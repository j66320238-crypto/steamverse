# StreamVerse — free hosting (bina credit card)

## Pehle ye samajh lo: kya chahiye

StreamVerse ko **persistent Node server** chahiye, serverless nahi. Wajah:

1. `/api/hls` live video ko **stream** karta hai — request minuton tak khuli rehti hai.
   Serverless functions 10-60 second me timeout ho jaate hain.
2. HLS proxy ka allowlist **memory me** banta hai. Ek India channel ka manifest
   `jmp2.uk` pe hota hai par uske video segments `cloudfront.net` se aate hain —
   alag host. Server manifest padhte waqt us CDN ko trust-register karta hai.
   Serverless pe har request alag instance pe jaa sakti hai jiski memory khaali hai
   → segment request **403** deti hai → channel nahi chalta.

Isliye **Vercel / Netlify / Cloudflare Pages kaam nahi karenge** (Live TV toot jayega).
Movies/TV/anime shayad chal jaye, par live TV nahi.

**Achhi khabar:** app ki **zero npm dependencies** hain aur load pe sirf
**~75 MB RAM** leta hai. Har 512 MB free tier me aaram se fit ho jata hai.

---

## Ranking — no card, free

### 1. Render free tier ⭐ (sabse aasan)

Tum pehle se Render jaante ho. Free tier me web service **bina card** ke ban jaati hai
(paid instance pe hi card maangta hai).

| | |
|---|---|
| RAM | 512 MB (humein 75 MB chahiye ✅) |
| Bandwidth | 100 GB/month |
| Sleep | 15 min idle ke baad, 30-60s cold start |
| Card | Nahi |

Steps:
1. Code GitHub pe push karo.
2. Render → New → Web Service → repo connect.
3. Build: `npm install --omit=dev` · Start: `npm start` · Health: `/api/health`
4. Environment me `TMDB_KEY` daalo.
5. **Sleep se bachne ke liye:** env me `KEEPALIVE_URL` = apna Render URL
   (`https://streamverse-xxxx.onrender.com`). Server har 12 min khud ko ping karega.

`render.yaml` repo me maujood hai — bas usme `plan: starter` ko `plan: free` kar do.

---

### 2. Koyeb (sleep nahi hota — best uptime)

Free "nano" instance, **zyadatar regions me card nahi maangta** (kabhi-kabhi
human-verification ke liye maang sakta hai; wo $1 hold real charge nahi hota).

| | |
|---|---|
| RAM | 512 MB / 0.1 vCPU |
| Region | Frankfurt ya Washington DC (India ke liye Frankfurt lo) |
| Sleep | 1 ghanta idle ke baad scale-to-zero (Render se behtar) |
| Card | Aam taur pe nahi |

Steps: GitHub connect karo → Koyeb khud `Dockerfile` detect karega → port **3000** →
health check `/api/health` → `TMDB_KEY` secret banao.
`koyeb.yaml` reference ke liye repo me hai.

---

### 3. Back4app Containers (pakka no card)

Sabse kam friction — card kabhi nahi maangta. Trade-off: **256 MB RAM**.
Humara app 75 MB me chalta hai to fit ho jata hai, par headroom kam hai.
`Dockerfile` ready hai, GitHub connect karo aur ho gaya.

---

### 4. Railway ($5 trial credit, no card)

Deploy experience sabse smooth hai, par credit khatam hone pe app band.
Chhote traffic pe kuch hafte nikal jaate hain. Short-term testing ke liye theek.

---

## Comparison

| Platform | Card | RAM | Sleep | Live TV chalega? |
|---|---|---|---|---|
| **Render free** | ❌ nahi | 512 MB | 15 min | ✅ |
| **Koyeb** | ⚠️ shayad | 512 MB | 1 hr | ✅ |
| **Back4app** | ❌ nahi | 256 MB | haan | ✅ |
| **Railway** | ❌ (trial) | ~512 MB | nahi | ✅ credit tak |
| Vercel / Netlify | ❌ nahi | — | — | ❌ **toot jayega** |
| Cloudflare Pages | ❌ nahi | — | — | ❌ **toot jayega** |

---

## Free tier pe dhyan rakhne wali baatein

**Bandwidth sabse pehle khatam hoga, RAM nahi.** Live TV proxy ke through jata hai,
to 1 ghanta dekhna ≈ 1-2 GB. 100 GB/month ≈ **50-100 ghante** total viewing.
Zyada log dekhenge to jaldi khatam. Ye har free host pe same problem hai.

**Cold start.** Sleep ke baad pehla visitor 30-60s wait karega. `KEEPALIVE_URL`
set kar do to ye problem lagbhag khatam.

**Catalogue refresh.** `channels.json.gz` repo me commit hoti hai (618 KB).
Refresh karne ke liye **local machine pe** chalao aur commit kar do — free instance
pe 15-minute probe mat chalana, RAM/CPU kam hai:

```bash
node tools/build-channels.js --probe
git add channels.json.gz && git commit -m "refresh channels" && git push
```

---

## Mera suggestion

Tum already Render pe ho aur pay kar rahe ho — **wahi sabse achha hai** (no sleep,
no cold start). Free chahiye to:

- **Render free tier** — same platform, bas plan badlo, `KEEPALIVE_URL` daalo.
- Sleep bilkul na chahiye to **Koyeb** (Frankfurt).
