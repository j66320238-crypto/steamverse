# 🚀 StreamVerse — Deploy Guide (Public Link + 24/7 Online)

Sabse easy tarika: **Render.com** (free, public link milta hai, GitHub se auto-deploy).

---

## Step 1 — Code GitHub par daalo

1. https://github.com par free account banao
2. **New repository** → naam do `streamverse` → Create
3. Apne computer me `streamverse` folder ke andar ye commands chalao:

```bash
git init
git add .
git commit -m "StreamVerse v2"
git branch -M main
git remote add origin https://github.com/APNA_USERNAME/streamverse.git
git push -u origin main
```

> Agar git install nahi hai to repo me **Add file → Upload files** se saari files upload
> kar do (folder structure waisa hi rakho: `server.js`, `package.json`, `public/...`).

---

## Step 2 — Render par deploy (2 minute)

1. https://render.com → **GitHub se sign in** karo
2. **New → Web Service** → apna `streamverse` repo select karo
3. Settings aise rakho:

| Setting | Value |
|---|---|
| Name | `streamverse` |
| Branch | `main` |
| Region | Singapore (India ke closest) |
| Runtime | `Node` |
| Build Command | *(khaali chhod do)* |
| Start Command | `node server.js` |
| Plan | **Free** |

4. (Recommended) **Environment Variables** me add karo: `TMDB_KEY` = apni free TMDB key
   (themoviedb.org → Settings → API). `render.yaml` bhi repo me diya hai; Blueprint import karoge to `TMDB_KEY` ko Render Secret me fill karo.
5. **Deploy Web Service** dabao.

✅ 1–2 minute me public link ready:
**`https://streamverse.onrender.com`** — ye link kisi ko bhi bhej sakte ho!

Ab jab bhi GitHub me naya code push karoge, site **auto-update** ho jayegi.

---

## Step 3 — 24/7 online rakho (free)

Render ka free plan 15 minute idle rehne par "so" jaata hai (agle visitor par ~30s me
khud jaag jaata hai). Hamesha awake rakhne ke liye:

1. https://uptimerobot.com → free account
2. **Add New Monitor**:
   - Monitor Type: **HTTP(s)**
   - Friendly Name: `StreamVerse`
   - URL: `https://streamverse.onrender.com/api/health`
   - Interval: **5 minutes**
3. Save. Bas — ye har 5 min me ping karega aur site 24/7 awake rahegi ✅

---

## 🔄 Backup deploy options

| Platform | Free? | Notes |
|---|---|---|
| **Koyeb.com** | Haan | Render jaisa hi: New App → repo → Start command `node server.js` |
| **Railway.app** | Trial credits | New Project → Deploy from GitHub, bohot fast |
| **Fly.io** | Free tier | Thoda technical (CLI chahiye) |
| **Apna VPS (Oracle Cloud Always Free)** | Haan, truly 24/7 | Neeche dekho |

### VPS par (advanced, truly 24/7)
```bash
# Ubuntu server par:
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs git
git clone https://github.com/APNA_USERNAME/streamverse.git
cd streamverse
sudo npm i -g pm2
pm2 start server.js --name streamverse
pm2 startup && pm2 save     # restart ke baad bhi chalta rahega
```
Server ka IP:3000 par site chalegi (firewall me port 3000 kholna).

### Custom domain (optional)
Render → Web Service → **Settings → Custom Domain** → apna domain (GoDoodle/Namecheap se
khareeda hua) daalo. Free SSL automatic mil jaata hai.

---

## 🧪 Deploy ke baad test karo
- `https://APNI-SITE/api/health` → `{"ok":true,...}` aana chahiye
- Home page kholo → trending row load honi chahiye
- Koi bhi movie card → **Play Trailer** → YouTube trailer chalna chahiye
- Search "naruto" → movies + anime dono aane chahiye

## ⚠️ Common problems
| Problem | Fix |
|---|---|
| `Application failed to respond` | Start Command sahi hai? `node server.js` |
| `Cannot find module` | `package.json` repo me upload hua hai? |
| Rows "Load nahi hua" dikhate hain | TMDB key limit — apna free `TMDB_KEY` env var lagao |
| Preview blank | Browser me direct link kholo, in-app iframe me network nahi hota |

---

## 📡 Live TV + Deploy note
- Live TV ka player pehle **direct stream** try karta hai; CORS block hone par **server proxy**
  (`/api/hls`) se chalata hai; wo bhi fail ho to **next server** par auto-switch.
- Render free plan par proxy streaming bandwidth use karta hai — zyada traffic ho to
  Koyeb/VPS better rahega. Movies/anime/trailers par koi asar nahi.
- Naye v9 me Settings (⚙️) me **language, country (IP auto-detect), data usage,
  API health 🟢🔴** — sab milta hai.

## Anime video API
`/api/anime/videos?id=20` returns the official AniList trailer and licensed streaming links. AniList is primary and Jikan is the fallback, so Anime rows do not depend on the old TMDB title-matching workaround.

## UI and browser recommendation
The site shows a one-time Brave/ad-blocker recommendation popup. It has **Don't show again** and **Confirm** controls, detects Brave, and opens the correct official Brave download page or mobile store. Users on Chrome, Firefox, Edge and Safari can keep their browser and use a trusted content blocker.

The footer includes the developer contact: [Telegram @botdeveloper08](https://t.me/botdeveloper08).

## After deploying a new ZIP
The HTML uses versioned `style.css?v=9.3.0` and `app.js?v=9.3.0` URLs so Render/browser cache cannot keep the old half-height player. If an old tab is open, do one hard refresh (`Ctrl + Shift + R`).
