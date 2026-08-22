# Render par StreamVerse deploy karna

## 1) TMDB key banao

1. <https://www.themoviedb.org/> par account banao.
2. **Settings → API → Create** kholo.
3. **API Key (v3 auth)** copy karo.
4. Key ko GitHub files ya `app.js` me kabhi mat daalna. Render Secret me hi rakhna.

## 2) GitHub par project upload karo

Naya repository bana kar is folder ki saari files upload/push karo. `.env` upload mat karna; `.gitignore` usse block karta hai.

```bash
git init
git add .
git commit -m "StreamVerse v10"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/streamverse.git
git push -u origin main
```

## 3) Sabse aasaan: Render Blueprint

1. Render dashboard me **New → Blueprint** kholo.
2. Apna GitHub repository select karo.
3. Render included `render.yaml` padh lega.
4. `TMDB_KEY` maange to apni **v3 API key** paste karo.
5. **Apply / Deploy** dabao.

`render.yaml` pehle se ye set karta hai:

- Node runtime
- Singapore region
- `npm ci --omit=dev`
- `npm start`
- `/api/health` health check
- generated admin-cache secret
- India watch region

## Manual Web Service option

Agar Blueprint use nahi karna:

| Render setting | Value |
|---|---|
| Runtime | Node |
| Region | Singapore |
| Build Command | `npm ci --omit=dev` |
| Start Command | `npm start` |
| Health Check Path | `/api/health` |
| Environment variable | `TMDB_KEY` = your v3 key |
| Optional | `WATCH_REGION=IN` |

## Deploy ke baad test

In URLs ko kholo:

```text
https://YOUR-SITE.onrender.com/api/health
https://YOUR-SITE.onrender.com/
```

Health JSON me ye hona chahiye:

```json
{"ok":true,"version":"10.0.0","tmdb_configured":true}
```

Phir check karo:

1. Home rows load hon.
2. Settings → **Website Language → हिन्दी** se poora interface Hindi ho.
3. Settings → **Titles & Description Language → Hindi** se TMDB ka available Hindi metadata aaye.
4. Anime me Naruto jaisa title khol kar official trailer/provider links check karo.
5. Live TV me Aaj Tak, DD Bihar ya News18 Bihar Jharkhand check karo.

## API limit bachane ke liye kya laga hai

- identical requests ek hi upstream call me merge hote hain;
- server LRU + stale cache;
- browser cache and cancelled old searches;
- lower rows viewport ke paas aane par hi load hoti hain;
- generic public TMDB proxy hata diya gaya;
- `/api` aur HLS per-IP limits;
- HLS proxy sirf approved public channel hosts ko allow karta hai.

Render Free service idle hone par sleep/cold-start kar sakti hai. Ye normal hai. Artificial keep-alive monitor lagane se pehle Render ke current plan rules check karein.

## Common problems

### `tmdb_configured: false`
Render → Service → Environment me `TMDB_KEY` add karo aur redeploy karo.

### Hindi title English hi hai
Us title ka Hindi translation TMDB par available nahi hoga. Website buttons phir bhi Hindi me rahenge; dono language controls alag hain.

### Hindi audio nahi mil raha
Audio preference provider ko bheji jaati hai, lekin har title ka Hindi dub nahi hota. Video ke andar provider ka audio menu bhi check karo. Parent site cross-origin iframe ke audio tracks ko force nahi kar sakti.

### Anime full episode in-app nahi khulta
Official YouTube trailer in-app chalta hai. Licensed AniList/Crunchyroll/Netflix episode links provider restrictions ki wajah se new tab me khulte hain.

### Live channel kabhi unavailable ho
Public HLS URLs broadcaster badal sakta hai. `LIVE_CHANNELS` me sirf trusted host add karo aur zarurat par `HLS_ALLOWED_HOSTS` env variable update karo.
