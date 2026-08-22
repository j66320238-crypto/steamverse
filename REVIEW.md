# StreamVerse v10 — Completed Fix Review

Date: 2026-08-22

## Completed

- Removed committed TMDB credential; server now reads `TMDB_KEY` only.
- Removed generic browser-accessible TMDB proxy.
- Added LRU cache, stale fallback and in-flight request coalescing.
- Added request validation, per-IP API/HLS limits and restricted HLS host allowlist.
- Added DNS/private-IP validation, redirect validation and HLS response-size limits.
- Fixed HLS playlist URI rewriting, including nested variants, keys and segments.
- Replaced failing Live TV entries with 25 tested public streams, including Bihar channels.
- Fixed AniList requests that sent explicit null IDs and caused 404 responses.
- Kept MAL and AniList identifiers separate throughout cards, details, lists and player state.
- Made official anime trailers embeddable and licensed episode links open at their providers.
- Added real English/Hindi interface localization separate from TMDB content localization.
- Fixed K-Drama origin-language/content-language parameter collision.
- Fixed upcoming row being filtered into an error state.
- Fixed genre “Load more” path duplication.
- Added cancellable parallel search to prevent stale results and wasted calls.
- Removed false iframe failures caused by treating normal window blur as a popup.
- Added player load tokens to stop old iframe requests overwriting a newer title.
- Clarified that audio preference cannot manufacture a dub the provider does not carry.
- Added Live TV audio normalization, HLS error recovery and lazy HLS.js loading.
- Fixed mobile navigation/search layout and reduced expensive mobile visual effects.
- Added responsive images, hero preloading, row arrows, Brotli/Gzip, ETags and PWA shell caching.
- Added security headers, static-file allowlist, protected cache administration and graceful shutdown.
- Added Render Blueprint, environment example and built-in smoke tests.

## Verification

- `npm run check` passes.
- `npm test` passes all smoke tests.
- TMDB Hindi route, AniList anime details/video route and Render health route tested.
- HLS master + child playlist proxy flow tested against the retained channel set.

## External limitation

Cross-origin movie/TV iframe providers control their own media availability, dubbing, bitrate and advertisements. A parent website cannot inspect or force those audio tracks. Live TV audio can be normalized because it uses the site’s own HTML video element.
