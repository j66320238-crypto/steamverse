# StreamVerse — Code & UX Review

Date: 2026-08-21 · Stack: Vanilla JS frontend + zero-dependency Node.js (http) backend
APIs: TMDB, Jikan, AniList backup, Cinemeta backup, iptv-org, Internet Archive, ipwho.is

---

## 1. Overall Verdict

**7.5 / 10** — Ek "Netflix clone" se kahin zyada mature project hai.
Backup API fallback, stale-if-error cache, HLS proxy with SSRF protection, multi-language,
IP geo-detect, quality switching — ye sab production-grade soch hai, wo bhi bina kisi npm
dependency ke. Architecture solid hai, lekin polish, security, accessibility aur
consistency me abhi kaafi gaps hain.

---

## 2. Kya Accha Hai 👏

- **Zero-dependency backend** — `package.json` me sirf `node server.js`. Supply-chain risk
  almost zero, deploy karna bohot aasaan.
- **Har API ka backup** — TMDB down ho to Cinemeta, Jikan down to AniList, geo down to
  ipapi.co, Live TV down to stale cache. User ko kabhi blank screen nahi milegi. Ye sabse
  strong feature hai.
- **Stale-if-error caching** — purana data serve karke error chhupa deta hai. Smart.
- **HLS proxy** me SSRF protection (private IP block, DNS resolve check, 90 MB cap) —
  security ke liye socha gaya hai.
- **Multi-language + IP country auto-detect** — Indian audience ke liye Hindi/Tamil/Telugu/
  Bengali etc. ka hona ek accha touch hai.
- **Free full movies** 100% legal (Internet Archive public domain) — piracy se bacha gaya,
  aur actual playback bhi site ke andar hi hai.
- **Skeleton loaders, lazy images, debounced search, client-side memory cache** — UX ka
  khayal rakha gaya hai.
- **YouTube nocookie embed** — privacy ke liye sahi.
- **Code ek hi IIFE me band** — global scope pollute nahi karta.

---

## 3. 🚨 Critical — Pehle Fix Karo

### 3.1 Hardcoded TMDB API key (security)
`server.js` line ~25:
```js
const TMDB_KEY = process.env.TMDB_KEY || '3fd2be6f0c70a2a598f084ddfb75487c';
```
Ye key GitHub/Render pe publicly dikhegi aur abuse ho sakti hai → TMDB key ban kar dega.
**Fix:** fallback hatao, sirf `process.env.TMDB_KEY` rakho; startup pe check karo ki set
hai ya nahi. Render me env var daalo.

### 3.2 Open HLS proxy (abuse risk)
`/api/hls?url=...` kisi bhi public URL ko proxy kar deta hai. SSRF check hai (private IP
block), lekin ye **bandwidth-relay** ban sakta hai — koi bhi apni streaming tumhare server
se route karega aur Render ka free quota (100 GB/mahina) jali hogi.
**Fix:**
- Sirf allowed hostnames allow karo (iptv-org known stream hosts, archive.org, etc.).
- Ya per-IP rate-limit lagao.
- `Referer`/`User-Agent` whitelist.

### 3.3 Version numbers inconsistent
- `package.json` → 2.0.0
- `/api/health` → 3.0.0
- server log → "v4"
- README → "v5"
- app.js header → "v3"
**Fix:** ek jagah (e.g. `const VERSION = '5.0.0'`) define karo aur sab jagah use karo.

### 3.4 CORS poora open
`Access-Control-Allow-Origin: *` har response pe. Agar tumhara backend sirf apni hi site
serve karega to static + API same-origin pe hain — CORS header ki zaroorat hi nahi.
**Fix:** API pe `*` hatao; agar koi 3rd party use kare to specific origin allowlist banao.

### 3.5 Koi rate-limit / security headers nahi
- `/api/search`, `/api/free/movies`, `/api/hls` ko koi spam kar sakta hai.
- `helmet` jaisa kuch nahi (zero-dep rehna hai to khud likho):
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: SAMEORIGIN`
  - `Referrer-Policy: no-referrer`
  - CSP header (YouTube embed + TMDB images + hls.js CDN allow karke)
- Per-IP simple in-memory rate limiter lagao (e.g. 60 req/min).

### 3.6 `cache/clear` endpoint public hai
Koi bhi `GET /api/cache/clear` maar ke poora server cache flush kar sakta hai — har request
pe upstream hit hoga, TMDB rate-limit maar dega.
**Fix:** token/env-var se protect karo ya hata do.

---

## 4. Bugs

1. **Hero "Play Trailer" button detail modal kholta hai, trailer nahi** — `openPlayer`
   directly call hona chahiye. Abhi user ko extra "Play Trailer" modal me dabana padta
   hai. (Function `open` = `openDetail`.)
2. **Search me race-condition** — free movies search (`/free/movies?cat=search`) ke liye
   `noCache` to hai, lekin `AbortController` nahi. Pehla search baad me aaye to naya result
   overwrites ho sakta hai. Same anime search ke saath.
3. **`/api/livetv` har country/category change pe 8000+ channels ka array filter karta hai**
   server pe — bade list pe CPU waste. Response bhi 400 channels tak limit hai but total
   number sahi aata hai. Better: client-side filtering for already-loaded list, ya
   pre-indexed maps.
4. **`playerMode` global** — agar user free movie chala ke turant Live TV khole to
   `currentFiles`/`hlsInst` state mix ho sakti hai (mostly `stopHls()` handle karta hai,
   par defensive cleanup aur chahiye).
5. **Light theme me `.hero-title` color hardcoded `#fff`** — overlay dark hai to theek hai,
   par agar kabhi image fail ho to white-on-white ho sakta hai.
6. **`#freeSearch` placeholder Hinglish hai** ("28,000+ free movies me search karo") lekin
   baaki interface English — bhasha inconsistent hai. Poori site ek hi tone me rakho
   (pure English ya pure Hinglish).
7. **Genre results ka pagination nahi** — sirf page 1 dikhta hai. "Aur dikhao" button
   chahiye.
8. **Modal close on backdrop click** detail modal pe hai, lekin **focus trap nahi** — Tab
   modal ke bahar chala jaata hai.
9. **Escape key** player ko band karti hai par agar settings aur detail dono khule hon to
   dono band ho jaate hain (expected, but test karo).
10. **`/api/free/details` me `runtime` kabhi string ("92 min") to kabhi number** — frontend
    dono handle karta hai par type consistent karo.
11. **Empty results pe `grid.innerHTML` set karte ho, par `.results-empty` div bhi use kar
    rahe ho** — do jagah empty-state logic hai, inconsistent.
12. **`nav-links` mobile pe wrap ho jaate hain** (760px breakpoint) lekin unpe scroll
    snapping ya horizontal scroll nahi — 6 links chhoti screen pe bhari lagte hain.

---

## 5. UI/UX Improvements

- **Row scroll arrows** (‹ ›) desktop pe — abhi sirf touch swipe se chalta hai.
- **Hero hover pe pause** — auto-rotate 7s me hai, mouse hero pe ho to ruk jaana chahiye.
- **Card pe focus-visible outline** — keyboard users ke liye.
- **"Back to top" button** lambi scrolling ke baad.
- **Search clear button (✕)** input ke andar.
- **Search results me type filter** — Movies / TV / Anime / Free ke tabs.
- **Detail modal me**: Cast, crew, similar titles, season list (TV ke liye).
- **Trailer ke liye "mute & autoplay"** option (browser autoplay policy ke wajah se muted
  autoplay zyada reliable hai).
- **Toast ki jagah inline error banners** critical errors ke liye (toast 2.6s me gayab ho
  jaata hai — padhne ka time nahi milta).
- **Loading spinner ke saath progress text** ("Channels load ho rahe hain…" achha hai,
  similar har jagah).
- **Free movies player me subtitles/captions** agar Archive.org pe available hon.
- **Card pe "NEW"/"HD" badges** dynamically (e.g. release date < 30 din).
- **Rating circle** (★ 7.8) text ki jagah colored ring zyada professional lagega.
- **Mobile nav** ko hamburger menu me lo — 6 links + search ek hi line me bhari lagte hain.
- **Empty states** me illustration ya emoji + CTA (e.g. "Koi result nahi — Popular dekhho").

---

## 6. Performance

- **No gzip/brotli compression** — `server.js` static files aur JSON response seedha bhejta
  hai. `zlib.createGzip()` se 60-80% chhota response milega (specially `channels.json`
  jo 5+ MB hai).
- **IPTV dataset (~8000 channels) har baar memory me filter hota hai** — pre-index by
  country/category at load time.
- **Server cache (Map) ka size 900 cap hai** par LRU nahi hai — FIFO hai. Lambe time tak
  chalne se useful entries nikal jaati hain. LRU implement karo (ya `lru-cache` jaisa
  chhota khud ka).
- **Client cache 4 min ka** — theek hai, par stale-while-revalidate aur better hoga.
- **Images** `w500` use ho rahi hain. `srcset` do (w300/w500) taaki mobile pe kam data
  lage. Hero backdrop `original` (bahut bada, sometimes 4 MB) — `w1280` kaafi hai.
- **Fonts** — Poppins poora 300-800 load ho raha hai (6 weights, ~120 KB+). Sirf 400,600,
  800 rakho aur `&display=swap` already hai (achha).
- **`hls.js` CDN se aata hai** — pehla live channel click pe load hota hai. Use `preconnect`
  ya lazy-load already hai (achha).
- **No HTTP/2** — single-file Node http server hai. Render/Railway HTTPS dete hain to
  unka edge HTTP/2 handle karta hai, theek hai.
- **Pre-warming** IPTV + Archive at startup achha hai.

---

## 7. Code Quality

- **`app.js` 1209 lines, ek IIFE** — sections me to hai (free, live, settings, etc.) par
  alag files me split karo:
  - `api.js`, `cards.js`, `hero.js`, `live.js`, `free.js`, `player.js`, `settings.js`,
    `modal.js`, `theme.js`, `state.js`
  - ES modules use karo (`<script type="module">`).
- **Magic numbers** — 7000 (hero timer), 400 (live cap), 90 MB, 120 channels per batch —
  named constants me daalo.
- **Error messages Hinglish mix** — user-facing strings ek `i18n` object me rakho; abhi
  hardcoded poore code me bikhre hain (language selector ka asli fayada tabhi hoga).
- **`server.js` 713 lines** — routes alag module me, cache alag, proxy alag.
- **No tests** — kam-se-kam `/api/health`, `/api/free/movies`, `/api/livetv` ke liye
  integration tests (Node ka built-in `node:test` use karo, zero-dependency rahega).
- **No logging** — sirf `console.error` errors pe. Pino/Winston ki jagah chhota custom
  logger banao jo timestamp + route de.
- **Duplicate logic** — `movie/genre` aur `tv/genre` me same `tmdb()` call pattern hai.
  Generic helper banao.
- **`withBackup()` do functions leta hai par uska return type alag-alag hai** — TypeScript
  ya JSDoc types se help milegi.
- **Dead code**: `WATCH_REGION` constant hai par har request `q.get('region')` use karti
  hai; `now_playing`/`airing_today`/`top_rated` TV routes defined hain par UI me use nahi
  hote.

---

## 8. Naye Features (Suggestions)

1. **Watchlist / Favorites** — `localStorage` me movie/anime IDs store karo; "❤️" button
   card pe. Login ki zaroorat nahi.
2. **"Continue Watching"** — free movies ke liye `currentTime` localStorage me save karo.
3. **User ratings / reviews** — TMDB reviews API se lao.
4. **Person pages** — actor/director click karne par unki filmography.
5. **Episode guide** TV shows ke liye (season dropdown).
6. **"Surprise me" button** — random movie/anime pick karke detail modal khole.
7. **Share button** — card/modal pe (Web Share API on mobile).
8. **PWA install** — manifest.json + service worker (offline browsing of cached rows).
9. **Picture-in-Picture** — player me already attribute hai, button add karo.
10. **Watch party** — multiplayer sync (advanced, baad me).
11. **Content filter** — "no animation", "only HD", year range.
12. **Dark/Light theme ke beech "Auto (system)"** option —
    `prefers-color-scheme` follow kare.
13. **Keyboard shortcuts** — `Space` play/pause, `←/→` seek, `F` fullscreen, `Esc` close.

---

## 9. SEO & Accessibility

### SEO
- **No Open Graph / Twitter Card tags** — WhatsApp/Twitter par share karne pe preview
  nahi aayega. Add karo: `og:title`, `og:description`, `og:image`, `og:type`,
  `twitter:card`.
- **No sitemap.xml / robots.txt** — search engines index nahi kar paayenge.
- **Client-side rendered content** — meta tags server pe generate hona chahiye (abhi title
  "Loading…" se shuru hota hai).
- **No structured data** (JSON-LD `Movie`/`TVSeries`) — Google rich results ke liye.
- **Canonical URL** missing.
- **Semantic HTML** theek hai (`<header>`, `<main>`, `<section>`, `<footer>` use kiye) —
  good.
- **`lang="en"`** hardcoded — language change hone pe `document.documentElement.lang`
  update karo.

### Accessibility
- **Color contrast** — muted `#8a93a8` on `#0b0f19` ≈ 3.5:1 (WCAG AA fail for small text).
  Thoda light karo (`#a0a8bd`).
- **Icon-only buttons** (🔍, ⚙️, 🌙) ke `aria-label` hain — good.
- **Cards are clickable divs**, not buttons/links — keyboard users can't focus. Use
  `<button>` or add `role="button" tabindex="0"` + Enter/Space handler.
- **Modal focus trap missing** (upar bug me mention kiya).
- **Skip-to-content link** nahi hai.
- **Hero image** CSS background hai — alt text nahi. Screen readers ko kuch nahi pata
  chalega kiski movie hai.
- **Toast** ko `role="status" aria-live="polite"` chahiye.
- **Live badges** (`1080p`, `2 server`) abhi visual only — screen reader ke liye label
  chahiye.
- **Color-only indicators** (🟢/🔴 health) — text bhi hona chahiye ("OK"/"Error").
- **Reduced motion** — `@media (prefers-reduced-motion: reduce)` me animations/hero
  auto-rotate band karo.

---

## 10. Priority Checklist

### 🔴 Aaj hi fix karo (security + bugs)
- [ ] TMDB key hatao code se, sirf env var
- [ ] `/api/cache/clear` ko token se protect karo
- [ ] HLS proxy pe host whitelist + rate-limit
- [ ] Hero "Play Trailer" direct player khole
- [ ] CORS `*` hatao (same-origin pe serve kar rahe ho to zaroorat hi nahi)
- [ ] Security headers add karo (nosniff, frame-options, CSP)

### 🟡 Is hafte (UX + performance)
- [ ] Gzip/brotli compression on server
- [ ] Cards ko keyboard-focusable banao
- [ ] Contrast fix for muted text
- [ ] Hero pause on hover
- [ ] Row scroll arrows desktop pe
- [ ] Genre pagination ("Load more")
- [ ] Search me AbortController (race fix)
- [ ] OG tags + sitemap.xml + robots.txt
- [ ] Version number ek jagah

### 🟢 Baad me (features + polish)
- [ ] Watchlist (localStorage)
- [ ] PWA manifest + service worker
- [ ] Code split into ES modules
- [ ] Tests (`node:test`)
- [ ] Cast/similar titles in modal
- [ ] System theme auto option
- [ ] i18n object (all strings in one place)
- [ ] LRU server cache
- [ ] Episode guide for TV

---

## 11. Deploy Notes

- Render free plan 15 min idle sleep kar jaata hai — UptimeRobot guide sahi hai (already
  `DEPLOYMENT.md` me).
- **Live TV proxy bandwidth** Render free (100 GB/mah) jaldi kha sakta hai — warning
  already documented hai. Production ke liye Koyeb/VPS behtar.
- `TMDB_KEY` env var set karna mat bhoolo — warna shared key ban ho jaayegi.
- Node 18+ required (built-in `fetch` use ho raha hai) — `package.json` me engines sahi
  set hai.
