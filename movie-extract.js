'use strict';
/* Direct-stream extraction for movies and TV.
 *
 * Round 9. Until now every movie/TV chip was an opaque cross-origin <iframe>:
 * the provider's own player, its own controls, its own ads, and no way for us
 * to offer quality or audio-language switching (the round-8 note about
 * cross-provider mixing being "technically impossible" was about exactly that).
 *
 * This module resolves the same providers *server-side* and hands back a plain
 * HLS master URL. When it succeeds the app plays the title in the same native
 * player the anime path already uses, which means the existing quality picker,
 * audio-track picker, speed control and subtitle plumbing all light up for
 * movies too. When it fails the caller simply keeps using the iframe, so this
 * can only ever add capability.
 *
 * Two independent extractors, tried in order and merged:
 *
 *   speedracelight  - the API behind videasy. Responses are obfuscated with a
 *                     custom seeded stream cipher (enc=2); the keystream is
 *                     reimplemented below. Gives up to 2160p and exposes a
 *                     handful of language-specific back ends ("Fade" = Hindi
 *                     audio, "Killjoy" = German, and so on).
 *   vidrock         - a small JSON API whose URLs are AES-256-GCM sealed with a
 *                     key baked into its front-end bundle. Its per-language
 *                     servers (Hindi/Tamil/Telugu/Bengali) are the reason it is
 *                     worth querying at all.
 *
 * Every candidate is probed before it is returned, because both providers
 * happily hand out URLs for CDNs that are dead (a 2026-08 sweep found 0 of 23
 * vidrock regional streams alive while its English ones were fine). Nothing
 * unverified reaches the player.
 */

const crypto = require('crypto');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/* ------------------------------------------------------------------ *
 * speedracelight (videasy)                                            *
 * ------------------------------------------------------------------ */

const SRL_API = 'https://api.speedracelight.com';
const SRL_REFERER = 'https://player.videasy.to/';

/* SHA-256 round constants, reused by the provider as a table of mixing words. */
const SRL_K = [
  1116352408, 1899447441, 3049323471, 3921009573, 961987163, 1508970993,
  2453635748, 2870763221, 3624381080, 310598401, 607225278, 1426881987,
  1925078388, 2162078206, 2614888103, 3248222580,
];
/* Plaintext always starts with these four bytes ("mvm1"); they are the
   integrity check that tells us the seed was still valid. */
const SRL_MAGIC = [109, 118, 109, 49];

const fmix32 = (x) => {
  x >>>= 0;
  x ^= x >>> 16;
  x = Math.imul(x, 2246822507) >>> 0;
  x ^= x >>> 13;
  x = Math.imul(x, 3266489909) >>> 0;
  x ^= x >>> 16;
  return x >>> 0;
};
const rotl32 = (x, n) => {
  x >>>= 0; n &= 31;
  return n === 0 ? x >>> 0 : ((x << n) | (x >>> (32 - n))) >>> 0;
};
const fnv1a32 = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return fmix32(h);
};

function srlInitState(seed, mediaId) {
  const S = new Array(61);
  let a = fmix32(fnv1a32(seed) ^ fmix32((mediaId >>> 0) ^ 2654435769)) >>> 0;
  for (let i = 0; i < 8; i++) {
    const n = a % 61;
    a = rotl32((a + 2654435769) >>> 0, 7 + (i & 7));
    S[n] = (a ^ fmix32(a)) >>> 0;
    a = fmix32((a + n) >>> 0);
  }
  return { S, acc: fmix32(2779096485 ^ a) >>> 0 };
}

function srlNextWord(st, ctr) {
  const r = st.S;
  let o = st.acc >>> 0;
  const n = o % 61;
  const present = r[n] !== undefined;
  const mask = (0 - Number(present)) >>> 0;
  const d = (r[n] >>> 0) || 0;
  const a = (d ^ (Math.imul(2654435769, ctr + 1) >>> 0)) >>> 0;
  let l = (((o ^ a) >>> 0) | ((o & a & mask) >>> 0)) >>> 0;
  l = (rotl32((l + o) >>> 0, 31 & n) ^ rotl32(o, 31 & Math.imul(n, 7))) >>> 0;
  o = fmix32((l + 2654435769) >>> 0);
  r[n] = o >>> 0;
  st.acc = o >>> 0;
  return o >>> 0;
}

function srlKeystream(seed, mediaId, len) {
  const st = srlInitState(seed, mediaId);
  const out = new Uint8Array(len);
  let ctr = 0;
  let i = 0;
  while (i < len) {
    const t = srlNextWord(st, ctr++);
    out[i++] = t & 255;
    if (i < len) out[i++] = (t >>> 8) & 255;
    if (i < len) out[i++] = (t >>> 16) & 255;
    if (i < len) out[i++] = (t >>> 24) & 255;
  }
  return out;
}

function b64urlToBytes(s) {
  const t = String(s).replace(/-/g, '+').replace(/_/g, '/')
    .padEnd(4 * Math.ceil(String(s).length / 4), '=');
  return new Uint8Array(Buffer.from(t, 'base64'));
}

function srlDecode(payload, seed, mediaId) {
  const buf = b64urlToBytes(payload);
  const ks = srlKeystream(seed, mediaId, buf.length);
  for (let i = 0; i < buf.length; i++) buf[i] ^= ks[i];
  for (let i = 0; i < SRL_MAGIC.length; i++) {
    if (buf[i] !== SRL_MAGIC[i]) throw new Error('srl: bad seed or tampered payload');
  }
  return Buffer.from(buf.subarray(SRL_MAGIC.length)).toString('utf8');
}

async function srlJson(url, timeoutMs = 12000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'user-agent': UA, referer: SRL_REFERER, origin: 'https://player.videasy.to', accept: '*/*' },
    });
    const body = await res.text();
    return { ok: res.ok, status: res.status, body };
  } finally { clearTimeout(timer); }
}

/* Seeds are per-mediaId and live ~30s. Asking for a fresh one before every
   provider call earned an immediate HTTP 429 and lost whole titles, so hold
   each seed for its stated lifetime and share it across the sweep. */
const srlSeedCache = new Map();
const SRL_SEED_TTL = 25000;

/* The seed endpoint rate limits by IP. Once it starts answering 429 there is
   nothing to gain from asking again for every provider on every request, and
   a busy server would keep itself permanently throttled. Sit out a cooldown
   and let the other extractor carry the request. */
let srlCooldownUntil = 0;
const SRL_COOLDOWN_MS = 60 * 1000;

function srlThrottled() { return Date.now() < srlCooldownUntil; }

async function srlSeed(mediaId, force = false) {
  const key = String(mediaId);
  if (srlThrottled()) throw new Error('rate limited, cooling down');
  const hit = srlSeedCache.get(key);
  if (!force && hit && hit.expires > Date.now()) return hit.seed;
  if (!force && hit && hit.pending) return hit.pending;

  const pending = (async () => {
    const r = await srlJson(`${SRL_API}/seed?mediaId=${encodeURIComponent(mediaId)}`, 10000);
    if (r.status === 429) {
      srlCooldownUntil = Date.now() + SRL_COOLDOWN_MS;
      throw new Error('srl seed HTTP 429');
    }
    if (!r.ok) throw new Error(`srl seed HTTP ${r.status}`);
    const j = JSON.parse(r.body);
    if (!j || !j.seed) throw new Error('srl seed missing');
    const ttl = Math.min(Number(j.ttlMs) || SRL_SEED_TTL, SRL_SEED_TTL);
    srlSeedCache.set(key, { seed: j.seed, expires: Date.now() + ttl });
    if (srlSeedCache.size > 200) {
      for (const [k, v] of srlSeedCache) { if (!v.expires || v.expires < Date.now()) srlSeedCache.delete(k); }
    }
    return j.seed;
  })();

  srlSeedCache.set(key, { ...(hit || {}), pending });
  try { return await pending; }
  catch (e) { srlSeedCache.delete(key); throw e; }
}

/* The provider's own front end labels these back ends by Valorant agent name;
   what actually matters to us is the audio language each one carries. */
const SRL_PROVIDERS = [
  { path: 'cdn', language: '', label: 'Original' },
  { path: 'hdmovie', language: 'hi', label: 'Hindi' },
  { path: 'lamovie', language: '', label: 'Original' },
  { path: 'm4uhd', language: '', label: 'Original' },
  { path: 'superflix', language: 'pt', label: 'Portuguese' },
  { path: 'meine', language: 'de', label: 'German', extra: { language: 'german' } },
];

async function srlProvider(provider, params, mediaId, retry = true) {
  const seed = await srlSeed(mediaId);
  const qs = new URLSearchParams({ ...params, ...(provider.extra || {}), enc: '2', seed });
  const r = await srlJson(`${SRL_API}/${provider.path}/sources-with-title?${qs}`);

  // The cached seed expired mid-sweep. Burn it and try once with a fresh one.
  if (r.status === 401 && retry) {
    srlSeedCache.delete(String(mediaId));
    await srlSeed(mediaId, true);
    return srlProvider(provider, params, mediaId, false);
  }
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  // A Cloudflare interstitial means we are being rate limited, not that the
  // title is missing; surface it distinctly so the caller can back off.
  if (/^\s*<!doctype/i.test(r.body)) throw new Error('challenged');
  const json = JSON.parse(srlDecode(r.body, seed, mediaId));
  return {
    sources: Array.isArray(json.sources) ? json.sources : [],
    subtitles: Array.isArray(json.subtitles) ? json.subtitles : [],
  };
}

/* ------------------------------------------------------------------ *
 * vidrock                                                             *
 * ------------------------------------------------------------------ */

const VR_KEY = Buffer.from(
  process.env.VIDROCK_KEY || '7f3e9c2a8b5d1f4e6a9c3b7d2e5f8a1c4b6d9e2f5a8c1b4d7e9f2a5c8b1d4e7f',
  'hex',
);

function vrDecrypt(payload) {
  const buf = Buffer.from(b64urlToBytes(payload));
  if (buf.length < 29) throw new Error('vidrock: ciphertext too short');
  const iv = buf.subarray(0, 12);
  const rest = buf.subarray(12);
  const tag = rest.subarray(rest.length - 16);
  const ct = rest.subarray(0, rest.length - 16);
  const d = crypto.createDecipheriv('aes-256-gcm', VR_KEY, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
}

/* vidrock names its back ends too; the language field is authoritative. */
const VR_LANG_BY_NAME = {
  hindi: 'hi', tamil: 'ta', telugu: 'te', bengali: 'bn',
  malayalam: 'ml', kannada: 'kn', marathi: 'mr', punjabi: 'pa',
};

async function vidrockSources(kind, tmdbId, season, episode) {
  const url = kind === 'tv'
    ? `https://vidrock.net/api/tv/${tmdbId}/${season}/${episode}`
    : `https://vidrock.net/api/movie/${tmdbId}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  let json;
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'user-agent': UA, referer: 'https://vidrock.net/', accept: '*/*' },
    });
    if (!res.ok) return [];
    json = await res.json();
  } catch { return []; } finally { clearTimeout(timer); }

  const out = [];
  for (const [name, v] of Object.entries(json || {})) {
    if (!v || !v.url) continue;
    let plain;
    try { plain = vrDecrypt(v.url); } catch { continue; }
    if (!/^https?:\/\//i.test(plain)) continue;
    const key = String(v.language || name).toLowerCase();
    out.push({
      url: plain,
      language: VR_LANG_BY_NAME[key] || (key === 'english' ? 'en' : ''),
      label: v.language || name,
      quality: '',
      provider: `vidrock:${name}`,
      referer: 'https://vidrock.net/',
    });
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Probing                                                             *
 * ------------------------------------------------------------------ */

/* Both providers return URLs for CDNs that are frequently dead. Fetch a little
   of each candidate and require it to actually look like a playlist. */
async function probe(url, referer, timeoutMs = 9000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'user-agent': UA, referer: referer || '', accept: '*/*' },
    });
    if (!res.ok) return null;
    const text = (await res.text()).slice(0, 4096);
    if (!text.includes('#EXTM3U')) return null;
    return { text, finalUrl: res.url || url };
  } catch { return null; } finally { clearTimeout(timer); }
}

/* Read the renditions out of a master playlist so the client can show a real
   quality menu instead of guessing. */
function parseMasterQualities(text) {
  const out = [];
  const lines = String(text).split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith('#EXT-X-STREAM-INF')) continue;
    const res = /RESOLUTION=(\d+)x(\d+)/i.exec(lines[i]);
    const bw = /BANDWIDTH=(\d+)/i.exec(lines[i]);
    const uri = (lines[i + 1] || '').trim();
    if (!uri || uri.startsWith('#')) continue;
    out.push({
      height: res ? Number(res[2]) : 0,
      bandwidth: bw ? Number(bw[1]) : 0,
      uri,
    });
  }
  return out.sort((a, b) => b.height - a.height);
}

function heightFromQualityLabel(q) {
  const m = /(\d{3,4})\s*p/i.exec(String(q || ''));
  return m ? Number(m[1]) : 0;
}

/* videasy hands back one entry per rendition (index-s1080p-v1-a1.m3u8,
   index-s720p-..., and so on) which would lock the viewer to a single
   bitrate. The sibling master.m3u8 lists all of them, so hls.js can adapt and
   the quality menu becomes real rather than decorative. Collapse them. */
function collapseToMaster(url) {
  const m = /^(https?:\/\/[^?#]*\/)index-s\d{3,4}p-v\d+-a\d+\.m3u8(\?.*)?$/i.exec(String(url));
  return m ? `${m[1]}master.m3u8${m[2] || ''}` : '';
}

/* ------------------------------------------------------------------ *
 * Public entry point                                                  *
 * ------------------------------------------------------------------ */

/**
 * Resolve a movie/TV title to directly playable HLS.
 *
 * @returns {Promise<{ok:boolean, streams?:Array, subtitles?:Array, error?:string}>}
 *   Each stream: { url, language, label, provider, height, master }.
 *   `language` is a 2-letter code where known, '' when the provider only
 *   promises "original audio".
 */
async function extractMovieStreams({ kind, tmdbId, imdbId, title, year, season = 1, episode = 1, wantLang = '' }) {
  const mediaType = kind === 'tv' ? 'TV' : 'Movie';
  const params = {
    title: String(title || ''),
    mediaType,
    year: String(year || ''),
    episodeId: String(episode),
    seasonId: String(season),
    tmdbId: String(tmdbId || ''),
    imdbId: String(imdbId || ''),
  };

  const found = [];
  const subtitles = [];
  const errors = [];

  /* Ask only for what can actually be shown: the original-audio back end
     (nearly always available, and the one that carries 4K), plus the back end
     for the language the viewer asked for. Sweeping all six serially took
     ~13s per title to surface options the picker would never display. */
  const wanted = SRL_PROVIDERS.filter((p) => p.language && p.language === wantLang);
  const chosen = [...wanted, ...SRL_PROVIDERS.filter((p) => !p.language)].slice(0, 3);

  /* Everything below talks to a different host, so run it all at once and
     let the slowest one set the floor rather than the sum. */
  const vidrockPending = vidrockSources(kind, tmdbId, season, episode)
    .catch((e) => { errors.push(`vidrock: ${e.message}`); return []; });

  const srlResults = await Promise.all(chosen.map(async (provider) => {
    try {
      return { provider, data: await srlProvider(provider, params, Number(tmdbId) || 0) };
    } catch (e) {
      errors.push(`${provider.path}: ${e.message}`);
      return null;
    }
  }));

  for (const r of srlResults) {
    if (!r) continue;
    const { provider, data } = r;
    for (const s of data.subtitles) {
      if (!s || !s.url) continue;
      // Providers repeat the same track once per rendition; keep one.
      if (subtitles.some((x) => x.url === s.url)) continue;
      subtitles.push({ url: s.url, label: s.lang || s.label || 'Subtitle', language: s.language || s.lang || '' });
    }
    for (const s of data.sources) {
      const url = String(s && s.url || '');
      if (!/^https?:\/\//i.test(url)) continue;
      found.push({
        url,
        language: provider.language,
        label: provider.language ? provider.label : (s.quality || 'Original'),
        quality: s.quality || '',
        provider: `videasy:${provider.path}`,
        referer: SRL_REFERER,
      });
    }
  }

  found.push(...(await vidrockPending));

  if (!found.length) {
    return { ok: false, error: errors.slice(0, 4).join(' | ') || 'no direct source found' };
  }

  /* Probe candidates, best-looking first, and keep the ones that answer.
     De-duplicate by language so the picker does not fill up with six
     identical "English" entries from the same CDN. */
  const seenLang = new Map();
  const streams = [];
  const ranked = found.sort((a, b) => {
    const al = a.language === wantLang ? -1 : 0;
    const bl = b.language === wantLang ? -1 : 0;
    if (al !== bl) return al - bl;
    return heightFromQualityLabel(b.quality) - heightFromQualityLabel(a.quality);
  });

  /* Collapse rendition siblings up front: index-s2160p / index-s1080p /
     index-s720p from one provider are the same stream, and their shared
     master.m3u8 already offers every one of them to the player. Probing all
     four would cost four round trips to learn nothing. */
  const byTarget = new Map();
  for (const cand of ranked) {
    const target = collapseToMaster(cand.url) || cand.url;
    const prev = byTarget.get(target);
    if (!prev || heightFromQualityLabel(cand.quality) > heightFromQualityLabel(prev.quality)) {
      byTarget.set(target, { ...cand, probeUrl: target, fallbackUrl: cand.url });
    }
  }

  /* Probe what is left concurrently: these are independent CDNs and doing
     them one at a time made resolving a title take ~20s. */
  const probed = await Promise.all([...byTarget.values()].slice(0, 10).map(async (cand) => {
    let hit = await probe(cand.probeUrl, cand.referer);
    let url = cand.probeUrl;
    if (!hit && cand.fallbackUrl !== cand.probeUrl) {
      hit = await probe(cand.fallbackUrl, cand.referer);
      url = cand.fallbackUrl;
    }
    return hit ? { cand, url, text: hit.text } : null;
  }));

  for (const p of probed) {
    if (!p) continue;
    if (streams.length >= 5) break;
    const langKey = p.cand.language || 'orig';
    if ((seenLang.get(langKey) || 0) >= 2) continue;
    seenLang.set(langKey, (seenLang.get(langKey) || 0) + 1);
    const qualities = parseMasterQualities(p.text);
    streams.push({
      url: p.url,
      language: p.cand.language,
      label: p.cand.label,
      provider: p.cand.provider,
      height: (qualities[0] ? qualities[0].height : 0) || heightFromQualityLabel(p.cand.quality),
      isMaster: qualities.length > 0,
      qualities: qualities.map((q) => q.height).filter(Boolean),
    });
  }

  if (!streams.length) {
    return { ok: false, error: 'sources found but none playable' };
  }
  return { ok: true, streams, subtitles: subtitles.slice(0, 12) };
}

module.exports = { extractMovieStreams, parseMasterQualities, UA_DESKTOP: UA };
