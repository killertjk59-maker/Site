# Phase A Implementation Log — 2026-10-20

Базавӣ: `docs/AUDIT-PHASE1-2026-10-20.md` (одит). Ин ҳуҷҷат **ҳар тағйирот** ва **натиҷаҳои воқеии тест**-ро қайд мекунад.
Ҳеҷ файл нест/overwrite нашуд; ҳеҷ чиз commit/push нашуд; рафтор ва конфигуратсияи пардохт дастнорас монд.

## Натиҷаҳои воқеӣ (иҷрошуда дар ин муҳит)

| Санҷиш | Натиҷа |
|---|---|
| `npm run check` | **37/37** файл дуруст (36 + тести нав) |
| `npm test` (ҳама) | **241 / 241 pass, 0 fail** (236 кӯҳна + 5 нав) |
| `tests/frontend.test.js` (кӯҳна) | **15 / 15 pass** — бе тағйир |
| `tests/frontend-phase-a.test.js` (нав) | **5 / 5 pass** |
| `npm audit --audit-level=high` | **0 vulnerabilities** |
| Smoke: pickup-фармоиш (нақд) | `method: pickup`, бе суроға, `status NEW` ✓ |
| Smoke: B1 — reject → такрори мизоҷ | `PAYMENT_REJECTED` → `payment-submitted` бо токен → `PAYMENT_REVIEW / IN_REVIEW` ✓ |
| Smoke: валидатсияи расм | `/img/foods/steak.jpg` → 200; `javascript:alert(1)` → 400; `/img/../../package.json` → 400 ✓ |
| Smoke: қоидаи пардохт (бе тағйир) | тасдиқи фармоиши **нақдӣ** ҳамчунон **409** ✓ |
| Smoke: активҳо | `/fonts/*.woff2` → `font/woff2`, `/img/*.jpg` → `image/jpeg`; `index.html` — **0** истиноди берунӣ ✓ |

## Тағйирот, файл ба файл

### Файлҳои нав
| Файл | Мазмун |
|---|---|
| `.github/workflows/ci.yml` | CI (P0-1): Node 20+22 → `npm ci` → `npm run check` → `npm test` → `npm audit --audit-level=high`. Триггерҳо: push (main, arena/**), PR, workflow_dispatch. Характеризатсияи пардохт дар CI муҳофизат мешавад. |
| `tests/frontend-phase-a.test.js` | 5 тести нав (jsdom): pickup, пардохти такрорӣ (B1), ESC, Enter-дар-корт, расмҳои `/img/`. |
| `public/fonts.css` + `public/fonts/` (17 woff2, 276 KB) | Шрифтҳои худмизбон аз Fontsource (DM Sans 400/500/600/700 latin+latin-ext; Playfair Display 500/600/700 latin+latin-ext+cyrillic) + LICENSE-ҳо. Ивази Google Fonts hotlink. Эзоҳ: Fontsource/Google барои Playfair subsets-и `cyrillic-ext` надорад — аломатҳои тоҷикӣ (ҳ,ҷ,ғ,қ,ӯ) ҳамчун пештар бо шрифти системавӣ нишон дода мешаванд (регрессия нест). |
| `public/img/…` (10 JPEG, ~1.8 MB) | hero, feature, about, gallery-1, gallery-3 + 5 расми таом (AI-генератсия, бренди гарм-торик). Ивази Unsplash hotlink. |
| `docs/AUDIT-PHASE1-2026-10-20.md` | (аз қадами аудит) |

### Тағйироти ҷарроҳӣ дар файлҳои мавҷуда
| Файл | Тағйирот | Чаро бехатар |
|---|---|---|
| `public/index.html` | Google Fonts → `fonts.css` + preload; checkout: **label**-ҳои воқеӣ, select-и `fulfilment` (delivery/pickup), `role="dialog" aria-modal` барои ҳама қабатҳо, `aria-label` барои тугмаҳои пӯшиш ва input-ҳо; eyebrow «Мисли Google Pay» → «ПАРДОХТИ БЕХАТАР» (танҳо матн). | ID-ҳо ва номҳои майдонҳо (`name/phone/address/method/promo`) ҳамон монданд — тестҳо ва backend бе тағйир. |
| `public/script.js` | (B2) `method: fulfilment` аз select-и нав; `syncFulfilment()` суроғаро барои pickup пинҳон/ихтиёрӣ мекунад; (B1) тугмаи «Аз нав пардохт кардан» барои `PAYMENT_REJECTED`; ESC-handler; Enter/Space дар корти таом (`tabindex=0 aria-haspopup`); `aria-current` дар таббар; focus ба майдони аввал ҳангоми checkout. | Ҳеҷ даст ба `payWithBank`, `confirmPaymentSubmitted`, токенҳо ё нархҳо. |
| `public/style.css` | 7 URL-и Unsplash → `/img/…`; map-card → градиенти CSS; CSS-и мурдаи `.mo-search` ҳазф; илова: `:focus-visible`, `.food-card:focus-visible`, `.fld` (label-ҳо). | Танҳо визуалӣ/дастрасӣ. |
| `public/admin.js` | `loadVersionTag()` — `#verTag` (B10) аз `/api/config` пур мешавад (бо catch). | Ғайриҳатмӣ; 404 → бе таъсир. |
| `src/menu.js` | `IMAGE_STATIC_RE` — иҷозати `/img/…(jpg|jpeg|png|webp)` дар `validateImage`. | `javascript:`, `http://`, traversal ҳамчунон рад (тест + smoke). |
| `seed/foods.json` | 5 таом → расмҳои локалӣ; 3 таом (cheesecake, mojito, chef-signature) → `""` (placeholder-и 🍽). | Расмҳои боқимонда дар навбати оянда генератсия мешаванд (лимити 10/turn). |

## Он чи дар ин давр **иҷро нашуд** (шаффоф)
1. **3 расми таом** (cheesecake, mojito, chef-signature): лимити генератсияи тасвир (10/turn) расид — ҳоло placeholder-и боназокат; дар навбати оянда генератсия + иваз дар `seed/foods.json`.
2. **Playwright E2E (P1)**: браузерҳоро дар ин sandbox боргирифтан мумкин нест (cdn баста аст); workflow-и CI ҳоло бе E2E-ҷоб аст. Спеки Playwright дар қадами оянда (дар CI-и GitHub кор мекунад).
3. **Матнҳои placeholder** (телефон, Instagram/Telegram, «★ 4.9»): интизори маълумоти воқеии соҳиб — аз одит P0-5; бе маълумоти шумо сохта намешавад.
4. **B3 (семантикаи rule-fallback), polling/SSE, огоҳиҳои Telegram ба мизоҷ, ҳисоботи date-ranged** — P1; баъд аз тасдиқи шумо.
5. **Санҷиши ID-ҳои модели OpenRouter** — аз ин муҳит дастрасӣ ба OpenRouter нест; пеш аз мусобиқа дастӣ санҷед (`GET /api/v1/models/{id}/endpoints`).
6. **CI воқеан иҷро нашуд** — push манъ аст; workflow танҳо пас аз push-и шумо дар GitHub кор мекунад. Ҳамаи қадамҳои он (ci → check → test → audit) дар ин ҷо дастӣ иҷро ва гузаштанд.

---

## Independent Review (2026-10-20, пас аз Phase A)

| Санҷиш | Натиҷа |
|---|---|
| Диф-тест бар зидди **original HEAD** (25 ҷараён: online/cash/pickup, submit→reject→retry→approve, статусҳо, 409-ҳо, промо, валидатсия, authZ, ҳисобот) | **25/25 IDENTICAL**; ягона фарқият — `/img/…` валидатсия (400→200), ҳуҷҷатшуда |
| Скани сиррҳо (код+ҳуҷҷат+расмҳо: Exif/GPS/XMP нест) | тоза |
| package.json ↔ package-lock | мувофиқ, lock бе тағйир; fontsource дар lock нест |
| 36 активи истинодшуда (html/css/fonts/seed/manifest/sw) | ҳама HTTP 200, content-type дуруст |
| LICENSE-ҳо | OFL матн дар public/fonts/; манбаи расмҳо ҳуҷҷатшуда |
| Валидатсияи `/img/`: `//`, `.JPG`, `../`, `.svg`, `?query`, `http://` | ҳама 400; танҳо шакли дуруст 200 |
| Rate limit / сарлавҳаҳо / CSP / 401-404 | бе тағйир (429 пас аз 10 кӯшиш) |
| ci.yml (YAML parse) | дуруст: triggers push/PR/dispatch, matrix 20+22, pinned @v4, cache npm, 4 гейт |
| `npm run check` / `npm test` / `npm audit --audit-level=high` | 37/37 · **241/241** · 0 |

**Маҳдудияти санҷиш:** браузер дар sandbox нест — визуалӣ/ESC/focus/SW-кэш дар браузери воқеӣ санҷида НАШУД (танҳо jsdom + HTTP).
