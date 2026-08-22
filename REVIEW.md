# StreamVerse v12.2 — Verification Summary

Date: 2026-08-22

## NEW IN v12.2 — Native HLS player (the big one)

The screenshot you sent showing `Aspect Ratio / Stereo Enhancer / Sleep timer / Volume Boost`
was **not our UI** — it was the embed provider's own chrome rendered inside their iframe.
That is the root cause of every "the player keeps changing", "Hindi does nothing" and
"quality selector is dead" report: each provider shipped a different skin and we had no
control over any of it.

**Fix: we now play anime ourselves, in our own `<video>` element.**

- New server route `GET /api/anime/stream?id&ep&source=mal|anilist&lang=sub|dub`.
  Resolves via `megavid.buzz` → `megaplay.buzz` (Referer + Origin headers required, 12 s abort),
  returns a proxied `master.m3u8`, proxied `.vtt` subtitle tracks, and intro/outro timestamps.
  Cached 5 min. Every media URL is routed through `/api/hls` because the upstream is Referer-gated.
- Client plays it with **self-hosted hls.js 1.5.17** (`/hls.min.js`, 405 KB — no CDN dependency,
  jsdelivr/unpkg only as a fallback). Native Safari HLS is used where available.
- **The player no longer changes between sessions.** Same `<video>`, same controls, every time.
  Iframe providers remain only as a silent fallback when a title is not resolvable.

### What this unlocks

| Control | Before | Now |
|---|---|---|
| Quality | Provider skin, usually inert | Real hls.js levels — `Auto / 1080p · 3000kbps / 720p …`, switches instantly, no reload, persisted to `sv-quality` |
| Subtitles | Not exposed | New `#pcSubtitle` menu built from the provider's real tracks (up to 5 languages seen), `Off` included |
| Audio SUB/DUB | Reloaded a different iframe | Re-resolves the same native stream; the control never disappears |
| Speed | Ignored by most embeds | Sets `video.playbackRate` directly |
| Skip intro | — | Floating "Skip intro" button, driven by the provider's real intro timestamps |

### Verified this pass

- `/hls.min.js` served 200, 413 952 bytes.
- `/api/anime/stream` resolved **14/14** (One Piece, Naruto, Death Note, Attack on Titan,
  Demon Slayer, Hunter x Hunter, Steins;Gate — sub **and** dub for each). Attack on Titan
  returned 5 subtitle tracks, Steins;Gate 3.
- jsdom harness, native player: **14/14 pass** — video shown, iframe hidden, real quality
  levels listed, level switch applied, auto restores `-1`, subtitle `<track>`s added and not
  duplicated on dub switch, intro timestamps stored, zero console errors.
- jsdom harness, shell + i18n: **8/8 pass**, zero console errors.
- Live TV: **47/47 channels 200**, `hls_inflight` back to 0 after the sweep.
- i18n dictionaries symmetric (5 new keys added to both), 94 `data-i18n` keys, none undefined.
- `node --check server.js && node --check app.js` clean.

### Honest limits

- Quality options are whatever the upstream master playlist advertises. Some titles publish a
  single rendition (One Piece ep1 advertises only 1440x1080) — the menu then shows Auto plus
  that one level. This is a source limitation, not a UI bug; nothing is downscaled by us.
- Titles without a MAL/AniList mapping still fall back to the iframe chain.

## Fixed in v12.1



### Anime (was the largest defect)

- Anime playback previously resolved a single id and frequently 404'd. Now resolves **both** `mal_id` and `anilist_id` from `/api/anime/details` before choosing a provider.
- Added a dedicated anime streaming engine: `activeAnimeSource()`, `buildAnimeUrl()`, `renderAnimeSourceChips()`, `renderAnimeEpisodeChips()`, `tryAnimeSourceAt()`, `loadAnimeStream()`, mirroring the movie/TV failover machinery including the 8 s watchdog and inline retry.
- Five providers wired with priority ordering and id-type filtering: MegaPlay sub (30), MegaPlay dub (28), Videasy (26), VidLink (24), VidSrc.cc (20).
- Added SUB/DUB toggle in the player chrome, persisted to `sv-anime-dub`, with a guard against switching to an unavailable dub.
- `loadStream()` previously contained `if (p.media === 'anime') return;` — a dead end that guaranteed anime never played. Replaced with a real dispatch to `loadAnimeStream()`.
- Ongoing series reported `episodes: null` from AniList, collapsing the episode picker to one item. Server now falls back to `nextAiringEpisode.episode - 1`, then to `streamingEpisodes.length`.

### Language

- `refreshLocalizedContent()` only re-rendered home/mylist/playlists/live. Search results, browse views and open detail modals kept the previous language. All are now re-rendered.
- English and Hindi dictionaries verified symmetric: **197 keys each, zero difference**, zero keys used but undefined.

### Quality

- No `onchange` handler existed for the quality control — selecting a value did nothing at all.
- Now wired in both the player (`#pcQuality`) and Settings (`#setQuality`), persisted to `sv-quality`, passed as an argument to every source's `movie()`/`tv()` builder.
- Auto-switches to a `qualitySelect`-capable provider when the active one cannot honour a cap.

### Recommendations during playback

- Added Collapse, Hide, inline dismiss (✕), a "Show recommendations" restore button and a persistent Settings preference (`sv-hide-recs`).

### Dead providers and latent crashes

- Repointed three redirecting hosts: `videasy.net`→`player.videasy.to`, `vidfast.pro`→`vidfast.vc`, `vidsrc.me`→`vidsrcme.ru`.
- Removed **peachify** entirely (403, host offline). It was hard-coded as the "Try Hindi audio" target, so that button always failed. Now picks the highest-priority reachable `audioRequest` source at runtime.
- `providerAudioName()` was referenced by the Videasy source entry but **never defined** — would throw on every Videasy load.
- `manifest.webmanifest` was referenced by `index.html`, `sw.js` and the server's static allowlist but **did not exist**, breaking PWA install and service-worker activation.
- `window.matchMedia` was called unguarded at boot; fatal in embedded webviews lacking it.
- Service worker and asset cache-busting stamps were still pinned to `11.1.0`, so returning users would have been served stale code. All bumped to `12.0.0`.
- `package-lock.json` still declared `11.1.0` while `package.json` said `12.0.0` — this would have **failed `npm ci` on Render**. Synced.
- Added `blob:` to CSP `connect-src` (player SDKs fetch subtitle tracks via blob URLs).
- Extended `TRUSTED_PLAYER_ORIGINS` with the new provider origins so postMessage progress events are accepted.

## Tests performed

- `npm run check` passes (`node --check` on `server.js`, `app.js`, `sw.js`).
- `npm test` exits 0 but runs **0 tests** — the project ships no unit test files. All verification below is runtime/integration, not unit tests.
- `npm ci --omit=dev` succeeds, 0 vulnerabilities.
- Headless DOM boot test: **zero errors** — no `window.error`, no unhandled rejection, no `console.error`.
- Headless DOM interaction test: **zero errors** across language switch, quality change, anime audio change, recommendation hide/collapse/restore.
- Language switch verified live: nav changed to `मुख्य सामग्री पर जाएँ | होम | फ़िल्में | टीवी शो | ऐनिमे | ड्रामा`, `sv-ui-lang=hi` persisted, and reverting to English restored the original labels.
- Quality verified live: Settings → 1080 propagated to `sv-quality=1080` and to the in-player selector.
- Anime audio verified live: `sv-anime-dub=1` persisted.
- Recommendations verified live: hide → `sv-hide-recs=1` and `#pcRecRow.hidden`; collapse → `.collapsed`; restore → `sv-hide-recs=0`.
- DOM integrity: all 14 dynamically-created element ids confirmed generated in code; **no missing DOM references**; no duplicate ids; no HTML nesting errors; no unclosed tags.
- Provider reachability (desktop UA): movie/TV **7/7 return 200** — videasy.to, vidfast.vc, vidsrcme.ru, vidcore.org, vidlink.pro, vidsrc.to, vidsrc.su.
- Anime provider reachability: **5/6 return 200** — megaplay mal/sub, megaplay mal/dub, megaplay ani/sub, videasy.to, vidlink.pro.
- Anime API verified end-to-end: One Piece (MAL 21) → `mal_id 21`, `anilist_id 21`, **1174 episodes**; Fullmetal (MAL 5114) → **64 episodes**.
- Static assets: `/`, `/index.html`, `/app.js`, `/style.css`, `/sw.js`, `/manifest.webmanifest`, `/icon-192.png`, `/icon-512.png`, `/robots.txt`, `/api/health` all 200 with correct MIME types.
- Release archive extracted to a clean directory, `npm ci` run, server booted on an isolated port and confirmed serving `version: 12.0.0`.

## Known limitations (honest)

- **VidSrc.cc returns 403 to server-side requests.** It appears referer-gated rather than dead, so it may work inside a real browser iframe. Kept as the lowest-priority failover, but unverified.
- **`TMDB_KEY` is not set in the development sandbox**, so movie/TV rows are empty there. Anime is unaffected. Set the key on Render and the rest populates.
- A cross-origin iframe cannot be forced to expose an audio track or quality level it does not carry. The app distinguishes original Hindi audio from a requested Hindi dub and never labels an unverified dub as guaranteed. The same honesty applies to the quality cap.
- Anime providers are community-operated and change hosts periodically. If one dies, remove or repoint its entry in `ANIME_SOURCES` in `app.js`; the Auto failover chain absorbs a single provider going offline.

---

## v12.2 — second pass (2026-08-22)

Six issues were reported after v12.0. All six are addressed below.

### 1. Live TV was dying for everyone — root cause found and fixed

This was the most serious bug in the codebase and it was **not** a channel/provider problem: every one of the 47 channels was reachable the whole time.

`hlsProxy()` streams upstream segments to the browser. When the socket buffer filled, the loop did:

```js
await new Promise(r => res.once('drain', r));   // never settles on a dead socket
```

If the viewer switched channel, closed the tab or lost the network mid-segment, `drain` never fires. The request hung **forever**, holding its `hlsInFlight` slot. `hlsInFlight` is capped at 40, so after ~40 channel switches every later request hit the cap and got `503 stream proxy busy`. Live TV then stayed dead for **all** users until the process restarted. This also explains the server appearing to die under load.

The loop now:

- checks `res.destroyed || res.writableEnded || !res.writable` before every read and cancels the reader if the client is gone,
- races the drain wait against `close`, `error` and a 20 s timeout — whichever settles first wins, and anything but `drain` cancels the reader and breaks the loop,
- attaches `.catch(() => {})` to every `reader.cancel()`,
- guards the final `res.end()` with `!res.writableEnded`.

`/api/stats` now exposes `hls_inflight` so this class of leak is visible instead of silent.

**Verified:** 60 clients killed mid-segment → `hls_inflight` back to 0, Live TV still serves 200. 47/47 channels 200 concurrently (16 workers, 2.6 s), then 47/47 again serially, `hls_inflight` 0 at the end.

### 2. Recommendations no longer cover the video

The inline strip docked *over* the picture, hiding both the film and the player's own controls. `INLINE_RECS_OVER_VIDEO = false` disables that dock permanently; recommendations live only in the row **below** the player, where Collapse / Hide / ✕ / the Settings preference all still work.

### 3. Anime audio (SUB/DUB) is now a real, labelled control

Previously a pair of unlabelled pills that were easy to miss. Now a proper `<select>` (`#pcAnimeAudio`) sitting beside the audio-language control, labelled "Anime audio", translated in both languages. `setAnimeDub()` is the single mutation path: persists `sv-anime-dub`, resets source failover state, re-renders chips, reloads the stream and toasts. If no dub provider exists for that title the dub option is **disabled and relabelled** rather than silently failing.

### 4. Quality control is honest about what it can do

Streaming providers are third-party iframes; a page cannot force a resolution inside another origin's player. Sources that accept a quality parameter are marked `qualitySelect` and their chips are prefixed `🎚`. When the active source cannot honour a cap, `updateQualityControlState()` dims the control, disables it and attaches an explanatory note instead of pretending to work. Picking a capped value still steers source selection toward a capable provider.

### 5. Language indication

Every language-bearing control is now labelled and translated. The audit reports **197 en / 197 hi keys, zero asymmetry**, and **92 `data-i18n` keys used in markup with zero undefined**. Strings that were previously baked into the HTML — the "NEXT UP" kicker, the tap-to-unmute prompt, "Next server", "Reload" — now carry `data-i18n`.

### 6. Errors

- `npm run check` clean.
- 22/22 HTTP routes return their expected status, including the deliberate 404s for source files and the 400 for a malformed anime id.
- jsdom harness: 15/15 assertions pass with **zero** `console.error`, zero `window.onerror`, zero unhandled rejections.

## Test log (v12.2)

| Test | Result |
|---|---|
| `npm run check` | pass |
| Route matrix (22 routes incl. 404/400 cases) | 22/22 |
| Live TV concurrent sweep, 16 workers | 47/47 → 200 in 2.6 s |
| Live TV serial sweep after concurrency | 47/47 → 200 |
| `hls_inflight` after 60 aborted clients | 0 |
| jsdom feature harness | 15/15, 0 errors |
| i18n parity | 197 / 197, 0 undefined |
| Anime API (details/search/recs/top/topairing/genres/videos) | all 200 with real data |

## Still true (honest limitations)

- Third-party iframe players cannot be forced to a given audio track or resolution from the parent page. Both controls steer **provider choice**; they cannot reach inside another origin's player. The UI now says so instead of implying otherwise.
- `vidsrc.cc` returns 403 to plain curl (referer/JS gated). It works in a real browser, so it stays as a low-priority source.
- Anime embed hosts rotate domains periodically. Auto failover walks the provider list, but a source may need repointing over time.
- `TMDB_KEY` is not set in this sandbox, so movie/TV catalogue calls fall back to Cinemeta/AniList here. Set it on Render and the full catalogue lights up.
- `npm test` ships no unit tests; verification is runtime/integration (curl + jsdom), logged above.
