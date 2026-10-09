"use strict";

/**
 * Мизоҷи OpenRouter (backend-only).
 *  - калид танҳо дар Authorization-и дархости HTTP меравад; ҳаргиз дар лог/ҷавоб нест;
 *  - timeout (AbortController), бозгашт бо экспоненсиалӣ + jitter, Retry-After (то ҳадд);
 *  - 429/5xx/timeout/шабака → такрор (ҳадди маҳдуд); 404/400 (модели дастнорас) → модели захиравӣ;
 *  - 401 (калид нодуруст), 402 (credits), 403 (модерацияи OpenRouter) → бе такрор, хатои ошкор;
 *  - ҳадди ҷамъи вақт ва ҳадди шумораи дархостҳо барои ҳар рӯз (назорати хароҷот).
 */

class AiError extends Error {
  /**
   * @param {"disabled"|"auth"|"credits"|"blocked"|"quota"|"too_large"|"unavailable"|"timeout"} code
   */
  constructor(code, message, details = {}) {
    super(message);
    this.name = "AiError";
    this.code = code;
    this.details = details;
  }
}

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const MODEL_UNAVAILABLE_STATUS = new Set([400, 404]);

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Матни кӯтоҳи хато барои лог — бе калид ва бе матни корбар */
function shortError(obj, text) {
  const msg = (obj && obj.error && obj.error.message) || text || "";
  return String(msg).replace(/sk-[A-Za-z0-9_-]{8,}/g, "sk-***").slice(0, 160);
}

function createOpenRouterClient(opts) {
  const {
    apiKey = "",
    baseUrl = "https://openrouter.ai/api/v1",
    models = [],
    timeoutMs = 20000,
    maxTotalMs = 25000,
    maxRetriesPerModel = 2,
    baseBackoffMs = 500,
    maxBackoffMs = 4000,
    maxRetryAfterMs = 5000,
    maxOutputTokens = 700,
    temperature = 0.3,
    dailyRequestLimit = 500,
    maxInputChars = 12000,
    referer = "",
    title = "OSHONA",
    fetchImpl = globalThis.fetch,
    sleep = defaultSleep,
    random = Math.random,
    now = () => Date.now(),
    logger = console,
  } = opts || {};

  const enabled = Boolean(apiKey) && models.length > 0;
  let budgetDay = "";
  let budgetCount = 0;

  function consumeBudget() {
    const day = new Date(now()).toISOString().slice(0, 10);
    if (day !== budgetDay) {
      budgetDay = day;
      budgetCount = 0;
    }
    if (budgetCount >= dailyRequestLimit) return false;
    budgetCount += 1;
    return true;
  }

  function backoffMs(attempt) {
    const exp = Math.min(maxBackoffMs, baseBackoffMs * 2 ** attempt);
    // jitter: 50%–100% аз exp
    return Math.round(exp * (0.5 + random() * 0.5));
  }

  function inputSize(messages) {
    return messages.reduce((n, m) => n + String(m.content || "").length, 0);
  }

  /**
   * Дархости chat. Бозгашт: { content, model, attempts }.
   * Хатогӣ: AiError (code: auth|credits|blocked|quota|too_large|unavailable|timeout).
   */
  async function chat({ messages, maxTokens = maxOutputTokens }) {
    if (!enabled) throw new AiError("disabled", "AI танзим нашудааст (OPENROUTER_API_KEY).");
    if (inputSize(messages) > maxInputChars) throw new AiError("too_large", "Матни дархост хеле калон аст.");

    const startedAt = now();
    const deadline = startedAt + maxTotalMs;
    const attempts = [];

    for (const model of models) {
      for (let attempt = 0; attempt <= maxRetriesPerModel; attempt++) {
        if (now() > deadline) {
          throw new AiError("timeout", "Вақти интизорӣ гузашт.", { attempts });
        }
        if (!consumeBudget()) {
          throw new AiError("quota", "Ҳадди рӯзонаи дархостҳои AI ба охир расид.", { attempts });
        }

        let res;
        let text = "";
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const headers = {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "X-Title": title,
          };
          if (referer) headers["HTTP-Referer"] = referer;
          res = await fetchImpl(`${baseUrl}/chat/completions`, {
            method: "POST",
            headers,
            body: JSON.stringify({
              model,
              messages,
              max_tokens: maxTokens,
              temperature,
              stream: false,
            }),
            signal: controller.signal,
          });
          text = await res.text();
        } catch (err) {
          const outcome = err && err.name === "AbortError" ? "timeout" : "network";
          attempts.push({ model, attempt: attempt + 1, outcome });
          logger.warn(`[ai] model=${model} attempt=${attempt + 1} natija=${outcome}`);
          if (attempt < maxRetriesPerModel && now() + backoffMs(attempt) < deadline) {
            await sleep(backoffMs(attempt));
            continue;
          }
          break; // модели навбатӣ
        } finally {
          clearTimeout(timer);
        }

        const json = safeJson(text);

        if (res.ok) {
          // OpenRouter баъзан дар статуси 200 хатои модельро ҳамчун error дар бадана медиҳад
          if (json && json.error) {
            const code = Number(json.error.code) || 502;
            attempts.push({ model, attempt: attempt + 1, outcome: `status_${code}` });
            logger.warn(`[ai] model=${model} attempt=${attempt + 1} status=${code} xato="${shortError(json, "")}"`);
            if (RETRYABLE_STATUS.has(code) && attempt < maxRetriesPerModel && now() + backoffMs(attempt) < deadline) {
              await sleep(backoffMs(attempt));
              continue;
            }
            break;
          }
          const content = json && json.choices && json.choices[0] && json.choices[0].message
            ? json.choices[0].message.content
            : undefined;
          if (typeof content === "string" && content.trim()) {
            attempts.push({ model, attempt: attempt + 1, outcome: "ok" });
            logger.log(`[ai] model=${model} natija=ok urdi=${attempt + 1}`);
            return { content, model: (json && json.model) || model, attempts };
          }
          // Посух холӣ аст — ҳамчун хатои муваққатӣ
          attempts.push({ model, attempt: attempt + 1, outcome: "empty" });
          logger.warn(`[ai] model=${model} attempt=${attempt + 1} natija=empty`);
          if (attempt < maxRetriesPerModel && now() + backoffMs(attempt) < deadline) {
            await sleep(backoffMs(attempt));
            continue;
          }
          break;
        }

        const status = res.status;
        attempts.push({ model, attempt: attempt + 1, outcome: `status_${status}` });
        logger.warn(`[ai] model=${model} attempt=${attempt + 1} status=${status} xato="${shortError(json, text)}"`);

        if (status === 401) throw new AiError("auth", "Калиди AI нодуруст аст (танзимоти сервер).", { attempts });
        if (status === 402) throw new AiError("credits", "Маблағи OpenRouter ба охир расидааст.", { attempts });
        if (status === 403) throw new AiError("blocked", "Дархост аз ҷониби фильтри бехатарӣ рад шуд.", { attempts });

        if (RETRYABLE_STATUS.has(status)) {
          if (attempt < maxRetriesPerModel) {
            const ra = Number(res.headers.get("retry-after"));
            let wait = backoffMs(attempt);
            if (status === 429 && Number.isFinite(ra) && ra > 0) {
              if (ra * 1000 > maxRetryAfterMs) break; // Retry-After зиёд аст — модели навбатӣ
              wait = ra * 1000;
            }
            if (now() + wait < deadline) {
              await sleep(wait);
              continue;
            }
          }
          break; // модели навбатӣ
        }

        if (MODEL_UNAVAILABLE_STATUS.has(status)) break; // модели дастнорас — навбатӣ
        break;
      }
    }
    throw new AiError("unavailable", "AI ҳоло дастнорас аст. Тавсияҳо аз рӯи меню тартиб дода мешаванд.", { attempts });
  }

  return {
    enabled,
    models: models.slice(),
    chat,
    stats: () => ({ day: budgetDay, requestsToday: budgetCount, dailyRequestLimit }),
  };
}

module.exports = { createOpenRouterClient, AiError };
