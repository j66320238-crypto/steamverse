# StreamVerse v11

Render-ready movies, TV, anime and public Live TV web app. Vanilla HTML/CSS/JS frontend with a zero-dependency Node backend.

## v11 improvements

- **Hindi Originals:** dedicated home row, clear “Hindi original” badges and automatic Hindi preference for titles whose TMDB `original_language` is `hi`.
- **Hindi dub request:** compatible providers receive an actual Hindi audio/dub request. A separate **Try Hindi-dub source** button is shown for non-Hindi titles.
- **Playback speed:** 0.5×, 0.75×, 1×, 1.25×, 1.5× and 2× control. Auto mode switches to a provider with documented remote speed control when needed. Anime YouTube trailers use the YouTube player command.
- **Smart dynamic search:** understands genre/language/type intent. Searching `comedy`, `Hindi comedy`, `latest action movies`, `horror TV`, `anime comedy`, etc. returns category results rather than only titles containing those words.
- **Search filters:** instant All / Movies / TV / Anime result filters and a smart-intent explanation banner.
- **Better recommendations:** combines TMDB recommendations, similar titles, genre/language discovery and popularity scoring. Hindi titles prioritize quality Hindi recommendations. Anime uses AniList’s title-specific recommendation graph.
- **Real continue progress:** cooperative providers can send playback time; fake random percentages were removed.
- **Global audio preference:** Settings now has a separate Preferred Audio control.
- Existing v10 improvements remain: Hindi interface, fixed anime IDs, tested Live TV, HLS rewriting, API caching/rate limits, Brotli/Gzip, PWA, security headers and Render Blueprint.

## Important audio limitation

TMDB provides metadata and original language, not a verified per-provider list of dubbed audio tracks. The app can reliably identify **original Hindi** content and can request Hindi from compatible players, but it cannot create a Hindi dub that the selected provider does not carry. The player displays this honestly instead of falsely marking every title as Hindi-ready.

## Run locally

```bash
export TMDB_KEY="your_tmdb_v3_key"
npm start
```

Open <http://localhost:3000>.

## Test

```bash
npm run check
npm test
```

## Render

See **[DEPLOYMENT.md](DEPLOYMENT.md)**. `render.yaml` is included; add `TMDB_KEY` as a Render secret.

## Playback note

StreamVerse does not host media files. Third-party iframe providers control their own catalogues, audio tracks, availability and advertisements. Use only sources you are legally allowed to access.
