/* ============================================================
   StreamVerse — backend (Node.js, ZERO npm dependencies)
   Primary: TMDB (movies/TV), Jikan (anime)
   Backup : Cinemeta (movies/TV), AniList (anime), ipapi.co (geo)
   + stale-if-error cache, gzip compression, security headers
   ============================================================ */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const dns = require('dns').promises;

const VERSION = '5.2.0';
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36';

const PUBLIC_DIR = fs.existsSync(path.join(__dirname, 'public', 'index.html'))
  ? path.join(__dirname, 'public')
  : __dirname;

// Get a free TMDB key: https://www.themoviedb.org/settings/api
// Set it as an environment variable TMDB_KEY on your host (Render/Koyeb).
const TMDB_KEY = process.env.TMDB_KEY || '';
if (!TMDB_KEY) {
  console.warn('\n  [warn] TMDB_KEY env var not set — movie/TV data will not load until you add one.\n         Get a free key at https://www.themoviedb.org/settings/api\n');
}
const TMDB_BASE = 'https://api.themoviedb.org/3';
const CINEMETA = 'https://v3-cinemeta.strem.io';
const ANILIST = 'https://graphql.anilist.co';
const WATCH_REGION = process.env.WATCH_REGION || 'IN';

/* ---------------- stats ---------------- */
const stats = {
  started: Date.now(),
  requests: 0,
  apiBytes: 0,
  backupsUsed: { cinemeta: 0, anilist: 0, ipapi: 0, staleCache: 0 },
  top: {},
};
const apiHealth = { tmdb: '?', jikan: '?', cinemeta: '?', anilist: '?', geo: '?' };

/* ---------------- cache (stale-if-error) ---------------- */
const cache = new Map();
async function cached(key, ttl, fn, staleOnError = true) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < ttl) return hit.v;
  try {
    const v = await fn();
    cache.set(key, { t: Date.now(), v });
    if (cache.size > 1200) cache.delete(cache.keys().next().value);
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
      id: m.imdb_id || m.id,
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
  return {
    mal_id: m.idMal || m.id,
    title: (m.title && m.title.romaji) || '',
    title_english: (m.title && (m.title.english || m.title.romaji)) || '',
    images: { jpg: { image_url: m.coverImage && m.coverImage.large, large_image_url: (m.coverImage && (m.coverImage.extraLarge || m.coverImage.large)) || '' } },
    score: m.averageScore ? (m.averageScore / 10).toFixed(1) : null,
    year: m.seasonYear || (m.startDate && m.startDate.year) || null,
    type: m.format === 'MOVIE' ? 'Movie' : 'TV',
    status: m.status === 'RELEASING' ? 'Currently Airing' : m.status === 'FINISHED' ? 'Finished Airing' : (m.status || ''),
    episodes: m.episodes || null,
    synopsis: m.description || '',
    genres: (m.genres || []).map((g) => ({ name: g })),
    trailer: m.trailer && m.trailer.site === 'youtube' ? { youtube_id: m.trailer.id } : null,
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
      trailer { id site } siteUrl
    }
  }
}`;
const AL_DETAIL = `query ($idMal: Int) {
  Media(idMal: $idMal, type: ANIME) {
    id idMal title { romaji english } coverImage { extraLarge large } bannerImage
    description averageScore seasonYear startDate { year } episodes status format genres
    trailer { id site } siteUrl
  }
}`;

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

/* ---------------- TMDB countries (for settings) ---------------- */
function tmdbCountries() {
  return cached('tmdb:countries', 7 * 24 * 60 * 60 * 1000, () =>
    tmdb('/configuration/countries', {}, 7 * 24 * 60 * 60 * 1000));
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
  '/api/health': async () => ({ ok: true, version: VERSION, uptime: Math.round(process.uptime()), time: new Date().toISOString(), cached_items: cache.size }),

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
    // protected: requires ?token=ADMIN_CACHE_TOKEN (env) when set
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
      () => tmdb(`/${media}/${id}`, { append_to_response: 'credits,similar,recommendations,content_ratings,release_dates', language: langOf(q) }),
      async () => {
        // minimal cinemeta fallback
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
      () => jikan(`/anime?genres=${g}&order_by=members&sort=desc&sfw=true&page=${page}`),
      async () => {
        const d = await anilist(AL_LIST, { page: parseInt(page, 10), sort: ['POPULARITY_DESC'], genre: name });
        return { data: ((d.Page && d.Page.media) || []).map(alMediaToJikan) };
      }, 'anilist');
  },
  '/api/anime/top': (q) => withBackup(
    () => jikan('/top/anime?page=' + (q.get('page') || '1')),
    async () => { const d = await anilist(AL_LIST, { page: parseInt(q.get('page') || '1', 10), sort: ['SCORE_DESC'] }); return { data: ((d.Page && d.Page.media) || []).map(alMediaToJikan) }; }, 'anilist'),
  '/api/anime/topairing': () => withBackup(
    () => jikan('/top/anime?filter=airing'),
    async () => { const d = await anilist(AL_LIST, { page: 1, sort: ['POPULARITY_DESC'], status: 'RELEASING' }); return { data: ((d.Page && d.Page.media) || []).map(alMediaToJikan) }; }, 'anilist'),
  '/api/anime/search': (q) => withBackup(
    () => jikan('/anime?q=' + encodeURIComponent(q.get('q') || '') + '&page=1'),
    async () => { const d = await anilist(AL_LIST, { page: 1, sort: ['SEARCH_MATCH'], search: q.get('q') || '' }); return { data: ((d.Page && d.Page.media) || []).map(alMediaToJikan) }; }, 'anilist'),
  '/api/anime/details': (q) => {
    const id = q.get('id');
    if (!id) throw httpError(400, 'id required');
    return withBackup(
      () => jikan(`/anime/${id}/full`),
      async () => { const d = await anilist(AL_DETAIL, { idMal: parseInt(id, 10) }); return { data: alMediaToJikan(d.Media) }; }, 'anilist');
  },
};

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
