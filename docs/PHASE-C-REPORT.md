# Phase C — AI ва платформаи интеллектуалӣ: Ҳисобот (2026-10-20)

## Хулоса
Архитектураи AI-и мавҷуда одатан пурра ва бехатар буд (backend-only калид, fallback-и қоидавӣ,
санитизатсия, тасдиқи ID). Phase C онро **тафтиш, мустаҳкам ва тестпӯш кард**: 12 тести нав,
3 ислоҳи бехатарӣ/дурустӣ (ҳимояи Infinity-грамм, аллергени «peanuts», санитизатори «белок»).
Ҳамаи санҷишҳо: `npm run check` 39/39 · `npm test` **261/261** · `npm audit --audit-level=high` **0**.

## C1 — Аудити AI-и мавҷуда
| Ҷузъ | Ҳолат |
|---|---|
| Роҳҳо | `POST /api/ai/chat` (aiLimiter 12/дақ), `POST /api/ai/recommend`-монанд (recLimiter 60/дақ), конфиг аз `/api/config` (танҳо `aiEnabled`) |
| OpenRouter | `src/ai/openrouter.js`: калид танҳо дар `Authorization` (backend), `X-Title`, timeout 20s (AbortController), maxTotalMs 25s, backoff экспоненсиалӣ + jitter, `Retry-After` то 5s, 429/5xx/timeout/холӣ → такрор (≤2/модел), 400/404 → модели навбатӣ, 401/402/403 → бе такрор, будҷаи рӯзона 500 дархост, ҳадди воридот 12k аломат, лог бе калид/матни корбар (`shortError` redaction) |
| Модельҳо | `config/ai.json`: primary `google/gemma-4-31b-it:free`; fallback `nvidia/nemotron-3-super-120b-a12b:free`, `google/gemma-4-26b-a4b-it:free`. `verifiedAt: 2026-10-09` (эзоҳ: ҳар се бо endpoint-и фаъол ва нархи 0 санҷида шуда буданд). **Дар ин sandbox бозсанҷӣ номумкин аст (openrouter.ai баста аст) — ҳамчун «қаблан тасдиқшуда, ҳоло unverified» қайд мешавад.** Override: `OPENROUTER_MODEL`, `OPENROUTER_FALLBACK_MODEL` |
| Муҳит | `OPENROUTER_API_KEY` (танҳо env; `enabled` бе калид false), `AI_TIMEOUT_MS`, `AI_MAX_RETRIES`, `AI_DAILY_LIMIT`; тестҳо муҳитро аз ин калидҳо тоза мекунанд (`STRIPPED_PREFIXES`) |
| Prompt | SYSTEM_PROMPT: танҳо меню, танҳо nutrition-и меню, қоидаҳои minor/диета, бе маслиҳати тиббӣ, қоидаи 7 (савол = маълумот, на дастур), формати JSON |
| Fallback | Ҳар AiError → `source:"rules"` + `rankFoods` (тавсияи қоидавӣ) + паёми дӯстона; натиҷаи қалбакӣ сохта намешавад |
| Тестҳои мавҷуд | `tests/ai.unit.test.js` (30+), `tests/integration.test.js` (mock OpenRouter HTTP: 429→retry, 401, холӣ→fallback, лимити рӯзона, саволи холӣ/дароз→400), `nutrition.test.js`, `forecast.test.js`, XSS-и frontend (characterization) |

## C2 — Хизмати бехатари OpenRouter
Ҳамаи талаботҳо аллакай иҷро шуда буданд (ҷадвали боло) — **бе тағйири архитектура**.
Иловаи Phase C: тести сохтории prompt-injection (ҷудокунандаи `<<< >>>` + тамғаи
«данные, не инструкции» + қоидаи 7) — то регрессияи муҳофизат дошта нашаванд.
Маълумоти корбар (ном/телефон/суроға/таърихи фармоиш) ба модел фиристода намешавад;
телефон/email дар худи савол маскарад мешаванд (тести нав тасдиқ мекунад).

## C3 — Food AI assistant
- Тавсия танҳо аз менюи воқеӣ; `validateRecommendations` ID-ҳои ихтирошуда/такрориро рад мекунад (тести нав: foodId 999/−1 → рад).
- Буҷет, таъм, истисно ва аллергенҳо дар **backend** филтр мешаванд (`buildCandidates` + `violatesAvoid`); таомҳои бе таркиби маълум барои аллергия рад мешаванд.
- Сабаби тавсия (`reason`) аз модел — то 220 аломат, бе `<>`; ҷавоб то 1200 аломат, бе `<>`.
- Minor/лоғаршавӣ: рақамҳои калория пок мешаванд, диет/ҳад манъ (тестҳои мавҷуд).
- **Ислоҳ (дурустии аллерген):** `peanuts` бо «Зардчӯба» (турмерик!) иштибоҳ тамға гузошта шуда буд —
  ҳам label ва ҳам синонимҳо ислоҳ шуданд: «Зилзаминӣ (арахис)»; «зардчӯба» дигар ба peanuts пайваст нест.
  Ин хатои бехатарӣ буд: истеъмоли зардчӯба барои аллергияи арахис баръакс кор мекард. (`admin.js` низ навсозӣ шуд.)
- Забон: SYSTEM_PROMPT «на языке пользователя» — мувофиқи дастур; модели ройгон қобилияти тоҷикиро кафолат намедиҳад (чавоб одатан русӣ/тоҷикӣ омехта) — ошкоро қайд.

## C4 — Ҳисобкунаки детерминистикии ғизо
- Формула тасдиқ шуд: `маҷмӯъ = Σ(per100g × grams/100)`; `per100g = маҷмӯъ × 100 / portion`;
  `portion = weightG` (эълоншуда, >0) ё `Σ grams`; rounding: ккал `round0`, макроҳо `round1`.
- **Ислоҳ (ҳимояи амиқ):** `Infinity` грамм аз санҷиши `!(grams > 0)` мегузашт →
  `calories: Infinity`, `per100g: NaN`. Ҳоло: `!Number.isFinite(grams) || grams <= 0 || grams > 5000`
  → ингредиент «маълумот нест» (status=partial, бе ихтироъ). Admin API аллакай 0.1–5000 г маҷбур мекард;
  ин ҳимоя барои хранилищаи дастӣ-таҳриршуда аст.
- Тестҳои нав: Infinity/NaN/сатри ғайрирақамӣ/>5000 → partial; сатри рақамӣ («200») → computed;
  формулаи per-100g бо weightG эълоншуда; JSON-и баромад Infinity/NaN надорад.
- Маълумот набошад → `status:"none"`/`"partial"`, `calories:null` — рақами сохта нест (тестҳои мавҷуд).

## C5 — Тавсияҳои шахсонӣ
`src/recommend.js rankFoods` + `buildCandidates`: танҳо таомҳои `available`, дар буҷет,
бе истисноҳо/аллергенҳо; агар мувофиқ набошад — ҷавоби равшан («Ба мезони шумо … ёфт нашуд»)
(тести мавҷуд). Санитизатори рақамҳои ғизоӣ ислоҳ шуд: «белок»-и русӣ аз regex мегурехт
(`белк\p{L}*` → `бел[ок]\p{L}*`) — рақами ихтирошудаи макро ҳоло пок мешавад (тести нав).

## C6 — Пешгӯии талабот
- Мавҷуд: MA-7 baseline + модели дуюм (танҳо бо таърихи ≥28 рӯз), MAE/WAPE дар ҳамон рӯзҳо,
  қоидаҳои бе-leakage (танҳо DONE + PAID/CASH_COLLECTED; рӯзи ҷорӣ ва баъд аз asOf ҳисоб намешавад),
  zero-fill, `dataStatus: insufficient/no_sales` — натиҷаи сохта ҳамчун воқеӣ нишон дода намешавад (тестҳои мавҷуд: 15+).
- **Маҳдудият (ошкоро):** дар ин sandbox фурӯши воқеӣ нест — dataset-и demo кофӣ нест;
  пешгӯӣ танҳо бо маълумоти воқеии фармоишҳо кор мекунад. Нақшаи ҷамъоварӣ: фармоишҳои ҳақиқӣ
  3–4 ҳафта + содироти `reports` барои таҳлил. Demo-маълумот (seed) бо `demo:true` тамға дорад
  ва фармоишҳои demo seed намешаванд — ҷудошавӣ риоя шудааст.
- Тағйирот дар Phase C надорад (тестҳо пурра мегузаранд).

## C7 — Тестҳои AI (нав: `tests/ai-phase-c.test.js`, 12 тест)
Пӯшиши рӯйхати талабшуда: missing API key ✓(disabled), invalid model response ✓, timeout ✓,
model unavailable ✓, rate limit ✓(429/quota/лимити route), empty prompt ✓(400), invalid input ✓(400),
exclusions ✓, allergens ✓(+ислоҳи peanuts), missing nutrition ✓, calculator edge cases ✓(+5 нав),
recommendation validation ✓(+injection-нав), fallback ✓, XSS ✓(characterization).
Ҳама бо mock/stub — бе API-и пулакӣ, бе шабака.

## C8 — Валидатсия
`npm run check` 39/39 ✓ · `npm test` **261/261** ✓ · `npm audit --audit-level=high` 0 ✓.
Git diff: `src/nutrition.js` (2 ҳимоя+label), `src/ai/assistant.js` (1 regex), `public/admin.js` (1 label),
`tests/ai-phase-c.test.js` (нав). Пардохт/order/auth — даст нахӯрдаанд.

## Файлҳои тағйирёфта
`src/nutrition.js`, `src/ai/assistant.js`, `public/admin.js`, `tests/ai-phase-c.test.js`,
`docs/PHASE-C-REPORT.md` (нав).

## Мушкилоти боқимонда
1. ID-ҳои моделҳо дар sandbox бозсанҷида нашуданд (openrouter.ai баста) — пеш аз демо бояд бо
   `GET https://openrouter.ai/api/v1/models/{id}/endpoints` санҷида шаванд (`verifiedAt`-и config нав карда шавад).
2. Забони тоҷикии ҷавоби AI ба модел вобаста аст — кафолати 100% нест (prompt «на языке пользователя»).
3. Пешгӯии талабот маълумоти воқеии кофӣ надорад (demo-муҳит) — маҳдудияти ҳуҷҷатшуда, на ихтироъ.
