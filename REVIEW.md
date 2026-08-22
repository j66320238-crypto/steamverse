# StreamVerse v11 — Verification Summary

Date: 2026-08-22

## Fixed in this revision

- Added Hindi Originals home row and original-language badges.
- Original Hindi titles automatically request Hindi audio and prioritize original-audio sources.
- Added explicit Hindi dub/audio request source for titles that may have a separate Hindi track.
- Added global audio preference in Settings.
- Added 0.5×–2× movie/TV/anime playback-speed UI and cooperative player commands.
- Added a speed-compatible provider that Auto mode prioritizes whenever speed is not 1×.
- Replaced title-only search with server-side smart intent parsing.
- Added comedy/action/romance/horror/thriller/etc., Hindi/South/Korean language, media-type, year, latest and top-rated intent support.
- Added search result filters and smart-match banner.
- Improved movie/TV recommendations with weighted genre, original-language, popularity, vote-count, similar and recommendation data.
- Added AniList title-specific anime recommendations with Jikan/top-anime fallback.
- Removed fake random continue-watching percentages and added cooperative progress events.

## Tests performed

- `npm run check` passes.
- `npm test` passes 8/8 tests.
- Runtime DOM smoke test: 243 cards, 20 Hindi-original cards, zero failed home rows.
- Runtime Hindi original test: Dangal-style title opened with Hindi status and Hindi preference.
- Runtime speed test: selecting 1.5× switched Auto playback to the speed-control source.
- Runtime search test: `comedy` produced 58 mixed results with All/Movie/TV/Anime filters.
- API checks passed for Hindi comedy, horror TV, Hindi recommendations and Naruto-specific anime recommendations.

## Honest external limitation

A cross-origin iframe cannot be forced to expose a track it does not have. The app now distinguishes original Hindi audio from a requested Hindi dub and never labels an unverified dub as guaranteed.
