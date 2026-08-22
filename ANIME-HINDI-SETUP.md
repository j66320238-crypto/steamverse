# Anime — Hindi audio + real quality switching (v12.4.0)

**Status: DONE and live-tested.** Nothing for you to configure. Deploy and it works.

---

## 1. What you get now

Open any anime → the player's **"Anime audio"** dropdown lists the real languages
the episode ships with:

```
हिन्दी / Hindi     English      日本語 / Japanese
தமிழ் / Tamil      తెలుగు / Telugu    বাংলা / Bengali
മലയാളം / Malayalam  ಕನ್ನಡ / Kannada
```

And the **Quality** dropdown lists real renditions: **240p / 360p / 480p / 720p / 1080p**.

Both switch **instantly, without reloading the video** — the picture keeps
playing while the voice or the resolution changes. **Speed control (0.5×–2×)
also already works** on this player; no change was needed there.

Hindi is picked **automatically** when your site language is Hindi, or when you
previously chose Hindi. Your choice is remembered across episodes.

---

## 2. Live test results (run on this build)

| Title | Provider | Audio tracks | Hindi? | Qualities |
|---|---|---|---|---|
| One Piece ep 1 | animeworld | 7 | ✅ | 5 |
| One Piece ep 900 | animeworld | 7 | ✅ | 5 |
| Naruto ep 184 | animeworld | 7 | ✅ | 5 |
| Attack on Titan ep 5 | animeworld | 6 | ✅ | 5 |
| My Hero Academia ep 1 | animeworld | 7 | ✅ | 5 |
| Hunter x Hunter ep 1 | animeworld | 7 | ✅ | 4 |
| Jujutsu Kaisen ep 12 | animeworld | 5 | ✅ | 5 |
| Demon Slayer ep 1 | animeworld | 3 | ✅ | 5 |
| Death Note ep 9 | animeworld | 5 | ✅ | 5 |
| Fullmetal Alchemist: B ep 1 | animeworld | 5 | ✅ | 4 |
| One Punch Man ep 1 | animeworld | 3 | ✅ | 5 |
| Sword Art Online ep 3 | animeworld | 3 | ✅ | 5 |

The full chain was verified through our own proxy: master playlist `200` →
variant playlist `200` → first video segment `206`. It genuinely plays.

A handful of episodes are not on the multi-audio catalogue (e.g. Death Note
ep 1–8, One Piece ep 1050). Those **fall back silently** to the old provider and
still play — just in sub/dub only. Nothing breaks, nothing errors.

---

## 3. How it was built (future-proof by design)

**Server (`server.js`)**

- New AnimeWorld resolver: title → series slug → episode page → player iframe →
  signed HLS master.
- The signed URL **expires**, so it is resolved on demand and never cached long.
- Episode discovery reads the **real episode list** off the series page *and*
  pulls the remaining seasons over the site's own AJAX endpoint. That's why
  One Piece ep 900 resolves instead of stopping at ep 61.
- `/api/anime/stream` tries AnimeWorld first, then falls back to the previous
  provider. **A failure can never make things worse than before.**

**Config you can change without touching code** (Render → Environment):

| Variable | Default | Why |
|---|---|---|
| `ANIMEWORLD_HOSTS` | `watchanimeworld.top,watchanimeworld.net,watchanimeworld.in` | if the site changes domain, add it here |
| `ANIMEWORLD_PLAYER_HOSTS` | `play.zephyrix.top,play.zephyrflick.top` | if the player host is renamed |
| `HLS_ALLOWED_SUFFIXES` | *(empty)* | allow a new segment CDN |

Segment CDNs are matched by **suffix** (`.zn-grid05.top` etc.), so their
rotating numbered hostnames keep working on their own.

**Client (`app.js`)**

- New `syncNativeAudioTracks()` / `applyNativeAudioTrack()` read the manifest's
  audio group and drive `hls.audioTrack`.
- Language codes are normalised (`hin`/`hi-IN`/`Hindi` → `hi`) against a table
  of 20 languages, so new languages label themselves correctly with no code change.
- If a stream is single-audio, the dropdown reverts to the old SUB/DUB selector
  automatically.
- Choice persists in `sv-audio-lang`.

---

## 4. Also fixed in this build

- **Recommendations**: the "hide recommendations" flag could get stuck on from
  an older buggy build, which looked identical to recommendations not loading.
  It now resets once on upgrade. The Settings toggle still works normally.
- **Crash guard**: the online-counter animation is now optional, so embedded
  browsers that lack the Web Animations API no longer throw.
- **Cache busting**: version moved to **12.4.0** across `app.js`, `index.html`,
  `sw.js`, `package.json` and `server.js` together, so nobody gets served a
  stale script.

---

## 5. Deploy

No new steps. Push to Render as before; `TMDB_KEY` stays the only required
variable. First load after deploy may take a few seconds while the new service
worker replaces the old one.
