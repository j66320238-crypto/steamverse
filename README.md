# StreamVerse v12.9

Render-ready movies, TV, anime and public Live TV web app. Vanilla HTML/CSS/JS frontend with a zero-dependency Node backend.

## v12.9 — direct playback for movies & TV, and a language menu that means something

**Direct (non-iframe) playback.** Until now only anime played in our own `<video>`
element; every movie and episode ran inside a third-party iframe. That is the
reason the quality, audio-language and speed controls felt fake for them — a
cross-origin iframe cannot be told to change its bitrate or its audio track, so
those menus were only ever *requests* the provider was free to ignore.

`/api/movie/stream` now resolves the same providers server-side and returns a
plain HLS master, which hls.js plays in our own player. When that works the
quality menu lists the manifest's real levels, the speed control applies, and
the language menu lists streams we have actually verified.

- **Iframes are still there.** Direct playback is attempted first and the iframe
  takes over silently whenever it cannot resolve, so a title that used to play
  still plays. The **Direct / Embedded** button in the control bar shows which
  mode is live and lets you force either one; the choice persists.
- **The language menu now lists what exists, not what TMDB describes.** It used
  to be filled from TMDB's `spoken_languages`, which describes the *film* — so
  picking "Hindi" changed nothing at all, because nothing behind it could play
  Hindi. Entries are now one per resolved stream, and choosing one swaps the
  stream in place and keeps your position. Original-audio tracks are named after
  the title's original language, so a Hindi film's main track reads "Hindi
  (original)" rather than a vague "Original audio".
- **Rotating segment CDNs no longer 403.** These providers hand out a fresh
  hostname per request (`peakstorm.top` → `primecrown.top` → `polarcandy.top`),
  so a hand-maintained allowlist went stale within days and our *own* proxy
  blocked the video. Hosts referenced by a manifest we already trust are now
  trusted transitively for six hours and inherit its referer. No host can enter
  that set without first being named by an already-trusted playlist.
- **Latency.** Provider lookups run concurrently and are capped at three per
  request, the shared seed is cached (querying it per provider triggered an
  HTTP 429 that killed results for a minute), and rendition URLs are collapsed
  to their master before probing. Resolution went from ~13 s to 1–4 s.

### Honest limits

Not every title resolves a direct stream, and most resolve only their original
audio — the upstream Hindi provider is broken at source and the second
extractor's regional servers returned nothing usable across 23 measured
attempts. When there is one audio track the menu says so instead of offering
choices that do nothing. Those titles fall back to the iframe, exactly as before.


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
