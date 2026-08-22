# StreamVerse v12.2

Render-ready movies, TV, anime and public Live TV web app. Vanilla HTML/CSS/JS frontend with a zero-dependency Node backend.

## v12 improvements

- **Anime actually plays.** Previously the app guessed a single id and frequently 404'd. It now resolves **both** MAL and AniList ids from `/api/anime/details` and streams directly through five verified providers with automatic failover: MegaPlay (sub), MegaPlay (dub), Videasy, VidLink and VidSrc.cc. The old "search on Crunchyroll" screen is now a genuine last resort instead of the primary path.
- **Anime SUB/DUB toggle** in the player, plus a real episode picker and per-source chips.
- **Correct episode counts for ongoing series.** AniList reports `episodes: null` while a show is airing, which collapsed One Piece to a single episode. The server now derives the count from airing data — One Piece returns 1174, Fullmetal Brotherhood 64.
- **Language switching fixed.** `refreshLocalizedContent()` skipped the search/browse views and any open modal, so those kept the old language. All views and modals now re-render.
- **Quality selection works.** There was previously no handler at all. Quality is now wired in both the player and Settings, passed to providers that accept a cap, and Auto switches to a quality-capable source when the current one cannot honour it.
- **Recommendations during playback** can be collapsed, hidden or dismissed inline, with a restore button and a persistent Settings preference.
- **Dead and redirecting sources repointed.** `videasy.net`→`player.videasy.to`, `vidfast.pro`→`vidfast.vc`, `vidsrc.me`→`vidsrcme.ru`. The **peachify** provider was removed entirely: it returned 403 and was hard-coded as the "Try Hindi audio" target, so that button pointed at a dead server.
- **Three latent crashes fixed:** `providerAudioName()` was referenced by the Videasy source but never defined; `manifest.webmanifest` was referenced by the HTML, service worker and server allowlist but did not exist, breaking PWA install; `window.matchMedia` was called unguarded at boot and is fatal in some embedded webviews.
- **CSP:** added `blob:` to `connect-src` because player SDKs fetch subtitle tracks through blob URLs.
- **i18n:** English and Hindi dictionaries are now symmetric at 192 keys each, with zero keys used but undefined.

Existing v11 features remain: Hindi Originals row, Hindi dub requests to compatible providers, 0.5×–2× playback speed, smart intent search, search filters, weighted recommendations, real continue-watching progress, Voice Boost, 47-channel Live TV with HLS rewriting, API caching and rate limits, Brotli/Gzip, PWA and security headers.

## Important audio limitation

TMDB provides metadata and original language, not a verified per-provider list of dubbed audio tracks. The app reliably identifies **original Hindi** content and can request Hindi from compatible players, but it cannot create a Hindi dub that the selected provider does not carry. The player states this honestly instead of falsely marking every title as Hindi-ready.

The same applies to a cross-origin iframe: it cannot be forced to expose an audio track or quality level it does not have.

## Run locally

```bash
cp .env.example .env      # then edit .env and add your key
export TMDB_KEY="your_tmdb_v3_key"
npm start
```

Open <http://localhost:3000>.

Without `TMDB_KEY` the server still boots and the anime section works (it uses Jikan/AniList, which need no key), but movie and TV rows will be empty.

## Test

```bash
npm run check   # syntax-checks server.js and app.js
npm test        # node --test; currently no unit test files ship with the project
```

Verification for this release was done by booting the server and driving the real DOM headlessly — see **[REVIEW.md](REVIEW.md)** for what was actually checked.

## Render

See **[DEPLOYMENT.md](DEPLOYMENT.md)**. `render.yaml` is included; add `TMDB_KEY` as a Render secret.

## Playback note

StreamVerse does not host media files. Third-party iframe providers control their own catalogues, audio tracks, availability and advertisements. Use only sources you are legally allowed to access.
