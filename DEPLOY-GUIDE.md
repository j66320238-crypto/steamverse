# StreamVerse — Deploy Guide (bina card, free)

Tumhari site `node server.js` se chalti hai. Ise free host karne ke 2 sabse aasan
tarike neeche hain. **Pehle TMDB key le lo (2 minute, bilkul free):**

---

## Step 0 — Apni free TMDB key le lo

1. https://www.themoviedb.org/signup par jao — email se **free account** banao (card nahi maangta).
2. Email verify karo.
3. Login ke baad:
   - Profile icon (upar right) → **Settings**
   - Left side me **API** pe click
   - **Developer** section me:
     - **API Key** ke neeche "Click here to request an API key" / "Create" pe click
     - **Developer** option chuno
     - Form me kuch bhi common-sense bhar do:
       - Type: `Website`
       - Application name: `StreamVerse`
       - Application URL: apni future site ka URL ya `http://localhost:3000`
       - Application summary: `Personal movie discovery site`
     - Submit karo.
4. Turant ek **API Key (v3 auth)** dikhegi — 32-character lambi hex string.
   Use copy kar lo. Kahi save kar lo — ye tumhari `TMDB_KEY` hai.

> Key kisi ke saath mat share karo. Code me hardcode mat chhodo — host ke
> **Environment Variables** me daalo (neeche bataya hai).

---

## Step 1 — Code GitHub par upload karo

### Tarika A — Browser se (sabse aasan, git ki zaroorat nahi)

1. https://github.com par jao, free account banao/login karo.
2. Upar right me **+** → **New repository**.
3. Naam do: `streamverse`, **Public** rakho, **Create repository** dabao.
4. Agle page pe **uploading an existing file** link pe click karo.
5. Apne `streamverse` folder ki **saari files** yahan drag karo:
   - `index.html`, `style.css`, `app.js`, `server.js`, `package.json`, `README.md`
   - (`.gitignore` bhi — hidden file hai, naam type karke upload karo)
6. Neeche **Commit changes** dabao. Bas, code GitHub par aa gaya.

### Tarika B — Git se (terminal)

```bash
git init
git add .
git commit -m "StreamVerse v5.2"
git branch -M main
git remote add origin https://github.com/TUMHARA_USERNAME/streamverse.git
git push -u origin main
```

---

## Step 2 — Hosting chuno (dono free, bina card)

### Option 1 — Render.com (recommend, sabse simple)

1. https://render.com → **Get Started** → **Sign in with GitHub** (account banta hai, card nahi maangta).
2. Dashboard me **New +** → **Web Service**.
3. Apna `streamverse` repo select karo (GitHub access permission maange to de do).
4. Ye settings bharo:

   | Field | Value |
   |---|---|
   | Name | `streamverse` (ya koi naam) |
   | Region | `Singapore` (India ke closest) |
   | Branch | `main` |
   | Runtime | `Node` |
   | Build Command | (khaali chhod do) |
   | Start Command | `node server.js` |
   | Instance Type | **Free** |

5. Neeche **Advanced** kholo → **Add Environment Variable**:
   - Key: `TMDB_KEY`
   - Value: apni Step 0 wali TMDB key paste karo
   - (optional `WATCH_REGION` = `IN` already default hai)
6. **Deploy Web Service** dabao.

2–3 minute me site chal padegi:
```
https://streamverse.onrender.com
```

- Free plan 15 minute koi visitor na aaye to "so" jaata hai — pehla visitor
  aate hi ~20-30 second me jaag jaata hai.
- 24/7 jagaye rakhna ho to https://uptimerobot.com par free account bana ke
  monitor me ye URL daal do: `https://streamverse.onrender.com/api/health`,
  interval 5 minute.

### Option 2 — Koyeb.com (24/7 free, sleep nahi hota)

1. https://www.koyeb.com → **Sign Up with GitHub**.
2. **Create Service** → **GitHub** → apna `streamverse` repo select karo.
3. Settings:
   - Builder: **Node.js** (Native buildpack)
   - Run command: `node server.js`
   - Exposed port: `3000`
4. **Environment variables** me `TMDB_KEY` = apni key daalo.
5. **Deploy** dabao. Link milega: `https://streamverse-xxx.koyeb.app`

---

## Step 3 — Test karo

- `https://TUMHARI-SITE/api/health` browser me kholo —
  `{"ok":true,...}` aana chahiye.
- Home page kholo — Trending row load honi chahiye.
- Koi movie/TV show kholo → **Play** button se streaming options khulne chahiye.

---

## Common problems

| Problem | Fix |
|---|---|
| Rows "Could not load" dikhaye | `TMDB_KEY` sahi set hui? Render/Koyeb me env var check karo |
| Site 404 / "Application failed" | Start command `node server.js` hai? Port `3000` exposed hai? |
| 30 second pehli baar load | Free host so raha hai — UptimeRobot laga lo |
| `Cannot find module` | `package.json` repo me upload hua hai? (npm install ki zaroorat nahi — zero dep hai) |

---

## Update kaise karo?

Jab bhi code me badlaav karo:
- **Browser tarika**: GitHub repo kholo → file pe click → **Edit (pencil)** →
  naya content paste karo → **Commit changes**. Render/Koyeb khud re-deploy karega.
- **Git tarika**:
  ```bash
  git add .
  git commit -m "update"
  git push
  ```

Bas! 🎉
