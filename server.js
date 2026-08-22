/* ============================================================
   StreamVerse v11.1 — backend (Node.js, ZERO npm dependencies)
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
const { extractMovieStreams } = require('./movie-extract');

const VERSION = '12.9.0';
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
    // Currently-airing shows report `episodes: null` on AniList. Derive a
    // usable count so the episode picker is not collapsed to a single item.
    episodes: m.episodes
      || (m.nextAiringEpisode && m.nextAiringEpisode.episode ? Math.max(1, m.nextAiringEpisode.episode - 1) : null)
      || ((m.streamingEpisodes || []).length || null),
    synopsis: m.description || '',
    genres: (m.genres || []).map((g) => ({ name: g })),
    trailer: null,
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
      streamingEpisodes { title thumbnail url site } siteUrl
    }
  }
}`;
const AL_DETAIL = `query ($id: Int, $idMal: Int) {
  Media(id: $id, idMal: $idMal, type: ANIME) {
    id idMal title { romaji english native } coverImage { extraLarge large } bannerImage
    description averageScore seasonYear startDate { year } episodes status format genres
    nextAiringEpisode { episode } streamingEpisodes { title thumbnail url site } siteUrl
  }
}`;
const AL_VIDEO = `query ($id: Int, $idMal: Int) {
  Media(id: $id, idMal: $idMal, type: ANIME) {
    id idMal title { romaji english native } coverImage { extraLarge large } bannerImage
    streamingEpisodes { title thumbnail url site } siteUrl
  }
}`;
const AL_RECOMMENDATIONS = `query ($id: Int, $idMal: Int) {
  Media(id: $id, idMal: $idMal, type: ANIME) {
    recommendations(page: 1, perPage: 24, sort: [RATING_DESC]) {
      nodes {
        rating
        mediaRecommendation {
          id idMal title { romaji english native } coverImage { extraLarge large }
          averageScore seasonYear startDate { year } episodes status format genres siteUrl
        }
      }
    }
  }
}`;

function animeVars(id, source) {
  const n = Number(id);
  if (!Number.isSafeInteger(n) || n <= 0) throw httpError(400, 'invalid anime id');
  return source === 'anilist' ? { id: n } : { idMal: n };
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
  const episodes = (m && m.streamingEpisodes || []).filter((e) => e && e.url).slice(0, 40).map((e, i) => ({
    id: `${source}-${id}-${i + 1}`,
    title: e.title || `Official episode ${i + 1}`,
    thumbnail: e.thumbnail || '', url: secureExternalUrl(e.url), site: e.site || 'Official',
  })).filter((e) => e.url);
  const q = encodeURIComponent(title);
  const malId = (m && m.idMal) || (source === 'mal' ? Number(id) : null);
  const anilistId = (m && m.id) || (source === 'anilist' ? Number(id) : null);
  return {
    ok: Boolean(episodes.length), source: 'AniList', id: Number(id), id_type: source,
    mal_id: malId || null, anilist_id: anilistId || null, title,
    trailer: null, episodes,
    official: [
      { name: 'Crunchyroll', url: `https://www.crunchyroll.com/search?q=${q}` },
      { name: 'Netflix', url: `https://www.netflix.com/search?q=${q}` },
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
  return normaliseAnimeVideos({
    idMal:Number(malId),title:{romaji:title},siteUrl:a.url,streamingEpisodes:[],
  },malId,'mal',{source:'Jikan'});
}

async function animeVideos(id, source = 'mal') {
  return cached(`anime:videos:no-trailer:${source}:${id}`, 30 * 60 * 1000, async () => {
    try { return await animeVideosFromAniList(id, source); }
    catch (primaryError) {
      if (source === 'mal') {
        try { return await animeVideosFromJikan(id); } catch (backupError) { /* fall through */ }
      }
      return {
        ok:false,source:'unavailable',id:Number(id),id_type:source,
        mal_id:source==='mal'?Number(id):null,anilist_id:source==='anilist'?Number(id):null,
        title:'Anime',trailer:null,episodes:[],official:[],
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

/* ---------------- smart search intent parser ---------------- */
const SMART_GENRES = [
  { key: 'romantic-comedy', label: 'Romantic Comedy', aliases: ['romantic comedy', 'rom com', 'रोमांटिक कॉमेडी'], movie: '35,10749', tv: '35,10749', anime: 4 },
  { key: 'comedy', label: 'Comedy', aliases: ['comedy', 'comedies', 'funny', 'कॉमेडी', 'हास्य', 'mazedar', 'मजेदार'], movie: '35', tv: '35', anime: 4 },
  { key: 'action', label: 'Action', aliases: ['action', 'एक्शन', 'मारधाड़'], movie: '28', tv: '10759', anime: 1 },
  { key: 'romance', label: 'Romance', aliases: ['romance', 'romantic', 'love story', 'रोमांस', 'रोमांटिक', 'प्यार'], movie: '10749', tv: '10749', anime: 22 },
  { key: 'horror', label: 'Horror', aliases: ['horror', 'scary', 'ghost', 'हॉरर', 'डरावनी', 'भूत'], movie: '27', tv: '10765', tvKeywords: '6152|3358|162846', anime: 14 },
  { key: 'thriller', label: 'Thriller', aliases: ['thriller', 'suspense', 'थ्रिलर', 'सस्पेंस'], movie: '53', tv: '9648', anime: 41 },
  { key: 'animation', label: 'Animation', aliases: ['animation', 'animated', 'cartoon', 'कार्टून', 'एनिमेशन'], movie: '16', tv: '16', anime: 1 },
  { key: 'documentary', label: 'Documentary', aliases: ['documentary', 'docs', 'डॉक्यूमेंट्री'], movie: '99', tv: '99', anime: null },
  { key: 'crime', label: 'Crime', aliases: ['crime', 'gangster', 'क्राइम', 'अपराध'], movie: '80', tv: '80', anime: 7 },
  { key: 'family', label: 'Family', aliases: ['family', 'kids', 'परिवार', 'बच्चों'], movie: '10751', tv: '10751', anime: null },
  { key: 'fantasy', label: 'Fantasy', aliases: ['fantasy', 'magic', 'फैंटेसी', 'जादू'], movie: '14', tv: '10765', anime: 10 },
  { key: 'scifi', label: 'Sci-Fi', aliases: ['sci fi', 'sci-fi', 'science fiction', 'स्पेस', 'विज्ञान कथा'], movie: '878', tv: '10765', anime: 24 },
  { key: 'adventure', label: 'Adventure', aliases: ['adventure', 'एडवेंचर', 'रोमांच'], movie: '12', tv: '10759', anime: 2 },
  { key: 'mystery', label: 'Mystery', aliases: ['mystery', 'detective', 'मिस्ट्री', 'रहस्य'], movie: '9648', tv: '9648', anime: 7 },
  { key: 'drama', label: 'Drama', aliases: ['drama', 'ड्रामा', 'नाटक'], movie: '18', tv: '18', anime: 8 },
  { key: 'war', label: 'War', aliases: ['war movie', 'war', 'युद्ध'], movie: '10752', tv: '10768', anime: null },
  { key: 'music', label: 'Music', aliases: ['music', 'musical', 'संगीत', 'म्यूजिकल'], movie: '10402', tv: '10764', anime: 19 },
];
const SMART_LANGUAGES = [
  { code: 'hi', label: 'Hindi', aliases: ['hindi', 'bollywood', 'हिन्दी', 'हिंदी'] },
  { code: 'ta', label: 'Tamil', aliases: ['tamil', 'तमिल'] },
  { code: 'te', label: 'Telugu', aliases: ['telugu', 'तेलुगु'] },
  { code: 'ml', label: 'Malayalam', aliases: ['malayalam', 'मलयालम'] },
  { code: 'kn', label: 'Kannada', aliases: ['kannada', 'कन्नड़'] },
  { code: 'ko', label: 'Korean', aliases: ['korean', 'k drama', 'k-drama', 'कोरियन'] },
  { code: 'ja', label: 'Japanese', aliases: ['japanese', 'जापानी'] },
];

function normaliseIntentText(value) {
  return String(value || '').toLowerCase().normalize('NFKD')
    .replace(/[\p{M}]/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim().replace(/\s+/g, ' ');
}
function hasAlias(text, alias) {
  const value = normaliseIntentText(alias);
  return (` ${text} `).includes(` ${value} `);
}
function parseSmartSearch(value) {
  const text = normaliseIntentText(value);
  const genre = SMART_GENRES.find((item) => item.aliases.some((alias) => hasAlias(text, alias))) || null;
  let language = SMART_LANGUAGES.find((item) => item.aliases.some((alias) => hasAlias(text, alias))) || null;
  if (!language && (hasAlias(text, 'south indian') || hasAlias(text, 'south movie') || hasAlias(text, 'साउथ'))) {
    language = { code: 'te|ta|ml|kn', label: 'South Indian' };
  }
  let media = 'all';
  if (['anime', 'ऐनिमे', 'एनीमे'].some((alias) => hasAlias(text, alias))) media = 'anime';
  else if (['movie', 'movies', 'film', 'films', 'फिल्म', 'फिल्में'].some((alias) => hasAlias(text, alias))) media = 'movie';
  else if (['tv', 'show', 'shows', 'series', 'सीरीज', 'शो'].some((alias) => hasAlias(text, alias))) media = 'tv';
  let sort = 'popularity.desc';
  if (['top rated', 'best', 'highest rated', 'टॉप', 'सबसे अच्छा'].some((alias) => hasAlias(text, alias))) sort = 'vote_average.desc';
  else if (['latest', 'new', 'recent', 'नया', 'नई', 'लेटेस्ट'].some((alias) => hasAlias(text, alias))) sort = 'date.desc';
  const yearMatch = text.match(/\b(19\d{2}|20\d{2})\b/);
  const smart = Boolean(genre || language || media !== 'all' || sort !== 'popularity.desc' || yearMatch);
  return {
    smart, genre, language, media, sort,
    year: yearMatch ? yearMatch[1] : '',
    label: [language && language.label, genre && genre.label, media === 'anime' ? 'Anime' : ''].filter(Boolean).join(' · ') || 'Smart results',
  };
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
/* Mirrors of the same anime source API, tried in order. */
const ANIME_STREAM_HOSTS = ['megavid.buzz', 'megaplay.buzz'];

/* ============================================================
   AnimeWorld India (multi-audio provider)

   Why this exists: the megavid path only ever exposes sub/dub and a
   single video rendition. AnimeWorld serves one HLS master that carries
   up to 7 audio languages (Hindi, Tamil, Telugu, Bengali, Malayalam,
   English, Japanese) AND 240p-1080p renditions, so language and quality
   both become real, instant, in-place switches.

   FUTURE-PROOFING: this is a scraper, so every brittle value below is
   overridable with an env var and every extraction step falls back
   through a list of patterns. If the site moves domain or swaps player
   again (it already went .net -> .top and zephyrflick -> zephyrix), you
   change an env var on Render instead of editing code.
   ============================================================ */
const AW_SITES = String(process.env.ANIMEWORLD_HOSTS
  || 'watchanimeworld.top,watchanimeworld.net,watchanimeworld.in')
  .split(',').map((v) => v.trim().toLowerCase()).filter(Boolean);

// Player hosts we know how to talk to. Same PHP contract for each.
const AW_PLAYER_HOSTS = String(process.env.ANIMEWORLD_PLAYER_HOSTS
  || 'play.zephyrix.top,play.zephyrflick.top')
  .split(',').map((v) => v.trim().toLowerCase()).filter(Boolean);

const AW_LANG_NAMES = {
  hin: 'Hindi', tam: 'Tamil', tel: 'Telugu', ben: 'Bengali',
  mal: 'Malayalam', eng: 'English', jpn: 'Japanese', kan: 'Kannada',
  mar: 'Marathi', urd: 'Urdu',
};

function awHeaders(referer) {
  return {
    'User-Agent': UA,
    Accept: 'text/html,application/xhtml+xml,application/json,*/*',
    'Accept-Language': 'en-US,en;q=0.9,hi;q=0.8',
    ...(referer ? { Referer: referer } : {}),
  };
}

async function awFetchText(url, referer, timeoutMs = 15000, init = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: 'follow', headers: awHeaders(referer), ...init });
    if (!res.ok) return null;
    return await res.text();
  } catch { return null; } finally { clearTimeout(timer); }
}

/* Resolve a human title to the site's series slug. Cached for a day: slugs
   effectively never change, and this is the slowest step. */
async function awResolveSlug(title) {
  const clean = String(title || '').trim();
  if (!clean) return null;
  return cached(`aw:slug:${clean.toLowerCase()}`, 24 * 60 * 60 * 1000, async () => {
    // A direct slug guess is right most of the time and costs one request.
    const guess = clean.toLowerCase()
      .replace(/[’'`]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    for (const site of AW_SITES) {
      const html = await awFetchText(`https://${site}/series/${guess}/`, `https://${site}/`, 12000);
      if (html && /play\.zephyr|\/episode\//i.test(html)) return { slug: guess, site };
    }
    // Otherwise fall back to the site search and take the first series hit.
    for (const site of AW_SITES) {
      const html = await awFetchText(`https://${site}/?s=${encodeURIComponent(clean)}`, `https://${site}/`, 15000);
      if (!html) continue;
      const found = [...html.matchAll(/\/series\/([a-z0-9-]+)\/?"/gi)].map((m) => m[1]);
      if (found.length) return { slug: found[0], site };
    }
    return null;
  }, true);
}

/* Pull the player embed id out of an episode page. */
function awExtractPlayer(html) {
  if (!html) return null;
  for (const host of AW_PLAYER_HOSTS) {
    const re = new RegExp(host.replace(/\./g, '\\.') + '/video/([a-f0-9]{16,})', 'i');
    const hit = html.match(re);
    if (hit) return { host, id: hit[1] };
  }
  // Unknown player host but a recognisable /video/<hash> embed: try our known
  // hosts against it rather than giving up.
  const generic = html.match(/https?:\/\/([a-z0-9.-]+)\/video\/([a-f0-9]{16,})/i);
  if (generic) return { host: generic[1].toLowerCase(), id: generic[2] };
  return null;
}

/* Ask the player PHP endpoint for the signed master.m3u8. */
async function awGetVideoSource(playerHost, videoId) {
  const referer = `https://${playerHost}/video/${videoId}`;
  const api = `https://${playerHost}/player/index.php?data=${encodeURIComponent(videoId)}&do=getVideo`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(api, {
      method: 'POST', signal: ctrl.signal,
      headers: { ...awHeaders(referer), 'X-Requested-With': 'XMLHttpRequest' },
    });
    if (!res.ok) return null;
    const body = await res.json().catch(() => null);
    const src = body && (body.videoSource || body.securedLink);
    return typeof src === 'string' && src.includes('.m3u8') ? src : null;
  } catch { return null; } finally { clearTimeout(timer); }
}

/* Read the master playlist so the UI can show the REAL languages and
   qualities instead of guessing. */
function awParseMaster(text) {
  const audio = [];
  const qualities = [];
  if (!text) return { audio, qualities };
  for (const line of text.split('\n')) {
    if (line.startsWith('#EXT-X-MEDIA:TYPE=AUDIO')) {
      const lang = (line.match(/LANGUAGE="([^"]+)"/) || [])[1] || '';
      const name = (line.match(/NAME="([^"]+)"/) || [])[1] || '';
      const code = lang.toLowerCase();
      if (!audio.some((a) => a.code === code && a.label === name)) {
        audio.push({ code, label: AW_LANG_NAMES[code] || name || code || 'Audio', name });
      }
    } else if (line.startsWith('#EXT-X-STREAM-INF')) {
      const res = (line.match(/RESOLUTION=\d+x(\d+)/) || [])[1];
      const bw = Number((line.match(/BANDWIDTH=(\d+)/) || [])[1] || 0);
      if (res) qualities.push({ height: Number(res), bandwidth: bw });
    }
  }
  qualities.sort((a, b) => b.height - a.height);
  return { audio, qualities };
}

/* Full pipeline: title + season/episode -> proxied master URL + track lists. */
// Read the season/episode pairs the series page actually links to. Guessing
// the URL works most of the time, but some shows start at 1x9 or use their own
// season numbering, so the real list is what we trust first.
function awCollectEpisodeLinks(html, slug, into) {
  const re = new RegExp('/episode/' + slug.replace(/[^a-z0-9-]/gi, '.') + '-(\\d{1,3})x(\\d{1,4})/', 'g');
  let m;
  while ((m = re.exec(html || ''))) {
    const s = Number(m[1]); const e = Number(m[2]);
    if (Number.isFinite(s) && Number.isFinite(e)) into.set(`${s}x${e}`, { season: s, episode: e });
  }
  return into;
}

async function awListEpisodes(site, slug) {
  return cached(`aw:eps:${site}:${slug}`, 6 * 60 * 60 * 1000, async () => {
    const seriesUrl = `https://${site}/series/${slug}/`;
    const html = await awFetchText(seriesUrl, `https://${site}/`, 15000);
    if (!html) return [];
    const found = awCollectEpisodeLinks(html, slug, new Map());

    // The series page only renders one season inline; the rest load over
    // admin-ajax (torofilm theme, action_select_season). Pull them so long
    // runs like One Piece resolve past episode 61.
    const postId = (html.match(/data-post="(\d+)"/) || [])[1];
    const seasons = [...new Set([...html.matchAll(/data-season="(\d{1,3})"/g)].map((m2) => Number(m2[1])))]
      .filter((n) => Number.isFinite(n) && n > 0)
      .slice(0, 40);
    if (postId && seasons.length) {
      const results = await Promise.allSettled(seasons.map((season) => awFetchText(
        `https://${site}/wp-admin/admin-ajax.php?action=action_select_season&season=${season}&post=${postId}`,
        seriesUrl, 12000,
      )));
      results.forEach((r) => {
        if (r.status === 'fulfilled' && r.value) awCollectEpisodeLinks(r.value, slug, found);
      });
    }
    return [...found.values()].sort((a, b) => (a.season - b.season) || (a.episode - b.episode));
  }, true).catch(() => []);
}

async function awResolveEpisode(title, season, ep) {
  const resolved = await awResolveSlug(title);
  if (!resolved) return { ok: false, error: 'title not found on AnimeWorld' };
  const { slug, site } = resolved;

  // Their episode URLs are slug-{season}x{episode} with no zero padding.
  // Order of attempts: the season the page really lists for this episode
  // number, then the requested season, then season 1.
  const listed = await awListEpisodes(site, slug);
  const fromList = listed.filter((item) => item.episode === Number(ep)).map((item) => item.season);
  const seasons = [...new Set([...fromList, Number(season) || 1, 1])];
  for (const s of seasons) {
    const pageUrl = `https://${site}/episode/${slug}-${s}x${ep}/`;
    const html = await awFetchText(pageUrl, `https://${site}/series/${slug}/`, 15000);
    if (!html) continue;
    const player = awExtractPlayer(html);
    if (!player) continue;
    const source = await awGetVideoSource(player.host, player.id);
    if (!source) continue;

    const master = await awFetchText(source, `https://${player.host}/`, 15000);
    const { audio, qualities } = awParseMaster(master);
    // A master with no alternate audio is no better than megavid, so let the
    // caller fall back rather than switching provider for nothing.
    if (!audio.length) continue;

    return {
      ok: true,
      provider: 'animeworld',
      site, slug, season: s, episode: ep,
      source: `/api/hls?url=${encodeURIComponent(source)}`,
      // Raw master, needed by /api/hls/remix when the user wants this
      // provider's audio grafted onto another provider's video. It is a
      // short-lived signed URL, so it is only ever used immediately.
      master: source,
      audio, qualities,
      multiAudio: audio.length > 1,
    };
  }
  return { ok: false, error: 'episode not available on AnimeWorld' };
}

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
    hls_inflight: hlsInFlight,
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
  '/api/movie/hindi': (q) => withBackup(
    () => tmdb('/discover/movie', {
      with_original_language: 'hi', sort_by: 'popularity.desc',
      'vote_count.gte': '20', page: pageOf(q), language: langOf(q), include_adult: 'false',
    }, 30 * 60 * 1000),
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

  '/api/search/smart': async (q) => {
    const search = queryOf(q);
    const page = pageOf(q);
    const intent = parseSmartSearch(search);
    if (!intent.smart) {
      return withBackup(
        () => tmdb('/search/multi', { query: search, include_adult: 'false', page, language: langOf(q) }, 10 * 60 * 1000)
          .then((data) => ({ ...data, smart: false, intent: null })),
        async () => {
          const [movies, series] = await Promise.all([cinemetaList('movie', search), cinemetaList('series', search)]);
          return { results: [...movies.results.slice(0, 12), ...series.results.slice(0, 8)], smart: false, intent: null };
        }, 'cinemeta');
    }

    const voteFloor = intent.sort === 'vote_average.desc' ? '200' : intent.sort === 'date.desc' ? '5' : '35';
    const common = {
      include_adult: 'false', page, language: langOf(q),
      'vote_count.gte': voteFloor,
      ...(intent.language ? { with_original_language: intent.language.code } : {}),
    };
    const jobs = [];
    if (intent.media !== 'tv' && intent.media !== 'anime') {
      jobs.push(Promise.resolve().then(() => tmdb('/discover/movie', {
        ...common,
        ...(intent.genre && intent.genre.movie ? { with_genres: intent.genre.movie } : {}),
        ...(intent.year ? { primary_release_year: intent.year } : {}),
        sort_by: intent.sort === 'date.desc' ? 'primary_release_date.desc' : intent.sort,
      }, 20 * 60 * 1000)).then((data) => ({ kind: 'movie', data })).catch(() => ({ kind: 'movie', data: { results: [] } })));
    }
    if (intent.media !== 'movie' && intent.media !== 'anime') {
      jobs.push(Promise.resolve().then(() => tmdb('/discover/tv', {
        ...common,
        ...(intent.genre && intent.genre.tv ? { with_genres: intent.genre.tv } : {}),
        ...(intent.genre && intent.genre.tvKeywords ? { with_keywords: intent.genre.tvKeywords } : {}),
        ...(intent.year ? { first_air_date_year: intent.year } : {}),
        sort_by: intent.sort === 'date.desc' ? 'first_air_date.desc' : intent.sort,
      }, 20 * 60 * 1000)).then((data) => ({ kind: 'tv', data })).catch(() => ({ kind: 'tv', data: { results: [] } })));
    }
    const responses = await Promise.all(jobs);
    const groups = responses.map(({ kind, data }) => (data.results || []).map((item) => ({ ...item, media_type: kind })));
    const results = [];
    const max = Math.max(0, ...groups.map((group) => group.length));
    for (let index = 0; index < max; index++) {
      for (const group of groups) if (group[index]) results.push(group[index]);
    }
    const cleanIntent = {
      genre: intent.genre ? intent.genre.key : null,
      genre_label: intent.genre ? intent.genre.label : null,
      anime_genre_id: intent.genre ? intent.genre.anime : null,
      language: intent.language ? intent.language.code : null,
      language_label: intent.language ? intent.language.label : null,
      media: intent.media,
      sort: intent.sort,
      year: intent.year || null,
      label: intent.label,
    };
    return {
      results: results.slice(0, 40),
      page: Number(page), total_pages: Math.min(20, Math.max(1, ...responses.map((item) => item.data.total_pages || 1))),
      smart: true, intent: cleanIntent,
    };
  },
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
    const locale = langOf(q);
    return cached(`recommend:v2:${locale}:${media}:${id}`, 30 * 60 * 1000, async () => {
      const detail = await tmdb(`/${media}/${id}`, {
        language: locale,
        append_to_response: 'recommendations,similar',
      }, 30 * 60 * 1000);
      const genreIds = (detail.genres || []).map((genre) => genre.id).filter(Boolean);
      const origin = detail.original_language || '';
      const discover = genreIds.length ? await tmdb(`/discover/${media}`, {
        language: locale,
        with_genres: genreIds.slice(0, 3).join('|'),
        ...(origin ? { with_original_language: origin } : {}),
        sort_by: 'popularity.desc',
        'vote_count.gte': '30', page: '1', include_adult: 'false',
      }, 30 * 60 * 1000).catch(() => ({ results: [] })) : { results: [] };

      const ranked = new Map();
      const add = (items, base, reason) => (items || []).forEach((item, index) => {
        if (!item || String(item.id) === String(id)) return;
        const overlap = (item.genre_ids || []).filter((genreId) => genreIds.includes(genreId)).length;
        const languageBoost = origin && item.original_language === origin ? (origin === 'hi' ? 88 : 22) : 0;
        const quality = Math.min(16, Number(item.vote_average || 0) * 1.4)
          + Math.min(30, Math.log10(Number(item.vote_count || 0) + 1) * 8)
          + Math.min(24, Math.log10(Number(item.popularity || 0) + 1) * 8);
        const score = base - index * 0.7 + overlap * 7 + languageBoost + quality;
        const old = ranked.get(item.id);
        if (!old || score > old.score) ranked.set(item.id, { score, item: { ...item, media_type: media, recommendation_reason: reason } });
      });
      add(detail.recommendations && detail.recommendations.results, 104, 'Recommended for this title');
      add(detail.similar && detail.similar.results, 76, 'Similar story and genres');
      add(discover.results, 72, origin === 'hi' ? 'More Hindi titles in these genres' : 'Popular in the same genres');
      const results = [...ranked.values()].sort((a, b) => b.score - a.score).map((entry) => entry.item).slice(0, 30);
      return { results, based_on: { genres: genreIds, original_language: origin } };
    });
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
  /* Native anime playback: resolve a direct HLS manifest + subtitle tracks so
     the in-house player can offer real quality / audio / subtitle switching
     instead of surrendering control to a third-party iframe. */
  '/api/anime/stream': async (q) => {
    const id = positiveInt(q.get('id'), 'anime id');
    const ep = Math.max(1, Math.min(9999, parseInt(q.get('ep'), 10) || 1));
    const kind = q.get('source') === 'anilist' ? 'ani' : 'mal';
    const lang = q.get('lang') === 'dub' ? 'dub' : 'sub';
    const title = String(q.get('title') || '').slice(0, 120);
    const season = Math.max(1, Math.min(99, parseInt(q.get('season'), 10) || 1));
    const cacheKey = `animestream:${kind}:${id}:${ep}:${lang}:${title.toLowerCase()}`;
    return cached(cacheKey, 5 * 60 * 1000, async () => {
    // Prefer AnimeWorld when we know the title: it is the only provider that
    // returns Hindi/Tamil/Telugu audio and genuine 240p-1080p renditions. If
    // anything at all goes wrong we silently fall through to megavid, so this
    // can only ever add capability, never remove it.
    if (title) {
      try {
        const aw = await awResolveEpisode(title, season, ep);
        if (aw && aw.ok) return aw;
      } catch { /* fall through to the legacy providers */ }
    }

    let lastError = 'no anime stream provider responded';
    for (const host of ANIME_STREAM_HOSTS) {
      const endpoint = `https://${host}/api/${kind}/${id}/${ep}/${lang}`;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 12000);
      try {
        const upstream = await fetch(endpoint, {
          signal: ctrl.signal,
          headers: { 'User-Agent': UA, Accept: 'application/json,*/*', Referer: `https://${host}/`, Origin: `https://${host}` },
        });
        clearTimeout(timer);
        if (!upstream.ok) { lastError = `${host} responded ${upstream.status}`; continue; }
        const body = await upstream.json();
        if (!body || body.success === false || !body.source) { lastError = `${host} returned no source`; continue; }

        // Route the manifest and every subtitle through our proxy: the CDN is
        // hotlink-protected and the browser cannot forge a Referer.
        const payload = {
          ok: true,
          provider: host,
          lang,
          episode: ep,
          source: '/api/hls?url=' + encodeURIComponent(String(body.source)),
          tracks: (Array.isArray(body.tracks) ? body.tracks : [])
            .filter((t) => t && t.file && String(t.kind || 'captions') !== 'thumbnails')
            .map((t) => ({
              file: '/api/hls?url=' + encodeURIComponent(String(t.file)),
              label: String(t.label || 'Subtitles'),
              kind: String(t.kind || 'captions'),
              default: !!t.default,
            })),
          intro: body.intro && Number.isFinite(body.intro.start) ? body.intro : null,
          outro: body.outro && Number.isFinite(body.outro.start) ? body.outro : null,
        };
        return payload;
      } catch (e) {
        clearTimeout(timer);
        lastError = e.name === 'AbortError' ? `${host} timed out` : `${host} unreachable`;
      }
    }
    // Not a throw: the client falls back to the iframe providers.
    return { ok: false, error: lastError, source: null, tracks: [] };
    }, false);
  },

  /* Direct (non-iframe) playback for movies and TV.
   *
   * The iframe sources still exist and are still the fallback; this route is
   * what lets a title play in our own <video> element instead, which is the
   * only way the quality picker, the audio-language picker and the speed
   * control can apply to movies the way they already do for anime.
   *
   * Never throws for "not found": a false `ok` simply means the client keeps
   * the iframe it would have used anyway. */
  '/api/movie/stream': async (q) => {
    const tmdbId = positiveInt(q.get('tmdb') || q.get('id'), 'tmdb id');
    const kind = q.get('type') === 'tv' ? 'tv' : 'movie';
    const season = Math.max(1, Math.min(99, parseInt(q.get('season'), 10) || 1));
    const episode = Math.max(1, Math.min(9999, parseInt(q.get('ep') || q.get('episode'), 10) || 1));
    const title = String(q.get('title') || '').slice(0, 120);
    const year = String(q.get('year') || '').slice(0, 4);
    const imdbId = /^tt\d{5,10}$/.test(String(q.get('imdb') || '')) ? String(q.get('imdb')) : '';
    const wantLang = String(q.get('lang') || '').toLowerCase().slice(0, 3).replace(/[^a-z]/g, '');

    const cacheKey = `moviestream:${kind}:${tmdbId}:${season}:${episode}:${wantLang}`;
    // Short TTL: these are signed, expiring CDN URLs. Long enough to spare the
    // upstream a burst when a viewer flips between languages, short enough
    // that nothing handed out has gone stale.
    return cached(cacheKey, 4 * 60 * 1000, async () => {
      let res;
      try {
        res = await extractMovieStreams({ kind, tmdbId, imdbId, title, year, season, episode, wantLang });
      } catch (e) {
        return { ok: false, error: String(e && e.message || e).slice(0, 200), streams: [] };
      }
      if (!res.ok) return { ok: false, error: res.error || 'no direct stream', streams: [] };

      const streams = res.streams.map((s) => ({
        // Proxied, because these CDNs are hotlink-gated and the browser cannot
        // set a cross-origin Referer.
        source: `/api/hls?url=${encodeURIComponent(s.url)}`,
        // Raw master, needed by /api/hls/remix to graft one provider's audio
        // onto another's video. Short-lived, so only used immediately.
        master: s.url,
        language: s.language || '',
        label: s.label || 'Original',
        provider: s.provider,
        height: s.height || 0,
        qualities: Array.isArray(s.qualities) ? s.qualities : [],
        multiQuality: (s.qualities || []).length > 1,
      }));

      const subtitles = (res.subtitles || []).map((t) => ({
        file: `/api/hls?url=${encodeURIComponent(t.url)}`,
        label: String(t.label || 'Subtitle'),
        language: String(t.language || ''),
        kind: 'captions',
      }));

      const languages = [...new Set(streams.map((s) => s.language).filter(Boolean))];
      const primary = streams[0];
      return {
        ok: true,
        type: kind,
        // Flattened shape matching /api/anime/stream so the player can consume
        // either without a second code path.
        source: primary.source,
        master: primary.master,
        provider: primary.provider,
        qualities: primary.qualities,
        streams,
        languages,
        multiLanguage: languages.length > 1,
        subtitles,
      };
    }, false);
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
  '/api/anime/recommendations': async (q) => {
    const id = positiveInt(q.get('id'), 'anime id');
    const source = q.get('source') === 'anilist' ? 'anilist' : 'mal';
    try {
      const data = await anilist(AL_RECOMMENDATIONS, animeVars(id, source));
      const nodes = data && data.Media && data.Media.recommendations && data.Media.recommendations.nodes || [];
      const results = nodes.filter((node) => node && node.mediaRecommendation).map((node) => ({
        ...alMediaToJikan(node.mediaRecommendation),
        recommendation_reason: node.rating > 0 ? 'Highly recommended by anime viewers' : 'Related anime',
        recommendation_score: node.rating || 0,
      }));
      return { data: results };
    } catch (e) {
      if (source !== 'mal') return { data: [] };
      try {
        const result = await jikan(`/anime/${id}/recommendations`, 30 * 60 * 1000);
        return { data: (result.data || []).slice(0, 24).map((item) => ({
          ...(item.entry || {}), recommendation_reason: 'Recommended by anime viewers', recommendation_score: item.votes || 0,
        })) };
      } catch (backupError) { return { data: [] }; }
    }
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
  '.shemaroo.com', '.thelegitpro.in',
  // AnimeWorld/Zephyrix manifest hosts.
  '.zephyrix.top', '.zephyrflick.top',
  ...String(process.env.HLS_ALLOWED_SUFFIXES || '').split(',').map((v) => v.trim().toLowerCase()).filter(Boolean),
];
/* The AnimeWorld/Zephyrix segment CDNs are numbered and rotate without
   warning: s11.zn-grid05.top was serving yesterday, s11.zn-grid06.top today.
   Hard-coding each number silently 403'd every video segment the moment the
   CDN rolled over (round-8 bug: the audio played but no picture). Match the
   whole family with a pattern instead. */
const HLS_ALLOWED_PATTERNS = [
  /(^|\.)zn-grid\d*\.top$/,
  /(^|\.)zephyrix\.top$/,
  /(^|\.)zephyrflick\.top$/,
  /* Movie/TV direct-stream CDNs (/api/movie/stream). Like the anime CDNs
     above these are numbered and rotate, so match the family. */
  /(^|\.)peakstorm\.top$/,
  /(^|\.)primecrown\.top$/,
  /(^|\.)1shows\.app$/,
  /(^|\.)vimeos\.zip$/,
  /(^|\.)dolphin-d\d*\.workers\.dev$/,
  /(^|\.)slast\d*did\.com$/,
  /(^|\.)vdrk\.site$/,
];

const HLS_ALLOWED_EXACT = new Set([
  '103.225.189.136',
  // Anime stream hosts (native player path). These serve the m3u8/vtt returned
  // by the anime source APIs below and require a matching Referer.
  'megavid.buzz', 'megaplay.buzz', 'animeplay.cfd',
  // AnimeWorld / Zephyrix multi-audio path.
  ...AW_SITES, ...AW_PLAYER_HOSTS,
  ...String(process.env.HLS_ALLOWED_HOSTS || '').split(',').map((v) => v.trim().toLowerCase()).filter(Boolean),
]);

/* Some CDNs hotlink-protect their media and return 403 unless the request
   carries the referer of the site that issued the link. The browser cannot set
   Referer cross-origin, which is exactly why these streams must be proxied. */
const HLS_REFERER_BY_HOST = [
  [/(^|\.)megavid\.buzz$/, 'https://megavid.buzz/'],
  [/(^|\.)megaplay\.buzz$/, 'https://megaplay.buzz/'],
  [/(^|\.)animeplay\.cfd$/, 'https://animeplay.cfd/'],
  // Zephyrix serves the manifest AND the segments; both are hotlink-gated.
  [/(^|\.)zephyrix\.top$/, 'https://play.zephyrix.top/'],
  [/(^|\.)zephyrflick\.top$/, 'https://play.zephyrflick.top/'],
  // Segment CDNs used by the above (zn-grid05.top and friends).
  [/(^|\.)zn-grid\d*\.top$/, 'https://play.zephyrix.top/'],
  [/(^|\.)watchanimeworld\.(top|net|in)$/, 'https://watchanimeworld.top/'],
  /* Movie/TV direct streams. Both extractors' CDNs check the referer of the
     player that issued the signed URL, not of our site. */
  [/(^|\.)peakstorm\.top$/, 'https://player.videasy.to/'],
  [/(^|\.)primecrown\.top$/, 'https://player.videasy.to/'],
  [/(^|\.)vimeos\.zip$/, 'https://player.videasy.to/'],
  [/(^|\.)1shows\.app$/, 'https://vidrock.net/'],
  [/(^|\.)dolphin-d\d*\.workers\.dev$/, 'https://vidrock.net/'],
  [/(^|\.)slast\d*did\.com$/, 'https://vidrock.net/'],
  [/(^|\.)vdrk\.site$/, 'https://vidrock.net/'],
];

function hlsRefererFor(hostname) {
  const host = String(hostname || '').toLowerCase();
  const hit = HLS_REFERER_BY_HOST.find(([re]) => re.test(host));
  if (hit) return hit[1];
  // Segment hosts discovered from a trusted manifest inherit its referer.
  const derived = typeof derivedHlsEntry === 'function' ? derivedHlsEntry(host) : null;
  return derived && derived.referer ? derived.referer : '';
}

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

/* These CDNs hand out a different hostname on almost every request
   (peakstorm.top -> primecrown.top -> polarcandy.top ...), so a hand-written
   allowlist goes stale within days and playback dies with a 403 from our own
   proxy. Instead we trust transitively: if a manifest we already allowed
   points at a segment host, that host is part of the same stream and is
   allowed too — for a while. The entry is short-lived and remembers which
   referer the parent needed, so hotlink gating keeps working on the segments.

   This grants no new reach: an attacker cannot get a host in here without
   first serving a playlist from a host we already trust. */
const DERIVED_HLS_HOSTS = new Map();
const DERIVED_HLS_TTL = 6 * 60 * 60 * 1000;
const DERIVED_HLS_MAX = 500;

function trustDerivedHlsHost(hostname, parentUrl) {
  const host = String(hostname || '').toLowerCase().replace(/\.$/, '');
  if (!host || allowedHlsHost(host)) return;
  let referer = '';
  try {
    const parent = new URL(String(parentUrl));
    // Inherit the parent's referer requirement; the segments of a hotlink-
    // gated manifest are gated the same way.
    referer = hlsRefererFor(parent.hostname) || `${parent.protocol}//${parent.host}/`;
  } catch (e) { /* keep the default */ }
  if (DERIVED_HLS_HOSTS.size >= DERIVED_HLS_MAX) {
    const oldest = DERIVED_HLS_HOSTS.keys().next().value;
    if (oldest) DERIVED_HLS_HOSTS.delete(oldest);
  }
  DERIVED_HLS_HOSTS.set(host, { expires: Date.now() + DERIVED_HLS_TTL, referer });
}

function derivedHlsEntry(host) {
  const hit = DERIVED_HLS_HOSTS.get(host);
  if (!hit) return null;
  if (hit.expires < Date.now()) { DERIVED_HLS_HOSTS.delete(host); return null; }
  return hit;
}

function allowedHlsHost(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/\.$/, '');
  return HLS_ALLOWED_EXACT.has(host)
    || HLS_ALLOWED_SUFFIXES.some((suffix) => host.endsWith(suffix))
    || HLS_ALLOWED_PATTERNS.some((re) => re.test(host))
    || !!derivedHlsEntry(host);
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
      const referer = hlsRefererFor(current.hostname);
      response = await fetch(current, {
        signal: ctrl.signal,
        redirect: 'manual',
        headers: {
          'User-Agent': UA,
          Accept: req.headers.accept || '*/*',
          ...(referer ? { Referer: referer, Origin: referer.replace(/\/$/, '') } : {}),
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
    trustDerivedHlsHost(absolute.hostname, base);
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

/* ---------------------------------------------------------------------------
   CROSS-PROVIDER REMIX  (/api/hls/remix)
   ---------------------------------------------------------------------------
   The user's complaint: "the 4K source has bad quality but has Hindi, the
   other source has good quality" -> they want audio from one provider and
   video from the other.

   With sealed iframe players (Videasy, VidFast, APIPlayer...) that is
   impossible; the page is a black box and we can never reach its audio.
   But at the HLS level it IS possible, because a master playlist keeps
   video renditions and audio renditions as SEPARATE entries linked by a
   GROUP-ID. So we can:

     - fetch master A (the good-video provider) and master B (the has-Hindi one)
     - keep A's #EXT-X-STREAM-INF video renditions
     - graft B's #EXT-X-MEDIA:TYPE=AUDIO rows into A's audio group
     - hand the browser one synthetic master

   hls.js then plays A's video with B's audio track, switchable live.
   Everything is proxied through /api/hls so referer gating still works.

   Caveat we surface honestly to the UI: the two masters must be the same
   cut of the same episode or the audio drifts. We only offer the remix when
   both sides report a comparable duration.
--------------------------------------------------------------------------- */
async function fetchMasterText(url, req) {
  const { response, finalUrl } = await fetchHlsUpstream(url, req);
  if (!response.ok) throw httpError(502, 'remix upstream failed');
  const raw = Buffer.from(await response.arrayBuffer());
  if (raw.length > 2 * 1024 * 1024) throw httpError(502, 'remix manifest too large');
  return { text: raw.toString('utf8'), finalUrl };
}

/* Split a master into its audio rows, its video rows, and everything else. */
function splitMaster(text, base) {
  const lines = String(text).split(/\r?\n/);
  const audio = [];
  const video = [];   // { inf, uri }
  const other = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('#EXT-X-MEDIA:TYPE=AUDIO')) {
      audio.push(line.replace(/URI=("([^"]+)"|'([^']+)')/i, (whole, q, dbl, sgl) => {
        const value = dbl || sgl || '';
        return 'URI="' + proxyHlsUrl(value, base) + '"';
      }));
    } else if (line.startsWith('#EXT-X-STREAM-INF')) {
      // The URI is on the following non-comment line.
      let j = i + 1;
      while (j < lines.length && (!lines[j] || lines[j].startsWith('#'))) j++;
      if (j < lines.length) {
        video.push({ inf: line, uri: proxyHlsUrl(lines[j].trim(), base) });
        i = j;
      }
    } else if (line.startsWith('#EXT-X-MEDIA:TYPE=SUBTITLES')) {
      other.push(line.replace(/URI=("([^"]+)"|'([^']+)')/i, (whole, q, dbl, sgl) => {
        const value = dbl || sgl || '';
        return 'URI="' + proxyHlsUrl(value, base) + '"';
      }));
    }
  }
  return { audio, video, other };
}

function mediaAttr(line, key) {
  const m = line.match(new RegExp(key + '="([^"]*)"', 'i'));
  return m ? m[1] : '';
}

/* Force every audio row into one group id and make exactly one DEFAULT. */
function normaliseAudioRows(rows, groupId, preferLang) {
  const want = String(preferLang || '').toLowerCase().slice(0, 3);
  let defaultIndex = -1;
  const cleaned = rows.map((row, index) => {
    let out = row
      .replace(/GROUP-ID="[^"]*"/i, 'GROUP-ID="' + groupId + '"')
      .replace(/DEFAULT=(YES|NO)/i, 'DEFAULT=NO')
      .replace(/AUTOSELECT=(YES|NO)/i, 'AUTOSELECT=YES');
    if (!/GROUP-ID=/i.test(out)) out = out.replace('#EXT-X-MEDIA:', '#EXT-X-MEDIA:GROUP-ID="' + groupId + '",');
    if (!/DEFAULT=/i.test(out)) out += ',DEFAULT=NO';
    const lang = mediaAttr(out, 'LANGUAGE').toLowerCase();
    if (want && defaultIndex < 0 && (lang === want || lang.startsWith(want.slice(0, 2)))) defaultIndex = index;
    return out;
  });
  if (defaultIndex < 0 && cleaned.length) defaultIndex = 0;
  if (defaultIndex >= 0) cleaned[defaultIndex] = cleaned[defaultIndex].replace(/DEFAULT=NO/i, 'DEFAULT=YES');
  return cleaned;
}

/* De-duplicate audio rows by LANGUAGE+NAME so a remix does not show
   "Hindi" three times when both providers carry it. */
function dedupeAudioRows(rows) {
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const key = (mediaAttr(row, 'LANGUAGE') + '|' + mediaAttr(row, 'NAME')).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

async function hlsRemix(req, res, u) {
  const videoUrl = u.searchParams.get('video');
  const audioUrl = u.searchParams.get('audio');
  const preferLang = u.searchParams.get('lang') || '';
  if (!videoUrl || !audioUrl || videoUrl.length > 3000 || audioUrl.length > 3000) {
    return sendJson(res, 400, { error: 'video and audio master urls required' }, req.headers);
  }
  if (hlsInFlight >= 40) {
    return sendJson(res, 503, { error: 'stream proxy busy' }, req.headers, { headers: { 'Retry-After': '3' } });
  }
  hlsInFlight++;
  try {
    const [videoSide, audioSide] = await Promise.all([
      fetchMasterText(videoUrl, req),
      fetchMasterText(audioUrl, req),
    ]);
    const vParts = splitMaster(videoSide.text, videoSide.finalUrl);
    const aParts = splitMaster(audioSide.text, audioSide.finalUrl);
    if (!vParts.video.length) throw httpError(502, 'video master has no renditions');

    const GROUP = 'sv-mix';
    // Audio from the donor first (that is the whole point), then whatever the
    // video side already had, so the user never LOSES a language by remixing.
    const rows = normaliseAudioRows(
      dedupeAudioRows(aParts.audio.concat(vParts.audio)), GROUP, preferLang,
    );
    if (!rows.length) throw httpError(502, 'audio master exposes no selectable tracks');

    const out = ['#EXTM3U', '#EXT-X-VERSION:4'];
    rows.forEach((row) => out.push(row));
    vParts.other.forEach((row) => out.push(row));
    aParts.other.forEach((row) => out.push(row));
    vParts.video.forEach((entry) => {
      // Point every video rendition at our merged audio group and strip any
      // audio codec the original advertised for its own group.
      let inf = entry.inf.replace(/,?AUDIO="[^"]*"/i, '');
      inf += ',AUDIO="' + GROUP + '"';
      out.push(inf);
      out.push(entry.uri);
    });
    const body = Buffer.from(out.join('\n') + '\n');
    stats.hlsBytes += body.length;
    res.writeHead(200, securityHeaders({
      'Content-Type': 'application/vnd.apple.mpegurl; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Length': String(body.length),
    }));
    if (req.method === 'HEAD') return res.end();
    return res.end(body);
  } catch (err) {
    const code = err && err.statusCode ? err.statusCode : 502;
    return sendJson(res, code, { error: (err && err.message) || 'remix failed' }, req.headers);
  } finally {
    hlsInFlight--;
  }
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
      // Live TV viewers change channels constantly, which aborts the socket
      // mid-segment. Stop pulling from upstream the moment that happens.
      if (res.destroyed || res.writableEnded || !res.writable) {
        await reader.cancel('client disconnected').catch(() => {});
        break;
      }
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel('segment too large').catch(() => {});
        throw httpError(502, 'stream segment too large');
      }
      if (!res.write(Buffer.from(value))) {
        // Never await 'drain' alone: on a closed socket that event never fires,
        // so the request would hang forever and leak its in-flight slot until
        // the proxy wedged at 503 and Live TV stopped loading for everyone.
        const drained = await new Promise((resolve) => {
          let settled = false;
          const finish = (ok) => { if (!settled) { settled = true; cleanup(); resolve(ok); } };
          const onDrain = () => finish(true);
          const onStop = () => finish(false);
          const timer = setTimeout(() => finish(false), 20000);
          function cleanup() {
            clearTimeout(timer);
            res.off('drain', onDrain);
            res.off('close', onStop);
            res.off('error', onStop);
          }
          res.once('drain', onDrain);
          res.once('close', onStop);
          res.once('error', onStop);
        });
        if (!drained) {
          await reader.cancel('client gone').catch(() => {});
          break;
        }
      }
    }
    stats.hlsBytes += total;
    if (!res.writableEnded) res.end();
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
  // blob: is required because player SDKs (Vidstack et al.) fetch subtitle
  // tracks through blob URLs; https: covers HLS manifests from live channels.
  "connect-src 'self' blob: data: https: https://api.themoviedb.org https://api.jikan.moe https://graphql.anilist.co",
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
  'hls.min.js',
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

    if (pathname === '/api/hls/remix') {
      const retryAfter = rateLimit(req, 'hls');
      if (retryAfter) return sendJson(res, 429, { error: 'stream request limit reached' }, req.headers, { headers: { 'Retry-After': String(retryAfter) } });
      return hlsRemix(req, res, u);
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
