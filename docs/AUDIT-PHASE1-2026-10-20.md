# OSHONA.tj — Phase 1 Audit Report (independent re-verification)

**Date:** 2026-10-20 · **Auditor:** Arena agent (architect / full-stack / AI / UX review)
**Scope:** Full repository inspection at commit `4ce8106` (branch `arena/8c53f4e9-site`).
**Constraint compliance:** No files deleted, no code overwritten, no payment behavior/rules touched, nothing committed or pushed. This report is a NEW file; `docs/AUDIT.md` (the v1.5→v2.0 audit) is preserved unchanged.

---

## Verification actually performed (not assumed)

| Check | Result |
|---|---|
| `npm install` + `npm test` | **236 / 236 pass, 0 fail** (45 suites) — matches claim in `docs/AUDIT.md` |
| `npm run check` (node --check) | **36 / 36 files OK** |
| `npm audit --include=dev` | **0 vulnerabilities** (as of today) |
| Live server smoke test (temp DATA_DIR, port 3999) | Health, config, foods, security headers, 401/404 gating, dev-login, order creation with promo (`OSHONA10`: 136 → −14 → 122 TJS), payment instructions + QR, AI rule-fallback, recommendations — **all behaved exactly as documented** |
| PWA icons | All 4 files are valid PNGs (signature verified) |
| Git | Shallow clone; only the merge commit `4ce8106` is inspectable. The rollback tag `backup/pre-audit-7cc00c2` referenced by `docs/AUDIT.md` **does not exist in this checkout** |
| Reference repos | Inspected via GitHub API/web: shadcn-ui/ui, magicuidesign/magicui, tailwindlabs/tailwindcss, vercel/next.js, supabase/supabase, TanStack/query, vercel/ai, microsoft/playwright, vitest-dev/vitest. **`aceternity/aceternity-ui` returns 404 via the GitHub API** — Aceternity components are distributed via the ui.aceternity.com shadcn-style registry (React + Tailwind + Motion), not as a public repo at that URL. I could not inspect that repository and do not claim otherwise. |
| Secrets | `.env.example` contains no real secrets. No API keys found committed anywhere (verified by reading all config/source files). Nothing is reproduced in this report. |

---

## A. Existing architecture

**Stack:** Node.js ≥20 · Express 4 (CommonJS) · vanilla JS/HTML/CSS frontend (no build step) · JSON-file storage · OpenRouter LLM · Telegram Bot (webhook) · Railway deploy (Nixpacks + volume) · PWA (service worker v2).

```
server.js ── src/config.js (env load, production fail-closed checks)
        └── src/app.js     (all routes, DI of state/store/AI/Telegram)
             ├── src/security.js    JWT(HS256, 12h) · order access tokens (SHA-256 hash at rest,
             │                      timing-safe compare) · in-memory fixed-window rate limiters ·
             │                      CSP/nosniff/frame-deny/HSTS headers · JSON error handler
             ├── src/storage.js     JsonStore: atomic tmp→fsync→rename writes, .bak, fail-closed reads
             ├── src/validation.js  typed validators (str/num/int/phone/isoDate/timeHHMM, < > rejected)
             ├── src/orders.js      order state machine + server-side pricing
             │      online: AWAITING_PAYMENT → PAYMENT_REVIEW → CONFIRMED(PAID) → COOKING → DELIVERING → DONE
             │               (or PAYMENT_REJECTED; cancel-after-paid → REFUND_DUE)
             │      cash:   NEW → COOKING → DELIVERING → DONE(CASH_COLLECTED)
             │      AI never approves/rejects payments (enforced + tested)
             ├── src/payments.js    manual wallet flow: crypto payment codes (OSH-XXXXX), QR, wallet links
             ├── src/promos.js      percent/amount, expiry, maxUses, minTotal, ≤100% clamp, ≥1 somoni floor
             ├── src/reports.js     revenue split: ordered / approved-online / actually-collected / refundDue
             ├── src/nutrition.js   kcal & macros computed backend-side from ingredient catalog; no data → null
             ├── src/forecast.js    MA-7 + weekday-factor model, walk-forward MAE/WAPE, no leakage
             ├── src/preferences.js budget/taste/avoid + minor & weight-loss safety gating
             ├── src/recommend.js   deterministic rule-based ranker (always-on AI fallback)
             ├── src/ai/openrouter.js  retry/backoff/jitter, model fallback chain, daily quota, timeouts,
             │                         401/402/403 hard-fail, key never logged/returned
             ├── src/ai/assistant.js   system-prompt guardrails, PII masking, menu-ID validation of model
             │                         output, nutrition-claim sanitizer, rule fallback
             ├── src/telegram.js    webhook (timing-safe secret), user commands, admin commands gated by
             │                      numeric TELEGRAM_ADMIN_IDS in private chat, order deep-link tokens
             ├── src/menu.js src/uploads.js (magic-byte image validation, 5MB) src/util.js
public/  index.html · script.js (customer SPA-ish, esc() everywhere, event delegation, CSP-safe)
         admin.html · admin.js (JWT login, orders/reservations/menu/promos/reports/forecast tabs)
         sw.js (oshona-v2: never caches private API; foods network-first) · manifest · icons
tests/   236 node:test tests: characterization (payment flow frozen), security, orders, admin-api,
         nutrition, forecast, ai.unit (mock OpenRouter), integration (real server + mocks), frontend (jsdom)
seed/    foods.json (demo:true) · ingredients.json (orientative catalog, 36 items) · promos.json
```

**Assessment:** The architecture is coherent, defensively written, and unusually well-tested for a student project. Domain logic (orders/promos/nutrition/forecast/AI) lives in pure modules independent of Express — a genuinely good foundation that makes any future storage or frontend migration low-risk. The prior audit (`docs/AUDIT.md`, v2.0.0) is accurate: every claim I re-tested held up.

---

## B. Critical bugs

**No critical (data-loss / money-loss / auth-bypass) bug was found in the current code.** The v2.0.0 remediation is real and verified. What remains are functional defects and gaps (severity: M = medium, L = low):

| # | Sev | Finding (verified in code) |
|---|---|---|
| B1 | **M** | **Rejected-payment dead end:** backend allows `PAYMENT_REJECTED → PAYMENT_REVIEW` resubmission, but the customer UI (`script.js:496`) shows the "Пардохт кардан" button **only** for `AWAITING_PAYMENT`. A customer whose payment was rejected cannot retry from the site — exactly the state where retry matters most. |
| B2 | **M** | **Pickup never exposed:** `orders.js` validates and supports `method: "pickup"`, but checkout (`script.js`) hardcodes `method: "delivery"` and `index.html` has no pickup control. Dead backend feature / missing frontend feature. |
| B3 | **M** | **Rule-fallback ignores message semantics:** with AI disabled/unavailable, "ман гӯшт намехӯрам" in free text produces meat dishes (verified live: recommended Mojito/Cheesecake by budget only). Only the explicit preferences form feeds the rule engine; the message text is used solely for safety-intent detection. |
| B4 | **M** | **External hotlinks break the demo:** hero/gallery/about/map/feature images are Unsplash URLs in `style.css`; seed menu images are Unsplash; fonts are Google Fonts. On bad venue Wi-Fi (typical at competitions) or if Unsplash changes, the site looks broken. CSP `img-src https:` also permits any external image. |
| B5 | **L** | **Telegram webhook has no `update_id` dedup:** Telegram retries can re-run admin commands. The state machine absorbs double-approve with a 409, so impact is cosmetic (duplicate "Хато" replies). |
| B6 | **L** | **Bot answers free text in ANY chat** (incl. groups it's added to): 20 msg/min per chat, but the AI daily quota (500) is global — a group-chat flood degrades AI for real customers (quota DoS, not a breach). |
| B7 | **L** | **No rate limiter on `GET /api/orders/:id` / `/pay-info`:** token brute-force is infeasible (24-byte crypto token, uniform 404), but the routes are also the only unthrottled state-touching endpoints — inconsistent hardening. |
| B8 | **L** | **`mutate()` multi-file writes are sequential, not transactional:** a crash between writing `orders.json` and `promos.json` loses the promo `uses` increment. Single-writer design tolerates this; worth documenting. |
| B9 | **L** | **`nextId()` reuses deleted food IDs** (max+1). Old orders keep price/name snapshots so nothing corrupts, but ID reuse is a latent confusion source. |
| B10 | **L** | **Dead UI/CSS:** `#verTag` (admin.html) is never populated; `.mo-search` CSS is a leftover of the removed phone-search; `foodForm()` contains a no-op ternary. |
| B11 | **L** | **Unbounded in-memory growth:** `state.orders` + full-file synchronous JSON writes on every mutation; admin `GET /api/orders` returns everything with no pagination. Fine for demo scale, degrades at a few thousand orders. |
| B12 | **L** | **AI model IDs unverifiable here:** `config/ai.json` lists `google/gemma-4-31b-it:free` etc., "verified 2026-10-09". This sandbox has no OpenRouter access, so I **cannot** confirm they are still live. Must be re-checked before the event (the fallback chain + rule engine means the site never hard-fails, which is good design). |
| B13 | **L** | **Rollback tag missing:** `docs/AUDIT.md` cites `backup/pre-audit-7cc00c2`; the tag is absent from this (shallow) clone — the documented rollback point cannot be verified locally. |

---

## C. Security risks (residual, post-v2.0.0)

The v2.0.0 hardening is legitimate (verified by 47 security tests + live probes): production fail-closed config, order access tokens hashed at rest, PII removed from customer DTOs, phone-search removed, magic-byte upload validation, CSP, CORS allowlist, timing-safe comparisons, bcrypt, crypto payment codes, SW never caching private endpoints. Remaining risks:

| # | Sev | Risk | Notes |
|---|---|---|---|
| C1 | **M** | **Tokens in localStorage** (admin JWT + order tokens) | Standard XSS would exfiltrate them. XSS surface is currently well-controlled (esc() everywhere, no inline handlers, CSP `script-src 'self'`), but there is no token revocation/rotation for the admin JWT (12 h lifetime) and no CSP violation reporting to detect an incident. |
| C2 | **M** | **Hardcoded default wallet `034392828`** in `src/config.js` and `.env.example` | If production env vars are ever unset, the pay sheet silently displays the default wallet. I flag this **only as a configuration risk** — per constraints, payment destinations and behavior must not and were not changed. Recommendation: make missing wallets a production ConfigError (owner decision, changes no destination). |
| C3 | **M** | **No CI/CD:** no `.github/` at all | Tests exist but nothing enforces them; `npm audit` is manual. A future careless commit could silently break the payment state machine or reintroduce a vulnerable dep. Highest-leverage security fix available. |
| C4 | **M** | **AI quota abuse:** `/api/ai/chat` (12/min/IP) and `/api/promos/validate` (60/min/IP) are public; CGNAT/shared IPs make IP limiting coarse | Global daily AI cap (500) contains cost, but a flood degrades service. WAF/Cloudflare was already suggested in AUDIT.md R8 — still open. |
| C5 | **L** | **Prompt-injection residual** | System prompt fences user text as data, model output is ID-validated and nutrition-claim-sanitized — strong mitigation. Residual risk is inherent to any LLM feature; model can still produce off-menu *text* (never off-menu actions, since only actions are ID-gated). |
| C6 | **L** | **PII at rest unencrypted** | Names/phones/addresses sit in `orders.json` on the Railway volume; no retention policy or export/delete tooling. Acceptable for demo; needed for real operations (TJ personal-data law alignment is out of scope here). |
| C7 | **L** | **In-memory rate limiters** are per-process | Correct for single instance (documented R1); ineffective if ever scaled to multiple replicas. |
| C8 | **L** | **CSP `style-src 'unsafe-inline'`, `img-src https:`** | Inline styles are used by the frontend (`style="background-image:…"`); tightening requires refactoring to CSS classes — cosmetic gain, low priority. |
| C9 | **L** | **No security.txt / no LICENSE / no dependency-update policy** | Hygiene items judges occasionally notice. |

**Secrets check:** no key/token/password is committed anywhere in the repo (`.gitignore` covers `.env`, `data/*`). The JWT shown during my smoke test was a throwaway dev-mode random secret generated inside the sandbox; it is not reproduced here and grants nothing.

---

## D. UI/UX improvements

The visual design is already tasteful (dark-gold "restaurant" identity, Playfair/DM Sans, pay-sheet styled like a wallet sheet, install banner, tabbar). Weaknesses, ordered by demo impact:

1. **Accessibility (measurable, judges notice):**
   - Checkout/search/AI inputs use placeholder-only — **no `<label>` elements** in the checkout modal.
   - **No Escape-key handling anywhere** (verified: zero `keydown` listeners) and no focus trap/`role="dialog"`/`aria-modal` on modals, drawer, search and AI screens.
   - Food cards open via click on `<article data-open>` — not keyboard reachable (no `tabindex`/`role="button"`/Enter handling).
   - Tabbar has no `aria-current`; toasts/`aria-live` are correctly done (keep).
2. **Order-status experience:** after ordering, status only updates when the customer manually reopens "Фармоишҳои ман". No polling/SSE, no customer Telegram notification on approve/reject (known R11). For a *food platform* pitch this is the biggest experiential gap.
3. **Flow dead ends:** rejected-payment retry missing (B1); pickup missing (B2); no customer-side cancel for unpaid orders.
4. **Placeholder content undermines credibility:** hero "★ 4.9/5" is hardcoded; phone `+992 90 000 00 00`; footer Instagram/Telegram `href="#"`; demo menu (`demo:true`) with Unsplash photos; "Мисли Google Pay" eyebrow on the pay sheet invites brand-comparison questions from judges.
5. **Performance/LCP:** 2200px Unsplash hero + external fonts, background-image food cards (no `loading="lazy"`, no alt text, no width/height → layout stability). Self-hosting + `next/picture`-style srcset (or plain `<img loading=lazy>`) would visibly speed up the demo.
6. **Admin panel:** functional but dated — `confirm()/prompt()` dialogs, no order search/filter/status tabs, no pagination, no charts (forecast/reports are raw tables), no date-range picker (backend `summarizeRevenue` already supports `fromMs/toMs` but it's not exposed), event timestamps rendered with `ru-RU` locale inside a Tajik UI, no CSV export.
7. **Language:** customer site is Tajik-only, admin mixes Tajik UI with Russian event locales; no i18n scaffolding. For an international-ish science fair, at least an EN/RU toggle on the customer side is a differentiator.
8. **Meta/sharing:** no OG/Twitter tags; `<title>`/description are English on a `lang="tg"` site.
9. Minor: `.mo-card` dark-on-light contrast is fine, but rejected-reason text `#9b2c2c` on light card is small; pay-sheet QR hidden gracefully (good); offline menu via SW works (good).

---

## E. Missing functionality

**Customer-facing:** pickup option (B2); payment retry after rejection (B1); order cancellation (unpaid); live order tracking; customer notifications (Telegram push on approve/reject/cooking/delivering); accounts & cross-device order history (currently device-local tokens by design); reorder/favorites; reviews/ratings; menu variants (size/spice); delivery fee & zone logic; opening-hours enforcement (site says 09:00–23:00; orders are accepted 24/7); multi-language.

**Admin/ops:** reservation capacity management (any number of tables can be "booked" for the same slot); order filtering/search/pagination; analytics charts; date-ranged reports (backend ready, not exposed); CSV/XLSX export; refund workflow tracking (REFUND_DUE is recorded but has no admin checklist/state); automatic Telegram notification to customer (R11); stock/"86" automation.

**Platform:** CI/CD pipeline; real browser E2E tests (R9); structured logging/request IDs/uptime monitoring; backup automation beyond `.bak` (no offsite copy); multi-instance data store (R1); rate limiting at edge (R8).

**AI:** streaming responses (currently up-to-20 s silent wait; `stream:false` in openrouter.js); Tajik-quality eval set (R12 — 20-question manual benchmark was proposed, not built); semantic understanding in rule-fallback (B3); conversation memory per Telegram chat exists (prefs) but website chat history is client-side only.

---

## F. Recommended architecture

**Core recommendation: DO NOT migrate frameworks.** There is no demonstrated need: the Express monolith passes 236 tests, has clean domain separation, correct-by-construction payment rules, and a working PWA. A Next.js/React rewrite would discard a verified-secure payment core under competition time pressure — that is how student projects die. Constraint #8 applies squarely.

**Target architecture (evolutionary, keeps every existing guarantee):**

```
┌─ Phase A: harden what exists (no framework change) ────────────────────────┐
│ Express monolith + vanilla frontend (unchanged core)                       │
│ + GitHub Actions CI: npm ci → check → test → npm audit → Playwright E2E    │
│ + Playwright specs: order flow, pay sheet, rejected-retry, admin approve,  │
│   AI fallback, PWA offline, XSS canaries (fills R9)                        │
│ + self-hosted assets (images/fonts/icons) — demo-resilient                 │
│ + a11y pass (labels, ESC, focus trap, dialog roles, keyboard cards)        │
│ + order-status polling (or SSE) + customer Telegram notifications (R11)    │
│ + fix B1/B2/B3, expose pickup, expose date-ranged reports                  │
└────────────────────────────────────────────────────────────────────────────┘
┌─ Phase B (optional, after approval): AI & data upgrades ───────────────────┐
│ + vercel/ai SDK **server-side only** for streaming chat (OpenRouter is     │
│   OpenAI-compatible; keep existing fallback/quota/sanitizers as wrapper)   │
│ + Storage adapter interface around JsonStore (already 90% there via DI)    │
│   → swap-in Supabase Postgres without touching domain modules;             │
│   Supabase Realtime could later replace polling; RLS for admin             │
│ + Redis (or Supabase) rate limits only if multi-instance ever happens      │
└────────────────────────────────────────────────────────────────────────────┘
┌─ Phase C (only if owner explicitly chooses the React path) ────────────────┐
│ Next.js 15 frontend consuming the SAME Express API (frontend-only rewrite; │
│ backend & payment core untouched) + Tailwind + shadcn/ui + MagicUI/        │
│ Aceternity-style animations + TanStack Query                               │
│ Trade-off: prettiest result, highest risk/effort; justified only if the    │
│ competition story is "modern web engineering" over "working platform".     │
└────────────────────────────────────────────────────────────────────────────┘
```

Payment behavior, payment destinations, and order verification/approval rules remain **byte-for-byte identical** in all phases (characterization tests already freeze them — any PR touching them fails CI by design).

---

## G. Relevant reference repositories (fit analysis)

| Repo | Inspected | Fit for OSHONA |
|---|---|---|
| tailwindlabs/tailwindcss | ✅ API meta | **Fits even without React** — CLI build producing one static CSS file works with the current vanilla HTML. Optional; current hand-written CSS is coherent. |
| microsoft/playwright | ✅ API meta | **High fit, adopt in Phase A.** Directly closes audit gap R9 (no real-browser testing). Chromium-only headless in CI keeps it fast. |
| vercel/ai | ✅ API meta | **Partial fit (Phase B, server-side).** TypeScript-first but usable from plain Node; would add streaming. Keep the existing tested client as the fallback path — do not rip it out. |
| supabase/supabase | ✅ API meta | **Phase B option** for Postgres + Realtime + storage, replacing JSON files/volume. Only with demonstrated need (multi-instance or real traffic). Migration path is clean thanks to existing DI. |
| shadcn-ui/ui | ✅ API meta | **Requires React + Tailwind (Radix-based).** Phase C only. |
| magicuidesign/magicui | ✅ package.json read | **Requires React/Tailwind/Motion** (pnpm+turbo monorepo, Node ≥22). Copy-paste registry. Phase C only. |
| aceternity/aceternity-ui | ⚠️ **GitHub 404** — repo not public at that path; product verified via web search: copy-paste React+Tailwind+Motion components distributed through ui.aceternity.com registry | Phase C only; source components from their registry, not GitHub. |
| vercel/next.js | ✅ API meta | Phase C only (frontend rewrite). Not needed for any Phase A/B goal. |
| TanStack/query | ✅ API meta | React (and other framework) adapters only — **not applicable** to the vanilla frontend; the existing 40-line `api()` fetch wrapper is proportionate. Phase C only. |
| vitest-dev/vitest | ✅ API meta | **Not needed while on node:test** (zero-config, native, already 236 green tests). Becomes relevant only with a Vite/TS/React stack (Phase C). |
| openai/openai-cookbook | known patterns repo | Useful reading for Phase B: structured outputs, function-calling for menu queries, injection defenses, LLM evals — patterns are portable to the OpenRouter client. |
| practical-tutorials/project-based-learning | learning index | Not an implementation dependency; good source for the competition write-up's "further work" section. |

---

## H. Prioritized implementation plan (proposal — awaiting approval)

**P0 — Competition-critical (est. effort: small, risk: low)**
1. GitHub Actions CI: `check` + `test` + `npm audit` on every push/PR (protects the frozen payment behavior).
2. Fix B1 (rejected-payment retry button) and B2 (pickup vs delivery selector in checkout — backend already supports it; **no pricing/payment logic changes**).
3. Self-host all images/fonts (remove Unsplash + Google Fonts hotlinks); add `loading="lazy"`, alt text.
4. A11y pass: labels, ESC-to-close, focus trap, `role="dialog"`, keyboard-openable food cards, `aria-current` on tabbar.
5. Replace placeholder content: real (or clearly-demo) phone/socials/rating; reconsider "Мисли Google Pay" copy.
6. Re-verify OpenRouter model IDs from a machine with API access (B12); document the check in README.

**P1 — Platform polish (est. effort: medium)**
7. Playwright E2E suite (customer order → pay sheet → admin approve → status; AI-off fallback; offline PWA) wired into CI.
8. Order-status live updates: lightweight polling first (e.g., 15 s while an active order exists), SSE optional; customer Telegram notification on approve/reject/status change (R11) — **notification only; approval rules untouched**.
9. Rule-fallback intent parsing (B3): extract avoid/taste keywords from the message text when AI is unavailable.
10. Admin UX: order filters/search/pagination, date-ranged reports (expose existing `fromMs/toMs`), simple forecast/report charts, CSV export.
11. Streaming AI responses (Phase B scope) if time permits; Telegram `update_id` dedup (B5); rate limiter on order GET routes (B7); missing-wallet production warning (C2, config-only).

**P2 — Strategic (only with explicit approval; larger effort)**
12. Storage adapter → Supabase Postgres (+ Realtime, offsite backup) — resolves R1/R6-class limits.
13. Optional Next.js + Tailwind + shadcn/MagicUI frontend rebuild (Phase C) — cosmetic ceiling, highest risk; recommend only if P0/P1 are done and schedule allows.
14. i18n (tg/ru/en), customer accounts, reviews — post-competition roadmap.

**Explicitly out of scope (constraints):** any change to payment destinations, payment behavior, discount math, or order verification/approval rules; deleting files; framework migration without demonstrated need.

---

## I. Testing strategy

**Current state (verified):** 236 node:test tests across 9 suites — characterization (freezes v1.5 payment/order behavior), security/access (47), orders/state-machine (49), admin API, nutrition, forecast (MAE/WAPE with known-answer data), AI client (mock OpenRouter: 429/timeout/empty/401-403/quota), integration (real spawned server + mock Telegram/OpenRouter), frontend (jsdom: XSS, cart, offline, pay sheet, admin). Mocks are well-built (`tests/support/mocks.js`). This is already better than most production codebases.

**Gaps and additions (in priority order):**
1. **Real-browser E2E (Playwright, Chromium headless):** the jsdom suite cannot catch layout, focus, SW-install, clipboard or CSP-in-browser regressions (audit R9). Target flows: browse → cart → checkout → pay sheet → "paid" → admin login → approve → customer sees CONFIRMED; rejected → retry (after B1 fix); offline menu via SW; AI-off fallback banner.
2. **CI enforcement:** run `check`, `test`, `audit`, and E2E on every push; fail merges on red. Add `--experimental-test-coverage` reporting to track blind spots (target: keep domain modules ≥90%).
3. **Payment-behavior guard:** characterization suite is the contract — CI must treat any diff there as a breaking change requiring explicit human sign-off (aligns with the "do not change payment behavior" constraint).
4. **AI quality eval set (R12):** 20–30 Tajik questions with expected properties (must recommend only menu IDs, no invented kcal, minor/weight-loss guardrails fire); runnable manually against the real API pre-event; assert-in-CI only against the mock.
5. **Security regression canaries:** keep and extend the XSS/`javascript:`-URL/upload-signature tests; add a Playwright CSP-violation listener to catch inline-script regressions in a real browser.
6. **Performance budget (optional):** Lighthouse CI on the static site (a11y ≥ 95, perf ≥ 80 after asset self-hosting).
7. **Load smoke (optional, post-competition):** the synchronous full-file JSON write is the known bottleneck; a simple autocannon run against `/api/orders` would quantify R1 for the write-up.
8. **Vitest:** adopt only if a Vite/TS/React stack is approved (Phase C); otherwise node:test stays — zero-dependency and already green.

---

## Summary judgment

OSHONA.tj v2.0.0 is a **well-engineered, security-hardened, thoroughly tested single-instance platform** whose prior audit claims are honest and reproducible. It does not need a rescue; it needs (1) a handful of real functional fixes (B1–B3), (2) demo-resilience (self-hosted assets, verified AI models, CI), (3) accessibility and live-status polish, and (4) a decision from the owner on how far to go architecturally (Phase A/B/C above). The React/Next.js reference stack (shadcn, MagicUI, Aceternity, TanStack Query) only applies if a frontend rebuild is explicitly chosen; Playwright and (later) Supabase/vercel-ai fit the existing stack directly.

**No code was modified. Nothing was committed or pushed. Awaiting approval to proceed with P0.**
