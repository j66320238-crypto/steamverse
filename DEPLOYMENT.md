# StreamVerse v11 ko Render par deploy karein

## 1. TMDB key

1. <https://www.themoviedb.org/settings/api> par TMDB v3 API key banayein.
2. Key ko code/GitHub me mat daalein.
3. Render Environment me `TMDB_KEY` secret ke roop me add karein.

## 2. GitHub

```bash
git init
git add .
git commit -m "StreamVerse v11"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/streamverse.git
git push -u origin main
```

## 3. Render Blueprint

1. Render → **New → Blueprint**.
2. Repository select karein.
3. Included `render.yaml` automatically Node runtime, Singapore region, build/start commands aur health check configure karega.
4. `TMDB_KEY` prompt me apni key paste karein.
5. Deploy karein.

Manual settings:

| Setting | Value |
|---|---|
| Runtime | Node |
| Build | `npm ci --omit=dev` |
| Start | `npm start` |
| Health path | `/api/health` |
| Region | Singapore |
| Secret | `TMDB_KEY` |

Health response:

```json
{"ok":true,"version":"11.0.0","tmdb_configured":true}
```

## Deploy test checklist

1. Home par **Hindi Originals** row load ho.
2. Settings → Website Language → हिन्दी.
3. Settings → Preferred Audio → Hindi.
4. Dangal/3 Idiots jaise original Hindi title par `Hindi original audio` status aaye.
5. Non-Hindi title par **Try Hindi-dub source** option dikhe.
6. Player speed ko 1.5× set karne par Auto source speed-compatible player par switch ho.
7. Search `comedy`, `Hindi comedy`, `anime comedy`, `latest action movies` test karein.
8. Recommendation list selected title ki language/genre ke according aaye.

## Audio samajhna zaroori hai

- `language=hi-IN` TMDB metadata ko Hindi karta hai; video audio ko nahi.
- Original Hindi content `original_language=hi` se reliably identify hota hai.
- Dubbed Hindi track provider ke catalogue par depend karta hai.
- App compatible providers ko Hindi `dub/audio` request bhejta hai, lekin missing dub create nahi kar sakta.

## API limits

- in-flight request merging;
- LRU/stale cache;
- smart-search response caching;
- cancellable type-ahead search;
- lazy home rows;
- per-IP API/HLS limits;
- generic TMDB proxy disabled.

Render Free cold start normal hai. Artificial keep-alive lagane se pehle Render ke current plan rules check karein.
