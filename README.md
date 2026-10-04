# 🍽️ OSHONA — Сайт + Бэкенд (Railway-ready)

Фронтенд + бэкенди Node.js. Маълумот дар файлҳои `data/*.json` нигоҳ дошта мешавад.
Лоиҳа барои хостинги **Railway** омода аст (`railway.toml` дохил).

## 📁 Сохтори лоиҳа

```
oshona-app/
├── server.js          ← бэкенд (Express API)
├── package.json
├── railway.toml       ← танзимоти Railway
├── .env.example       ← намунаи танзимот (нусхабардорӣ кун → .env)
├── seed/foods.json    ← менюи аввал (барои деплойи аввал)
├── data/              ← «база» (дар git нест, дар Railway — дар Volume)
└── public/            ← сайт (index, admin, style, script)
```

## 🚀 Истифода дар компютер

```bash
cd oshona-app
cp .env.example .env
npm install
npm start
```

- Сайт: http://localhost:3000
- Админ: http://localhost:3000/admin.html (`admin` / `admin123`)

## 🌍 Деплой ба Railway (қадам ба қадам)

### 1️⃣ Бор кардан ба GitHub
```bash
git init
git add .
git commit -m "OSHONA site + backend"
git branch -M main
git remote add origin https://github.com/USERNAME/REPO-NAME.git
git push -u origin main
```
> `USERNAME` — номи GitHub-и шумо, `REPO-NAME` — номи репозитория (масалан `oshona-site`).

### 2️⃣ Пайваст кардан ба Railway
1. Дар [railway.com](https://railway.com) → **New Project** → **Deploy from Repo** → репозиторияро интихоб кунед.
2. Railway худаш `npm install` ва `npm start`-ро меёбад (Nixpacks).
3. Дар **Variables** ҳаминҳоро илова кунед (аз `.env.example` нусхабардорӣ кунед):

| Variable | Мисол |
|---|---|
| `JWT_SECRET` | матни тасодуфии дароз (масалан `oshona-x7k9-...`) |
| `ADMIN_USERNAME` | `admin` |
| `ADMIN_PASSWORD` | пароли пурқувват (ҳатман иваз кунед!) |
| `DUSHANBE_CITY_WALLET` | рақами ҳамёни шумо |
| `DUSHANBE_CITY_NAME` | `OSHONA` |
| `ALIF_WALLET` | рақами ҳамёни шумо |
| `ALIF_NAME` | `OSHONA` |

   `PORT`-ро **нанависед** — Railway худаш медиҳад!

### 3️⃣ Volume барои нигоҳдории фармоишҳо (МУҲИМ!)
Бе Volume — бо ҳар деплой фармоишҳо **пок мешаванд**! 😱

1. Дар Railway → Service → ҷадвали **Volumes** → **New Volume**.
2. Mount Path: **`/app/data`**
3. **Redeploy** кунед. Меню худкор аз `seed/` пур мешавад 🌱

### 4️⃣ Домен
Settings → Networking → **Generate Domain** → сайти шумо дар интернет! 🎉

Админ-панел: `https://САЙТИ-ШУМО/admin.html`

## 📷 Боркунии расм (бе URL!)

Дар панели админ → ҷадвали **Меню**:
- Таоми нав: тугмаи **«📷 Расм интихоб кун»** → аз телефон/компютер интихоб кунед → пешнамоиш мебинед → «Илова кардан»
- Таоми кӯҳна: тугмаи **«🖼 Ивази расм»** дар корти таом

Расмҳо дар сервер (`/uploads/...`) нигоҳ дошта мешаванд, дар Railway — дар Volume, яъне бо деплой гум намешаванд ✅

## 💳 Пардохт (Алиф / Душанбе Сити + QR)

Пул ба ҳамёни шумо меравад: **`034392828`** (дар `.env` / Railway Variables иваз карда мешавад).

Муштарӣ фармоиши онлайн медиҳад → равзанаи пардохт кушода мешавад:
- 💰 Сумма **автомати ҳисоб** ва калон нишон дода мешавад
- 🏦 2 тугма: **🟢 Пардохт бо Алиф** / **🔵 Душанбе Сити** — ҳамён + сумма + код автомати **нусха** мешаванд
- 🖼 **QR-код** (бо app-и бонк скан кардан) + тугмаҳои «Нусха»
- «Пардохт кардам ✓» → фармоиш ба админ барои санҷиш меравад

> 🔗 **Линкҳои автомати (app-кушоӣ):** Душанбе Сити ([aquaring.dc.tj](https://aquaring.dc.tj), комиссия 1%) ва Алиф линкҳои пардохтро танҳо бо **шартномаи merchant** медиҳанд. Вақте шартнома гирифтед — формати линкро ба `DC_PAY_URL` / `ALIF_PAY_URL` гузоред (`{wallet}` `{amount}` `{code}` автомати пур мешаванд) ва тугмаҳо бевосита app-ро мекушоянд. Google Pay-и мустақим дар Тоҷикистон барои қабули пул кор намекунад.

## 📲 Барномаи Android (PWA)

Сайт ҳамчун **барнома** насб мешавад — бе Play Market:

1. Дар телефон бо **Chrome** сайтро кушоед (`https://...railway.app`)
2. Дар поён баннер мебарояд → **«Насб»**-ро пахш кунед
   - Агар баннер набошад: менюи Chrome **⋮** → **«Насб кардани барнома»** / **«Добавить на главный экран»**
3. Иконкаи **OSHONA** дар экран пайдо мешавад — мисли барномаи асли кушода мешавад, меню ҳатто офлайн кор мекунад ✅

> 📦 **Файли APK лозим бошад:** ба [pwabuilder.com](https://www.pwabuilder.com) дароед → суроғаи сайтро нависед → **APK зеркашӣ кунед**. Барои Play Market — ҳисоби Developer ($25) лозим, бигӯед — роҳнамоӣ мекунам.

## 🔌 API

| Метод | Роҳ | Кӣ? |
|---|---|---|
| GET | `/api/foods` | ҳама |
| POST | `/api/upload` | админ (расм, max 5MB) |
| POST/PUT/DELETE | `/api/foods...` | админ |
| POST | `/api/orders` | ҳама |
| GET | `/api/orders` | админ |
| POST | `/api/orders/:id/payment-submitted` | ҳама |
| POST | `/api/orders/:id/approve-payment` | админ |
| POST | `/api/orders/:id/reject-payment` | админ |
| PATCH | `/api/orders/:id/status` | админ |
| POST/GET | `/api/reservations` | ҳама / админ |
| POST | `/api/auth/login` | ҳама |

## ⚠️ Муҳим
- Пароли `admin123`-ро ҳатман иваз кунед (дар Railway Variables).
- Барои ресторани калон (100+ фармоиш/рӯз) — ба PostgreSQL гузаред (дар Railway як клик аст, бигӯед — кӯмак мекунам).
