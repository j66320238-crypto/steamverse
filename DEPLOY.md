# 🚀 StreamVerse — Deploy Guide

StreamVerse is a **zero-dependency Node.js** app (just `node server.js`) with a static frontend. Pick any option below.

---

## ✅ Option 1 — Run locally (easiest)

```bash
# 1. Install Node.js 18+  →  https://nodejs.org
# 2. In the project folder:
node server.js
# 3. Open →  http://localhost:3000
```

Press `Ctrl+C` to stop.

---

## 🌐 Option 2 — Share with friends over the internet (quick, free)

### Cloudflare Tunnel (recommended, no signup)
```bash
# 1. Download cloudflared (single binary)
#    Linux/macOS:
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o cloudflared
chmod +x cloudflared
#    Windows: download cloudflared-windows-amd64.exe from
#    https://github.com/cloudflare/cloudflared/releases/latest

# 2. Run your server in one terminal:
node server.js

# 3. In another terminal:
./cloudflared tunnel --url http://localhost:3000
```

It prints a public URL like:
```
https://random-words-1234.trycloudflare.com
```
**Share that link with anyone in the world.** ✨

> No account, no port forwarding, HTTPS included.

---

## ☁️ Option 3 — Free 24/7 hosting

### Render (free, easy)
1. Push the project to a GitHub repo.
2. Go to https://render.com → **New → Web Service**.
3. Connect your repo.
4. Settings:
   - **Build command:** `npm install` (there are no deps, but it's fine to leave it)
   - **Start command:** `node server.js`
   - **Environment variable (optional):** `TMDB_KEY=your_tmdb_key`
5. **Deploy.** You'll get `https://your-app.onrender.com`.

### Railway / Fly.io / VPS
Same idea — just run `node server.js` and expose port `3000`.

### Vercel / Netlify
These are static-only — **don't deploy there** unless you only want the frontend (it still works in direct-API mode but the HLS proxy & geo features won't).

---

## ⚙️ Environment variables (optional)

| Variable   | Default            | What it does                                  |
|------------|--------------------|-----------------------------------------------|
| `PORT`     | `3000`             | Port the server listens on                    |
| `TMDB_KEY` | built-in public key| Your own TMDB API key (recommended for prod) |
| `WATCH_REGION` | `IN`           | Default streaming region                      |

Get a free TMDB key here: https://www.themoviedb.org/settings/api

---

## 🦁 Best browser recommendation

For the **best ad-free experience**, tell your friends to use **Brave browser** — it blocks all the ads inside the embedded stream players automatically:
https://brave.com/

(The site works in Chrome, Edge, Firefox, Safari too — you'll just see a few ads inside some embeds.)

---

## 📁 Project structure

```
index.html     → UI markup
app.js         → all client logic (player, lists, search, live TV)
style.css      → all styling (dark/light, mobile responsive)
server.js      → Node backend (API proxy, HLS proxy, online counter)
```

No `npm install` needed — zero dependencies.

---

## 🔌 Anime/video APIs and playback

- AniList is the primary anime metadata/video-link API.
- Jikan is used as a fallback when AniList is unavailable.
- Official YouTube trailers play in the in-app player when available.
- Licensed episode/provider links (for example Crunchyroll and Netflix) open in a new tab when a provider does not allow embedding.

The Render deployment is required for the same-origin API proxy and reliable production playback.

---

## ❓ Troubleshooting

**"Could not load" rows?**
→ Check your internet. The site falls back to TMDB directly if the Node API is unreachable.

**Video says "content not found"?**
→ That title hasn't been released yet on the source. Try another source or another title.

**Ads popping up?**
→ Use Brave / uBlock Origin, or enable "Popup protection" in Settings (some sources may refuse to load).

**Video doesn't play in file:// mode?**
→ Always open via `http://localhost:3000` (or the public tunnel URL). Embeds don't work over `file://`.

## Anime video API
Anime catalogue data is served by AniList first, with Jikan as a fallback. Official YouTube trailers are embedded when available; licensed episode/provider links open in a new tab when an embed is not allowed.
