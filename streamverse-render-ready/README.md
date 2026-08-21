# ▶ StreamVerse v9.2

Premium movies / TV / anime discovery & streaming launcher — zero npm dependencies.

## ✨ Features
- 🎬 **Movies · TV Shows · Anime** with trending, popular, top-rated, upcoming, genre rows
- 🎞️ **Anime video API** — AniList official trailers/streaming links, Jikan fallback, and official-provider buttons
- ▶️ **One big Play button everywhere** — opens the "where to watch" player (Netflix, Prime, JioHotstar, Zee5, etc. via JustWatch/TMDB)
- 📺 **TV seasons & episodes** — full episode list with stills, titles, air dates, runtime
- 🎭 **Cast** and **More Like This** recommendations on every detail page
- ❤️ **My List** — save favorites (localStorage, no login)
- ⏯ **Continue Watching** row — recently opened titles
- 🔍 Smart search (movies, TV & anime combined) with live typing
- 🌐 Multi-language (17 languages) + 🌍 IP-based region auto-detect
- 🌙 Dark / Light theme (auto-follows system on first visit)
- ⚙️ Settings with API health, data usage, cache controls
- 🛡️ Reliable APIs (TMDB + AniList anime, Cinemeta/Jikan fallbacks) + stale-if-error cache — site never goes blank
- ⚡ Gzip/Brotli compression, lazy images, skeleton loaders, client cache
- 📱 Fully responsive with mobile hamburger menu
- ⌨️ Keyboard accessible (focus trap, `/` to search, Esc to close, Tab navigation)
- 🚀 Back-to-top button, smooth animations, reduced-motion support
- 🦁 One-time Brave/ad-blocker recommendation popup with Do not show again, Confirm, Google Play/App Store and desktop download links
- 📱 Mobile-first fullscreen player with swipe-up Up Next recommendations and developer Telegram contact

## 🚀 Run locally
```bash
node server.js          # Node 18+ → http://localhost:3000
```

## 🔌 API routes
Core: `/api/health` · `/api/stats` · `/api/cache/clear` · `/api/geo` · `/api/countries`
Browse: `/api/trending` · `/api/movie/{popular,top_rated,upcoming,now_playing}` · `/api/tv/{popular,top_rated}` · `/api/search?q=`
Detail: `/api/details?media=tv|movie&id=` · `/api/tv/season?id=&s=1` · `/api/watch?media=&id=&region=`
Genres: `/api/genres?media=movie|tv` · `/api/movie/genre?g=` · `/api/tv/genre?g=` · `/api/anime/genres` · `/api/anime/genre?g=&name=`
Anime video: `/api/anime/videos?id=` — official YouTube trailer + licensed streaming links
Performance: home rows are lazy-loaded near the viewport to reduce the initial API burst
Anime: `/api/anime/{top,topairing,search,details}`

## 🔑 Optional env vars
- `TMDB_KEY` — your own free TMDB API key (recommended for production)
- `WATCH_REGION` — default JustWatch region (default `IN`)
- `ADMIN_CACHE_TOKEN` — if set, `/api/cache/clear?token=...` requires it

## 📡 How "Play" works
StreamVerse does **not** host or embed copyrighted videos. When you tap ▶ Play, it
looks up official streaming providers for your region (TMDB/JustWatch data) and opens
the chosen service. This keeps the site legal, fast, and reliable.

For anime, the player uses AniList as the primary video metadata API, falls back to Jikan, embeds official YouTube trailers when available, and links to licensed providers such as Crunchyroll and Netflix. StreamVerse does not host anime episodes.

## 🛡️ Security
- Anime video playback uses official YouTube/AniList links; provider availability is shown rather than hidden.
- Hardcoded fallback TMDB key is for dev only — set `TMDB_KEY` in production
- `/api/cache/clear` is protected by `ADMIN_CACHE_TOKEN` when configured
- `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` on all responses
- CORS headers removed (same-origin only)
