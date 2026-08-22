# Anime — Hindi audio + real quality switching (v12.8.0)

**Status: DONE and live-tested.** Nothing for you to configure. Deploy and it works.

---

## v12.8.0 — three round-8 fixes

### 1. Dropdowns no longer close themselves

**What you saw:** you tapped Quality (or Audio, or a control in Settings), the
options appeared, and a moment later they vanished on their own.

**Why:** hls.js fires `AUDIO_TRACKS_UPDATED` and `LEVEL_SWITCHED` continuously
during playback. Every one of those events rebuilt the `<select>` with
`innerHTML = ''`. A native `<select>` whose options are replaced while its
picker is open closes the picker instantly — so the menu slammed shut a
fraction of a second after you opened it, over and over.

**Fix:** all six option-rebuild sites now go through one helper,
`setSelectOptions()`, which:

- compares the new option list against the current one and **does nothing at
  all** when they are identical (which is the case for almost every event);
- refuses to touch a `<select>` while you have it open or focused, stashing the
  new list and applying it after you close the menu;
- keeps your current selection across a legitimate rebuild.

Verified in a real headless Chrome (`t.dropdown.tmp.js`): the Quality and Audio
menus were held open for 5 seconds each during live playback and their option
lists were byte-identical before and after.

### 2. Cross-provider audio + video remix

**What you asked for:** the 4K source has Hindi but poor picture; the other
source has a good picture but no Hindi — take the audio from one and the video
from the other.

For the sealed iframe players (Videasy, VidFast, APIPlayer, VidCore) this is
genuinely impossible: the page is a black box and its audio is never exposed to
us. **But at the HLS level it works**, because a master playlist keeps video
renditions and audio renditions as separate entries joined by a `GROUP-ID`.

New endpoint `GET /api/hls/remix?video=<masterA>&audio=<masterB>&lang=hin`:

- fetches both masters through the existing referer-gated proxy;
- keeps master A's video renditions (the good picture);
- grafts master B's `#EXT-X-MEDIA:TYPE=AUDIO` rows in, de-duplicated by
  language, normalised into a single group, with your preferred language marked
  `DEFAULT=YES`;
- returns one synthetic master.

hls.js then plays A's video with B's audio and you can switch languages live
from the Anime Audio dropdown. The player only attempts this when the primary
stream genuinely lacks the language you want, and it HEAD-probes the remix
before committing — a failed remix can never replace a working stream.

### 3. The segment CDN allowlist was silently blocking video

A real bug found while testing: the AnimeWorld segment CDNs are numbered and
rotate (`s11.zn-grid05.top` yesterday, `s11.zn-grid06.top` today). Each number
was hard-coded in the proxy allowlist, so the moment the CDN rolled over
**every video segment returned 403** while the manifest still loaded. Now
matched by pattern (`/(^|\.)zn-grid\d*\.top$/`), which also rejects
lookalikes such as `zn-grid06.top.evil.com`. Failed requests during a full
anime playback run went from 20 to 0.

### Also in this release

Three additional movie/TV sources, each probed live rather than trusted from a
list: **VidJoy** (multi-audio), **VidRock** (Hindi), **111Movies** (backup).

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

### v12.7.0 — the controls are now always on screen

Until v12.6.0 the player was a two-page vertical feed: the video filled the
whole screen and the Anime audio / Quality / Playback speed row lived on a
*second* page you had to swipe up to. Almost nobody discovered that swipe, so
the player looked like it simply had no options.

The control row is now **pinned to the bottom of the screen the entire time the
player is open** — windowed and fullscreen, phone and desktop. No swiping. The
video area is shrunk by exactly the bar's measured height (published as the
`--pc-bar-h` CSS variable and re-measured on resize, rotation and fullscreen
changes), so the bar never covers the video or its seek controls.

In fullscreen the bar auto-hides after ~3.2 s and comes back on any tap or
mouse move, the way a normal video player behaves.

Verified with a real headless-Chrome layout harness at 390×844, 360×640 and
1280×800: Anime audio, Quality and Playback speed all measure on-screen with
zero scrolling, zero overlap with the video, and they stay on-screen after
changing the audio language.

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
