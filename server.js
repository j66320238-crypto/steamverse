/* ============================================================
   StreamVerse v9.3 — backend (Node.js, ZERO npm dependencies)
   Primary: TMDB (movies/TV), Jikan (anime)
   Backup : Cinemeta (movies/TV), AniList (anime), ipwho.is (geo)
   + stale-if-error cache, gzip/br compression, security headers
   ============================================================ */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const VERSION = '9.3.0';
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36';

const PUBLIC_DIR = fs.existsSync(path.join(__dirname, 'public', 'index.html'))
  ? path.join(__dirname, 'public')
  : __dirname;

const TMDB_KEY = process.env.TMDB_KEY || '3fd2be6f0c70a2a598f084ddfb75487c';
const TMDB_BASE = 'https://api.themoviedb.org/3';
const CINEMETA = 'https://v3-cinemeta.strem.io';
const ANILIST = 'https://graphql.anilist.co';
const WATCH_REGION = process.env.WATCH_REGION || 'IN';

/* ---------------- stats + online presence ---------------- */
const stats = {
  started: Date.now(),
  requests: 0,
  apiBytes: 0,
  backupsUsed: { cinemeta: 0, anilist: 0, ipapi: 0, staleCache: 0 },
  top: {},
};
const apiHealth = { tmdb: '?', jikan: '?', cinemeta: '?', anilist: '?', geo: '?' };

// online presence: heartbeats live for 45s; sweep every 15s.
const presence = new Map(); // token -> lastSeen
let anonCounter = 0;
function sweepPresence() {
  const now = Date.now();
  for (const [k, v] of presence) if (now - v > 45000) presence.delete(k);
}
function onlineCount() { sweepPresence(); return presence.size; }
setInterval(sweepPresence, 15000).unref?.();

/* ---------------- cache (stale-if-error) ---------------- */
const cache = new Map();
async function cached(key, ttl, fn, staleOnError = true) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < ttl) return hit.v;
  try {
    const v = await fn();
    cache.set(key, { t: Date.now(), v });
    if (cache.size > 1500) cache.delete(cache.keys().next().value);
    return v;
  } catch (e) {
    if (staleOnError && hit) {
      stats.backupsUsed.staleCache++;
      if (hit.v && typeof hit.v === 'object') hit.v._stale = true;
      return hit.v;
    }
    throw e;
  }
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
        headers: { 'User-Agent': UA, ...headers },
      });
      clearTimeout(timer);
      if (r.status === 429) {
        lastErr = new Error('rate-limited: ' + url);
        if (attempt < retries) { await sleep(900 * (attempt + 1)); continue; }
        throw lastErr;
      }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch (e) {
      clearTimeout(timer);
      lastErr = e;
      if (attempt < retries) await sleep(600 * (attempt + 1));
    }
  }
  throw lastErr || new Error('fetch failed');
}

/* ---------------- TMDB ---------------- */
function tmdb(p, params = {}, ttl = 15 * 60 * 1000) {
  const q = new URLSearchParams({ api_key: TMDB_KEY, language: 'en-US', ...params }).toString();
  const url = `${TMDB_BASE}${p}?${q}`;
  return cached('tmdb:' + url, ttl, async () => {
    try { const v = await jfetch(url); apiHealth.tmdb = 'ok'; return v; }
    catch (e) { apiHealth.tmdb = 'error'; throw e; }
  });
}
const langOf = (q) => q.get('lang') || 'en-US';

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
    mal_id: m.idMal || m.id,
    title: (m.title && (m.title.romaji || m.title.english)) || '',
    title_english: (m.title && (m.title.english || m.title.romaji)) || '',
    title_japanese: m.title && m.title.native,
    images: { jpg: { image_url: m.coverImage && m.coverImage.large, large_image_url: (m.coverImage && (m.coverImage.extraLarge || m.coverImage.large)) || '' } },
    score: m.averageScore ? (m.averageScore / 10).toFixed(1) : null,
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
      id idMal title { romaji english } coverImage { extraLarge large }
      averageScore seasonYear startDate { year } episodes status format genres
      trailer { id site thumbnail } streamingEpisodes { title thumbnail url site } siteUrl
    }
  }
}`;
const AL_DETAIL = `query ($idMal: Int) {
  Media(idMal: $idMal, type: ANIME) {
    id idMal title { romaji english } coverImage { extraLarge large } bannerImage
    description averageScore seasonYear startDate { year } episodes status format genres
    trailer { id site thumbnail } streamingEpisodes { title thumbnail url site } siteUrl
  }
}`;
const AL_VIDEO = `query ($idMal: Int) {
  Media(idMal: $idMal, type: ANIME) {
    id idMal title { romaji english native } coverImage { extraLarge large } bannerImage
    trailer { id site thumbnail } streamingEpisodes { title thumbnail url site } siteUrl
  }
}`;

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

function normaliseAnimeVideos(m, malId, extra = {}) {
  const title = animeTitle(m);
  const trailer = m && m.trailer && String(m.trailer.site || '').toLowerCase() === 'youtube'
    ? youtubeTrailer(m.trailer.id, m.trailer.thumbnail)
    : null;
  const episodes = (m && m.streamingEpisodes || []).filter((e) => e && e.url).slice(0, 40).map((e, i) => ({
    id: `${malId}-${i + 1}`,
    title: e.title || `Official episode ${i + 1}`,
    thumbnail: e.thumbnail || '', url: secureExternalUrl(e.url), site: e.site || 'Official',
  }));
  const q = encodeURIComponent(title);
  return {
    ok: Boolean(trailer || episodes.length), source: 'AniList', mal_id: Number(malId), title,
    trailer, episodes,
    official: [
      { name: 'Crunchyroll', url: `https://www.crunchyroll.com/search?q=${q}` },
      { name: 'Netflix', url: `https://www.netflix.com/search?q=${q}` },
      { name: 'YouTube', url: `https://www.youtube.com/results?search_query=${q}+official+trailer` },
      ...(m && m.siteUrl ? [{ name: 'AniList', url: m.siteUrl }] : []),
    ],
    ...extra,
  };
}

async function animeVideosFromAniList(malId) {
  const data = await anilist(AL_VIDEO, { idMal: Number(malId) });
  const media = data && data.Media;
  if (!media) throw new Error('anime not found');
  return normaliseAnimeVideos(media, malId);
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
  const trailer = trailerId
    ? youtubeTrailer(trailerId, a.images && a.images.jpg && a.images.jpg.image_url)
    : null;
  return normaliseAnimeVideos({ title: { romaji: title }, trailer, streamingEpisodes: [] }, malId, { source: 'Jikan' });
}

async function animeVideos(malId) {
  return cached('anime:videos:' + malId, 30 * 60 * 1000, async () => {
    try {
      const primary = await animeVideosFromAniList(malId);
      // AniList sometimes has no trailer even though TMDB has an official
      // YouTube clip. Use the existing MAL → TMDB matcher only as a trailer
      // fallback; episode links always remain official provider URLs.
      if (!primary.trailer && !primary.episodes.length) {
        try {
          const mapped = await animeToTmdb(malId);
          if (mapped && mapped.tmdb_id) {
            const videos = await tmdb(`/${mapped.media}/${mapped.tmdb_id}/videos`, { language: 'en-US' }, 30 * 24 * 60 * 60 * 1000);
            const clip = (videos.results || []).find((v) => String(v.site).toLowerCase() === 'youtube' && /trailer|teaser|clip/i.test(v.type || v.name || ''))
              || (videos.results || []).find((v) => String(v.site).toLowerCase() === 'youtube');
            if (clip && clip.key) {
              primary.trailer = youtubeTrailer(clip.key);
              primary.ok = true;
              primary.source = 'AniList + TMDB video fallback';
            }
          }
        } catch (e) { /* keep the official provider links */ }
      }
      return primary;
    } catch (primaryError) {
      try { return await animeVideosFromJikan(malId); }
      catch (backupError) {
        return { ok: false, source: 'unavailable', mal_id: Number(malId), title: 'Anime', trailer: null, episodes: [], official: [] };
      }
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

/* ---------------- routes ---------------- */
const routes = {
  // CORS proxy for TMDB — lets file:// and other origins hit TMDB through us.
  '/api/tmdb': async (q) => {
    const p = q.get('p') || '';
    if (!/^\/[a-z0-9/_-]+$/i.test(p)) throw httpError(400, 'bad path');
    const params = {};
    for (const [k, v] of q) if (k !== 'p' && k !== 'api_key') params[k] = v;
    // Always use the Render/server key, never a browser-supplied key.
    params.api_key = TMDB_KEY;
    return tmdb(p, params, 5 * 60 * 1000);
  },

  '/api/health': async () => ({ ok: true, version: VERSION, uptime: Math.round(process.uptime()), time: new Date().toISOString(), cached_items: cache.size }),

  '/api/ping': async (q) => {
    // lightweight heartbeat. client sends &t=<token>; server keeps it live.
    const tok = q.get('t') || ('a' + (++anonCounter) + '_' + Date.now().toString(36));
    presence.set(tok, Date.now());
    return { ok: true, token: tok, online: onlineCount(), serverTime: Date.now() };
  },

  '/api/online': async () => ({ online: onlineCount(), started: stats.started }),

  '/api/stats': async () => ({
    uptime_s: Math.round((Date.now() - stats.started) / 1000),
    requests: stats.requests,
    api_mb: +(stats.apiBytes / 1048576).toFixed(2),
    backups_used: stats.backupsUsed,
    api_health: apiHealth,
    cache_items: cache.size,
    top_routes: Object.entries(stats.top).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([r, n]) => ({ route: r, hits: n })),
  }),

  '/api/cache/clear': async (q) => {
    const tok = process.env.ADMIN_CACHE_TOKEN;
    if (tok && q.get('token') !== tok) throw httpError(403, 'forbidden');
    const n = cache.size; cache.clear();
    return { ok: true, cleared: n };
  },

  '/api/geo': async (q, req) => {
    const ip = q.get('ip') || clientIp(req);
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
    const malId = q.get('id');
    if (!malId) throw httpError(400, 'id required');
    return withBackup(
      () => animeToTmdb(malId),
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

  '/api/search': (q) => withBackup(
    () => tmdb('/search/multi', { query: q.get('q') || '', include_adult: 'false', page: q.get('page') || '1', language: langOf(q) }),
    async () => {
      const s = q.get('q') || '';
      const [mv, sr] = await Promise.all([cinemetaList('movie', s), cinemetaList('series', s)]);
      return { results: [...mv.results.slice(0, 12), ...sr.results.slice(0, 8)] };
    }, 'cinemeta'),

  '/api/details': (q) => {
    const media = q.get('media');
    const id = q.get('id');
    if (!media || !id) throw httpError(400, 'media & id required');
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
    const id = q.get('id');
    if (!['movie', 'tv'].includes(media) || !id) throw httpError(400, 'media & id required');
    const fetchList = (kind) => tmdb(`/${media}/${id}/${kind}`, { page: '1', language: langOf(q) }, 15 * 60 * 1000).catch(() => ({ results: [] }));
    const [recommended, similar] = await Promise.all([fetchList('recommendations'), fetchList('similar')]);
    const results = [...(recommended.results || []), ...(similar.results || [])]
      .filter((v, i, arr) => v && arr.findIndex((x) => x.id === v.id) === i)
      .slice(0, 24);
    return { results };
  },

  '/api/tv/season': async (q) => {
    const id = q.get('id');
    const season = q.get('s') || '1';
    if (!id) throw httpError(400, 'id required');
    return tmdb(`/tv/${id}/season/${season}`, { language: langOf(q) }, 60 * 60 * 1000);
  },

  '/api/watch': async (q) => {
    const media = q.get('media');
    const id = q.get('id');
    if (!media || !id) throw httpError(400, 'media & id required');
    try {
      return await tmdb(`/${media}/${id}/watch/providers`, { watch_region: q.get('region') || WATCH_REGION }, 60 * 60 * 1000);
    } catch (e) { return { results: {} }; }
  },

  '/api/genres': (q) => {
    const media = q.get('media') === 'tv' ? 'tv' : 'movie';
    return tmdb(`/genre/${media}/list`, {}, 24 * 60 * 60 * 1000);
  },
  '/api/movie/genre': (q) => {
    const g = q.get('g');
    if (!g) throw httpError(400, 'g required');
    return tmdb('/discover/movie', {
      with_genres: g, sort_by: q.get('sort') || 'popularity.desc',
      'vote_count.gte': '50', page: q.get('page') || '1', language: langOf(q),
    });
  },
  '/api/tv/genre': (q) => {
    const g = q.get('g');
    if (!g) throw httpError(400, 'g required');
    return tmdb('/discover/tv', {
      with_genres: g, sort_by: q.get('sort') || 'popularity.desc',
      'vote_count.gte': '50', page: q.get('page') || '1', language: langOf(q),
    });
  },

  /* anime */
  '/api/anime/genres': () => withBackup(
    () => jikan('/genres/anime', 24 * 60 * 60 * 1000).then((d) => ({ genres: (d.data || []).filter((g) => g.mal_id < 50 || g.mal_id === 62) })),
    async () => ({ genres: ANIME_GENRES_FALLBACK }), 'anilist'),
  '/api/anime/genre': (q) => {
    const g = q.get('g'); const name = q.get('name') || ''; const page = q.get('page') || '1';
    if (!g) throw httpError(400, 'g required');
    return withBackup(
      async () => {
        const d = await anilist(AL_LIST, { page: parseInt(page, 10), sort: ['POPULARITY_DESC'], genre: name });
        return { data: ((d.Page && d.Page.media) || []).map(alMediaToJikan), pagination: { current_page: Number(page) } };
      },
      () => jikan(`/anime?genres=${g}&order_by=members&sort=desc&sfw=true&page=${page}`), 'jikan');
  },
  '/api/anime/top': (q) => withBackup(
    async () => { const d = await anilist(AL_LIST, { page: parseInt(q.get('page') || '1', 10), sort: ['SCORE_DESC'] }); return { data: ((d.Page && d.Page.media) || []).map(alMediaToJikan), pagination: { last_visible_page: 20 } }; },
    () => jikan('/top/anime?page=' + (q.get('page') || '1')), 'jikan'),
  '/api/anime/topairing': (q) => withBackup(
    async () => { const d = await anilist(AL_LIST, { page: parseInt(q.get('page') || '1', 10), sort: ['POPULARITY_DESC'], status: 'RELEASING' }); return { data: ((d.Page && d.Page.media) || []).map(alMediaToJikan), pagination: { last_visible_page: 20 } }; },
    () => jikan('/top/anime?filter=airing'), 'jikan'),
  '/api/anime/search': (q) => withBackup(
    async () => { const d = await anilist(AL_LIST, { page: 1, sort: ['SEARCH_MATCH'], search: q.get('q') || '' }); return { data: ((d.Page && d.Page.media) || []).map(alMediaToJikan) }; },
    () => jikan('/anime?q=' + encodeURIComponent(q.get('q') || '') + '&page=1'), 'jikan'),
  '/api/anime/details': (q) => {
    const id = q.get('id');
    if (!id) throw httpError(400, 'id required');
    return withBackup(
      async () => { const d = await anilist(AL_DETAIL, { idMal: parseInt(id, 10) }); return { data: alMediaToJikan(d.Media) }; },
      () => jikan(`/anime/${id}/full`), 'jikan');
  },
  '/api/anime/videos': (q) => {
    const id = q.get('id');
    if (!id || !/^\d+$/.test(String(id))) throw httpError(400, 'id required');
    return animeVideos(id);
  },

  /* K-Drama / Asian drama browse */
  '/api/drama/popular': (q) => {
    const lang = q.get('lang') || 'ko';
    return withBackup(
      () => tmdb('/discover/tv', {
        with_original_language: lang,
        sort_by: 'popularity.desc',
        page: q.get('page') || '1',
        'vote_count.gte': '10',
        language: langOf(q),
      }),
      () => cinemetaList('series'), 'cinemeta');
  },
};

/* ---------------- HLS proxy for Live TV ----------------
   Some streams don't send CORS headers; this proxies m3u8/segments
   so hls.js can play them. Whitelist http(s) targets only. */
const HLS_BLOCKLIST = /(localhost|127\.|169\.254|::1|10\.|192\.168)/i;
async function hlsProxy(req, res, u) {
  if (req.method !== 'GET') { res.writeHead(405); return res.end(); }
  const target = u.searchParams.get('url');
  if (!target) { res.writeHead(400); return res.end('url required'); }
  let parsed;
  try { parsed = new URL(target); } catch { res.writeHead(400); return res.end('bad url'); }
  if (!/^https?:$/.test(parsed.protocol) || HLS_BLOCKLIST.test(parsed.host)) {
    res.writeHead(400); return res.end('blocked');
  }
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    const r = await fetch(target, {
      signal: ctrl.signal, redirect: 'follow',
      headers: {
        'User-Agent': UA,
        'Referer': target,
        'Origin': 'https://' + parsed.host,
      },
    });
    clearTimeout(timer);
    const ct = r.headers.get('content-type') || 'application/octet-stream';
    res.writeHead(r.status, {
      'Content-Type': ct,
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': ct.includes('mpegurl') || ct.includes('json') ? 'no-store' : 'public, max-age=30',
      'X-Content-Type-Options': 'nosniff',
    });
    if (!r.ok || !r.body) { res.end(); return; }
    // stream the body
    const reader = r.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
    res.end();
  } catch (e) {
    if (!res.headersSent) res.writeHead(502);
    res.end('upstream error: ' + e.message);
  }
}

/* ---------------- static + gzip ---------------- */
const MIME = {
  '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.html': 'text/html; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon',
  '.webp': 'image/webp', '.woff2': 'font/woff2',
};
const COMPRESSIBLE = /^text\/|application\/json|application\/javascript|application\/manifest/i;

function sendJson(res, code, data, reqHeaders) {
  const body = Buffer.from(JSON.stringify(data));
  stats.apiBytes += body.length;
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  };
  negotiateCompression(reqHeaders, headers, body, code, res);
}

function negotiateCompression(reqHeaders, headers, body, code, res) {
  const ae = (reqHeaders['accept-encoding'] || '').toLowerCase();
  if (body.length < 1024 || !COMPRESSIBLE.test(headers['Content-Type'] || '')) {
    headers['Content-Length'] = body.length;
    res.writeHead(code, headers);
    return res.end(body);
  }
  if (ae.includes('br')) {
    zlib.brotliCompress(body, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 } }, (err, cmp) => {
      if (err) { headers['Content-Length'] = body.length; res.writeHead(code, headers); return res.end(body); }
      headers['Content-Encoding'] = 'br';
      headers['Content-Length'] = cmp.length;
      res.writeHead(code, headers); res.end(cmp);
    });
  } else if (ae.includes('gzip')) {
    zlib.gzip(body, { level: 6 }, (err, cmp) => {
      if (err) { headers['Content-Length'] = body.length; res.writeHead(code, headers); return res.end(body); }
      headers['Content-Encoding'] = 'gzip';
      headers['Content-Length'] = cmp.length;
      res.writeHead(code, headers); res.end(cmp);
    });
  } else {
    headers['Content-Length'] = body.length;
    res.writeHead(code, headers); res.end(body);
  }
}

function serveStatic(res, req, p) {
  let clean;
  try { clean = decodeURIComponent(p).replace(/^\/+/, '') || 'index.html'; }
  catch { clean = 'index.html'; }
  const file = path.normalize(path.join(PUBLIC_DIR, clean));
  if (!file.startsWith(PUBLIC_DIR)) { sendJson(res, 403, { error: 'forbidden' }, req.headers); return true; }
  const ext = path.extname(file).toLowerCase();
  if (!MIME[ext]) return false;
  if (PUBLIC_DIR === __dirname && path.basename(file) === 'server.js') return false;
  try {
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return false;
    const buf = fs.readFileSync(file);
    const headers = {
      'Content-Type': MIME[ext],
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    };
    negotiateCompression(req.headers, headers, buf, 200, res);
    return true;
  } catch { return false; }
}

/* ---------------- server ---------------- */
const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Methods': 'GET,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'X-Content-Type-Options': 'nosniff',
    });
    return res.end();
  }
  let u;
  try { u = new URL(req.url, 'http://localhost'); }
  catch { return sendJson(res, 400, { error: 'bad url' }, req.headers); }
  const p = u.pathname.replace(/\/+$/, '') || '/';

  try {
    // HLS proxy for live TV
    if (p === '/api/hls') return hlsProxy(req, res, u);
    const handler = routes[p];
    if (handler) {
      stats.requests++;
      stats.top[p] = (stats.top[p] || 0) + 1;
      const data = await handler(u.searchParams, req);
      return sendJson(res, 200, data, req.headers);
    }
    if (p === '/favicon.ico') {
      res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' });
      return res.end('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#e50914"/><path d="M26 20l18 12-18 12z" fill="white"/></svg>');
    }
    if (req.method === 'GET' && serveStatic(res, req, p)) return;
    return sendJson(res, 404, { error: 'not found' }, req.headers);
  } catch (err) {
    const status = err && err.status ? err.status : 502;
    console.error(`[error] ${p} → ${status}: ${err.message}`);
    return sendJson(res, status, { error: err.message || 'server error' }, req.headers);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`StreamVerse v${VERSION} → http://${HOST}:${PORT}`);
  console.log(`Static: ${PUBLIC_DIR}`);
});
