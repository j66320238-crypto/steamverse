/* ============================================================
   StreamVerse v10.0 — backend (Node.js, ZERO npm dependencies)
   Primary: TMDB (movies/TV), AniList (anime)
   Backup : Cinemeta (movies/TV), Jikan (anime), ipapi.co (geo)
   + stale-if-error cache, gzip/br compression, security headers
   ============================================================ */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const dns = require('dns').promises;
const net = require('net');
const crypto = require('crypto');

const VERSION = '10.0.0';
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36';

const PUBLIC_DIR = fs.existsSync(path.join(__dirname, 'public', 'index.html'))
  ? path.join(__dirname, 'public')
  : __dirname;

// Keep the TMDB credential on the server. Never commit a fallback key.
const TMDB_KEY = String(process.env.TMDB_KEY || '').trim();
const TMDB_BASE = 'https://api.themoviedb.org/3';
const CINEMETA = 'https://v3-cinemeta.strem.io';
const ANILIST = 'https://graphql.anilist.co';
const WATCH_REGION = process.env.WATCH_REGION || 'IN';

/* ---------------- stats + online presence ---------------- */
const stats = {
  started: Date.now(),
  requests: 0,
  apiBytes: 0,
  hlsBytes: 0,
  rateLimited: 0,
  backupsUsed: { cinemeta: 0, anilist: 0, ipapi: 0, staleCache: 0 },
  top: {},
};
const apiHealth = { tmdb: '?', jikan: '?', cinemeta: '?', anilist: '?', geo: '?' };

// online presence: heartbeats live for 75s; sweep every 15s.
const presence = new Map(); // token -> lastSeen
let anonCounter = 0;
function sweepPresence() {
  const now = Date.now();
  for (const [k, v] of presence) if (now - v > 75000) presence.delete(k);
}
function onlineCount() { sweepPresence(); return presence.size; }
setInterval(sweepPresence, 15000).unref?.();

/* ---------------- cache (stale-if-error) ---------------- */
const CACHE_MAX_ITEMS = Math.max(100, Number(process.env.CACHE_MAX_ITEMS) || 900);
const cache = new Map();
const inFlight = new Map();

function touchCache(key, entry) {
  cache.delete(key);
  cache.set(key, entry);
}

async function cached(key, ttl, fn, staleOnError = true) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < ttl) {
    touchCache(key, hit); // small LRU: frequently used entries survive
    return hit.v;
  }
  // Coalesce identical requests so a cold Render instance does not spend the
  // TMDB quota several times while the home page is opening.
  if (inFlight.has(key)) return inFlight.get(key);

  const job = (async () => {
    try {
      const v = await fn();
      touchCache(key, { t: Date.now(), v });
      while (cache.size > CACHE_MAX_ITEMS) cache.delete(cache.keys().next().value);
      return v;
    } catch (e) {
      if (staleOnError && hit) {
        stats.backupsUsed.staleCache++;
        touchCache(key, hit);
        return hit.v && !Array.isArray(hit.v) && typeof hit.v === 'object'
          ? { ...hit.v, _stale: true }
          : hit.v;
      }
      throw e;
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, job);
  return job;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function jfetch(url, { method = 'GET', body, headers = {}, timeout = 12000, retries = 2 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const r = await fetch(url, {
        method, body, signal: ctrl.signal, redirect: 'follow',
        headers: { 'User-Agent': UA, Accept: 'application/json', ...headers },
      });
      clearTimeout(timer);
      if (!r.ok) {
        const err = new Error('HTTP ' + r.status);
        err.status = r.status;
        // Retry only transient upstream failures. Retrying a 404/401 wastes
        // quota and makes the UI feel slow.
        if ((r.status === 429 || r.status >= 500) && attempt < retries) {
          const retryAfter = Number(r.headers.get('retry-after')) || 0;
          await sleep(Math.min(4000, retryAfter * 1000 || 650 * (attempt + 1)));
          lastErr = err;
          continue;
        }
        throw err;
      }
      return await r.json();
    } catch (e) {
      clearTimeout(timer);
      lastErr = e;
      const retryable = e.name === 'AbortError' || !e.status || e.status === 429 || e.status >= 500;
      if (attempt < retries && retryable) {
        await sleep(500 * (attempt + 1));
        continue;
      }
      break;
    }
  }
  throw lastErr || new Error('fetch failed');
}

/* ---------------- TMDB ---------------- */
function tmdb(p, params = {}, ttl = 15 * 60 * 1000) {
  if (!TMDB_KEY) {
    apiHealth.tmdb = 'missing-key';
    throw httpError(503, 'TMDB_KEY is not configured on the server');
  }
  const safeParams = { language: 'en-US', ...params, api_key: TMDB_KEY };
  const q = new URLSearchParams(safeParams).toString();
  const url = `${TMDB_BASE}${p}?${q}`;
  return cached('tmdb:' + url, ttl, async () => {
    try { const v = await jfetch(url); apiHealth.tmdb = 'ok'; return v; }
    catch (e) { apiHealth.tmdb = e.status === 401 ? 'bad-key' : 'error'; throw e; }
  });
}
const SUPPORTED_LOCALE = /^[a-z]{2}(?:-[A-Z]{2})?$/;
const langOf = (q) => {
  const value = q.get('lang') || 'en-US';
  return SUPPORTED_LOCALE.test(value) ? value : 'en-US';
};

/* ---------------- Cinemeta backup ---------------- */
function cinemetaToTmdbList(metas, mediaType) {
  return {
    results: (metas || []).map((m) => ({
      id: m.moviedb_id || m.imdb_id || m.id,
      media_type: mediaType,
      title: m.name, name: m.name,
      poster_path: m.poster || '', backdrop_path: m.background || '',
      vote_average: parseFloat(m.imdbRating) || 0,
      release_date: m.released ? String(m.released).slice(0, 10) : (m.year || ''),
      first_air_date: m.released ? String(m.released).slice(0, 10) : (m.year || ''),
      overview: m.description || '',
    })),
  };
}
function cinemetaList(kind, search) {
  const p = search ? `/catalog/${kind}/top/search=${encodeURIComponent(search)}.json` : `/catalog/${kind}/top.json`;
  return cached('cin:' + p, 20 * 60 * 1000, () =>
    jfetch(CINEMETA + p).then((d) => {
      apiHealth.cinemeta = 'ok';
      return cinemetaToTmdbList(d.metas, kind === 'series' ? 'tv' : 'movie');
    }).catch((e) => { apiHealth.cinemeta = 'error'; throw e; }), true);
}

/* ---------------- AniList backup ---------------- */
async function anilist(query, variables = {}) {
  return cached('al:' + query + JSON.stringify(variables), 15 * 60 * 1000, async () => {
    const data = await jfetch(ANILIST, {
      method: 'POST', body: JSON.stringify({ query, variables }),
      headers: { 'Content-Type': 'application/json' },
    });
    if (data.errors && data.errors.length) throw new Error('AniList: ' + data.errors[0].message);
    apiHealth.anilist = 'ok';
    return data.data;
  });
}
function alMediaToJikan(m) {
  if (!m) return {};
  return {
    // Keep both identifiers. A few new AniList entries do not have a MAL id;
    // treating an AniList id as a MAL id was the main cause of anime 404s.
    mal_id: m.idMal || null,
    anilist_id: m.id || null,
    anime_source: m.idMal ? 'mal' : 'anilist',
    title: (m.title && (m.title.english || m.title.romaji)) || '',
    title_english: (m.title && (m.title.english || m.title.romaji)) || '',
    title_japanese: m.title && m.title.native,
    images: { jpg: { image_url: m.coverImage && m.coverImage.large, large_image_url: (m.coverImage && (m.coverImage.extraLarge || m.coverImage.large)) || '' } },
    score: m.averageScore ? Number(m.averageScore / 10).toFixed(1) : null,
    year: m.seasonYear || (m.startDate && m.startDate.year) || null,
    type: m.format === 'MOVIE' ? 'Movie' : 'TV',
    status: m.status === 'RELEASING' ? 'Currently Airing' : m.status === 'FINISHED' ? 'Finished Airing' : (m.status || ''),
    episodes: m.episodes || null,
    synopsis: m.description || '',
    genres: (m.genres || []).map((g) => ({ name: g })),
    trailer: m.trailer && String(m.trailer.site || '').toLowerCase() === 'youtube' ? { youtube_id: m.trailer.id } : null,
    streamingEpisodes: (m.streamingEpisodes || []).filter((e) => e && e.url).slice(0, 40).map((e) => ({
      title: e.title || 'Official episode', thumbnail: e.thumbnail || '', url: e.url, site: e.site || 'Official',
    })),
    banner_image: m.bannerImage || '',
    url: m.siteUrl || (m.idMal ? 'https://myanimelist.net/anime/' + m.idMal : ''),
    aired: { from: m.startDate && m.startDate.year ? String(m.startDate.year) : null },
  };
}
const ANIME_GENRES_FALLBACK = [
  { mal_id: 1, name: 'Action' }, { mal_id: 2, name: 'Adventure' }, { mal_id: 4, name: 'Comedy' },
  { mal_id: 8, name: 'Drama' }, { mal_id: 10, name: 'Fantasy' }, { mal_id: 14, name: 'Horror' },
  { mal_id: 7, name: 'Mystery' }, { mal_id: 22, name: 'Romance' }, { mal_id: 24, name: 'Sci-Fi' },
  { mal_id: 36, name: 'Slice of Life' }, { mal_id: 30, name: 'Sports' }, { mal_id: 37, name: 'Supernatural' },
  { mal_id: 62, name: 'Isekai' },
];
const AL_LIST = `query ($page: Int, $sort: [MediaSort], $status: MediaStatus, $search: String, $genre: String) {
  Page(page: $page, perPage: 20) {
    media(type: ANIME, sort: $sort, status: $status, search: $search, genre: $genre, isAdult: false) {
      id idMal title { romaji english native } coverImage { extraLarge large }
      averageScore seasonYear startDate { year } episodes status format genres
      trailer { id site thumbnail } streamingEpisodes { title thumbnail url site } siteUrl
    }
  }
}`;
const AL_DETAIL = `query ($id: Int, $idMal: Int) {
  Media(id: $id, idMal: $idMal, type: ANIME) {
    id idMal title { romaji english native } coverImage { extraLarge large } bannerImage
    description averageScore seasonYear startDate { year } episodes status format genres
    trailer { id site thumbnail } streamingEpisodes { title thumbnail url site } siteUrl
  }
}`;
const AL_VIDEO = `query ($id: Int, $idMal: Int) {
  Media(id: $id, idMal: $idMal, type: ANIME) {
    id idMal title { romaji english native } coverImage { extraLarge large } bannerImage
    trailer { id site thumbnail } streamingEpisodes { title thumbnail url site } siteUrl
  }
}`;

function animeVars(id, source) {
  const n = Number(id);
  if (!Number.isSafeInteger(n) || n <= 0) throw httpError(400, 'invalid anime id');
  return source === 'anilist' ? { id: n } : { idMal: n };
}

function youtubeTrailer(id, thumbnail) {
  if (!id) return null;
  const key = encodeURIComponent(String(id));
  return {
    id: String(id),
    site: 'YouTube',
    thumbnail: thumbnail || `https://i.ytimg.com/vi/${key}/hqdefault.jpg`,
    url: `https://www.youtube.com/watch?v=${key}`,
    embed: `https://www.youtube-nocookie.com/embed/${key}?autoplay=1&rel=0&modestbranding=1&playsinline=1`,
  };
}

function animeTitle(m) {
  return (m && m.title && (m.title.english || m.title.romaji || m.title.native)) || 'Anime';
}

function secureExternalUrl(value) {
  try {
    const u = new URL(String(value));
    if (u.protocol === 'http:') u.protocol = 'https:';
    return /^https?:$/.test(u.protocol) ? u.toString() : '';
  } catch (e) { return ''; }
}

function normaliseAnimeVideos(m, id, source = 'mal', extra = {}) {
  const title = animeTitle(m);
  const trailer = m && m.trailer && String(m.trailer.site || '').toLowerCase() === 'youtube'
    ? youtubeTrailer(m.trailer.id, m.trailer.thumbnail)
    : null;
  const episodes = (m && m.streamingEpisodes || []).filter((e) => e && e.url).slice(0, 40).map((e, i) => ({
    id: `${source}-${id}-${i + 1}`,
    title: e.title || `Official episode ${i + 1}`,
    thumbnail: e.thumbnail || '', url: secureExternalUrl(e.url), site: e.site || 'Official',
  })).filter((e) => e.url);
  const q = encodeURIComponent(title);
  const malId = (m && m.idMal) || (source === 'mal' ? Number(id) : null);
  const anilistId = (m && m.id) || (source === 'anilist' ? Number(id) : null);
  return {
    ok: Boolean(trailer || episodes.length), source: 'AniList', id: Number(id), id_type: source,
    mal_id: malId || null, anilist_id: anilistId || null, title,
    trailer, episodes,
    official: [
      { name: 'Crunchyroll', url: `https://www.crunchyroll.com/search?q=${q}` },
      { name: 'Netflix', url: `https://www.netflix.com/search?q=${q}` },
      { name: 'YouTube', url: `https://www.youtube.com/results?search_query=${q}+official+trailer` },
      ...(m && m.siteUrl ? [{ name: 'AniList', url: m.siteUrl }] : []),
      ...(malId ? [{ name: 'MyAnimeList', url: `https://myanimelist.net/anime/${malId}` }] : []),
    ],
    ...extra,
  };
}

async function animeVideosFromAniList(id, source) {
  const data = await anilist(AL_VIDEO, animeVars(id, source));
  const media = data && data.Media;
  if (!media) throw new Error('anime not found');
  return normaliseAnimeVideos(media, id, source);
}

async function animeVideosFromJikan(malId) {
  const result = await jikan(`/anime/${encodeURIComponent(malId)}/full`);
  const a = result && result.data;
  if (!a) throw new Error('anime not found');
  const title = a.title_english || a.title || 'Anime';
  const rawTrailer = a.trailer && (a.trailer.youtube_id || a.trailer.url || '');
  const trailerId = a.trailer && a.trailer.youtube_id
    ? a.trailer.youtube_id
    : String(rawTrailer).match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/))([^?&/]+)/i)?.[1];
  const media = {
    idMal: Number(malId), title: { romaji: title }, siteUrl: a.url,
    trailer: trailerId ? { id: trailerId, site: 'youtube', thumbnail: a.images && a.images.jpg && a.images.jpg.image_url } : null,
    streamingEpisodes: [],
  };
  return normaliseAnimeVideos(media, malId, 'mal', { source: 'Jikan' });
}

async function animeVideos(id, source = 'mal') {
  return cached(`anime:videos:${source}:${id}`, 30 * 60 * 1000, async () => {
    try {
      const primary = await animeVideosFromAniList(id, source);
      // AniList occasionally has no trailer although TMDB has an official
      // YouTube clip. Mapping is only a trailer fallback.
      if (!primary.trailer && !primary.episodes.length && primary.mal_id) {
        try {
          const mapped = await animeToTmdb(primary.mal_id);
          if (mapped && mapped.tmdb_id) {
            const videos = await tmdb(`/${mapped.media}/${mapped.tmdb_id}/videos`, { language: 'en-US' }, 30 * 24 * 60 * 60 * 1000);
            const clip = (videos.results || []).find((v) => String(v.site).toLowerCase() === 'youtube' && /trailer|teaser|clip/i.test(v.type || v.name || ''))
              || (videos.results || []).find((v) => String(v.site).toLowerCase() === 'youtube');
            if (clip && clip.key) {
              primary.trailer = youtubeTrailer(clip.key);
              primary.ok = true;
              primary.source = 'AniList + TMDB trailer fallback';
            }
          }
        } catch (e) { /* official links below remain available */ }
      }
      return primary;
    } catch (primaryError) {
      if (source === 'mal') {
        try { return await animeVideosFromJikan(id); } catch (backupError) { /* fall through */ }
      }
      const q = encodeURIComponent('anime');
      return {
        ok: false, source: 'unavailable', id: Number(id), id_type: source,
        mal_id: source === 'mal' ? Number(id) : null,
        anilist_id: source === 'anilist' ? Number(id) : null,
        title: 'Anime', trailer: null, episodes: [],
        official: [
          { name: 'Crunchyroll', url: `https://www.crunchyroll.com/search?q=${q}` },
          { name: 'YouTube', url: `https://www.youtube.com/results?search_query=${q}+official+trailer` },
        ],
      };
    }
  });
}

/* ---------------- Jikan ---------------- */
function jikan(p, ttl = 15 * 60 * 1000) {
  const url = 'https://api.jikan.moe/v4' + p;
  return cached('jikan:' + p, ttl, async () => {
    try { const v = await jfetch(url); apiHealth.jikan = 'ok'; return v; }
    catch (e) { apiHealth.jikan = 'error'; throw e; }
  });
}

/* ---------------- Geo ---------------- */
function isPrivateIp(ip) {
  if (!ip) return true;
  let x = String(ip).replace(/^::ffff:/, '');
  if (x === '::1' || x === 'localhost') return true;
  return /^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(x) || /^172\.(1[6-9]|2\d|3[01])\./.test(x);
}
function clientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  if (xf) return String(xf).split(',')[0].trim();
  return req.socket.remoteAddress || '';
}
async function geoLookup(ip) {
  if (isPrivateIp(ip)) return { country_code: 'IN', country: 'India', flag: '🇮🇳', note: 'local default' };
  try {
    const d = await jfetch(`https://ipwho.is/${encodeURIComponent(ip)}`, { retries: 1, timeout: 8000 });
    if (d && d.success !== false && d.country_code) {
      apiHealth.geo = 'ok';
      return { country_code: d.country_code, country: d.country, flag: (d.flag && d.flag.emoji) || '', city: d.city };
    }
    throw new Error('no data');
  } catch (e) { /* backup */ }
  try {
    const d = await jfetch(`https://ipapi.co/${encodeURIComponent(ip)}/json/`, { retries: 1, timeout: 8000 });
    if (d && d.country_code) {
      stats.backupsUsed.ipapi++;
      apiHealth.geo = 'ok';
      return { country_code: d.country_code, country: d.country_name, flag: '', city: d.city, _backup: true };
    }
  } catch (e) { apiHealth.geo = 'error'; }
  return { country_code: 'IN', country: 'India', flag: '🇮🇳', fallback: true };
}

/* ---------------- TMDB countries ---------------- */
function tmdbCountries() {
  return cached('tmdb:countries', 7 * 24 * 60 * 60 * 1000, () =>
    tmdb('/configuration/countries', {}, 7 * 24 * 60 * 60 * 1000));
}

/* ---------------- anime → TMDB id mapping (for embeds) ---------------- */
async function animeToTmdb(malId) {
  return cached('a2t:' + malId, 30 * 24 * 60 * 60 * 1000, async () => {
    const j = await jikan(`/anime/${malId}/full`);
    const a = j.data || {};
    const title = a.title_english || a.title || '';
    const year = a.year ? String(a.year) : (a.aired && a.aired.from ? String(a.aired.from).slice(0, 4) : '');
    if (!title) throw new Error('no anime title');
    const r = await tmdb('/search/tv', { query: title, first_air_date_year: year, include_adult: 'false' }, 30 * 24 * 60 * 60 * 1000);
    const res = (r && r.results) || [];
    const best = res.find((x) => x.name && x.name.toLowerCase() === title.toLowerCase()) || res[0];
    if (!best) {
      // try movie search for anime films
      const rm = await tmdb('/search/movie', { query: title, year, include_adult: 'false' }, 30 * 24 * 60 * 60 * 1000);
      const m = (rm && rm.results && rm.results[0]) || null;
      if (!m) throw new Error('no tmdb match');
      return { tmdb_id: m.id, media: 'movie', title: m.title };
    }
    return { tmdb_id: best.id, media: 'tv', title: best.name };
  });
}

/* ---------------- fallback helper ---------------- */
async function withBackup(primary, backup, backupName) {
  try { return await primary(); }
  catch (e) {
    console.error('[primary failed] ' + e.message + ' → backup: ' + backupName);
    if (stats.backupsUsed[backupName] !== undefined) stats.backupsUsed[backupName]++;
    const data = await backup();
    if (data && typeof data === 'object') data._backup = true;
    return data;
  }
}
function httpError(status, msg) { const e = new Error(msg); e.status = status; return e; }

function positiveInt(value, name = 'id', max = 999999999) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0 || n > max) throw httpError(400, `invalid ${name}`);
  return n;
}
function pageOf(q) { return String(Math.min(20, positiveInt(q.get('page') || 1, 'page', 500))); }
function mediaIdOf(value) {
  const id = String(value || '');
  if (!/^(?:\d{1,10}|tt\d{5,12})$/.test(id)) throw httpError(400, 'invalid media id');
  return id;
}
function queryOf(q, key = 'q', max = 100) {
  const value = String(q.get(key) || '').trim().replace(/[\u0000-\u001f]/g, '').slice(0, max);
  if (!value) throw httpError(400, `${key} required`);
  return value;
}
function regionOf(value) {
  const region = String(value || WATCH_REGION).toUpperCase();
  return /^[A-Z]{2}$/.test(region) ? region : 'IN';
}

/* ---------------- lightweight per-IP limits ---------------- */
const rateBuckets = new Map();
function rateLimit(req, kind) {
  const now = Date.now();
  const limits = kind === 'hls' ? { max: 360, ms: 60000 }
    : kind === 'ping' ? { max: 12, ms: 60000 }
      : { max: 120, ms: 60000 };
  const key = `${kind}:${clientIp(req) || 'unknown'}`;
  let bucket = rateBuckets.get(key);
  if (!bucket || now - bucket.start >= limits.ms) bucket = { start: now, count: 0 };
  bucket.count++;
  rateBuckets.set(key, bucket);
  if (bucket.count > limits.max) {
    stats.rateLimited++;
    return Math.max(1, Math.ceil((limits.ms - (now - bucket.start)) / 1000));
  }
  return 0;
}
setInterval(() => {
  const cutoff = Date.now() - 2 * 60 * 1000;
  for (const [key, value] of rateBuckets) if (value.start < cutoff) rateBuckets.delete(key);
}, 60000).unref?.();

/* ---------------- routes ---------------- */
const routes = {
  '/api/health': async () => ({
    ok: true, version: VERSION, uptime: Math.round(process.uptime()),
    time: new Date().toISOString(), cached_items: cache.size,
    tmdb_configured: Boolean(TMDB_KEY),
  }),

  '/api/ping': async (q) => {
    // lightweight heartbeat. client sends &t=<token>; server keeps it live.
    const supplied = String(q.get('t') || '').slice(0, 96);
    const tok = /^[a-z0-9_-]{8,96}$/i.test(supplied)
      ? supplied
      : ('a' + (++anonCounter) + '_' + crypto.randomBytes(8).toString('hex'));
    if (presence.size > 5000) sweepPresence();
    presence.set(tok, Date.now());
    return { ok: true, token: tok, online: onlineCount(), serverTime: Date.now() };
  },

  '/api/online': async () => ({ online: onlineCount(), started: stats.started }),

  '/api/stats': async () => ({
    uptime_s: Math.round((Date.now() - stats.started) / 1000),
    requests: stats.requests,
    version: VERSION,
    tmdb_configured: Boolean(TMDB_KEY),
    api_mb: +(stats.apiBytes / 1048576).toFixed(2),
    hls_mb: +(stats.hlsBytes / 1048576).toFixed(2),
    rate_limited: stats.rateLimited,
    backups_used: stats.backupsUsed,
    api_health: apiHealth,
    cache_items: cache.size,
    top_routes: Object.entries(stats.top).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([r, n]) => ({ route: r, hits: n })),
  }),

  '/api/cache/clear': async (q, req) => {
    const tok = String(process.env.ADMIN_CACHE_TOKEN || '');
    if (!tok) throw httpError(404, 'cache administration is disabled');
    const supplied = String(req.headers['x-admin-token'] || '');
    const a = Buffer.from(tok), b = Buffer.from(supplied);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw httpError(403, 'forbidden');
    const n = cache.size; cache.clear();
    return { ok: true, cleared: n };
  },

  '/api/geo': async (q, req) => {
    const ip = clientIp(req);
    return cached('geo:' + ip, 60 * 60 * 1000, () => geoLookup(ip));
  },

  '/api/countries': async () => {
    try {
      const list = await tmdbCountries();
      return { countries: (list || []).map((c) => ({ code: c.iso_3166_1, name: c.english_name, native: c.native_name })) };
    } catch (e) {
      return { countries: [
        { code: 'US', name: 'United States' }, { code: 'IN', name: 'India' },
        { code: 'GB', name: 'United Kingdom' }, { code: 'CA', name: 'Canada' },
        { code: 'AU', name: 'Australia' }, { code: 'DE', name: 'Germany' },
        { code: 'FR', name: 'France' }, { code: 'JP', name: 'Japan' },
      ] };
    }
  },

  '/api/anime/tmdb': async (q) => {
    const id = positiveInt(q.get('id'), 'anime id');
    const source = q.get('source') === 'anilist' ? 'anilist' : 'mal';
    return withBackup(
      async () => {
        if (source === 'mal') return animeToTmdb(id);
        const d = await anilist(AL_DETAIL, animeVars(id, source));
        if (!d.Media || !d.Media.idMal) return { tmdb_id: null, media: 'tv', error: 'no_tmdb_match' };
        return animeToTmdb(d.Media.idMal);
      },
      async () => ({ tmdb_id: null, media: 'tv', error: 'no_tmdb_match' }),
      'anilist');
  },

  '/api/trending': (q) => withBackup(
    () => tmdb('/trending/all/week', { language: langOf(q) }),
    () => cinemetaList('movie'), 'cinemeta'),

  '/api/movie/popular': (q) => withBackup(
    () => tmdb('/movie/popular', { language: langOf(q) }),
    () => cinemetaList('movie'), 'cinemeta'),
  '/api/movie/top_rated': (q) => withBackup(
    () => tmdb('/movie/top_rated', { language: langOf(q) }),
    () => cinemetaList('movie'), 'cinemeta'),
  '/api/movie/upcoming': (q) => withBackup(
    () => tmdb('/movie/upcoming', { language: langOf(q) }),
    () => cinemetaList('movie'), 'cinemeta'),
  '/api/movie/now_playing': (q) => withBackup(
    () => tmdb('/movie/now_playing', { language: langOf(q) }),
    () => cinemetaList('movie'), 'cinemeta'),

  '/api/tv/popular': (q) => withBackup(
    () => tmdb('/tv/popular', { language: langOf(q) }),
    () => cinemetaList('series'), 'cinemeta'),
  '/api/tv/top_rated': (q) => withBackup(
    () => tmdb('/tv/top_rated', { language: langOf(q) }),
    () => cinemetaList('series'), 'cinemeta'),

  '/api/search': (q) => {
    const search = queryOf(q);
    const page = pageOf(q);
    return withBackup(
      () => tmdb('/search/multi', { query: search, include_adult: 'false', page, language: langOf(q) }, 10 * 60 * 1000),
      async () => {
        const [mv, sr] = await Promise.all([cinemetaList('movie', search), cinemetaList('series', search)]);
        return { results: [...mv.results.slice(0, 12), ...sr.results.slice(0, 8)] };
      }, 'cinemeta');
  },

  '/api/details': (q) => {
    const media = q.get('media');
    if (!['movie', 'tv'].includes(media)) throw httpError(400, 'invalid media');
    const id = mediaIdOf(q.get('id'));
    return withBackup(
      () => tmdb(`/${media}/${id}`, { append_to_response: 'credits,similar,recommendations,content_ratings,release_dates,translations', language: langOf(q) }),
      async () => {
        const kind = media === 'tv' ? 'series' : 'movie';
        try {
          const r = await jfetch(`${CINEMETA}/meta/${kind}/${encodeURIComponent(String(id))}.json`);
          const m = (r && r.meta) || {};
          return {
            id: m.moviedb_id || m.imdb_id || id,
            media_type: media,
            title: m.name, name: m.name, overview: m.description || '',
            poster_path: m.poster || '', backdrop_path: m.background || '',
            vote_average: parseFloat(m.imdbRating) || 0,
            release_date: m.released ? String(m.released).slice(0, 10) : (m.year || ''),
            genres: (m.genre || []).map((g) => ({ name: g })),
            credits: { cast: [] }, similar: { results: [] },
          };
        } catch (e) { throw e; }
      }, 'cinemeta');
  },

  '/api/recommendations': async (q) => {
    const media = q.get('media');
    if (!['movie', 'tv'].includes(media)) throw httpError(400, 'invalid media');
    const id = mediaIdOf(q.get('id'));
    const fetchList = (kind) => tmdb(`/${media}/${id}/${kind}`, { page: '1', language: langOf(q) }, 15 * 60 * 1000).catch(() => ({ results: [] }));
    const [recommended, similar] = await Promise.all([fetchList('recommendations'), fetchList('similar')]);
    const results = [...(recommended.results || []), ...(similar.results || [])]
      .filter((v, i, arr) => v && arr.findIndex((x) => x.id === v.id) === i)
      .slice(0, 24);
    return { results };
  },

  '/api/tv/season': async (q) => {
    const id = mediaIdOf(q.get('id'));
    const season = positiveInt(q.get('s') || 1, 'season', 100);
    return tmdb(`/tv/${id}/season/${season}`, { language: langOf(q) }, 60 * 60 * 1000);
  },

  '/api/watch': async (q) => {
    const media = q.get('media');
    if (!['movie', 'tv'].includes(media)) throw httpError(400, 'invalid media');
    const id = mediaIdOf(q.get('id'));
    try {
      return await tmdb(`/${media}/${id}/watch/providers`, { watch_region: regionOf(q.get('region')) }, 6 * 60 * 60 * 1000);
    } catch (e) { return { results: {} }; }
  },

  '/api/genres': (q) => {
    const media = q.get('media') === 'tv' ? 'tv' : 'movie';
    return tmdb(`/genre/${media}/list`, { language: langOf(q) }, 24 * 60 * 60 * 1000);
  },
  '/api/movie/genre': (q) => {
    const g = positiveInt(q.get('g'), 'genre', 9999);
    const sort = ['popularity.desc', 'vote_average.desc', 'release_date.desc'].includes(q.get('sort')) ? q.get('sort') : 'popularity.desc';
    return tmdb('/discover/movie', {
      with_genres: String(g), sort_by: sort,
      'vote_count.gte': '50', page: pageOf(q), language: langOf(q),
    });
  },
  '/api/tv/genre': (q) => {
    const g = positiveInt(q.get('g'), 'genre', 9999);
    const sort = ['popularity.desc', 'vote_average.desc', 'first_air_date.desc'].includes(q.get('sort')) ? q.get('sort') : 'popularity.desc';
    return tmdb('/discover/tv', {
      with_genres: String(g), sort_by: sort,
      'vote_count.gte': '50', page: pageOf(q), language: langOf(q),
    });
  },

  /* anime */
  '/api/anime/genres': () => withBackup(
    () => jikan('/genres/anime', 24 * 60 * 60 * 1000).then((d) => ({ genres: (d.data || []).filter((g) => g.mal_id < 50 || g.mal_id === 62) })),
    async () => ({ genres: ANIME_GENRES_FALLBACK }), 'anilist'),
  '/api/anime/genre': (q) => {
    const g = positiveInt(q.get('g'), 'genre', 9999);
    const name = String(q.get('name') || '').trim().slice(0, 50);
    const page = pageOf(q);
    return withBackup(
      async () => {
        const d = await anilist(AL_LIST, { page: Number(page), sort: ['POPULARITY_DESC'], genre: name || null });
        return { data: ((d.Page && d.Page.media) || []).map(alMediaToJikan), pagination: { current_page: Number(page), last_visible_page: 20 } };
      },
      () => jikan(`/anime?genres=${g}&order_by=members&sort=desc&sfw=true&page=${page}`), 'jikan');
  },
  '/api/anime/top': (q) => {
    const page = pageOf(q);
    return withBackup(
      async () => { const d = await anilist(AL_LIST, { page: Number(page), sort: ['SCORE_DESC'] }); return { data: ((d.Page && d.Page.media) || []).map(alMediaToJikan), pagination: { last_visible_page: 20 } }; },
      () => jikan('/top/anime?page=' + page), 'jikan');
  },
  '/api/anime/topairing': (q) => {
    const page = pageOf(q);
    return withBackup(
      async () => { const d = await anilist(AL_LIST, { page: Number(page), sort: ['POPULARITY_DESC'], status: 'RELEASING' }); return { data: ((d.Page && d.Page.media) || []).map(alMediaToJikan), pagination: { last_visible_page: 20 } }; },
      () => jikan('/top/anime?filter=airing&page=' + page), 'jikan');
  },
  '/api/anime/search': (q) => {
    const search = queryOf(q);
    return withBackup(
      async () => { const d = await anilist(AL_LIST, { page: 1, sort: ['SEARCH_MATCH'], search }); return { data: ((d.Page && d.Page.media) || []).map(alMediaToJikan) }; },
      () => jikan('/anime?q=' + encodeURIComponent(search) + '&page=1&sfw=true'), 'jikan');
  },
  '/api/anime/details': (q) => {
    const id = positiveInt(q.get('id'), 'anime id');
    const source = q.get('source') === 'anilist' ? 'anilist' : 'mal';
    const primary = async () => {
      const d = await anilist(AL_DETAIL, animeVars(id, source));
      if (!d.Media) throw new Error('anime not found');
      return { data: alMediaToJikan(d.Media) };
    };
    if (source === 'anilist') return primary();
    return withBackup(primary, () => jikan(`/anime/${id}/full`), 'jikan');
  },
  '/api/anime/videos': (q) => {
    const id = positiveInt(q.get('id'), 'anime id');
    const source = q.get('source') === 'anilist' ? 'anilist' : 'mal';
    return animeVideos(id, source);
  },

  /* K-Drama / Asian drama browse */
  '/api/drama/popular': (q) => {
    const origin = /^[a-z]{2}$/.test(q.get('origin') || '') ? q.get('origin') : '';
    return withBackup(
      () => tmdb('/discover/tv', {
        ...(origin ? { with_original_language: origin } : {}),
        sort_by: 'popularity.desc',
        page: pageOf(q),
        'vote_count.gte': '10',
        language: langOf(q),
      }),
      () => cinemetaList('series'), 'cinemeta');
  },
};

/* ---------------- HLS proxy for Live TV ----------------
   HLS manifests contain relative URLs, so they must be rewritten back through
   this same-origin proxy. Targets are restricted to the public CDNs used by
   the built-in channel list to prevent the Render service becoming an open
   bandwidth relay. */
const HLS_ALLOWED_SUFFIXES = [
  '.getaj.net', '.france24.com', '.akamaized.net', '.bloomberg.com',
  '.springcpc.com', '.cloudfront.net', '.samsung.wurl.tv', '.skycdp.com',
  '.stackpathdns.com', '.wizdeo.io', '.luxeat.lu', '.cloudycdn.services',
  '.intoday.in', '.akamaihd.net', '.trt.com.tr', '.wiseplayout.com',
];
const HLS_ALLOWED_EXACT = new Set([
  '103.225.189.136',
  ...String(process.env.HLS_ALLOWED_HOSTS || '').split(',').map((v) => v.trim().toLowerCase()).filter(Boolean),
]);
let hlsInFlight = 0;

function isPrivateAddress(address) {
  const ip = String(address || '').toLowerCase().replace(/^::ffff:/, '');
  if (!ip) return true;
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    return parts[0] === 0 || parts[0] === 10 || parts[0] === 127 ||
      (parts[0] === 169 && parts[1] === 254) ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168) ||
      (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) ||
      parts[0] >= 224;
  }
  if (net.isIPv6(ip)) {
    return ip === '::' || ip === '::1' || ip.startsWith('fc') || ip.startsWith('fd') ||
      /^fe[89ab]/.test(ip) || ip.startsWith('2001:db8:');
  }
  return true;
}

function allowedHlsHost(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/\.$/, '');
  return HLS_ALLOWED_EXACT.has(host) || HLS_ALLOWED_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

async function validateHlsUrl(value) {
  let u;
  try { u = value instanceof URL ? value : new URL(String(value)); }
  catch (e) { throw httpError(400, 'bad stream url'); }
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) throw httpError(400, 'blocked stream url');
  if (!allowedHlsHost(u.hostname)) throw httpError(403, 'stream host is not allowed');
  if (u.port && !['80', '443'].includes(u.port)) throw httpError(400, 'stream port is not allowed');
  if (net.isIP(u.hostname)) {
    if (isPrivateAddress(u.hostname)) throw httpError(403, 'private stream address blocked');
  } else {
    let resolved;
    try { resolved = await dns.lookup(u.hostname, { all: true, verbatim: true }); }
    catch (e) { throw httpError(502, 'stream host lookup failed'); }
    if (!resolved.length || resolved.some((item) => isPrivateAddress(item.address))) {
      throw httpError(403, 'private stream address blocked');
    }
  }
  return u;
}

async function fetchHlsUpstream(initialUrl, req) {
  let current = await validateHlsUrl(initialUrl);
  for (let hop = 0; hop < 5; hop++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    let response;
    try {
      response = await fetch(current, {
        signal: ctrl.signal,
        redirect: 'manual',
        headers: {
          'User-Agent': UA,
          Accept: req.headers.accept || '*/*',
          ...(req.headers.range ? { Range: req.headers.range } : {}),
        },
      });
    } catch (e) {
      clearTimeout(timer);
      throw httpError(502, e.name === 'AbortError' ? 'stream timed out' : 'stream connection failed');
    }
    clearTimeout(timer);
    if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
      current = await validateHlsUrl(new URL(response.headers.get('location'), current));
      continue;
    }
    return { response, finalUrl: current };
  }
  throw httpError(502, 'too many stream redirects');
}

function proxyHlsUrl(value, base) {
  try {
    const absolute = new URL(value, base);
    if (!['http:', 'https:'].includes(absolute.protocol)) return value;
    return '/api/hls?url=' + encodeURIComponent(absolute.toString());
  } catch (e) { return value; }
}

function rewriteM3u8(text, base) {
  return String(text).split(/\r?\n/).map((line) => {
    if (!line) return line;
    if (!line.startsWith('#')) return proxyHlsUrl(line.trim(), base);
    // Keys, subtitles and init segments often live in URI="..." attributes.
    return line.replace(/URI=("([^"]+)"|'([^']+)')/gi, (whole, quoted, dbl, single) => {
      const value = dbl || single || '';
      const quote = quoted[0];
      return `URI=${quote}${proxyHlsUrl(value, base)}${quote}`;
    });
  }).join('\n');
}

async function hlsProxy(req, res, u) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, securityHeaders({ Allow: 'GET, HEAD' }));
    return res.end();
  }
  const target = u.searchParams.get('url');
  if (!target || target.length > 3000) {
    res.writeHead(400, securityHeaders({ 'Content-Type': 'text/plain; charset=utf-8' }));
    return res.end('url required');
  }
  if (hlsInFlight >= 40) {
    res.writeHead(503, securityHeaders({ 'Retry-After': '3', 'Content-Type': 'text/plain; charset=utf-8' }));
    return res.end('stream proxy busy');
  }
  hlsInFlight++;
  try {
    const { response: r, finalUrl } = await fetchHlsUpstream(target, req);
    const ct = r.headers.get('content-type') || 'application/octet-stream';
    const playlist = /mpegurl|application\/vnd\.apple\.mpegurl/i.test(ct) || /\.m3u8(?:$|\?)/i.test(finalUrl.pathname + finalUrl.search);
    if (!r.ok || !r.body) {
      res.writeHead(r.status || 502, securityHeaders({ 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }));
      return res.end('upstream stream error');
    }

    if (playlist) {
      const raw = Buffer.from(await r.arrayBuffer());
      if (raw.length > 2 * 1024 * 1024) throw httpError(502, 'stream manifest too large');
      const body = Buffer.from(rewriteM3u8(raw.toString('utf8'), finalUrl));
      stats.hlsBytes += body.length;
      const headers = securityHeaders({
        'Content-Type': 'application/vnd.apple.mpegurl; charset=utf-8',
        'Cache-Control': 'no-store',
        'Content-Length': String(body.length),
      });
      res.writeHead(200, headers);
      if (req.method === 'HEAD') return res.end();
      return res.end(body);
    }

    const headers = securityHeaders({
      'Content-Type': ct,
      'Cache-Control': 'public, max-age=20',
      ...(r.headers.get('content-range') ? { 'Content-Range': r.headers.get('content-range') } : {}),
      ...(r.headers.get('accept-ranges') ? { 'Accept-Ranges': r.headers.get('accept-ranges') } : {}),
    });
    res.writeHead(r.status, headers);
    if (req.method === 'HEAD') return res.end();
    const reader = r.body.getReader();
    let total = 0;
    const maxBytes = 32 * 1024 * 1024;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel('segment too large');
        throw httpError(502, 'stream segment too large');
      }
      if (!res.write(Buffer.from(value))) await new Promise((resolve) => res.once('drain', resolve));
    }
    stats.hlsBytes += total;
    res.end();
  } catch (e) {
    if (!res.headersSent) {
      res.writeHead(e.status || 502, securityHeaders({ 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }));
      res.end(e.message || 'upstream stream error');
    } else if (!res.writableEnded) {
      res.destroy();
    }
  } finally {
    hlsInFlight--;
  }
}

/* ---------------- static + compression + headers ---------------- */
const MIME = {
  '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.html': 'text/html; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8', '.ico': 'image/x-icon',
  '.webp': 'image/webp', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
};
const COMPRESSIBLE = /^text\/|application\/(?:json|javascript|manifest|xml)/i;
const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://unpkg.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: https:",
  "connect-src 'self' https://api.themoviedb.org https://api.jikan.moe https://graphql.anilist.co",
  "frame-src https:",
  "worker-src 'self' blob:",
  "form-action 'self'",
].join('; ');

function securityHeaders(extra = {}) {
  return {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
    'Content-Security-Policy': CSP,
    ...extra,
  };
}

function sendJson(res, code, data, reqHeaders, options = {}) {
  const body = Buffer.from(JSON.stringify(data));
  stats.apiBytes += body.length;
  const headers = securityHeaders({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': options.cacheControl || 'no-store',
    Vary: 'Accept-Encoding',
    ...(options.headers || {}),
  });
  negotiateCompression(reqHeaders, headers, body, code, res, options.head);
}

function negotiateCompression(reqHeaders, headers, body, code, res, head = false, prepared = null) {
  const ae = (reqHeaders['accept-encoding'] || '').toLowerCase();
  const finish = (payload, encoding) => {
    if (encoding) headers['Content-Encoding'] = encoding;
    headers['Content-Length'] = String(payload.length);
    res.writeHead(code, headers);
    return head ? res.end() : res.end(payload);
  };
  if (body.length < 1024 || !COMPRESSIBLE.test(headers['Content-Type'] || '')) return finish(body);
  if (ae.includes('br')) {
    if (prepared && prepared.br) return finish(prepared.br, 'br');
    zlib.brotliCompress(body, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 } }, (err, cmp) => finish(err ? body : cmp, err ? null : 'br'));
  } else if (ae.includes('gzip')) {
    if (prepared && prepared.gzip) return finish(prepared.gzip, 'gzip');
    zlib.gzip(body, { level: 6 }, (err, cmp) => finish(err ? body : cmp, err ? null : 'gzip'));
  } else return finish(body);
}

const staticCache = new Map();
const ROOT_PUBLIC_ALLOW = new Set([
  'index.html', 'app.js', 'style.css', 'manifest.webmanifest', 'sw.js',
  'robots.txt', 'sitemap.xml', 'favicon.svg', 'icon-192.png', 'icon-512.png',
]);
function cachedStatic(file, stat) {
  const stamp = `${stat.size}:${stat.mtimeMs}`;
  const old = staticCache.get(file);
  if (old && old.stamp === stamp) return old;
  const raw = fs.readFileSync(file);
  const value = {
    stamp, raw,
    br: raw.length >= 1024 ? zlib.brotliCompressSync(raw, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 } }) : null,
    gzip: raw.length >= 1024 ? zlib.gzipSync(raw, { level: 6 }) : null,
  };
  staticCache.set(file, value);
  return value;
}

function serveStatic(res, req, pathname) {
  let clean;
  try { clean = decodeURIComponent(pathname).replace(/^\/+/, '') || 'index.html'; }
  catch (e) { return false; }
  if (clean.includes('\0')) return false;
  const root = path.resolve(PUBLIC_DIR);
  const file = path.resolve(root, clean);
  if (file !== root && !file.startsWith(root + path.sep)) {
    sendJson(res, 403, { error: 'forbidden' }, req.headers, { head: req.method === 'HEAD' });
    return true;
  }
  if (PUBLIC_DIR === __dirname && !ROOT_PUBLIC_ALLOW.has(clean.replace(/\\/g, '/'))) return false;
  const ext = path.extname(file).toLowerCase();
  if (!MIME[ext]) return false;
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile()) return false;
    const entry = cachedStatic(file, stat);
    const etag = `W/\"${entry.stamp}\"`;
    const cacheControl = ext === '.html'
      ? 'no-cache'
      : /^(?:app\.js|style\.css|sw\.js)$/.test(path.basename(file))
        ? 'public, max-age=3600, must-revalidate'
        : 'public, max-age=86400';
    const headers = securityHeaders({
      'Content-Type': MIME[ext],
      'Cache-Control': cacheControl,
      ETag: etag,
      Vary: 'Accept-Encoding',
    });
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, headers);
      res.end();
      return true;
    }
    negotiateCompression(req.headers, headers, entry.raw, 200, res, req.method === 'HEAD', entry);
    return true;
  } catch (e) { return false; }
}

function cachePolicyFor(pathname) {
  if (['/api/health', '/api/ping', '/api/online', '/api/stats', '/api/geo', '/api/cache/clear'].includes(pathname)) return 'no-store';
  if (pathname.startsWith('/api/search') || pathname.startsWith('/api/anime/search')) return 'private, max-age=30, stale-while-revalidate=120';
  return 'private, max-age=60, stale-while-revalidate=300';
}

/* ---------------- server ---------------- */
const server = http.createServer(async (req, res) => {
  let u;
  try { u = new URL(req.url, 'http://localhost'); }
  catch (e) { return sendJson(res, 400, { error: 'bad url' }, req.headers); }
  const pathname = u.pathname.replace(/\/+$/, '') || '/';

  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, securityHeaders({ Allow: 'GET, HEAD, OPTIONS', 'Cache-Control': 'no-store' }));
      return res.end();
    }

    if (pathname === '/api/hls') {
      const retryAfter = rateLimit(req, 'hls');
      if (retryAfter) return sendJson(res, 429, { error: 'stream request limit reached' }, req.headers, { headers: { 'Retry-After': String(retryAfter) } });
      return hlsProxy(req, res, u);
    }

    const handler = routes[pathname];
    if (handler) {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        return sendJson(res, 405, { error: 'method not allowed' }, req.headers, { headers: { Allow: 'GET, HEAD' } });
      }
      const retryAfter = rateLimit(req, pathname === '/api/ping' ? 'ping' : 'api');
      if (retryAfter) return sendJson(res, 429, { error: 'request limit reached' }, req.headers, { headers: { 'Retry-After': String(retryAfter) } });
      stats.requests++;
      stats.top[pathname] = (stats.top[pathname] || 0) + 1;
      const data = await handler(u.searchParams, req);
      return sendJson(res, 200, data, req.headers, { cacheControl: cachePolicyFor(pathname), head: req.method === 'HEAD' });
    }

    if (pathname === '/favicon.ico') {
      const body = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#e50914"/><path d="M26 20l18 12-18 12z" fill="white"/></svg>';
      const headers = securityHeaders({ 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400', 'Content-Length': String(Buffer.byteLength(body)) });
      res.writeHead(200, headers);
      return req.method === 'HEAD' ? res.end() : res.end(body);
    }

    if ((req.method === 'GET' || req.method === 'HEAD') && serveStatic(res, req, pathname)) return;
    return sendJson(res, 404, { error: 'not found' }, req.headers, { head: req.method === 'HEAD' });
  } catch (err) {
    const status = err && err.status ? err.status : 502;
    if (status >= 500) console.error(`[error] ${pathname} → ${status}: ${err.message}`);
    return sendJson(res, status, { error: err.message || 'server error' }, req.headers, { head: req.method === 'HEAD' });
  }
});

server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;
server.requestTimeout = 30000;
server.listen(PORT, HOST, () => {
  console.log(`StreamVerse v${VERSION} → http://${HOST}:${PORT}`);
  console.log(`Static: ${PUBLIC_DIR}`);
  console.log(`TMDB: ${TMDB_KEY ? 'configured' : 'missing (set TMDB_KEY on Render)'}`);
});

function shutdown(signal) {
  console.log(`${signal}: closing server`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 8000).unref();
}
process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));
