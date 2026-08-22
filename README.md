# StreamVerse v10

Render-ready movies, TV, anime and public Live TV web app. Frontend is vanilla HTML/CSS/JS; backend uses Node.js built-ins only.

## What was fixed

- **Hindi now actually works:** Settings has separate **Website Language** and **Titles & Description Language** controls. Menus, buttons, rows, errors and major player text switch to हिन्दी.
- **Anime 404 fixed:** AniList and MyAnimeList IDs are no longer mixed. AniList is primary, Jikan is fallback, official YouTube trailers play in-app, and licensed episode/provider links open correctly.
- **Live TV fixed:** removed dead channels, added tested Indian/Bihar and international public streams, rewrote nested HLS playlists/segments, added retry/recovery and lazy-loaded HLS.js.
- **Better audio controls:** Hindi is a provider preference (not a fake guaranteed track). Live TV has optional **Clear audio** normalization. Movie/TV iframe audio quality still depends on the selected provider.
- **Smoother UI:** repaired mobile menu/search, preloaded hero images, responsive cards, desktop row arrows, reduced mobile blur/overlays and less aggressive scroll snapping.
- **Lower API usage:** server LRU cache, stale fallback, in-flight request coalescing, browser cache, search cancellation and lazy home rows.
- **Safer Render backend:** no hardcoded TMDB key, no public generic TMDB proxy, protected admin cache, per-IP limits, restricted HLS hosts, DNS/private-IP checks, response-size caps and security headers.
- **Web optimized:** Brotli/Gzip, ETags, responsive TMDB images, PWA manifest/service worker and deferred Live TV library.

## Run locally

Node.js 18.18+ is required.

```bash
cp .env.example .env
# Put your TMDB v3 API key in .env, then export it in your shell.
# Linux/macOS example:
export TMDB_KEY="your_tmdb_v3_key"
npm start
```

Open <http://localhost:3000>.

> `npm install` is not required at runtime; there are zero npm dependencies.

## Tests

```bash
npm run check
npm test
```

## Render deployment

See **[DEPLOYMENT.md](DEPLOYMENT.md)**. A ready-to-use `render.yaml` is included.

Required secret:

- `TMDB_KEY` — TMDB **v3 API key**, created at <https://www.themoviedb.org/settings/api>

Optional variables are documented in `.env.example`.

## Important playback note

StreamVerse does not host video files. Anime playback uses official YouTube/AniList metadata and licensed provider links. Movie/TV embed availability, audio tracks and media quality are controlled by the selected third-party provider and can vary by title and region. Use only sources you are legally allowed to access.
