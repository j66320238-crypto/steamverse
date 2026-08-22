# StreamVerse v12.2 ko Render par deploy karein

## 1. TMDB key

1. <https://www.themoviedb.org/settings/api> par TMDB v3 API key banayein.
2. Key ko code/GitHub me mat daalein. `.env` bhi commit mat karein — `.gitignore` me already blocked hai.
3. Render Environment me `TMDB_KEY` secret ke roop me add karein.

## 2. GitHub

```bash
git init
git add .
git commit -m "StreamVerse v12"
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
{"ok":true,"version":"12.9.0","tmdb_configured":true}
```

Agar `tmdb_configured` `false` aaye to key set nahi hui — movie/TV rows khaali rahenge, anime phir bhi chalega.

## Deploy test checklist

1. Home par **Hindi Originals** row load ho.
2. Settings → Website Language → हिन्दी. Nav turant `होम | फ़िल्में | टीवी शो | ऐनिमे` ho jaye, aur search/browse view bhi translate ho.
3. Settings → Quality → 1080p. Player ka quality selector bhi 1080 dikhaye.
4. Settings → Preferred Audio → Hindi.
5. Dangal/3 Idiots jaise original Hindi title par `Hindi original audio` status aaye.
6. Non-Hindi title par **Try Hindi-dub source** option dikhe aur ek **live** source par switch kare (peachify hata diya gaya hai).
7. Player speed 1.5× karne par Auto source speed-compatible player par switch ho.
8. **Anime:** koi bhi anime Play karein — direct stream khule, SUB/DUB toggle dikhe, episode list sahi count dikhaye (One Piece = 1174).
9. Anime me source chip badal kar dekhein; ek source fail ho to Auto agla try kare.
10. Player me recommendations ko Collapse / Hide karein, phir "Show recommendations" se wapas laayein. Reload ke baad preference yaad rahe.
11. Search `comedy`, `Hindi comedy`, `anime comedy`, `latest action movies` test karein.
12. Live TV me channels aur Voice Volume 100–150% control dikhe.
13. PWA install prompt aaye (`manifest.webmanifest` ab exist karta hai — v11 me missing tha).

## Audio samajhna zaroori hai

- `language=hi-IN` TMDB metadata ko Hindi karta hai; video audio ko nahi.
- Original Hindi content `original_language=hi` se reliably identify hota hai.
- Dubbed Hindi track provider ke catalogue par depend karta hai.
- App compatible providers ko Hindi `dub/audio` request bhejta hai, lekin missing dub create nahi kar sakta.

Yahi baat quality par bhi lagu hai: cross-origin iframe ko wo quality dene par majboor nahi kiya ja sakta jo uske paas hai hi nahi.

## API limits

- in-flight request merging;
- LRU/stale cache;
- smart-search response caching;
- cancellable type-ahead search;
- lazy home rows;
- per-IP API/HLS limits;
- generic TMDB proxy disabled.

Render Free cold start normal hai. Artificial keep-alive lagane se pehle Render ke current plan rules check karein.
