/* ============================================================
   StreamVerse v9.3 — client
   • Works with or without the Node server (direct TMDB/Jikan fallback)
   • 8 embed sources (VidSrc, Embed.su, MultiEmbed, AutoEmbed, SmashyStream,
     VidSrc.xyz, 2Embed, Streambug) with season/episode picker
   • Playlists (multiple, named) — Netflix-style
   • Live TV with custom HLS.js player (speed + quality controls, PiP, mute)
   • K-Drama / Asian drama category
   • Add-to-playlist from player, continue-watching with S/E
   • Fully mobile-optimised
   ============================================================ */
(() => {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const IMG = 'https://image.tmdb.org/t/p/w500';
  const BACKDROP = 'https://image.tmdb.org/t/p/w1280';
  const CAST_IMG = 'https://image.tmdb.org/t/p/w185';

  const TMDB_KEY = ''; // Keep the production key on Render as TMDB_KEY; never send it to the browser
  const TMDB_BASE = 'https://api.themoviedb.org/3';
  const ANILIST_GRAPHQL = 'https://graphql.anilist.co';
  const ANILIST_VIDEO_QUERY = `query ($idMal: Int) {
    Media(idMal: $idMal, type: ANIME) {
      id idMal title { romaji english native } coverImage { extraLarge large } bannerImage
      trailer { id site thumbnail } streamingEpisodes { title thumbnail url site } siteUrl
    }
  }`;

  const LANGS = [
    ['', 'Original'], ['en-US', 'English'], ['hi-IN', 'Hindi'],
    ['ta-IN', 'Tamil'], ['te-IN', 'Telugu'], ['ml-IN', 'Malayalam'],
    ['kn-IN', 'Kannada'], ['bn-IN', 'Bengali'], ['mr-IN', 'Marathi'],
    ['ja-JP', 'Japanese'], ['ko-KR', 'Korean'], ['zh-CN', 'Chinese'],
    ['es-ES', 'Spanish'], ['fr-FR', 'French'], ['de-DE', 'German'],
    ['pt-BR', 'Portuguese'], ['ru-RU', 'Russian'], ['ar-SA', 'Arabic'],
  ];

  const AUDIO_NAMES = {
    en: 'English', hi: 'Hindi', ta: 'Tamil', te: 'Telugu', ml: 'Malayalam', kn: 'Kannada',
    bn: 'Bengali', mr: 'Marathi', pa: 'Punjabi', gu: 'Gujarati', ja: 'Japanese', ko: 'Korean',
    zh: 'Chinese', es: 'Spanish', fr: 'French', de: 'German', pt: 'Portuguese', ru: 'Russian',
    ar: 'Arabic', tr: 'Turkish', th: 'Thai', it: 'Italian', nl: 'Dutch', pl: 'Polish',
  };

  /* ========= STREAM SOURCES (verified working) =========
     Order = priority for "Auto (best)". */
  const STREAM_SOURCES = [
    { id: 'vidlink',    name: 'VidLink',       color: '#14b8a6', priority: 10,
      movie: (id, lang) => `https://vidlink.pro/movie/${id}${lang ? '?language='+lang : ''}`,
      tv: (id,s,e,lang) => `https://vidlink.pro/tv/${id}/${s}/${e}${lang ? '?language='+lang : ''}` },
    { id: 'vidsrc-to',  name: 'VidSrc.to',     color: '#e50914', priority: 9,
      movie: (id) => `https://vidsrc.to/embed/movie/${id}`,
      tv: (id,s,e) => `https://vidsrc.to/embed/tv/${id}/${s}/${e}` },
    { id: 'vidsrc-me',  name: 'VidSrc.me',     color: '#dc2626', priority: 8,
      movie: (id) => `https://vidsrc.me/embed/movie?tmdb=${id}`,
      tv: (id,s,e) => `https://vidsrc.me/embed/tv?tmdb=${id}&season=${s}&episode=${e}` },
    { id: 'vidsrc-su',  name: 'VidSrc.su',     color: '#b91c1c', priority: 7,
      movie: (id) => `https://vidsrc.su/embed/movie/${id}`,
      tv: (id,s,e) => `https://vidsrc.su/embed/tv/${id}/${s}/${e}` },
    { id: '2embed-stream', name: '2Embed',     color: '#d97706', priority: 6,
      movie: (id) => `https://2embed.stream/embed/movie/${id}`,
      tv: (id,s,e) => `https://2embed.stream/embed/tv/${id}/${s}/${e}` },
  ];
  // "Auto" — tries sources in priority order until one loads
  const AUTO_ID = 'auto';
  function orderedSources() {
    return [...STREAM_SOURCES].sort((a,b) => (b.priority||0)-(a.priority||0));
  }

  /* ========= LIVE TV CHANNELS (free public HLS) ========= */
  const LIVE_CHANNELS = [
    { cat: 'News',    name: 'Al Jazeera English',  logo: '🇶🇦', url: 'https://live-hls-web-aje.getaj.net/AJE/01.m3u8' },
    { cat: 'News',    name: 'Al Jazeera Arabic',   logo: '🇶🇦', url: 'https://live-hls-web-aja.getaj.net/AJA/01.m3u8' },
    { cat: 'News',    name: 'France 24 English',   logo: '🇫🇷', url: 'https://static.france24.com/live/F24_EN_LO_HLS/live_web.m3u8' },
    { cat: 'News',    name: 'France 24 Français',  logo: '🇫🇷', url: 'https://static.france24.com/live/F24_FR_LO_HLS/live_web.m3u8' },
    { cat: 'News',    name: 'DW English',          logo: '🇩🇪', url: 'https://dwamdstream102.akamaized.net/hls/live/2015525/dwstream102/index.m3u8' },
    { cat: 'News',    name: 'Bloomberg TV',        logo: '🇺🇸', url: 'https://bloomberg.com/media-manifest/streams/us.m3u8' },
    { cat: 'News',    name: 'CNBC USA',            logo: '🇺🇸', url: 'https://podium.services.springcpc.com/ttcnnlkjhb/chunks.m3u8' },
    { cat: 'News',    name: 'NHK World Japan',     logo: '🇯🇵', url: 'https://nhkwlive-ojp.akamaized.net/hls/live/2003459/nhkwlive-ojp-en/index.m3u8' },
    { cat: 'News',    name: 'CNA',                 logo: '🇸🇬', url: 'https://d2e9ms4x0r9b6s.cloudfront.net/hls/cna-intl.m3u8' },
    { cat: 'News',    name: 'Euronews English',    logo: '🇪🇺', url: 'https://rakuten-euronews-1-be.samsung.wurl.tv/playlist.m3u8' },
    { cat: 'News',    name: 'Sky News Australia',  logo: '🇦🇺', url: 'https://linear217-gb-hls1-prd-ak.cdn01.cds1.skycdp.com/usp/auth/content_1080p30/master.m3u8' },
    { cat: 'Entertainment', name: 'Red Bull TV',   logo: '🐂', url: 'https://rbmn-live.akamaized.net/hls/live/590964/BoRB-AT/master.m3u8' },
    { cat: 'Entertainment', name: 'MTV Lebanon',   logo: '🎵', url: 'https://d2y7y4m3.stackpathdns.com/edge/live/861956559001/5962148433001/playlist.m3u8' },
    { cat: 'Entertainment', name: 'BFM TV',        logo: '🇫🇷', url: 'https://ncdn-live-bfm.aws-bfMTV4.wizdeo.io/bfmtv_live.m3u8' },
    { cat: 'Entertainment', name: 'Luxe TV',       logo: '💎', url: 'https://stream.luxeat.lu/luxetv/luxetv.m3u8' },
    { cat: 'Entertainment', name: 'Fashion TV',    logo: '👗', url: 'https://fash1043.cloudycdn.services/slive/ftv_paris_hd.m3u8' },
    { cat: 'Movies',  name: 'FilmRise Free Movies', logo: '🎬', url: 'https://d2j6fpvklg2uq.cloudfront.net/v1/master/022788b5d7d2af64fabaa91520c3b29c088e21f8/ls2-ctv-roku/Content/61415d4a8e47e/master.m3u8' },
    { cat: 'Movies',  name: 'MaX Romance',         logo: '💕', url: 'https://d2y7y4m3.stackpathdns.com/edge/live/861956559001/5858034036001/playlist.m3u8' },
    { cat: 'Movies',  name: 'MaX Comedy',          logo: '😂', url: 'https://d2y7y4m3.stackpathdns.com/edge/live/861956559001/5858035803001/playlist.m3u8' },
    { cat: 'Movies',  name: 'MaX Thriller',        logo: '🔪', url: 'https://d2y7y4m3.stackpathdns.com/edge/live/861956559001/5858034427001/playlist.m3u8' },
    { cat: 'Sports',  name: 'Red Bull TV Sports',  logo: '🏎️', url: 'https://rbmn-live.akamaized.net/hls/live/590964/BoRB-AT/master.m3u8' },
    { cat: 'Sports',  name: 'T Sports HD',         logo: '🇧🇩', url: 'http://103.225.189.136:9999/live/tsports.m3u8' },
    { cat: 'Sports',  name: 'Sports Central',      logo: '⚽', url: 'https://d2y7y4m3.stackpathdns.com/edge/live/861956559001/5858040222001/playlist.m3u8' },
    { cat: 'Kids',    name: 'Animax',              logo: '🦸', url: 'https://d2y7y4m3.stackpathdns.com/edge/live/861956559001/5908828240001/playlist.m3u8' },
    { cat: 'Kids',    name: 'Kids TV Flix',        logo: '🧸', url: 'https://d2y7y4m3.stackpathdns.com/edge/live/861956559001/5858035623001/playlist.m3u8' },
    { cat: 'Music',   name: 'Clubbing TV',         logo: '🎧', url: 'https://hls021919655169.cdn01.cds1.skycdp.com/usp/auth/content_1080p25/master.m3u8' },
    { cat: 'Music',   name: 'Hot Gold',            logo: '🎤', url: 'https://d2y7y4m3.stackpathdns.com/edge/live/861956559001/5858036024001/playlist.m3u8' },
    { cat: 'Music',   name: 'Bigo Live Music',     logo: '🎶', url: 'https://d2y7y4m3.stackpathdns.com/edge/live/861956559001/5908827831001/playlist.m3u8' },
    { cat: 'Education', name: 'NASA TV',           logo: '🚀', url: 'https://ntv1.akamaized.net/hls/live/2014075/NASA-NTV1-HLS/master.m3u8' },
    { cat: 'Education', name: 'NASA TV Media',     logo: '🛰️', url: 'https://ntv2.akamaized.net/hls/live/2014076/NASA-NTV2-HLS/master.m3u8' },
    { cat: 'Education', name: 'UN Web TV',         logo: '🌐', url: 'https://dco4c1fdygi3w.cloudfront.net/v1/master/48280d4c7f548f30266d258f864602b5054c87c5/ls2-ctv-roku/Content/44411/master.m3u8' },
  ];

  /* ========= STATE ========= */
  const state = {
    heroItems: [], heroIndex: 0, heroTimer: null, heroPaused: false,
    detail: null,
    lang: localStorage.getItem('sv-lang') || 'en-US',
    region: localStorage.getItem('sv-region') || '',
    country: localStorage.getItem('sv-country') || '',
    countries: [],
    watchlist: JSON.parse(localStorage.getItem('sv-watchlist') || '[]'),
    continue:  JSON.parse(localStorage.getItem('sv-continue')  || '[]'),
    playlists: JSON.parse(localStorage.getItem('sv-playlists') || '[]'),
    browse: { page: 1, totalPages: 1, kind: 'movie', genre: 0, loading: false, apiPath: '' },
    player: (() => {
      const saved = localStorage.getItem('sv-source');
      const validIds = new Set([AUTO_ID, ...STREAM_SOURCES.map(s=>s.id)]);
      return {
        active: false, title: '', media: 'movie', tmdbId: null, malId: null, backdrop: '',
        season: 1, episode: 1, seasons: [], episodes: [],
        source: (saved && validIds.has(saved)) ? saved : AUTO_ID,
        autoIdx: 0, autoTimer: null, _lastSrcAt: 0,
        audioLang: localStorage.getItem('sv-audio-lang') || '',
        animeVideo: null,
      };
    })(),
    sandbox: localStorage.getItem('sv-sandbox') === '1',
    useServer: location.protocol.startsWith('http') && !location.protocol.startsWith('file'),
    live: { hls: null, currentChannel: null },
  };

  let usage = JSON.parse(localStorage.getItem('sv-usage') || 'null') || { bytes: 0, reqs: 0, since: Date.now() };
  const saveUsage = () => localStorage.setItem('sv-usage', JSON.stringify(usage));
  const fmtMB = (b) => (b / 1048576).toFixed(2) + ' MB';

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const STAR = `<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" style="display:inline-block;vertical-align:-1px"><path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/></svg>`;
  const CHECK = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`;
  const PLUS  = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>`;
  const PLAY_SM = `<svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;

  const isTouch = window.matchMedia('(hover: none)').matches || 'ontouchstart' in window;
  if (isTouch) document.body.classList.add('touch');

  const apiCache = new Map();
  let networkBanner = false;

  /* ================= API LAYER (with direct fallback) ================= */
  async function rawFetch(url, opts = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeout || 12000);
    try {
      const r = await fetch(url, { signal: ctrl.signal, ...opts });
      clearTimeout(timer);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch (e) {
      clearTimeout(timer);
      throw e;
    }
  }

  async function directTmdb(path, params = {}) {
    // On Render/local Node, the server adds process.env.TMDB_KEY. Do not put
    // the production key in the browser query string.
    if (location.protocol.startsWith('http')) {
      const qp = new URLSearchParams({ p: path, ...params, language: state.lang || 'en-US' }).toString();
      return rawFetch('/api/tmdb?' + qp);
    }
    // File mode is catalogue-only unless a developer deliberately supplies a
    // local key here; the supported deployment path is the Render server.
    if (!TMDB_KEY) throw new Error('Run the Node server to use TMDB');
    const q = new URLSearchParams({ api_key: TMDB_KEY, language: state.lang || 'en-US', ...params }).toString();
    return rawFetch(`${TMDB_BASE}${path}?${q}`);
  }
  async function directJikan(path) {
    return rawFetch('https://api.jikan.moe/v4' + path);
  }

  async function directAnilist(query, variables = {}) {
    const data = await rawFetch(ANILIST_GRAPHQL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    });
    if (data.errors && data.errors.length) throw new Error(data.errors[0].message || 'AniList request failed');
    return data.data;
  }

  function normaliseAnimeVideos(media, malId, fallbackTitle = 'Anime') {
    const title = (media && media.title && (media.title.english || media.title.romaji || media.title.native)) || fallbackTitle;
    const secureUrl = (value) => {
      try { const u = new URL(String(value)); if (u.protocol === 'http:') u.protocol = 'https:'; return /^https?:$/.test(u.protocol) ? u.toString() : ''; }
      catch (e) { return ''; }
    };
    const trailerId = media && media.trailer && String(media.trailer.site || '').toLowerCase() === 'youtube'
      ? media.trailer.id : '';
    const trailer = trailerId ? {
      id: String(trailerId),
      site: 'YouTube',
      thumbnail: media.trailer.thumbnail || `https://i.ytimg.com/vi/${encodeURIComponent(trailerId)}/hqdefault.jpg`,
      url: `https://www.youtube.com/watch?v=${encodeURIComponent(trailerId)}`,
      embed: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(trailerId)}?autoplay=1&rel=0&modestbranding=1&playsinline=1`,
    } : null;
    const episodes = (media && media.streamingEpisodes || []).filter((e) => e && e.url).slice(0, 40).map((e, i) => ({
      id: `${malId}-${i + 1}`, title: e.title || `Official episode ${i + 1}`,
      thumbnail: e.thumbnail || '', url: secureUrl(e.url), site: e.site || 'Official',
    }));
    const q = encodeURIComponent(title);
    return {
      ok: Boolean(trailer || episodes.length), source: 'AniList', mal_id: Number(malId), title,
      trailer, episodes,
      official: [
        { name: 'Crunchyroll', url: `https://www.crunchyroll.com/search?q=${q}` },
        { name: 'Netflix', url: `https://www.netflix.com/search?q=${q}` },
        { name: 'YouTube', url: `https://www.youtube.com/results?search_query=${q}+official+trailer` },
        ...(media && media.siteUrl ? [{ name: 'AniList', url: media.siteUrl }] : []),
      ],
    };
  }

  async function directAnimeVideos(malId, fallbackTitle) {
    const data = await directAnilist(ANILIST_VIDEO_QUERY, { idMal: Number(malId) });
    if (!data || !data.Media) throw new Error('Anime not found');
    return normaliseAnimeVideos(data.Media, malId, fallbackTitle);
  }

  async function api(p, { noCache = false } = {}) {
    const sep = p.includes('?') ? '&' : '?';
    const url = p + (state.lang ? `${sep}lang=${encodeURIComponent(state.lang)}` : '');
    if (!noCache) {
      const hit = apiCache.get(url);
      if (hit && Date.now() - hit.t < 4 * 60 * 1000) return hit.v;
    }
    const tryServer = async () => {
      const r = await fetch('/api' + url);
      if (!r.ok) {
        let msg = 'HTTP ' + r.status;
        try { const j = await r.json(); if (j && j.error) msg = j.error; } catch (e) {}
        throw new Error(msg);
      }
      return r.json();
    };
    const tryDirect = async () => {
      // Map server routes → direct API calls (works in file:// preview too)
      const u = new URL('http://x' + p);
      const qp = u.searchParams;
      const get = (k) => qp.get(k);
      const after = (pfx) => p.startsWith(pfx) ? p.slice(pfx.length).split('?')[0] : null;

      if (p.startsWith('/trending')) return directTmdb('/trending/all/week');
      if (p.startsWith('/movie/popular')) return directTmdb('/movie/popular');
      if (p.startsWith('/movie/top_rated')) return directTmdb('/movie/top_rated');
      if (p.startsWith('/movie/upcoming')) return directTmdb('/movie/upcoming');
      if (p.startsWith('/movie/now_playing')) return directTmdb('/movie/now_playing');
      if (p.startsWith('/tv/popular')) return directTmdb('/tv/popular');
      if (p.startsWith('/tv/top_rated')) return directTmdb('/tv/top_rated');
      if (p.startsWith('/search')) return directTmdb('/search/multi', { query: get('q'), include_adult: 'false', page: get('page') || '1' });
      if (p.startsWith('/details')) {
        const media = get('media'), id = get('id');
        return directTmdb(`/${media}/${id}`, { append_to_response: 'credits,similar,recommendations,content_ratings,release_dates,translations' });
      }
      if (p.startsWith('/tv/season')) return directTmdb(`/tv/${get('id')}/season/${get('s') || '1'}`);
      if (p.startsWith('/recommendations')) {
        const media = get('media'), id = get('id');
        const responses = await Promise.allSettled([
          directTmdb(`/${media}/${id}/recommendations`, { page: '1' }),
          directTmdb(`/${media}/${id}/similar`, { page: '1' }),
        ]);
        const results = responses.flatMap((r) => r.status === 'fulfilled' ? (r.value.results || []) : [])
          .filter((v, i, arr) => v && arr.findIndex((x) => x.id === v.id) === i).slice(0, 24);
        return { results };
      }
      if (p.startsWith('/watch')) return directTmdb(`/${get('media')}/${get('id')}/watch/providers`, { watch_region: get('region') || 'IN' });
      if (p.startsWith('/genres')) return directTmdb(`/genre/${get('media') === 'tv' ? 'tv' : 'movie'}/list`);
      if (p.startsWith('/movie/genre')) return directTmdb('/discover/movie', { with_genres: get('g'), sort_by: get('sort') || 'popularity.desc', 'vote_count.gte': '50', page: get('page') || '1' });
      if (p.startsWith('/tv/genre')) return directTmdb('/discover/tv', { with_genres: get('g'), sort_by: get('sort') || 'popularity.desc', 'vote_count.gte': '50', page: get('page') || '1' });
      if (p.startsWith('/drama/popular')) {
        // Korean / Asian dramas — discover with origin country KR + with_original_language
        return directTmdb('/discover/tv', { with_original_language: get('lang') || 'ko', sort_by: 'popularity.desc', page: get('page') || '1', 'vote_count.gte': '10' });
      }
      if (p.startsWith('/drama/trending')) return directTmdb('/trending/tv/week', { with_original_language: 'ko' });
      if (p.startsWith('/anime/genres')) return directJikan('/genres/anime').then((d) => ({ genres: (d.data || []).filter((g) => g.mal_id < 50 || g.mal_id === 62) }));
      if (p.startsWith('/anime/genre')) return directJikan(`/anime?genres=${get('g')}&order_by=members&sort=desc&sfw=true&page=${get('page') || '1'}`);
      if (p.startsWith('/anime/top')) return directJikan('/top/anime?page=' + (get('page') || '1'));
      if (p.startsWith('/anime/topairing')) return directJikan('/top/anime?filter=airing');
      if (p.startsWith('/anime/search')) return directJikan('/anime?q=' + encodeURIComponent(get('q') || '') + '&page=1');
      if (p.startsWith('/anime/details')) return directJikan(`/anime/${get('id')}/full`);
      if (p.startsWith('/anime/videos')) return directAnimeVideos(get('id'), get('title') || 'Anime');
      if (p.startsWith('/anime/tmdb')) {
        // client-side MAL → TMDB mapping
        const j = await directJikan(`/anime/${get('id')}/full`);
        const a = j.data || {};
        const title = a.title_english || a.title || '';
        const yr = a.year ? String(a.year) : (a.aired && a.aired.from ? String(a.aired.from).slice(0,4) : '');
        const r = await directTmdb('/search/tv', { query: title, first_air_date_year: yr, include_adult: 'false' });
        const res = r.results || [];
        let best = res.find((x) => x.name && x.name.toLowerCase() === title.toLowerCase()) || res[0];
        let media = 'tv';
        if (!best) {
          const rm = await directTmdb('/search/movie', { query: title, year: yr, include_adult: 'false' });
          best = (rm.results || [])[0]; media = 'movie';
        }
        if (!best) return { tmdb_id: null, media: 'tv', error: 'no_tmdb_match' };
        return { tmdb_id: best.id, media, title: best.name || best.title };
      }
      if (p.startsWith('/countries')) {
        const list = await directTmdb('/configuration/countries');
        return { countries: (list || []).map((c) => ({ code: c.iso_3166_1, name: c.english_name, native: c.native_name })) };
      }
      if (p.startsWith('/geo')) return { country_code: 'IN', country: 'India', flag: '🇮🇳' };
      if (p.startsWith('/stats')) return { version: '9.3.0-client', uptime_s: 0, api_health: { tmdb: 'ok', jikan: 'ok' }, cache_items: 0, requests: 0, backups_used: {} };
      if (p.startsWith('/cache/clear')) return { ok: true, cleared: 0 };
      if (p.startsWith('/health')) return { ok: true, version: '9.3.0-client' };
      throw new Error('unknown api path: ' + p);
    };

    let data, err;
    // try server first if running on a host
    if (state.useServer) {
      try { data = await tryServer(); }
      catch (e) { err = e; }
    }
    if (!data) {
      try { data = await tryDirect(); }
      catch (e2) {
        if (state.useServer && err) throw err;
        throw e2;
      }
    }
    usage.reqs++;
    try { usage.bytes += JSON.stringify(data).length; } catch (e) {}
    if (usage.reqs % 4 === 0) saveUsage();
    if (!noCache) {
      apiCache.set(url, { t: Date.now(), v: data });
      if (apiCache.size > 80) apiCache.delete(apiCache.keys().next().value);
    }
    return data;
  }

  function showNetworkBanner() {
    if (networkBanner) return; networkBanner = true;
    const b = document.createElement('div');
    b.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:999;max-width:92vw;background:#7c2d12;color:#ffedd5;padding:13px 20px;border-radius:12px;box-shadow:0 20px 50px rgba(0,0,0,.6);font-size:13.5px;text-align:center;line-height:1.5;border:1px solid #c2410c';
    b.textContent = 'Could not connect. Check your internet and try again.';
    document.body.appendChild(b);
    setTimeout(() => { b.remove(); networkBanner = false; }, 9000);
  }
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._t);
    t._t = setTimeout(() => t.classList.remove('show'), 2400);
  }

  const year = (d) => (d ? String(d).split('-')[0] || '—' : '—');
  const runtimeFmt = (m) => {
    if (!m) return '';
    if (typeof m === 'string') return m;
    const h = Math.floor(m/60), min = m%60;
    return h ? `${h}h ${min}m` : `${min}m`;
  };
  const posterUrl = (p) => !p ? placeholderPoster() : (String(p).startsWith('http') ? p : IMG + p);
  const backdropUrl = (p) => !p ? '' : (String(p).startsWith('http') ? p : BACKDROP + p);
  const titleOf = (m) => m.title || m.name || m.title_english || '';
  const mediaOf = (m) => m.media_type === 'tv' || m.first_air_date || m.number_of_seasons ? 'tv' : 'movie';

  function placeholderPoster() {
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="342" height="513"><rect width="100%" height="100%" fill="#15151f"/><text x="50%" y="50%" fill="#3b4259" font-family="Arial" font-size="20" font-weight="800" letter-spacing="2" text-anchor="middle" dominant-baseline="middle">STREAMVERSE</text></svg>');
  }
  const stillPlaceholder = () => 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="135"><rect width="100%" height="100%" fill="#15151f"/></svg>');
  function matchScore(m) { if (!m.vote_average) return null; return Math.min(99, Math.round(m.vote_average * 9.5 + 5)); }
  function certificationOf(d) {
    try {
      if (d.media_type === 'tv' || d.number_of_seasons) {
        const ratings = (d.content_ratings && d.content_ratings.results) || [];
        const us = ratings.find((x) => x.iso_3166_1 === 'US') || ratings[0];
        return us ? us.rating : '';
      }
      const releases = (d.release_dates && d.release_dates.results) || [];
      const us = releases.find((x) => x.iso_3166_1 === 'US') || releases[0];
      if (!us) return '';
      const r = (us.release_dates || []).find((x) => x.certification);
      return r ? r.certification : '';
    } catch (e) { return ''; }
  }

  /* ================= WATCHLIST / CONTINUE / PLAYLISTS ================= */
  function inWatchlist(id, media) { return state.watchlist.some((x) => x.id === id && x.media === media); }
  function toggleWatchlist(item) {
    const id = item.id, media = item.media_type || mediaOf(item);
    const idx = state.watchlist.findIndex((x) => x.id === id && x.media === media);
    if (idx >= 0) { state.watchlist.splice(idx,1); toast('Removed from My List'); }
    else {
      state.watchlist.unshift({ id, media, title: titleOf(item), poster: item.poster_path||'', backdrop: item.backdrop_path||'', vote_average: item.vote_average||0, release_date: item.release_date||item.first_air_date||'', addedAt: Date.now() });
      toast('Added to My List');
    }
    localStorage.setItem('sv-watchlist', JSON.stringify(state.watchlist));
    updateWatchlistButtons(id, media);
    if (!$('#mylistView').classList.contains('hidden')) renderMyList();
    const card = document.querySelector(`.card[data-id="${id}"][data-media="${media}"]`);
    if (card) updateCardVisual(card);
  }
  function updateWatchlistButtons(id, media) {
    $$('.wl-btn').forEach((btn) => {
      if (btn.dataset.id === String(id) && btn.dataset.media === media) {
        const on = inWatchlist(id, media);
        btn.classList.toggle('in-list', on);
        btn.innerHTML = on ? CHECK : PLUS;
        btn.title = on ? 'In My List' : 'Add to My List';
      }
    });
  }
  function updateCardVisual(card) {
    const btn = card.querySelector('.wl-btn'); if (!btn) return;
    const on = inWatchlist(card.dataset.id, card.dataset.media);
    btn.classList.toggle('in-list', on);
    btn.innerHTML = on ? CHECK : PLUS;
  }
  function recordContinue(item, opts = {}) {
    const id = item.id, media = item.media_type || mediaOf(item);
    const isTv = media === 'tv' || opts.season != null;
    const entry = {
      id, media, title: titleOf(item), poster: item.poster_path||'', backdrop: item.backdrop_path||'',
      vote_average: item.vote_average||0, release_date: item.release_date||item.first_air_date||'',
      season: isTv ? (opts.season || state.player.season || 1) : null,
      episode: isTv ? (opts.episode || state.player.episode || 1) : null,
      progress: Math.round(20 + Math.random()*70), at: Date.now(),
    };
    const idx = state.continue.findIndex((x) => x.id === id && x.media === media);
    if (idx >= 0) state.continue.splice(idx,1);
    state.continue.unshift(entry);
    state.continue = state.continue.slice(0,12);
    localStorage.setItem('sv-continue', JSON.stringify(state.continue));
    renderContinueRow();
  }

  function loadPlaylists() { try { state.playlists = JSON.parse(localStorage.getItem('sv-playlists')||'[]'); } catch(e) { state.playlists=[]; } }
  function savePlaylists() { localStorage.setItem('sv-playlists', JSON.stringify(state.playlists)); }
  function createPlaylist(name) {
    const pl = { id: 'pl_' + Date.now() + '_' + Math.random().toString(36).slice(2,7), name: name || 'New Playlist', items: [], createdAt: Date.now() };
    state.playlists.unshift(pl); savePlaylists(); return pl;
  }
  function addToPlaylist(plId, item) {
    const pl = state.playlists.find((p) => p.id === plId); if (!pl) return;
    if (pl.items.some((x) => x.id === item.id && x.media === item.media)) { toast('Already in playlist'); return; }
    pl.items.unshift({ ...item, addedAt: Date.now() });
    savePlaylists();
    toast(`Added to "${pl.name}"`);
  }
  function removeFromPlaylist(plId, id, media) {
    const pl = state.playlists.find((p) => p.id === plId); if (!pl) return;
    pl.items = pl.items.filter((x) => !(x.id === id && x.media === media));
    savePlaylists();
  }

  /* ================= CARDS ================= */
  function tmdbCard(m) {
    const el = document.createElement('div');
    el.className = 'card'; el.tabIndex = 0; el.setAttribute('role','button');
    const media = mediaOf(m);
    el.dataset.id = m.id; el.dataset.media = media;
    const t = esc(titleOf(m));
    const badge = media === 'tv' ? '<span class="card-badge tv">TV</span>' : '<span class="card-badge">MOVIE</span>';
    const rating = m.vote_average ? `<span class="card-rating">${STAR} ${m.vote_average.toFixed(1)}</span>` : '';
    const onList = inWatchlist(m.id, media);
    const upcoming = !isReleased(m);
    el.innerHTML = `
      <img class="card-poster" loading="lazy" src="${esc(posterUrl(m.poster_path))}" alt="${t}" onerror="this.onerror=null;this.src='${placeholderPoster()}'">
      ${badge}
      ${upcoming?'<span class="card-badge upcoming">SOON</span>':''}
      ${rating}
      <div class="card-actions">
        <button class="card-action wl-btn ${onList?'in-list':''}" data-id="${m.id}" data-media="${media}" title="${onList?'In My List':'Add to My List'}" aria-label="Toggle list">${onList?CHECK:PLUS}</button>
      </div>
      <div class="card-info">
        <div class="card-title">${t}</div>
        <div class="card-sub"><span class="yr">${year(m.release_date||m.first_air_date||'')}</span><span class="dot"></span><span>${upcoming?'Coming soon':(media==='tv'?'Series':'Film')}</span></div>
      </div>
      <div class="card-hover-bar">
        ${upcoming
          ? `<button class="mini-btn disabled" disabled title="Not released yet">${PLAY_SM} Soon</button><button class="mini-btn" data-action="info">Details</button>`
          : `<button class="mini-btn play" data-action="play">${PLAY_SM} Watch</button><button class="mini-btn" data-action="info">Details</button>`}
      </div>`;
    el.onclick = (e) => {
      if (e.target.closest('.wl-btn')) { toggleWatchlist(m); return; }
      if (upcoming) { openDetail(media, m.id, titleOf(m)); return; }
      if (e.target.closest('[data-action="play"]')) {
        recordContinue(m);
        openPlayer({ title: titleOf(m), media, tmdbId: m.id, backdrop: backdropUrl(m.backdrop_path||m.poster_path) });
        return;
      }
      openDetail(media, m.id, titleOf(m));
    };
    el.onkeydown = (e) => { if (e.key==='Enter'||e.key===' ') { e.preventDefault(); openDetail(media, m.id, titleOf(m)); } };
    return el;
  }
  function animeCard(a) {
    const el = document.createElement('div');
    el.className = 'card'; el.tabIndex = 0; el.setAttribute('role','button');
    const img = (a.images && a.images.jpg && (a.images.jpg.large_image_url || a.images.jpg.image_url)) || '';
    const t = esc(titleOf(a));
    const yr = a.year ? String(a.year) : (a.aired && a.aired.from ? year(a.aired.from) : '');
    const score = a.score || a.rating || 0;
    const onList = inWatchlist(a.mal_id, 'anime');
    const upcoming = a.status && /not yet aired|upcoming/i.test(a.status);
    el.dataset.id = a.mal_id; el.dataset.media = 'anime';
    el.innerHTML = `
      <img class="card-poster" loading="lazy" src="${esc(img||placeholderPoster())}" alt="${t}" onerror="this.onerror=null;this.src='${placeholderPoster()}'">
      <span class="card-badge anime">ANIME</span>
      ${upcoming?`<span class="card-badge upcoming">UPCOMING</span>`:''}
      ${score?`<span class="card-rating">${STAR} ${Number(score).toFixed(1)}</span>`:''}
      <div class="card-actions"><button class="card-action wl-btn ${onList?'in-list':''}" data-id="${a.mal_id}" data-media="anime">${onList?CHECK:PLUS}</button></div>
      <div class="card-info"><div class="card-title">${t}</div><div class="card-sub"><span class="yr">${yr||'—'}</span><span class="dot"></span><span>${upcoming?'Soon':'Anime'}</span></div></div>
      <div class="card-hover-bar">
        ${upcoming
          ? `<button class="mini-btn disabled" disabled title="Not yet released">Coming soon</button><button class="mini-btn" data-action="info">Details</button>`
          : `<button class="mini-btn play" data-action="play">${PLAY_SM} Watch</button><button class="mini-btn" data-action="info">Details</button>`}
      </div>`;
    if (upcoming) {
      el.onclick = (e) => {
        if (e.target.closest('.wl-btn')) { toggleWatchlist({ id: a.mal_id, media_type:'anime', title: titleOf(a), poster_path: img?img.replace(/^https?:\/\//,''):'' }); return; }
        openAnimeDetail(a.mal_id, img, titleOf(a));
      };
    } else {
      el.onclick = (e) => {
        if (e.target.closest('.wl-btn')) { toggleWatchlist({ id: a.mal_id, media_type:'anime', title: titleOf(a), poster_path: img?img.replace(/^https?:\/\//,''):'' }); return; }
        if (e.target.closest('[data-action="play"]')) {
          recordContinue({ id: a.mal_id, media_type:'anime', title: titleOf(a), vote_average: a.score, release_date: String(a.year||'') });
          openPlayer({ title: titleOf(a), media: 'anime', malId: a.mal_id, backdrop: img||'' });
          return;
        }
        openAnimeDetail(a.mal_id, img, titleOf(a));
      };
    }
    el.onkeydown = (e) => { if (e.key==='Enter'||e.key===' ') { e.preventDefault(); openAnimeDetail(a.mal_id, img, titleOf(a)); } };
    return el;
  }
  function continueCard(c) {
    const el = document.createElement('div');
    el.className = 'card'; el.tabIndex = 0; el.setAttribute('role','button');
    el.dataset.id = c.id; el.dataset.media = c.media;
    const t = esc(c.title), onList = inWatchlist(c.id, c.media);
    const sub = c.season ? `S${c.season} · E${c.episode}` : `${Math.round(c.progress)}% watched`;
    el.innerHTML = `
      <img class="card-poster" loading="lazy" src="${esc(posterUrl(c.poster))}" alt="${t}" onerror="this.onerror=null;this.src='${placeholderPoster()}'">
      ${c.media==='anime'?'<span class="card-badge anime">ANIME</span>':c.media==='tv'?'<span class="card-badge tv">TV</span>':'<span class="card-badge">MOVIE</span>'}
      ${c.vote_average?`<span class="card-rating">${STAR} ${Number(c.vote_average).toFixed(1)}</span>`:''}
      <div class="card-actions"><button class="card-action wl-btn ${onList?'in-list':''}" data-id="${c.id}" data-media="${c.media}">${onList?CHECK:PLUS}</button></div>
      <div class="card-info"><div class="card-title">${t}</div><div class="card-sub"><span>${year(c.release_date)}</span><span class="dot"></span><span>${esc(sub)}</span></div></div>
      <div class="card-hover-bar"><button class="mini-btn play" data-action="play">${PLAY_SM} Resume</button><button class="mini-btn" data-action="info">Details</button></div>`;
    el.onclick = (e) => {
      if (e.target.closest('.wl-btn')) { toggleWatchlist(c); return; }
      const resume = !!e.target.closest('[data-action="play"]');
      if (c.media === 'anime') {
        if (resume) openPlayer({ title: c.title, media:'anime', malId: c.id, backdrop: posterUrl(c.backdrop) });
        else openAnimeDetail(c.id, null, c.title);
      } else {
        if (resume) openPlayer({ title: c.title, media: c.media, tmdbId: c.id, backdrop: posterUrl(c.backdrop), season: c.season||1, episode: c.episode||1 });
        else openDetail(c.media, c.id, c.title);
      }
    };
    return el;
  }

  /* ================= ROWS ================= */
  function fillRow(rowId, items, fn) {
    const row = document.getElementById(rowId); if (!row) return;
    row.innerHTML = '';
    const frag = document.createDocumentFragment();
    items.slice(0,20).forEach((it) => frag.appendChild(fn(it)));
    row.appendChild(frag);
  }
  function skelRow(rowId, n=14) {
    const row = document.getElementById(rowId); if (!row) return;
    row.innerHTML = '';
    for (let i=0;i<n;i++){ const s=document.createElement('div'); s.className='skel-card skel'; row.appendChild(s); }
  }
  function rowError(rowId, retryFn) {
    const row = document.getElementById(rowId); if (!row) return;
    row.innerHTML = '';
    const d = document.createElement('div'); d.className='row-error';
    d.innerHTML = '<span>Could not load right now.</span>';
    const b = document.createElement('button'); b.textContent = 'Retry'; b.onclick = retryFn;
    d.appendChild(b); row.appendChild(d);
  }
  function loadRow(apiPath, rowId, cardFn) {
    const tryLoad = () => {
      skelRow(rowId);
      api(apiPath).then((data) => {
        let items = data.items || data.data || data.results || [];
        // filter out unreleased / future titles so user never sees a "not found"
        items = items.filter(isReleased);
        if (items.length) fillRow(rowId, items.slice(0,20), cardFn);
        else rowError(rowId, tryLoad);
      }).catch((e) => { console.warn(e); rowError(rowId, tryLoad); });
    };
    tryLoad();
  }

  const homeRowObservers = [];
  function clearHomeRowObservers() {
    while (homeRowObservers.length) {
      try { homeRowObservers.pop().disconnect(); } catch (e) {}
    }
  }

  // Load only the rows near the viewport. This keeps the first paint fast and
  // avoids firing eleven upstream API requests at the same time on mobile.
  function loadRowWhenVisible(apiPath, rowId, cardFn, delay = 0) {
    const section = document.getElementById(rowId)?.closest('.row-section');
    let started = false;
    const run = () => {
      if (started) return;
      started = true;
      window.setTimeout(() => loadRow(apiPath, rowId, cardFn), delay);
    };
    if (!section || !('IntersectionObserver' in window)) { run(); return; }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect(); run();
      }
    }, { rootMargin: '260px 0px' });
    observer.observe(section);
    homeRowObservers.push(observer);
  }

  // Returns true for a title that is released (release/air date in the past),
  // OR for items where we can't determine the date (don't over-filter anime etc).
  function isReleased(item) {
    if (!item) return false;
    const now = Date.now();
    const WINDOW = 7 * 24 * 60 * 60 * 1000; // allow 1 week of "new"
    if (item.media_type === 'movie' || item.title) {
      if (item.release_date) {
        const t = Date.parse(item.release_date + 'T00:00:00');
        if (!isNaN(t) && t > now + WINDOW) return false;
      }
      return true;
    }
    if (item.media_type === 'tv' || item.first_air_date) {
      if (item.first_air_date) {
        const t = Date.parse(item.first_air_date + 'T00:00:00');
        if (!isNaN(t) && t > now + WINDOW) return false;
      }
      return true;
    }
    // anime (Jikan): status/year
    if (item.aired && item.aired.from) {
      const t = Date.parse(item.aired.from);
      if (!isNaN(t) && t > now + WINDOW) return false;
    }
    if (item.status && /Not yet aired/i.test(item.status)) return false;
    return true;
  }

  function loadHome() {
    clearHomeRowObservers();
    ['rowTrendingRow','rowPopularRow','rowTopRatedRow','rowTvRow','rowTvTopRow','rowAnimeRow','rowAiringRow','rowUpcomingRow','rowHorrorRow','rowComedyRow','rowActionRow','rowDramaRow'].forEach(skelRow);
    renderContinueRow();

    // The hero + first visible rows are eager; everything else waits until
    // the user gets close to it. API responses are still cached by api().
    api('/trending').then((tr) => {
      const results = (tr.results||[]).filter((x) => x.backdrop_path || x.poster_path);
      state.heroItems = results.slice(0,8);
      fillRow('rowTrendingRow', state.heroItems.length ? state.heroItems : results.slice(0,20), tmdbCard);
      $('#rowTrendingCount').textContent = state.heroItems.length ? `Top ${state.heroItems.length} picks` : '';
      if (state.heroItems.length) initHero();
    }).catch((e) => { console.warn(e); rowError('rowTrendingRow', loadHome); });

    loadRow('/movie/popular', 'rowPopularRow', tmdbCard);
    loadRow('/tv/popular', 'rowTvRow', tmdbCard);

    const animeFiltered = (rowId, path) => {
      skelRow(rowId);
      api(path).then((d) => {
        const items = (d.data||[]).filter(isReleased);
        if (items.length) fillRow(rowId, items.slice(0,20), animeCard);
        else rowError(rowId, () => animeFiltered(rowId, path));
      }).catch(() => rowError(rowId, () => animeFiltered(rowId, path)));
    };
    animeFiltered('rowAnimeRow', '/anime/top');

    [
      ['/movie/top_rated', 'rowTopRatedRow', tmdbCard],
      ['/tv/top_rated', 'rowTvTopRow', tmdbCard],
      ['/movie/upcoming', 'rowUpcomingRow', tmdbCard],
      ['/movie/genre?g=27', 'rowHorrorRow', tmdbCard],
      ['/movie/genre?g=35', 'rowComedyRow', tmdbCard],
      ['/movie/genre?g=28', 'rowActionRow', tmdbCard],
    ].forEach(([path, rowId, cardFn], i) => loadRowWhenVisible(path, rowId, cardFn, i * 70));

    loadRowWhenVisible('/anime/topairing', 'rowAiringRow', animeCard, 100);

    // Drama is a small promotional row; load it in the background without
    // delaying the first catalogue paint.
    window.setTimeout(() => {
      api('/drama/popular?lang=ko').then((d) => {
        const items = d.results || [];
        if (items.length) { fillRow('rowDramaRow', items.slice(0,16), tmdbCard); $('#dramaPromo').classList.remove('hidden'); }
      }).catch(() => {});
    }, 900);
  }

  function renderContinueRow() {
    const section = document.querySelector('[data-row="continue"]');
    if (!state.continue.length) { section.hidden = true; return; }
    section.hidden = false; fillRow('rowContinueRow', state.continue, continueCard);
  }

  /* ================= HERO ================= */
  function initHero() {
    if (!state.heroItems.length) return;
    renderHero(false);
    clearInterval(state.heroTimer);
    state.heroTimer = setInterval(() => { if (!state.heroPaused) nextHero(); }, 7500);
    $('#heroNext').onclick = () => { nextHero(); resetTimer(); };
    $('#heroPrev').onclick = () => { prevHero(); resetTimer(); };
    $('#hero').onmouseenter = () => { state.heroPaused = true; };
    $('#hero').onmouseleave = () => { state.heroPaused = false; };
    buildHeroDots();
  }
  function buildHeroDots() {
    const wrap = $('#heroDots'); wrap.innerHTML = '';
    state.heroItems.forEach((_, i) => {
      const b = document.createElement('button'); b.setAttribute('aria-label',`Slide ${i+1}`);
      b.onclick = () => { state.heroIndex = i; renderHero(true); resetTimer(); };
      wrap.appendChild(b);
    });
  }
  function resetTimer() { clearInterval(state.heroTimer); state.heroTimer = setInterval(() => { if (!state.heroPaused) nextHero(); }, 7500); }
  function renderHero(animate=true) {
    const it = state.heroItems[state.heroIndex]; if (!it) return;
    const media = mediaOf(it), bg = $('#heroBg'), url = backdropUrl(it.backdrop_path||it.poster_path);
    const apply = () => { bg.style.backgroundImage = `url(${url})`; bg.classList.add('loaded'); setTimeout(() => bg.classList.add('zoom'),80); };
    if (animate) { bg.classList.remove('loaded','zoom'); bg.style.opacity=0; setTimeout(()=>{bg.style.opacity=''; apply();},300); } else apply();
    const tags = $('#heroTags'), match = matchScore(it);
    tags.innerHTML = `<span class="hero-tag">Featured</span><span class="hero-tag gold">${media==='tv'?'Series':'Film'}</span>${match?`<span class="hero-tag">${match}% Match</span>`:''}`;
    $('#heroTitle').textContent = titleOf(it);
    const cert = certificationOf(it);
    $('#heroMeta').innerHTML = `<span class="match">${match?match+'% Match':'New'}</span><span>${year(it.release_date||it.first_air_date)}</span>${cert?`<span class="chip" style="padding:2px 8px">${esc(cert)}</span>`:''}<span>${media==='tv'?'TV Series':'Movie'}</span>${it.vote_average?`<span class="rating">${STAR} ${it.vote_average.toFixed(1)}</span>`:''}`;
    $('#heroDesc').textContent = it.overview || '';
    if (animate) { const hc=$('#heroContent'); hc.classList.remove('hero-anim'); void hc.offsetWidth; hc.classList.add('hero-anim'); }
    $$('#heroDots button').forEach((b,i)=>b.classList.toggle('active', i===state.heroIndex));
    const onList = inWatchlist(it.id, media), listBtn = $('#heroList');
    listBtn.classList.toggle('active', onList); listBtn.innerHTML = onList?CHECK:PLUS;
    listBtn.title = onList?'In My List':'Add to My List';
    listBtn.onclick = () => toggleWatchlist(it);
    $('#heroPlay').onclick = () => { recordContinue(it); openPlayer({ title: titleOf(it), media, tmdbId: it.id, backdrop: backdropUrl(it.backdrop_path||it.poster_path) }); };
    $('#heroInfo').onclick = () => openDetail(media, it.id, titleOf(it));
  }
  function nextHero() { if(!state.heroItems.length)return; state.heroIndex=(state.heroIndex+1)%state.heroItems.length; renderHero(true); }
  function prevHero() { if(!state.heroItems.length)return; state.heroIndex=(state.heroIndex-1+state.heroItems.length)%state.heroItems.length; renderHero(true); }

  /* ================= NAV ================= */
  function setNav(nav) {
    const hash = (nav||location.hash.replace('#','')||'home').toLowerCase();
    $$('#navLinks a, #mobileMenu a').forEach((a)=>a.classList.toggle('active', a.dataset.nav===hash));
  }
  function hideAllViews() {
    ['#content','#resultsView','#mylistView','#playlistsView','#playlistDetailView','#liveView'].forEach((s)=>$(s).classList.add('hidden'));
  }
  function showHome() { hideAllViews(); $('#content').classList.remove('hidden'); window.scrollTo({top:0,behavior:'smooth'}); closeMobileMenu(); }
  function closeMobileMenu() {
    $('#hamburger').classList.remove('open'); $('#mobileMenu').classList.remove('open');
    $('#navbar').classList.remove('menu-open'); $('#hamburger').setAttribute('aria-expanded','false');
  }
  $$('#navLinks a').forEach((a)=>{ a.onclick = (e)=>{ e.preventDefault(); navigate(a.dataset.nav); }; });
  const mm = $('#mobileMenu');
  $$('#navLinks a').forEach((a)=>{
    const b = document.createElement('a'); b.href='#'+a.dataset.nav; b.dataset.nav=a.dataset.nav; b.innerHTML = a.innerHTML;
    b.onclick=(e)=>{e.preventDefault(); navigate(a.dataset.nav);}; mm.appendChild(b);
  });
  $$('.footer-links a').forEach((a)=>{ a.onclick=(e)=>{e.preventDefault(); navigate(a.dataset.nav);}; });
  $('#hamburger').onclick = () => {
    const open = $('#hamburger').classList.toggle('open');
    $('#mobileMenu').classList.toggle('open', open); $('#navbar').classList.toggle('menu-open', open);
    $('#hamburger').setAttribute('aria-expanded', open?'true':'false');
  };

  function navigate(nav) {
    location.hash = nav; setNav(nav); closeMobileMenu();
    if (nav==='home') showHome();
    else if (nav==='mylist') showMyList();
    else if (nav==='playlists') showPlaylists();
    else if (nav==='live') showLiveTV();
    else if (nav==='drama') showDrama();
    else showResultsForNav(nav);
  }

  function showResultsForNav(nav) {
    hideAllViews(); $('#resultsView').classList.remove('hidden');
    window.scrollTo({top:0});
    const titles = { movies:'Movies', tv:'TV Shows', anime:'Anime' };
    $('#resultsTitle').textContent = titles[nav] || 'Browse';
    $('#resultsEmpty').classList.add('hidden'); $('#resultsMore').classList.add('hidden');
    const grid = $('#resultsGrid'); grid.innerHTML = '';
    for (let i=0;i<18;i++){ const s=document.createElement('div'); s.className='skel-card skel'; grid.appendChild(s); }
    state.browse.kind = nav==='anime'?'anime':(nav==='tv'?'tv':'movie'); state.browse.genre = 0; state.browse.page = 1;
    renderGenreChips(nav);
    if (nav==='movies') loadBrowsePage('/movie/popular');
    else if (nav==='tv') loadBrowsePage('/tv/popular');
    else if (nav==='anime') loadBrowsePage('/anime/top', true);
  }

  function showDrama() {
    hideAllViews(); $('#resultsView').classList.remove('hidden');
    window.scrollTo({top:0});
    $('#resultsTitle').textContent = 'K-Drama & Asian Dramas';
    $('#genreChips').classList.remove('hidden');
    const wrap = $('#genreChips'); wrap.innerHTML = '';
    const langs = [
      ['ko','Korean'],['ja','Japanese'],['zh','Chinese'],['hi','Indian'],['tr','Turkish'],['th','Thai'],['all','All Dramas']
    ];
    let cur = 'ko';
    const mkChip = (code, label, active=false) => {
      const b = document.createElement('button'); b.className='cat-chip'+(active?' active':''); b.textContent=label;
      b.onclick=()=>{ $$('#genreChips .cat-chip').forEach(x=>x.classList.remove('active')); b.classList.add('active'); cur=code; state.browse.page=1; loadDramas(code); };
      wrap.appendChild(b);
    };
    langs.forEach(([c,l],i)=>mkChip(c,l,i===0));
    const grid = $('#resultsGrid'); grid.innerHTML='';
    for (let i=0;i<18;i++){ const s=document.createElement('div'); s.className='skel-card skel'; grid.appendChild(s); }
    loadDramas('ko');
    $('#resultsMore').classList.add('hidden');
  }
  function loadDramas(lang) {
    const grid = $('#resultsGrid');
    grid.innerHTML='';
    for (let i=0;i<18;i++){ const s=document.createElement('div'); s.className='skel-card skel'; grid.appendChild(s); }
    const path = lang==='all' ? '/drama/popular' : `/drama/popular?lang=${lang}`;
    api(path).then((d)=>{
      grid.innerHTML='';
      const items = d.results||[];
      if (!items.length) { $('#resultsEmpty').classList.remove('hidden'); return; }
      $('#resultsEmpty').classList.add('hidden');
      items.forEach((it)=>grid.appendChild(tmdbCard(it)));
    }).catch(()=>{ grid.innerHTML='<div class="results-empty">Could not load dramas.</div>'; });
  }

  function loadBrowsePage(apiPath, isAnime=false, append=false) {
    state.browse.loading=true; state.browse.apiPath=apiPath;
    const grid=$('#resultsGrid');
    if (!append) { grid.innerHTML=''; for (let i=0;i<18;i++){ const s=document.createElement('div'); s.className='skel-card skel'; grid.appendChild(s); } }
    $('#resultsMore').classList.add('hidden');
    api(apiPath + (apiPath.includes('?')?'&':'?') + 'page=' + state.browse.page).then((d)=>{
      if (!append) grid.innerHTML='';
      let items = isAnime ? (d.data||[]) : (d.results||[]);
      items = items.filter(isReleased);
      if (!items.length && !append) { $('#resultsEmpty').classList.remove('hidden'); return; }
      $('#resultsEmpty').classList.add('hidden');
      items.forEach((it)=>grid.appendChild(isAnime?animeCard(it):tmdbCard(it)));
      state.browse.totalPages = Math.min(isAnime ? ((d.pagination&&d.pagination.last_visible_page)||1) : (d.total_pages||1), 20);
      if (state.browse.page < state.browse.totalPages) $('#resultsMore').classList.remove('hidden');
    }).catch(()=>{ if(!append) grid.innerHTML='<div class="results-empty">Could not load. Try again.</div>'; })
     .finally(()=>{ state.browse.loading=false; });
  }
  $('#resultsMore').onclick = () => {
    if (state.browse.loading) return;
    state.browse.page++;
    const isAnime = state.browse.kind==='anime';
    let path = state.browse.apiPath.split('?')[0];
    if (state.browse.genre) path += isAnime ? `/anime/genre?g=${state.browse.genre.mal_id}&name=${encodeURIComponent(state.browse.genre.name)}` : `/${state.browse.kind}/genre?g=${state.browse.genre}`;
    loadBrowsePage(path, isAnime, true);
  };
  $('#resultsBack').onclick = () => navigate('home');

  async function renderGenreChips(nav) {
    const wrap = $('#genreChips'); wrap.innerHTML=''; wrap.classList.remove('hidden');
    const mk = (label, fn, active=false) => {
      const b=document.createElement('button'); b.className='cat-chip'+(active?' active':''); b.textContent=label;
      b.onclick=()=>{ $$('#genreChips .cat-chip').forEach(x=>x.classList.remove('active')); b.classList.add('active'); state.browse.page=1; fn(); };
      wrap.appendChild(b);
    };
    if (nav==='movies'||nav==='tv') {
      const media = nav==='tv'?'tv':'movie'; state.browse.kind=media;
      mk('All', ()=>loadBrowsePage(`/${media}/popular`), true);
      try { const g = await api('/genres?media='+media); (g.genres||[]).forEach((x)=>mk(x.name, ()=>{ state.browse.genre=x.id; loadBrowsePage(`/${media}/genre?g=${x.id}`); })); } catch(e){}
    } else if (nav==='anime') {
      state.browse.kind='anime';
      mk('Top All', ()=>loadBrowsePage('/anime/top', true), true);
      try { const g = await api('/anime/genres'); (g.genres||[]).slice(0,18).forEach((x)=>mk(x.name, ()=>{ state.browse.genre=x; loadBrowsePage(`/anime/genre?g=${x.mal_id}&name=${encodeURIComponent(x.name)}`, true); })); } catch(e){}
    } else wrap.classList.add('hidden');
  }

  /* ================= SEARCH ================= */
  const searchWrap=$('#searchWrap'), searchInput=$('#searchInput');
  $('#searchToggle').onclick=()=>{ searchWrap.classList.toggle('open'); if(searchWrap.classList.contains('open')) setTimeout(()=>searchInput.focus(),200); else searchInput.value=''; };
  document.addEventListener('click',(e)=>{
    if(!searchWrap.classList.contains('open')) return;
    if(e.target.closest('.search-wrap')||e.target.closest('.search-toggle')) return;
    if(!searchInput.value) searchWrap.classList.remove('open');
  });
  let searchAbort;
  let searchRequestId = 0;
  searchInput.addEventListener('input',(e)=>{
    const q=e.target.value.trim(); searchWrap.classList.toggle('has-value',!!q);
    clearTimeout(searchAbort); if(!q) return;
    searchAbort=setTimeout(()=>doSearch(q),350);
  });
  searchInput.addEventListener('keydown',(e)=>{ if(e.key==='Enter') doSearch(searchInput.value.trim()); if(e.key==='Escape'){ searchInput.value=''; searchInput.blur(); } });
  $('#searchClear').onclick=()=>{ searchInput.value=''; searchWrap.classList.remove('has-value'); searchInput.focus(); };

  async function doSearch(q) {
    if(!q) return;
    const requestId = ++searchRequestId;
    hideAllViews(); $('#resultsView').classList.remove('hidden');
    $('#genreChips').classList.add('hidden'); $('#resultsMore').classList.add('hidden');
    $('#resultsTitle').textContent = `Results for “${q}”`;
    const grid=$('#resultsGrid'); grid.innerHTML='';
    for (let i=0;i<18;i++){ const s=document.createElement('div'); s.className='skel-card skel'; grid.appendChild(s); }
    window.scrollTo({top:0});
    try {
      const r = await api('/search?q='+encodeURIComponent(q));
      if (requestId !== searchRequestId) return;
      grid.innerHTML='';
      const items = (r.results||[]).filter((x)=>x.media_type==='movie'||x.media_type==='tv'||(!x.media_type&&(x.title||x.name)));
      if (items.length) items.slice(0,30).forEach((it)=>grid.appendChild(tmdbCard(it)));
      api('/anime/search?q='+encodeURIComponent(q)).then((ar)=>{
        if (requestId !== searchRequestId) return;
        (ar.data||[]).slice(0,12).forEach((a)=>grid.appendChild(animeCard(a)));
        if (!grid.children.length) $('#resultsEmpty').classList.remove('hidden'); else $('#resultsEmpty').classList.add('hidden');
      }).catch(()=>{ if(!grid.children.length) $('#resultsEmpty').classList.remove('hidden'); });
      if (!items.length) $('#resultsEmpty').classList.remove('hidden');
    } catch(e) { grid.innerHTML='<div class="results-empty">Search failed: '+esc(e.message)+'</div>'; }
  }

  /* ================= MY LIST ================= */
  function showMyList() { hideAllViews(); $('#mylistView').classList.remove('hidden'); window.scrollTo({top:0}); closeMobileMenu(); renderMyList(); }
  function renderMyList() {
    const grid=$('#mylistGrid'); grid.innerHTML='';
    if (!state.watchlist.length) { $('#mylistEmpty').classList.remove('hidden'); return; }
    $('#mylistEmpty').classList.add('hidden');
    state.watchlist.forEach((it)=>{
      if (it.media==='anime') {
        grid.appendChild(animeCard({ mal_id:it.id, title:it.title, title_english:it.title, images:{jpg:{image_url:posterUrl(it.poster)}}, score:it.vote_average, year:year(it.release_date) }));
      } else {
        grid.appendChild(tmdbCard({ id:it.id, media_type:it.media, title:it.title, name:it.title, poster_path:it.poster, backdrop_path:it.backdrop, vote_average:it.vote_average, release_date:it.release_date, first_air_date:it.release_date }));
      }
    });
  }

  /* ================= PLAYLISTS UI ================= */
  function showPlaylists() {
    hideAllViews(); $('#playlistsView').classList.remove('hidden'); window.scrollTo({top:0}); closeMobileMenu(); renderPlaylists();
  }
  function renderPlaylists() {
    loadPlaylists();
    const wrap = $('#playlistsList'); wrap.innerHTML='';
    if (!state.playlists.length) {
      wrap.innerHTML = `<div class="results-empty" style="padding:60px 20px">
        <div style="font-size:40px;margin-bottom:10px">🎬</div>
        <p style="font-size:15px;color:var(--muted)">You haven't created any playlists yet.</p>
        <p style="font-size:13px;color:var(--muted-2);margin-top:6px">Make a "Weekend Watch", "Date Night", or "Anime Marathon" list.</p>
      </div>`;
      return;
    }
    const grid = document.createElement('div'); grid.className='playlists-grid';
    state.playlists.forEach((pl) => {
      const posters = pl.items.slice(0,4).map((it) => posterUrl(it.poster));
      while (posters.length < 4) posters.push(placeholderPoster());
      const card = document.createElement('div'); card.className='playlist-card';
      card.tabIndex=0; card.setAttribute('role','button');
      card.innerHTML = `
        <div class="pl-posters">
          ${posters.map((p,i)=>`<img src="${esc(p)}" alt="" onerror="this.onerror=null;this.src='${placeholderPoster()}'"><span class="pl-grad"></span>`).join('')}
        </div>
        <div class="pl-meta">
          <div class="pl-name">${esc(pl.name)}</div>
          <div class="pl-info">${pl.items.length} title${pl.items.length===1?'':'s'}</div>
        </div>
        <button class="pl-del" title="Delete playlist" aria-label="Delete">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
        </button>`;
      card.onclick = (e) => {
        if (e.target.closest('.pl-del')) {
          if (confirm(`Delete playlist "${pl.name}"?`)) { state.playlists = state.playlists.filter(x=>x.id!==pl.id); savePlaylists(); renderPlaylists(); }
          return;
        }
        openPlaylist(pl.id);
      };
      card.onkeydown = (e) => { if(e.key==='Enter'||e.key===' '){e.preventDefault(); openPlaylist(pl.id);} };
      grid.appendChild(card);
    });
    wrap.appendChild(grid);
  }
  function openPlaylist(plId) {
    loadPlaylists();
    const pl = state.playlists.find((p)=>p.id===plId); if (!pl) return;
    hideAllViews(); $('#playlistDetailView').classList.remove('hidden');
    window.scrollTo({top:0});
    $('#plTitle').textContent = pl.name;
    $('#plCount').textContent = `${pl.items.length} title${pl.items.length===1?'':'s'}`;
    const grid = $('#plGrid'); grid.innerHTML='';
    if (!pl.items.length) { $('#plEmpty').classList.remove('hidden'); }
    else {
      $('#plEmpty').classList.add('hidden');
      pl.items.forEach((it)=>{
        if (it.media==='anime') grid.appendChild(animeCard({ mal_id:it.id, title:it.title, title_english:it.title, images:{jpg:{image_url:posterUrl(it.poster)}}, score:it.vote_average, year:year(it.release_date) }));
        else grid.appendChild(tmdbCard({ id:it.id, media_type:it.media, title:it.title, name:it.title, poster_path:it.poster, backdrop_path:it.backdrop, vote_average:it.vote_average, release_date:it.release_date, first_air_date:it.release_date }));
      });
    }
    $('#plRename').onclick = () => {
      const n = prompt('Rename playlist:', pl.name);
      if (n && n.trim()) { pl.name = n.trim(); savePlaylists(); openPlaylist(plId); }
    };
    $('#plBack').onclick = () => showPlaylists();
  }
  $('#createPlaylistBtn').onclick = () => {
    const name = prompt('Playlist name:', 'My Playlist');
    if (name && name.trim()) { const pl = createPlaylist(name.trim()); openPlaylist(pl.id); }
  };

  /* Add-to-playlist modal from player */
  let pendingPlaylistItem = null;
  function openPlaylistModal(item) {
    pendingPlaylistItem = item;
    loadPlaylists();
    $('#plModalItem').textContent = (item.title||'') + (item.year?` (${item.year})`:'');
    const list = $('#plModalList'); list.innerHTML='';
    if (!state.playlists.length) {
      list.innerHTML = '<div class="tiny-note" style="padding:8px 2px">No playlists yet — create one below.</div>';
    } else {
      state.playlists.forEach((pl) => {
        const has = pl.items.some((x)=>x.id===item.id && x.media===item.media);
        const row = document.createElement('button');
        row.className = 'pl-row' + (has?' in':'');
        row.innerHTML = `<span class="pl-row-name">${esc(pl.name)}</span><span class="pl-row-count">${pl.items.length}</span>${has?'<span class="pl-row-check">✓</span>':''}`;
        row.onclick = () => {
          if (has) { removeFromPlaylist(pl.id, item.id, item.media); }
          else addToPlaylist(pl.id, item);
          openPlaylistModal(item); // refresh
        };
        list.appendChild(row);
      });
    }
    $('#playlistModal').classList.remove('hidden');
    document.body.style.overflow='hidden';
  }
  $('#plModalNew').onclick = () => {
    const name = prompt('New playlist name:', 'My Playlist');
    if (name && name.trim()) {
      const pl = createPlaylist(name.trim());
      if (pendingPlaylistItem) addToPlaylist(pl.id, pendingPlaylistItem);
      openPlaylistModal(pendingPlaylistItem);
    }
  };
  $('#playlistModalClose').onclick = () => { $('#playlistModal').classList.add('hidden'); if ($('#playerModal').classList.contains('hidden')) document.body.style.overflow=''; };
  $('#playlistModal').addEventListener('click', (e) => { if (e.target.id==='playlistModal') $('#playlistModalClose').click(); });

  /* ================= DETAIL MODAL ================= */
  async function openDetail(media, id, fallbackTitle) {
    showModal();
    const body = $('#modalBody');
    body.innerHTML = '<div class="skel" style="height:220px;border-radius:14px;margin-bottom:90px"></div>';
    try {
      const d = await api('/details?media='+media+'&id='+encodeURIComponent(id));
      state.detail = { media, id: d.id||id, title: d.title||d.name||fallbackTitle };
      renderDetail(d);
    } catch(e) { body.innerHTML='<div class="section-label" style="color:#ff8690">Could not load details.</div>'; }
  }
  function renderDetail(d) {
    const body=$('#modalBody'), media=state.detail.media, isTv=media==='tv'||!!d.number_of_seasons;
    const genres=(d.genres||[]).map((g)=>`<span class="chip">${esc(g.name)}</span>`).join('');
    const rating = d.vote_average?Number(d.vote_average).toFixed(1):'—';
    const match=matchScore(d), cert=certificationOf({...d,media_type:media});
    const backdrop=backdropUrl(d.backdrop_path||d.poster_path||'');
    const runtime = d.runtime?`<span>${runtimeFmt(d.runtime)}</span>`:'';
    const seasons = d.number_of_seasons?`<span>${d.number_of_seasons} season${d.number_of_seasons>1?'s':''}</span>`:'';
    $('#modalBackdrop').style.backgroundImage = backdrop?`url(${backdrop})`:'none';
    const onList = inWatchlist(d.id, media);
    body.innerHTML = `
      <h2 class="modal-title" id="modalTitle">${esc(d.title||d.name)}</h2>
      <div class="modal-meta">
        ${match?`<span class="match">${match}% Match</span>`:''}
        <span>${year(d.release_date||d.first_air_date)}</span>
        ${cert?`<span class="chip" style="padding:2px 9px">${esc(cert)}</span>`:''}
        ${runtime}${seasons}
        ${d.status?`<span>${esc(d.status)}</span>`:''}
        <span class="rating" style="color:var(--gold);font-weight:800">${STAR} ${rating}</span>
      </div>
      <div class="modal-genres">${genres}</div>
      <p class="modal-desc">${esc(d.overview||'No synopsis available.')}</p>
      <div class="modal-actions">
        <button class="btn btn-play" id="detailPlay"><svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M8 5v14l11-7z"/></svg> Watch Now</button>
        <button class="btn btn-ghost" id="detailList">${onList?'In My List':'My List'}</button>
        <button class="btn btn-ghost" id="detailPlaylist">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M21 15V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h9"/><path d="M3 10h18M8 18h4M8 14h7M19 16v6M16 19h6"/></svg>
          Playlist
        </button>
      </div>
      <div id="detailExtra"></div>`;
    $('#detailPlay').onclick = () => { recordContinue(d); closeModal(); openPlayer({ title:d.title||d.name, media, tmdbId:d.id, backdrop:backdropUrl(d.backdrop_path||d.poster_path) }); };
    $('#detailList').onclick = () => { toggleWatchlist({...d, id:d.id, media_type:media}); const b=$('#detailList'); setTimeout(()=>{ b.textContent=inWatchlist(d.id,media)?'In My List':'My List'; },0); };
    $('#detailPlaylist').onclick = () => openPlaylistModal({ id:d.id, media, title:d.title||d.name, poster:d.poster_path||'', backdrop:d.backdrop_path||'', vote_average:d.vote_average, release_date:d.release_date||d.first_air_date, year:year(d.release_date||d.first_air_date) });
    renderDetailExtra(d, isTv);
  }
  async function renderDetailExtra(d, isTv) {
    const wrap=$('#detailExtra');
    if (isTv && d.number_of_seasons) {
      const blk = document.createElement('div');
      blk.innerHTML = `<div class="section-label">Seasons &amp; Episodes — tap an episode to watch</div><div class="season-tabs" id="seasonTabs"></div><div class="ep-list" id="epList"></div>`;
      wrap.appendChild(blk);
      const seasonList = (d.seasons||[]).filter(s=>s.season_number>0).sort((a,b)=>a.season_number-b.season_number);
      const tabs=$('#seasonTabs');
      if (!seasonList.length) seasonList.push({season_number:1,name:'Season 1',episode_count:0});
      seasonList.forEach((s)=>{
        const b=document.createElement('button'); b.className='season-tab'+(s.season_number===1?' active':'');
        b.textContent=`Season ${s.season_number}`; b.title=`${s.episode_count||'?'} episodes`;
        b.onclick=()=>{ $$('#seasonTabs .season-tab').forEach(x=>x.classList.remove('active')); b.classList.add('active'); loadEpisodes(d.id, s.season_number); };
        tabs.appendChild(b);
      });
      loadEpisodes(d.id, 1);
    }
    const cast=(d.credits&&d.credits.cast)||[];
    if (cast.length) {
      const c=document.createElement('div');
      c.innerHTML=`<div class="section-label">Top Cast</div><div class="cast-row" id="castRow"></div>`; wrap.appendChild(c);
      cast.slice(0,12).forEach((p)=>{
        const div=document.createElement('div'); div.className='cast-card';
        div.innerHTML=`<img class="cast-avatar" loading="lazy" src="${p.profile_path?CAST_IMG+p.profile_path:placeholderPoster()}" alt="${esc(p.name)}" onerror="this.onerror=null;this.src='${placeholderPoster()}'"><div class="cast-name">${esc(p.name)}</div><div class="cast-role">${esc(p.character||'')}</div>`;
        $('#castRow').appendChild(div);
      });
    }
    const similar=[...((d.recommendations&&d.recommendations.results)||[]).slice(0,8),...((d.similar&&d.similar.results)||[]).slice(0,8)]
      .filter((v,i,arr)=>arr.findIndex(x=>x.id===v.id)===i).slice(0,12);
    if (similar.length) {
      const s=document.createElement('div');
      s.innerHTML=`<div class="section-label">More Like This</div><div class="mini-row" id="similarRow"></div>`; wrap.appendChild(s);
      similar.forEach((it)=>{
        const div=document.createElement('div'); div.className='mini-card'; div.tabIndex=0;
        div.innerHTML=`<img loading="lazy" src="${esc(posterUrl(it.poster_path))}" alt="${esc(titleOf(it))}" onerror="this.onerror=null;this.src='${placeholderPoster()}'"><div class="mc-title">${esc(titleOf(it))}</div>`;
        const m=mediaOf(it);
        div.onclick=()=>openDetail(m, it.id, titleOf(it));
        div.onkeydown=(e)=>{ if(e.key==='Enter'||e.key===' '){e.preventDefault(); openDetail(m,it.id,titleOf(it));} };
        $('#similarRow').appendChild(div);
      });
    }
  }
  async function loadEpisodes(tvId, seasonNum) {
    const list=$('#epList');
    list.innerHTML='<div class="row-error" style="border:none;padding:8px"><span>Loading episodes…</span></div>';
    try {
      const data = await api(`/tv/season?id=${tvId}&s=${seasonNum}`); list.innerHTML='';
      (data.episodes||[]).forEach((ep)=>{
        const el=document.createElement('div'); el.className='ep'; el.tabIndex=0; el.setAttribute('role','button');
        const still=ep.still_path?`https://image.tmdb.org/t/p/w300${ep.still_path}`:stillPlaceholder();
        el.innerHTML=`<img class="ep-still" loading="lazy" src="${still}" alt="" onerror="this.onerror=null;this.src='${stillPlaceholder()}'"><div class="ep-body"><div class="ep-title">${esc(ep.name||'Episode '+ep.episode_number)}</div><div class="ep-meta"><span>E${ep.episode_number}</span>${ep.air_date?`<span>${year(ep.air_date)}</span>`:''}${ep.vote_average?`<span>${STAR} ${ep.vote_average.toFixed(1)}</span>`:''}${ep.runtime?`<span>${ep.runtime}m</span>`:''}</div><div class="ep-over">${esc(ep.overview||'')}</div></div><div class="ep-play" aria-hidden="true">${PLAY_SM}</div>`;
        const play=()=>{ recordContinue({id:tvId,media_type:'tv',title:state.detail.title,vote_average:0,release_date:''},{season:seasonNum,episode:ep.episode_number}); closeModal(); openPlayer({title:state.detail.title,media:'tv',tmdbId:tvId,backdrop:$('#modalBackdrop').style.backgroundImage.slice(5,-2),season:seasonNum,episode:ep.episode_number}); };
        el.onclick=play;
        el.onkeydown=(e)=>{ if(e.key==='Enter'||e.key===' '){e.preventDefault();play();} };
        list.appendChild(el);
      });
      if (!(data.episodes||[]).length) list.innerHTML='<div class="row-error" style="border:none"><span>No episode data for this season.</span></div>';
    } catch(e) { list.innerHTML='<div class="row-error" style="border:none"><span>Could not load episodes.</span></div>'; }
  }

  async function openAnimeDetail(malId, img, title) {
    showModal();
    const bodyEl=$('#modalBody');
    bodyEl.innerHTML='<div class="skel" style="height:220px;border-radius:14px;margin-bottom:90px"></div>';
    try {
      const r = await api('/anime/details?id='+encodeURIComponent(malId));
      const a = r.data;
      const aTitle = a.title_english||a.title||title;
      const backdrop=(a.trailer&&a.trailer.images&&a.trailer.images.maximum_image_url)||(a.images&&a.images.jpg&&(a.images.jpg.large_image_url||a.images.jpg.image_url))||'';
      const genres=(a.genres||[]).map((g)=>`<span class="chip">${esc(g.name)}</span>`).join('');
      $('#modalBackdrop').style.backgroundImage=backdrop?`url(${backdrop})`:'none';
      const onList=inWatchlist(malId,'anime');
      state.detail={media:'anime',id:malId,title:aTitle};
      bodyEl.innerHTML = `
        <h2 class="modal-title" id="modalTitle">${esc(aTitle)}</h2>
        <div class="modal-meta"><span>Anime</span><span>${a.year||(a.aired&&a.aired.from?year(a.aired.from):'—')}</span>
          <span class="rating" style="color:var(--gold);font-weight:800">${STAR} ${a.score||'—'}</span>
          <span>${esc(a.type||'TV')}</span>${a.status?`<span>${esc(a.status)}</span>`:''}<span>${a.episodes||'?'} episodes</span></div>
        <div class="modal-genres">${genres}</div>
        <p class="modal-desc">${esc((a.synopsis||'No synopsis available.').replace(/\[written by.*?\]/i,'').trim())}</p>
        <div class="modal-actions">
          <button class="btn btn-play" id="animePlay"><svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M8 5v14l11-7z"/></svg> Watch Now</button>
          <button class="btn btn-ghost" id="animeList">${onList?'In My List':'My List'}</button>
          ${a.url?`<a class="btn btn-ghost" href="${esc(a.url)}" target="_blank" rel="noopener">MyAnimeList</a>`:''}
        </div>
        <div id="detailExtra"></div>`;
      $('#animePlay').onclick=()=>{ recordContinue({id:malId,media_type:'anime',title:aTitle,vote_average:a.score,release_date:String(a.year||'')}); closeModal(); openPlayer({title:aTitle,media:'anime',malId,backdrop}); };
      $('#animeList').onclick=()=>{ toggleWatchlist({id:malId,media_type:'anime',title:aTitle,poster_path:backdrop}); const b=$('#animeList'); setTimeout(()=>{b.textContent=inWatchlist(malId,'anime')?'In My List':'My List';},0); };
    } catch(e) { bodyEl.innerHTML='<div class="section-label" style="color:#ff8690">Could not load details.</div>'; }
  }

  /* ============================================================
     STREAMING PLAYER
     ============================================================ */
  function getSource(id) { return STREAM_SOURCES.find(s=>s.id===id) || orderedSources()[0]; }
  function activeSource() {
    const p = state.player;
    if (p.source === AUTO_ID) return orderedSources()[p.autoIdx] || orderedSources()[0];
    return getSource(p.source);
  }
  function buildEmbedUrl(src) {
    const p=state.player, s=src||activeSource(), id=p.tmdbId;
    const lang = p.audioLang || '';
    return p.media==='movie' ? s.movie(id, lang) : s.tv(id, p.season||1, p.episode||1, lang);
  }
  function showPlayerLoading(text) {
    const el=$('#playerLoading'); el.classList.add('show');
    $('#plSourceName').textContent = text || (state.player.source===AUTO_ID ? 'Picking best server…' : activeSource().name);
  }
  function hidePlayerLoading() { $('#playerLoading').classList.remove('show'); }

  function renderSourceChips() {
    const wrap=$('#sourceChips'); wrap.innerHTML='';
    const mkChip = (id, label, color, isAuto) => {
      const b=document.createElement('button');
      b.className='source-chip'+(id===state.player.source?' active':'')+(isAuto?' auto-chip':'');
      b.style.setProperty('--sc', color);
      b.innerHTML = isAuto
        ? `<span class="sc-auto">⚡</span><span>${esc(label)}</span>`
        : `<span class="sc-dot" style="background:${color}"></span>${esc(label)}`;
      b.onclick=()=>{
        state.player.source=id;
        if (id===AUTO_ID) state.player.autoIdx=0;
        localStorage.setItem('sv-source', id);
        renderSourceChips();
        loadStream(true);
      };
      wrap.appendChild(b);
    };
    mkChip(AUTO_ID, 'Auto (best)', '#22d3ee', true);
    orderedSources().forEach((s)=>mkChip(s.id, s.name, s.color, false));
  }

  function setFrameSource(url) {
    return new Promise((resolve) => {
      const frame = $('#playerFrame');
      let settled = false;
      // Detect if embed tries to popup / navigate top (sandbox blocks it,
      // but window blur tells us the source attempted a redirect)
      let sawPopup = false;
      const onBlur = () => { sawPopup = true; };
      window.addEventListener('blur', onBlur);
      const cleanup = () => {
        clearTimeout(watchdog);
        frame.onload = null;
        frame.onerror = null;
        window.removeEventListener('blur', onBlur);
      };
      const done = (ok) => {
        if (settled) return; settled = true; cleanup();
        resolve(ok && !sawPopup);
      };
      // 6 second watchdog per source, then auto-fail to next in Auto mode
      const watchdog = setTimeout(() => done(false), 6000);
      frame.onload = () => {
        // about:blank fires first ("1"), real URL fires second ("2")
        if (frame.dataset.loading === '1') {
          frame.dataset.loading = '2';
          frame.src = url;
        } else {
          frame.dataset.loading = '0';
          // give the embedded player a brief moment to render its own video
          setTimeout(() => done(true), 400);
        }
      };
      frame.onerror = () => done(false);
      frame.dataset.loading = '1';
      frame.src = 'about:blank';
    });
  }

  async function trySourceAtIndex(idx) {
    const p = state.player;
    const list = orderedSources();
    if (idx >= list.length) {
      // all servers failed — show a clear, actionable screen inside the player
      showPlayerLoading('All servers busy');
      $('#plSourceName').innerHTML = 'Tap <b>Next server</b> below to retry, or pick a specific source.';
      // drop a retry button directly over the video
      $$('.pf-inline-retry').forEach(n => n.remove());
      const bar = document.createElement('div');
      bar.className = 'pf-inline-retry';
      bar.innerHTML = `<button class="btn btn-play sm" id="pfInlineRetry">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>
          Try again
        </button>`;
      $('#playerVideoWrap').appendChild(bar);
      $('#pfInlineRetry').onclick = () => {
        bar.remove();
        if (state.player.source === AUTO_ID) trySourceAtIndex(0);
        else loadStream(true);
      };
      return false;
    }
    p.autoIdx = idx;
    const s = list[idx];
    showPlayerLoading(`Trying ${s.name}… (${idx+1}/${list.length})`);
    const url = buildEmbedUrl(s);
    $('#playerExt').href = url;
    p._lastSrcAt = Date.now();
    const ok = await setFrameSource(url);
    if (!ok && p.source === AUTO_ID) {
      return trySourceAtIndex(idx + 1);
    }
    if (ok) {
      hidePlayerLoading();
      // briefly show which auto source was picked
      const note = $('#plSourceName');
      if (p.source === AUTO_ID) {
        note.textContent = `Playing via ${s.name}`;
        setTimeout(() => { if (!$('#playerLoading').classList.contains('show')) note.textContent = ''; }, 2500);
      }
    }
    return ok;
  }

  function loadStream(showLoad=true) {
    const p = state.player;
    if (p.media === 'anime') {
      if (p.animeVideo && p.animeVideo.current) playAnimeVideo(p.animeVideo.current);
      return;
    }
    clearTimeout(p.autoTimer);
    $$('.pf-inline-retry, .player-fallback').forEach(n => n.remove());

    // apply user's popup-protection preference to the iframe
    const frame = $('#playerFrame');
    applyFramePolicy();
    $('#playerTitle').textContent = p.media==='tv'
      ? `${p.title} — S${String(p.season).padStart(2,'0')}E${String(p.episode).padStart(2,'0')}`
      : p.title;
    updatePrevNext();
    if (p.source === AUTO_ID) {
      p.autoIdx = 0;
      trySourceAtIndex(0);
    } else {
      const s = activeSource();
      showPlayerLoading(s.name);
      setFrameSource(buildEmbedUrl(s)).then((ok) => {
        if (!ok) {
          // fall back to auto
          state.player.source = AUTO_ID;
          renderSourceChips();
          trySourceAtIndex(0);
        } else {
          hidePlayerLoading();
        }
      });
    }
  }

  function updatePrevNext() {
    const p=state.player, isTv=p.media==='tv';
    const prev=$('#pcPrev'), next=$('#pcNext');
    if (!isTv) { prev.style.display='none'; next.style.display='none'; return; }
    prev.style.display=''; next.style.display='';
    const eps=p.episodes||[], idx=eps.findIndex(e=>e.episode_number===p.episode);
    prev.disabled = p.episode<=1 && !eps[idx-1];
    next.disabled = idx>=eps.length-1 && !(p.seasons||[]).some(s=>s.season_number===p.season+1);
  }
  function renderEpisodeChips() {
    const wrap=$('#epChips'); wrap.innerHTML='';
    state.player.episodes.forEach((ep)=>{
      const b=document.createElement('button'); b.className='ep-chip'+(ep.episode_number===state.player.episode?' active':'');
      b.textContent=ep.episode_number; b.title=ep.name||`Episode ${ep.episode_number}`;
      b.onclick=()=>{
        state.player.episode=ep.episode_number; renderEpisodeChips(); loadStream();
        recordContinue({id:state.player.tmdbId,media_type:'tv',title:state.player.title,vote_average:0,release_date:''},{season:state.player.season,episode:ep.episode_number});
      };
      wrap.appendChild(b);
    });
  }
  function renderSeasonSelect() {
    const sel=$('#pcSeason'); sel.innerHTML='';
    state.player.seasons.forEach((s)=>{
      const o=document.createElement('option'); o.value=s.season_number;
      o.textContent=s.name||`Season ${s.season_number}`;
      if (s.season_number===state.player.season) o.selected=true;
      sel.appendChild(o);
    });
    sel.onchange=async()=>{ state.player.season=parseInt(sel.value,10); state.player.episode=1; await loadPlayerEpisodes(); renderEpisodeChips(); loadStream(); };
  }
  async function loadPlayerEpisodes() {
    const p=state.player; if (p.media!=='tv') return;
    try {
      const data = await api(`/tv/season?id=${p.tmdbId}&s=${p.season}`,{noCache:true});
      p.episodes=(data.episodes||[]).filter(e=>e.episode_number>0);
      if (!p.episodes.some(e=>e.episode_number===p.episode)) p.episode=1;
    } catch(e) {
      p.episodes=Array.from({length:24},(_,i)=>({episode_number:i+1,name:`Episode ${i+1}`}));
    }
  }
  function populateAudioLanguages(detail) {
    const select = $('#pcLang');
    if (!select) return;
    const found = [];
    const add = (code, label) => {
      code = String(code || '').toLowerCase().slice(0, 2);
      if (!code || found.some((x) => x.code === code)) return;
      found.push({ code, label: label || AUDIO_NAMES[code] || code.toUpperCase() });
    };
    // TMDB's spoken_languages + original_language are the only languages we
    // advertise. This avoids showing unsupported fake dub choices.
    add(detail && detail.original_language, AUDIO_NAMES[detail && detail.original_language]);
    (detail && detail.spoken_languages || []).forEach((x) => add(x.iso_639_1, x.english_name || AUDIO_NAMES[x.iso_639_1]));
    select.innerHTML = '<option value="">Auto (available)</option>' + found.map((x) => `<option value="${esc(x.code)}">${esc(x.label)}</option>`).join('');
    const allowed = new Set(found.map((x) => x.code));
    if (!allowed.has(state.player.audioLang)) state.player.audioLang = '';
    select.value = state.player.audioLang;
    select.title = found.length ? 'Only metadata-listed audio languages are shown' : 'Audio will be selected automatically';
  }

  async function loadPlayerLanguages() {
    const p = state.player;
    if (p.media === 'anime' || !p.tmdbId) return;
    try {
      const d = await api(`/details?media=${p.media}&id=${encodeURIComponent(p.tmdbId)}`, { noCache: true });
      p.details = d;
      populateAudioLanguages(d);
      return d;
    } catch (e) {
      populateAudioLanguages({});
      return null;
    }
  }

  async function loadPlayerSeasons() {
    const p=state.player;
    try {
      const d = await api(`/details?media=tv&id=${p.tmdbId}`);
      p.details = d;
      populateAudioLanguages(d);
      p.seasons=((d.seasons||[]).filter(s=>s.season_number>0).sort((a,b)=>a.season_number-b.season_number));
      if (!p.seasons.length) p.seasons=[{season_number:1,name:'Season 1'}];
    } catch(e) { p.seasons=[{season_number:1,name:'Season 1'}]; }
  }
  async function loadOfficialProviders() {
    const grid=$('#pcProviderGrid'); grid.innerHTML='';
    const p=state.player;
    if (p.media === 'anime' || !p.tmdbId) return;
    try {
      const region=(state.country||state.region||'IN').toUpperCase();
      const r=await api(`/watch?media=${p.media}&id=${encodeURIComponent(p.tmdbId)}&region=${region}`,{noCache:true});
      const regions=r.results||{}, prov=regions[region]||regions.IN||regions.US||Object.values(regions)[0];
      if (!prov) { grid.innerHTML='<div class="tiny-note" style="padding:6px 2px">No official services found for your region.</div>'; return; }
      const services=[]; const push=(arr,tag)=>(arr||[]).forEach(s=>services.push({name:s.provider_name,logo:s.logo_path?'https://image.tmdb.org/t/p/original'+s.logo_path:'',url:prov.link||'#',tag}));
      push(prov.flatrate,'Subscription'); push(prov.free,'Free'); push(prov.ads,'With ads'); push(prov.rent,'Rent'); push(prov.buy,'Buy');
      const seen={}; const list=services.filter(s=>(seen[s.name]?false:(seen[s.name]=true))).slice(0,14);
      list.forEach((s)=>{
        const a=document.createElement('a'); a.className='provider-tile'+(s.tag==='Subscription'?' flatrate':'');
        a.href=s.url; a.target='_blank'; a.rel='noopener';
        const logo=s.logo?`<img src="${esc(s.logo)}" alt="" onerror="this.style.display='none'">`:`<div class="pt-fallback">${esc(s.name[0]||'P')}</div>`;
        a.innerHTML=`${logo}<span class="pt-name">${esc(s.name)}</span><span class="pt-tag">${esc(s.tag)}</span><span class="pt-arrow">›</span>`;
        grid.appendChild(a);
      });
    } catch(e) { grid.innerHTML='<div class="tiny-note" style="padding:6px 2px">Official options unavailable right now.</div>'; }
  }

  async function openPlayer({title, media, tmdbId, malId, backdrop, season=1, episode=1}) {
    const p = state.player;
    p.session = (p.session || 0) + 1;
    p.active = true;
    p.title = title || 'Now Playing';
    p.backdrop = backdrop || '';
    p.season = season;
    p.episode = episode;
    p.episodes = [];
    p.seasons = [];
    p.animeVideo = null;
    p.media = media;
    p.tmdbId = tmdbId || null;
    p.malId = malId || null;

    $('#playerModal').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    resetPlayerFeed();
    $('#playerTitle').textContent = p.title;
    $$('.player-fallback, .pf-inline-retry').forEach((n) => n.remove());
    restoreEpisodePanel();
    restoreMoviePlayerChrome();
    showPlayerLoading('Preparing…');

    if (media === 'anime' && malId) {
      $('#playerTitle').textContent = p.title;
      $('#plSourceName').textContent = 'Loading official anime video…';
      try {
        const data = await api(`/anime/videos?id=${encodeURIComponent(malId)}&title=${encodeURIComponent(title || '')}`, { noCache: true });
        p.animeVideo = data || { title: title || 'Anime', trailer: null, episodes: [], official: [] };
        if (data && data.title && data.title !== 'Anime') p.title = data.title;
        $('#playerTitle').textContent = p.title;
        renderAnimePlayer(data);
        loadAnimeRecommendations(p);
      } catch (e) {
        renderAnimeFallback(p.title, malId, null);
        loadAnimeRecommendations(p);
      }
      clearTimeout(p._loadTimer);
      p._loadTimer = setTimeout(() => { if (p.active) hidePlayerLoading(); }, 10000);
      clearTimeout(p._muteTimer);
      p._muteTimer = setTimeout(showUnmutePrompt, 3500);
      return;
    }

    renderSourceChips();
    if (p.media === 'tv') {
      $('#pcEpisodes').classList.remove('hidden');
      await loadPlayerSeasons();
      if (!p.seasons.some((s) => s.season_number === p.season)) p.season = p.seasons[0].season_number;
      renderSeasonSelect();
      await loadPlayerEpisodes();
      renderEpisodeChips();
    } else {
      $('#pcEpisodes').classList.add('hidden');
    }

    updatePrevNext();
    if (p.media === 'movie') await loadPlayerLanguages();
    loadStream(true);
    loadOfficialProviders();
    loadRecommendations(p);
    clearTimeout(p._loadTimer);
    p._loadTimer = setTimeout(() => { if (p.active) hidePlayerLoading(); }, 10000);
    clearTimeout(p._muteTimer);
    p._muteTimer = setTimeout(showUnmutePrompt, 3500);
  }

  function resetPlayerFeed() {
    const feed = $('#playerFeed');
    if (feed) {
      feed.scrollTop = 0;
      feed.classList.remove('has-scrolled');
    }
    const hint = $('#feedSwipeHint');
    if (hint) hint.classList.remove('dismissed');
    const inline = $('#playerInlineRecommendations');
    if (inline) inline.classList.add('hidden');
    const inlineRow = $('#playerInlineRecRow');
    if (inlineRow) inlineRow.innerHTML = '';
    $('#playerStage')?.classList.remove('has-inline-recs');
  }

  function applyFramePolicy() {
    const frame = $('#playerFrame');
    if (state.sandbox) {
      frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-presentation allow-pointer-lock');
    } else {
      frame.removeAttribute('sandbox');
    }
  }

  function restoreMoviePlayerChrome() {
    const sourceRow = $('#sourceChips') && $('#sourceChips').closest('.pc-row');
    if (sourceRow) sourceRow.classList.remove('anime-hidden');
    $('#pcLang').closest('.pc-row').classList.remove('anime-hidden');
    $('#playerNextSrc').classList.remove('anime-hidden');
    const details = $('#pcProviderGrid') && $('#pcProviderGrid').closest('details');
    if (details) {
      details.open = false;
      const summary = details.querySelector('summary');
      if (summary) summary.textContent = 'Official streaming options (Netflix, Prime, JioHotstar…)';
    }
  }

  function restoreEpisodePanel() {
    $('#pcEpisodes').innerHTML = `
      <div class="pc-label">
        <span>Episodes</span>
        <select id="pcSeason" class="pc-select" aria-label="Season"></select>
      </div>
      <div class="ep-chips" id="epChips"></div>`;
    $('#pcEpisodes').classList.add('hidden');
  }

  function playAnimeVideo(item) {
    if (!item || !item.url) return;
    const p = state.player;
    const frame = $('#playerFrame');
    const isTrailer = item.kind === 'trailer';
    const url = item.embed || item.url;
    applyFramePolicy();
    $('.player-fallback')?.remove();
    showPlayerLoading(item.label || (isTrailer ? 'Official trailer' : 'Official episode'));
    $('#playerExt').href = item.external || item.url || '#';
    frame.onload = () => {
      setTimeout(() => { if (p.active) hidePlayerLoading(); }, isTrailer ? 900 : 1400);
    };
    frame.onerror = () => {
      hidePlayerLoading();
      toast('This official video cannot be embedded here. Use Open source.');
    };
    frame.src = 'about:blank';
    window.setTimeout(() => {
      if (p.active) frame.src = url;
    }, 30);
    p.animeVideo.current = item;
  }

  function renderAnimePlayer(data) {
    const p = state.player;
    const sourceRow = $('#sourceChips').closest('.pc-row');
    sourceRow.classList.add('anime-hidden');
    $('#pcLang').closest('.pc-row').classList.add('anime-hidden');
    $('#playerNextSrc').classList.add('anime-hidden');
    $('#pcEpisodes').classList.remove('hidden');
    $('#pcEpisodes').innerHTML = `
      <div class="pc-label">
        <span>Anime video</span>
        <span class="pc-hint">Official preview / licensed link</span>
      </div>
      <div class="ep-chips" id="epChips"></div>`;

    const items = [];
    if (data && data.trailer && data.trailer.id) {
      const trailerId = encodeURIComponent(data.trailer.id);
      const trailerUrl = data.trailer.url || `https://www.youtube.com/watch?v=${trailerId}`;
      items.push({
        kind: 'trailer', label: 'Official trailer · YouTube', title: 'Official trailer',
        url: trailerUrl, external: trailerUrl,
        embed: data.trailer.embed || `https://www.youtube-nocookie.com/embed/${trailerId}?autoplay=1&rel=0&modestbranding=1&playsinline=1`,
      });
    }
    (data && data.episodes || []).forEach((ep, i) => items.push({
      kind: 'episode', episodeNo: i + 1, label: `${ep.site || 'Official'} · ${ep.title || 'Episode'}`,
      title: ep.title || 'Official episode', url: ep.url, external: ep.url, thumbnail: ep.thumbnail,
    }));

    const chips = $('#epChips');
    if (items.length) {
      items.forEach((item, i) => {
        const b = document.createElement('button');
        b.className = 'ep-chip anime-video-chip' + (i === 0 ? ' active' : '');
        b.textContent = item.kind === 'trailer' ? 'Trailer' : `E${item.episodeNo || i + 1}`;
        b.title = item.label;
        b.onclick = () => {
          $$('#epChips .ep-chip').forEach((x) => x.classList.remove('active'));
          b.classList.add('active');
          playAnimeVideo(item);
        };
        chips.appendChild(b);
      });
      playAnimeVideo(items[0]);
    } else {
      chips.innerHTML = '<span class="pc-hint anime-empty">No embeddable preview was published for this title.</span>';
      renderAnimeFallback(data && data.title || p.title, p.malId, data);
    }

    renderOfficialAnimeLinks(data);
  }

  function renderOfficialAnimeLinks(data) {
    const grid = $('#pcProviderGrid');
    const details = grid.closest('details');
    grid.innerHTML = '';
    if (details) {
      details.open = true;
      const summary = details.querySelector('summary');
      if (summary) summary.textContent = 'Official anime links';
    }
    const links = (data && data.official || []).filter((x) => x && x.url);
    if (!links.length) {
      grid.innerHTML = '<div class="tiny-note" style="padding:6px 2px">No official link was returned. Try again in a moment.</div>';
      return;
    }
    links.forEach((item) => {
      const a = document.createElement('a');
      a.className = 'provider-tile';
      a.href = item.url; a.target = '_blank'; a.rel = 'noopener';
      a.innerHTML = `<div class="pt-fallback">${esc((item.name || 'O')[0])}</div><span class="pt-name">${esc(item.name || 'Official source')}</span><span class="pt-arrow">›</span>`;
      grid.appendChild(a);
    });
  }

  function playRecommendationItem(it) {
    const isAnime = it.kind === 'anime' || it.mal_id != null;
    const name = titleOf(it);
    const poster = isAnime
      ? (it.images && it.images.jpg && (it.images.jpg.large_image_url || it.images.jpg.image_url))
      : it.poster_path;
    if (isAnime) {
      recordContinue({ id: it.mal_id, media_type: 'anime', title: name, vote_average: it.score, release_date: String(it.year || '') });
      openPlayer({ title: name, media: 'anime', malId: it.mal_id, backdrop: poster || '' });
    } else {
      const media = mediaOf(it);
      recordContinue({ id: it.id, media_type: media, title: name, vote_average: it.vote_average, release_date: it.release_date || it.first_air_date, poster_path: it.poster_path, backdrop_path: it.backdrop_path });
      openPlayer({ title: name, media, tmdbId: it.id, backdrop: backdropUrl(it.backdrop_path || it.poster_path) });
    }
  }

  function recommendationPoster(it) {
    const isAnime = it.kind === 'anime' || it.mal_id != null;
    return isAnime
      ? (it.images && it.images.jpg && (it.images.jpg.large_image_url || it.images.jpg.image_url))
      : it.poster_path;
  }

  function recommendationName(it) {
    return titleOf(it) || 'Recommended title';
  }

  function renderInlineRecommendationCards(items) {
    const wrap = $('#playerInlineRecommendations');
    const row = $('#playerInlineRecRow');
    const stage = $('#playerStage');
    row.innerHTML = '';
    const clean = (items || []).filter(Boolean).slice(0, 7);
    if (!clean.length) {
      wrap.classList.add('hidden');
      stage.classList.remove('has-inline-recs');
      return;
    }
    clean.forEach((it) => {
      const isAnime = it.kind === 'anime' || it.mal_id != null;
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'inline-rec-card';
      card.title = recommendationName(it);
      card.innerHTML = `<img loading="lazy" src="${esc(recommendationPoster(it) || placeholderPoster())}" alt="${esc(recommendationName(it))}" onerror="this.onerror=null;this.src='${placeholderPoster()}'"><span class="inline-rec-name">${esc(recommendationName(it))}</span><span class="inline-rec-type">${isAnime ? 'Anime' : mediaOf(it) === 'tv' ? 'TV' : 'Movie'}</span>`;
      card.onclick = () => playRecommendationItem(it);
      row.appendChild(card);
    });
    wrap.classList.remove('hidden');
    stage.classList.add('has-inline-recs');
  }

  function renderRecommendationCards(items) {
    const inner = $('#pcRecRowInner');
    inner.innerHTML = '';
    const clean = (items || []).filter(Boolean).slice(0, 14);
    if (!clean.length) {
      $('#pcRecRow').classList.add('hidden');
      renderInlineRecommendationCards([]);
      return;
    }
    clean.forEach((it) => {
      const isAnime = it.kind === 'anime' || it.mal_id != null;
      const c = document.createElement('div');
      c.className = 'rec-card'; c.tabIndex = 0;
      c.innerHTML = `<img loading="lazy" src="${esc(recommendationPoster(it) || placeholderPoster())}" alt="${esc(recommendationName(it))}" onerror="this.onerror=null;this.src='${placeholderPoster()}'"><div class="rec-name">${esc(recommendationName(it))}</div><div class="rec-type">${isAnime ? 'Anime' : mediaOf(it) === 'tv' ? 'TV show' : 'Movie'}</div>`;
      c.onclick = () => playRecommendationItem(it);
      c.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); c.click(); } };
      inner.appendChild(c);
    });
    $('#pcRecRow').classList.remove('hidden');
    renderInlineRecommendationCards(clean);
  }

  function fallbackRecommendations(p) {
    return (state.heroItems || []).filter((it) => !(p.media === 'anime' && it.mal_id === p.malId)).slice(0, 10);
  }

  async function loadRecommendations(p) {
    $('#pcRecRow').classList.add('hidden');
    $('#pcRecRowInner').innerHTML = '';
    renderInlineRecommendationCards([]);
    if (!p.tmdbId || p.media === 'anime') return;
    const session = p.session;
    try {
      const d = await api(`/recommendations?media=${p.media}&id=${p.tmdbId}`, { noCache: true });
      if (p.session !== session || !p.active) return;
      const recs = (d.results || [])
        .filter((v, i, arr) => arr.findIndex((x) => x.id === v.id) === i)
        .filter(isReleased)
        .slice(0, 14);
      renderRecommendationCards(recs.length ? recs : fallbackRecommendations(p));
    } catch (e) {
      if (p.session === session && p.active) renderRecommendationCards(fallbackRecommendations(p));
    }
  }

  async function loadAnimeRecommendations(p) {
    $('#pcRecRow').classList.add('hidden');
    $('#pcRecRowInner').innerHTML = '';
    renderInlineRecommendationCards([]);
    const session = p.session;
    try {
      const [animeResult, movieResult] = await Promise.allSettled([api('/anime/top?page=1'), api('/trending')]);
      if (p.session !== session || !p.active) return;
      const anime = animeResult.status === 'fulfilled' ? (animeResult.value.data || []).slice(0, 8).map((x) => ({ ...x, kind: 'anime' })) : [];
      const movies = movieResult.status === 'fulfilled' ? (movieResult.value.results || []).filter(isReleased).slice(0, 6) : [];
      const recs = [...anime, ...movies].filter((x) => !(x.kind === 'anime' && x.mal_id === p.malId));
      renderRecommendationCards(recs.length ? recs : fallbackRecommendations(p));
    } catch (e) {
      if (p.session === session && p.active) renderRecommendationCards(fallbackRecommendations(p));
    }
  }

  function renderAnimeFallback(title, malId, data) {
    hidePlayerLoading();
    const sourceRow = $('#sourceChips').closest('.pc-row');
    sourceRow.classList.add('anime-hidden');
    $('#pcLang').closest('.pc-row').classList.add('anime-hidden');
    $('#playerNextSrc').classList.add('anime-hidden');
    const frame = $('#playerFrame'); frame.src = 'about:blank';
    $('#playerTitle').textContent = title || 'Anime';
    $('#pcEpisodes').classList.add('hidden');
    $$('.player-fallback').forEach((n) => n.remove());
    const wrap = document.createElement('div'); wrap.className = 'player-fallback';
    const defaultLinks = [
      { name: 'Crunchyroll', url: `https://www.crunchyroll.com/search?q=${encodeURIComponent(title || 'anime')}` },
      { name: 'Netflix', url: `https://www.netflix.com/search?q=${encodeURIComponent(title || 'anime')}` },
    ];
    const official = ((data && data.official && data.official.length) ? data.official : defaultLinks).filter((x) => x && x.url).slice(0, 3);
    wrap.innerHTML = `<div class="pf-logo">${PLAY_SM}</div>
      <div class="pf-h">Official anime video not available</div>
      <div class="pf-sub">This title has no embeddable preview right now. Use an official source below or try again later.</div>
      <div class="pf-btns">
        ${official.map((x) => `<a class="btn btn-more" href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.name)}</a>`).join('')}
        <a class="btn btn-ghost" href="https://www.youtube.com/results?search_query=${encodeURIComponent(title + ' official trailer')}" target="_blank" rel="noopener">YouTube</a>
        ${malId ? `<a class="btn btn-ghost" href="https://myanimelist.net/anime/${encodeURIComponent(malId)}" target="_blank" rel="noopener">AniList / MAL</a>` : ''}
      </div>`;
    $('#playerVideoWrap').appendChild(wrap);
    renderOfficialAnimeLinks({ official });
  }
  $('#playerClose').onclick=closePlayer;
  function closePlayer() {
    const p = state.player;
    p.active = false;
    clearTimeout(p._loadTimer);
    clearTimeout(p._muteTimer);
    const frame = $('#playerFrame');
    frame.onload = null; frame.onerror = null; frame.src = 'about:blank';
    $('#playerModal').classList.add('hidden');
    document.body.style.overflow = $('#detailModal').classList.contains('hidden') ? '' : 'hidden';
    hidePlayerLoading();
    $('#unmuteBanner').classList.remove('show');
    $$('.player-fallback, .pf-inline-retry').forEach((n) => n.remove());
    $('#pcRecRow').classList.add('hidden');
    $('#pcRecRowInner').innerHTML = '';
    resetPlayerFeed();
    restoreMoviePlayerChrome();
    p.animeVideo = null;
  }

  // Browser autoplay policy: videos start muted. Show tap-to-unmute banner
  // and try to unmute the iframe via a fresh load with user gesture.
  function showUnmutePrompt() {
    const p = state.player;
    if (!p.active) return;
    $('#unmuteBanner').classList.add('show');
  }
  $('#unmuteBtn').onclick = () => {
    // try sending a click to iframe (may trigger unmute in some players)
    const frame = $('#playerFrame');
    try { frame.contentWindow.focus(); } catch(e){}
    $('#unmuteBanner').classList.remove('show');
    // Reload current source — a user-initiated reload usually starts unmuted
    loadStream(true);
    toast('Sound on 🔊');
  };

  // Language / audio selector
  $('#pcLang').value = state.player.audioLang || '';
  $('#pcLang').onchange = (e) => {
    state.player.audioLang = e.target.value;
    localStorage.setItem('sv-audio-lang', e.target.value);
    loadStream(true);
    toast(e.target.value ? `Audio: ${e.target.value.toUpperCase()}` : 'Audio: default');
  };
  $('#pcReload').onclick = () => {
    loadStream(true);
    toast(state.player.media === 'anime' ? 'Reloading official video…' : 'Reloading…');
  };
  $('#playerFs').onclick=()=>{
    const el=document.querySelector('#playerModal .player');
    if (!el) return;
    if (!document.fullscreenElement) {
      const enter = el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen;
      if (enter) enter.call(el);
    } else {
      const exit = document.exitFullscreen || document.webkitExitFullscreen;
      if (exit) exit.call(document);
    }
  };
  $('#pcPrev').onclick=()=>{
    const p=state.player; if(p.media!=='tv')return;
    if (p.episode>1){ p.episode--; renderEpisodeChips(); loadStream(); }
  };
  $('#pcNext').onclick=async()=>{
    const p=state.player; if(p.media!=='tv')return;
    const idx=p.episodes.findIndex(e=>e.episode_number===p.episode);
    if (idx>=0 && idx<p.episodes.length-1) p.episode=p.episodes[idx+1].episode_number;
    else if (p.seasons.some(s=>s.season_number===p.season+1)) { p.season++; p.episode=1; renderSeasonSelect(); await loadPlayerEpisodes(); renderEpisodeChips(); }
    else return;
    loadStream();
    recordContinue({id:p.tmdbId,media_type:'tv',title:p.title,vote_average:0,release_date:''},{season:p.season,episode:p.episode});
  };
  $('#pcDownload').onclick = (e) => {
    // Build a small quality/download menu
    const existing = $('#dlMenu');
    if (existing) { existing.remove(); return; }
    const p = state.player;
    if (p.media === 'anime') {
      const href = (p.animeVideo && p.animeVideo.current && (p.animeVideo.current.external || p.animeVideo.current.url))
        || (p.animeVideo && p.animeVideo.official && p.animeVideo.official[0] && p.animeVideo.official[0].url);
      if (href) window.open(href, '_blank', 'noopener');
      else toast('No official link available yet');
      return;
    }
    const s = activeSource();
    const base = buildEmbedUrl(s);
    const menu = document.createElement('div');
    menu.id = 'dlMenu';
    menu.className = 'dl-menu';
    const opt = (label, sub, href) => `<a class="dl-opt" href="${esc(href)}" target="_blank" rel="noopener">
      <span class="dl-q">${esc(label)}</span>
      <span class="dl-sub">${esc(sub)}</span>
    </a>`;
    menu.innerHTML = `
      <div class="dl-head">
        <span>Open / Download</span>
        <button class="dl-x" aria-label="Close">×</button>
      </div>
      ${opt('Source page', 'Best quality (1080p/4K) — use IDM or browser save', base)}
      ${opt('Google search', 'Find direct downloads / torrents',
        'https://www.google.com/search?q=' + encodeURIComponent(p.title + (p.media==='tv' ? ` S${p.season}E${p.episode}` : '') + ' download 1080p'))}
      ${p.media==='tv' ? opt('IMDb / TMDB', 'View info & external links', 'https://www.themoviedb.org/tv/' + p.tmdbId) : opt('TMDB page', 'View info & external links', 'https://www.themoviedb.org/movie/' + p.tmdbId)}
      <div class="dl-note">Embedded videos can't be saved directly. The source page opens in a new tab — use a video downloader (IDM, CocoCut, Video DownloadHelper) there.</div>
    `;
    document.body.appendChild(menu);
    const rect = e.currentTarget.getBoundingClientRect();
    menu.style.bottom = (window.innerHeight - rect.top + 8) + 'px';
    menu.style.left = Math.min(rect.left, window.innerWidth - 300) + 'px';
    menu.querySelector('.dl-x').onclick = () => menu.remove();
    setTimeout(() => {
      const closer = (ev) => { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('click', closer); } };
      setTimeout(() => document.addEventListener('click', closer), 50);
    }, 0);
  };
  $('#playerNextSrc').onclick = () => {
    // manually skip to next source
    const list = orderedSources();
    if (state.player.source === AUTO_ID) {
      state.player.autoIdx = (state.player.autoIdx + 1) % list.length;
      const s = list[state.player.autoIdx];
      showPlayerLoading(`Switching to ${s.name}…`);
      setFrameSource(buildEmbedUrl(s)).then((ok) => {
        if (!ok && state.player.autoIdx < list.length - 1) $('#playerNextSrc').click();
        else hidePlayerLoading();
      });
    } else {
      // switch to next specific source
      const curIdx = list.findIndex((x) => x.id === state.player.source);
      const next = list[(curIdx + 1) % list.length];
      state.player.source = next.id;
      localStorage.setItem('sv-source', next.id);
      renderSourceChips();
      loadStream(true);
      toast(`Switched to ${next.name}`);
    }
  };
  $('#playerPlaylistAdd').onclick = () => {
    const p = state.player;
    openPlaylistModal({ id:p.tmdbId, media:p.media, title:p.title, poster:'', backdrop:'', vote_average:0, release_date:'' });
  };

  /* ================= LIVE TV ================= */
  function showLiveTV() {
    hideAllViews(); $('#liveView').classList.remove('hidden'); window.scrollTo({top:0}); closeMobileMenu();
    renderLiveChannels();
  }
  function renderLiveChannels(filter='All') {
    const chips = $('#liveChips');
    if (!chips.children.length) {
      const cats = ['All', ...Array.from(new Set(LIVE_CHANNELS.map(c=>c.cat)))];
      cats.forEach((cat) => {
        const b = document.createElement('button'); b.className='cat-chip'+(cat==='All'?' active':''); b.textContent=cat;
        b.onclick = () => { $$('#liveChips .cat-chip').forEach(x=>x.classList.remove('active')); b.classList.add('active'); renderLiveChannels(cat); };
        chips.appendChild(b);
      });
    }
    const grid = $('#liveGrid'); grid.innerHTML='';
    const list = filter==='All' ? LIVE_CHANNELS : LIVE_CHANNELS.filter(c=>c.cat===filter);
    list.forEach((ch) => {
      const card = document.createElement('div'); card.className='live-card';
      card.tabIndex=0;
      card.innerHTML = `
        <div class="lc-logo">${ch.logo}</div>
        <div class="lc-meta">
          <div class="lc-name">${esc(ch.name)}</div>
          <div class="lc-cat">${esc(ch.cat)} <span class="lc-live"><span class="live-dot sm"></span> LIVE</span></div>
        </div>`;
      card.onclick = () => openLivePlayer(ch);
      card.onkeydown = (e) => { if(e.key==='Enter'||e.key===' '){e.preventDefault(); openLivePlayer(ch);} };
      grid.appendChild(card);
    });
  }

  function openLivePlayer(channel) {
    $('#livePlayerModal').classList.remove('hidden');
    document.body.style.overflow='hidden';
    $('#liveTitle').innerHTML = `<span class="live-dot"></span> ${esc(channel.name)} <span style="opacity:.6;font-weight:500">— ${esc(channel.cat)}</span>`;
    const video = $('#liveVideo');
    const loading = $('#liveLoading'); loading.classList.remove('hidden');
    $('#liveMeta').textContent = 'Connecting…';
    destroyLive();
    state.live.currentChannel = channel;
    const proxyUrl = '/api/hls?url=' + encodeURIComponent(channel.url);

    if (window.Hls && Hls.isSupported()) {
      const hls = new Hls({ lowLatencyMode: true, backBufferLength: 30, enableWorker: true });
      state.live.hls = hls;
      hls.loadSource(proxyUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        loading.classList.add('hidden');
        $('#liveMeta').textContent = `Playing ${channel.name} · ${channel.cat}`;
        populateQualityLevels(hls);
        video.play().catch(()=>{});
      });
      hls.on(Hls.Events.LEVEL_SWITCHED, () => populateQualityLevels(hls));
      hls.on(Hls.Events.ERROR, (evt, data) => {
        if (data && data.fatal) {
          loading.classList.add('hidden');
          $('#liveMeta').innerHTML = `Stream unavailable. <a href="${esc(channel.url)}" target="_blank" rel="noopener" style="color:#9ab5ff;text-decoration:underline">Try direct link</a>`;
        }
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = channel.url; // Safari native
      video.addEventListener('loadedmetadata', () => { loading.classList.add('hidden'); video.play().catch(()=>{}); }, { once: true });
    } else {
      loading.classList.add('hidden');
      $('#liveMeta').textContent = 'HLS not supported in this browser.';
    }
  }
  function populateQualityLevels(hls) {
    const sel = $('#liveQuality');
    const levels = hls.levels || [];
    sel.innerHTML = '<option value="-1">Auto</option>' + levels.map((lvl, i) => {
      const res = lvl.height ? lvl.height + 'p' : `${Math.round(lvl.bitrate/1000)} kbps`;
      return `<option value="${i}">${res}</option>`;
    }).join('');
    sel.value = hls.autoLevelEnabled ? '-1' : String(hls.currentLevel);
    sel.onchange = () => { hls.currentLevel = parseInt(sel.value,10); };
  }
  function destroyLive() {
    if (state.live.hls) { try { state.live.hls.destroy(); } catch(e){} state.live.hls = null; }
    const v = $('#liveVideo'); if (v) { try { v.pause(); v.removeAttribute('src'); v.load(); } catch(e){} }
  }
  $('#liveClose').onclick = () => { destroyLive(); $('#livePlayerModal').classList.add('hidden'); if ($('#detailModal').classList.contains('hidden')&&$('#playerModal').classList.contains('hidden')) document.body.style.overflow=''; };
  $('#liveFs').onclick = () => {
    const v = $('#liveVideo');
    if (!document.fullscreenElement) { (v.requestFullscreen||v.webkitRequestFullscreen||v.mozRequestFullScreen).call(v); }
    else (document.exitFullscreen||document.webkitExitFullscreen).call(document);
  };
  $('#liveSpeed').onchange = (e) => { const v=$('#liveVideo'); v.playbackRate = parseFloat(e.target.value); toast(`Speed ${e.target.value}×`); };
  $('#liveMute').onclick = () => {
    const v=$('#liveVideo'); v.muted = !v.muted;
    $('#liveMuteText').textContent = v.muted ? 'Unmute' : 'Mute';
    toast(v.muted ? 'Muted' : 'Unmuted');
  };
  $('#livePip').onclick = async () => {
    const v=$('#liveVideo');
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else if (document.pictureInPictureEnabled) await v.requestPictureInPicture();
    } catch(e) { toast('PiP not available'); }
  };

  /* ================= MODAL PLUMBING ================= */
  function showModal() { closePlayer(); $('#detailModal').classList.remove('hidden'); $('#modalBody').innerHTML=''; $('#modalBackdrop').style.backgroundImage='none'; document.body.style.overflow='hidden'; }
  $('#modalClose').onclick=closeModal;
  $('#detailModal').addEventListener('click',(e)=>{ if(e.target===$('#detailModal')) closeModal(); });
  function closeModal() { $('#detailModal').classList.add('hidden'); if ($('#playerModal').classList.contains('hidden')&&$('#livePlayerModal').classList.contains('hidden')) document.body.style.overflow=''; }
  document.addEventListener('keydown',(e)=>{ if(e.key==='Escape'){ closePlayer(); destroyLive(); $('#livePlayerModal').classList.add('hidden'); closeModal(); $('#settingsModal').classList.add('hidden'); $('#playlistModal').classList.add('hidden'); closeBravePromo(false); } });

  function trapFocus(container) {
    const focusables = container.querySelectorAll('button,[href],input,select,[tabindex]:not([tabindex="-1"])');
    if (!focusables.length) return;
    const first=focusables[0], last=focusables[focusables.length-1];
    if (container._trap) container.removeEventListener('keydown', container._trap);
    container._trap=(e)=>{
      if (e.key!=='Tab') return;
      if (e.shiftKey && document.activeElement===first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement===last) { e.preventDefault(); first.focus(); }
    };
    container.addEventListener('keydown', container._trap);
    setTimeout(()=>first.focus(),80);
  }
  new MutationObserver(()=>{
    if (!$('#detailModal').classList.contains('hidden')) trapFocus($('#detailModal'));
    if (!$('#playerModal').classList.contains('hidden')) trapFocus($('#playerModal'));
    if (!$('#settingsModal').classList.contains('hidden')) trapFocus($('#settingsModal'));
    if (!$('#livePlayerModal').classList.contains('hidden')) trapFocus($('#livePlayerModal'));
    if (!$('#playlistModal').classList.contains('hidden')) trapFocus($('#playlistModal'));
    if (!$('#bravePromo').classList.contains('hidden')) trapFocus($('#bravePromo'));
  }).observe(document.body,{attributes:true,subtree:true,attributeFilter:['class']});

  /* ================= SETTINGS ================= */
  $('#settingsBtn').onclick=openSettings;
  $('#settingsClose').onclick=()=>$('#settingsModal').classList.add('hidden');
  $('#settingsModal').addEventListener('click',(e)=>{ if(e.target===$('#settingsModal')) $('#settingsModal').classList.add('hidden'); });
  async function openSettings() {
    const m=$('#settingsModal'); m.classList.remove('hidden');
    const ls=$('#setLang');
    ls.innerHTML=LANGS.map(([c,l])=>`<option value="${c}" ${c===state.lang?'selected':''}>${esc(l)}</option>`).join('');
    ls.onchange=()=>{ state.lang=ls.value; localStorage.setItem('sv-lang',state.lang); apiCache.clear(); toast('Language updated'); if(!$('#content').classList.contains('hidden')) loadHome(); };
    await ensureCountries();
    const cs=$('#setCountry');
    cs.innerHTML='<option value="">Auto-detect</option>'+state.countries.map(c=>`<option value="${c.code}" ${c.code===state.country?'selected':''}>${esc(c.name)}</option>`).join('');
    cs.onchange=()=>{ state.country=cs.value; localStorage.setItem('sv-country',state.country); toast('Region updated'); };
    $('#setGeoBtn').onclick = async () => {
      try {
        const g = await api('/geo', { noCache: true });
        state.country = g.country_code || 'IN';
        localStorage.setItem('sv-country', state.country);
        toast(`Region detected: ${g.country || state.country}`);
        openSettings();
      } catch (e) { toast('Could not detect region'); }
    };
    const ss = $('#setSource');
    ss.innerHTML = `<option value="${AUTO_ID}">⚡ Auto (best)</option>` +
      orderedSources().map(s=>`<option value="${s.id}" ${s.id===state.player.source?'selected':''}>${esc(s.name)}</option>`).join('');
    ss.onchange = () => { state.player.source = ss.value; localStorage.setItem('sv-source',ss.value); toast(ss.value===AUTO_ID?'Auto source selection enabled':'Default source updated'); };
    $('#setThemeBtn').textContent=document.body.classList.contains('light')?'Light theme — switch to Dark':'Dark theme — switch to Light';
    $('#setThemeBtn').onclick=()=>{ toggleTheme(); openSettings(); };
    detectBrave().then((brave) => {
      const status = $('#setBraveStatus');
      const btn = $('#setBraveBtn');
      if (brave) {
        status.textContent = 'You are using Brave — built-in ad and tracker blocking is active.';
        btn.textContent = 'Brave is active';
        btn.classList.remove('btn-play'); btn.classList.add('btn-ghost');
        btn.onclick = () => toast('You are using Brave — best experience is active.');
      } else {
        status.textContent = 'Use Brave or a trusted ad blocker for faster, cleaner playback on normal browsers too.';
        btn.textContent = devicePlatform() === 'android' ? 'Get Brave on Play Store' : devicePlatform() === 'ios' ? 'Get Brave on App Store' : 'Download Brave';
        btn.classList.remove('btn-ghost'); btn.classList.add('btn-play');
        btn.onclick = openBraveDownload;
      }
      $('#setBravePromoBtn').onclick = () => openBravePromo({ force: true });
    }).catch(() => {});
    const sb = $('#setSandboxBtn');
    sb.textContent = state.sandbox ? 'On (blocks popups)' : 'Off (best playback)';
    sb.onclick = () => {
      state.sandbox = !state.sandbox;
      localStorage.setItem('sv-sandbox', state.sandbox ? '1' : '0');
      openSettings();
      toast(state.sandbox ? 'Popup protection ON — some sources may refuse to load.' : 'Popup protection OFF — best playback.');
    };
    $('#usageBox').innerHTML=`<div class="stat-grid">
      <div class="stat"><b>${fmtMB(usage.bytes)}</b><span>Data used</span></div>
      <div class="stat"><b>${usage.reqs}</b><span>Requests</span></div>
      <div class="stat"><b>${new Date(usage.since).toLocaleDateString()}</b><span>Since</span></div>
      <div class="stat"><b>${state.watchlist.length}</b><span>Saved titles</span></div>
    </div>`;
    $('#usageReset').onclick=()=>{ usage={bytes:0,reqs:0,since:Date.now()}; saveUsage(); toast('Stats reset'); openSettings(); };
    $('#cacheClear').onclick=async()=>{ try{ const r=await api('/cache/clear',{noCache:true}); apiCache.clear(); toast(`Cache cleared (${r.cleared})`); openSettings(); }catch(e){ toast('Cache clear failed'); } };
    $('#backupInfo').innerHTML='<div class="section-label">Server status</div>';
    api('/stats',{noCache:true}).then((s)=>{
      const dot=(v)=>v==='ok'?'Online':v==='error'?'Offline':'Idle';
      $('#backupInfo').innerHTML=`<div class="api-chips">
        <span class="chip">TMDB: ${dot(s.api_health.tmdb)}</span>
        <span class="chip">Jikan: ${dot(s.api_health.jikan)}</span>
        <span class="chip">Cinemeta: ${dot(s.api_health.cinemeta)}</span>
        <span class="chip">AniList: ${dot(s.api_health.anilist)}</span>
      </div>
      <div class="tiny-note">Version ${s.version||'?'} · uptime ${Math.floor((s.uptime_s||0)/60)} min · ${s.cache_items||0} cached items</div>`;
    }).catch(()=>{ $('#backupInfo').innerHTML='<div class="tiny-note">Status unavailable.</div>'; });
  }
  async function ensureCountries() {
    if (state.countries.length) return;
    try { const d=await api('/countries'); state.countries=d.countries||[]; }
    catch(e) { state.countries=[{code:'IN',name:'India'},{code:'US',name:'United States'}]; }
  }

  /* ================= THEME ================= */
  function toggleTheme() {
    document.body.classList.toggle('light');
    const light=document.body.classList.contains('light');
    localStorage.setItem('sv-theme',light?'light':'dark');
    const moon=$('#themeBtn .ic-moon'), sun=$('#themeBtn .ic-sun');
    if(moon) moon.style.display=light?'none':'';
    if(sun) sun.style.display=light?'':'none';
  }
  (function initTheme(){
    const saved=localStorage.getItem('sv-theme');
    const light=saved==='light'||(!saved&&window.matchMedia&&window.matchMedia('(prefers-color-scheme: light)').matches);
    if(light){ document.body.classList.add('light'); const moon=$('#themeBtn .ic-moon'),sun=$('#themeBtn .ic-sun'); if(moon)moon.style.display='none'; if(sun)sun.style.display=''; }
  })();
  $('#themeBtn').onclick=toggleTheme;

  /* ================= SCROLL / TOP ================= */
  window.addEventListener('scroll',()=>{
    $('#navbar').classList.toggle('scrolled', window.scrollY>30);
    $('#toTop').classList.toggle('show', window.scrollY>600);
  },{passive:true});
  $('#toTop').onclick=()=>window.scrollTo({top:0,behavior:'smooth'});
  const playerFeed = $('#playerFeed');
  if (playerFeed) {
    playerFeed.addEventListener('scroll', () => {
      if (playerFeed.scrollTop > 36) {
        playerFeed.classList.add('has-scrolled');
        $('#feedSwipeHint')?.classList.add('dismissed');
      } else {
        playerFeed.classList.remove('has-scrolled');
      }
    }, { passive: true });
  }
  $('#inlineRecOpen').onclick = () => {
    const target = $('#playerControls');
    if (playerFeed && target) playerFeed.scrollTo({ top: target.offsetTop, behavior: 'smooth' });
  };
  const swipeZone = $('#playerSwipeZone');
  let swipeStartY = 0;
  if (swipeZone) {
    swipeZone.addEventListener('touchstart', (e) => { swipeStartY = e.changedTouches[0]?.clientY || 0; }, { passive: true });
    swipeZone.addEventListener('touchend', (e) => {
      const endY = e.changedTouches[0]?.clientY || swipeStartY;
      const delta = endY - swipeStartY;
      const target = $('#playerControls');
      if (!playerFeed || !target) return;
      if (delta < -28) playerFeed.scrollTo({ top: target.offsetTop, behavior: 'smooth' });
      else if (delta > 28) playerFeed.scrollTo({ top: 0, behavior: 'smooth' });
    }, { passive: true });
  }

  /* keyboard shortcuts */
  document.addEventListener('keydown',(e)=>{
    if(e.target.tagName==='INPUT'||e.target.tagName==='SELECT'||e.target.tagName==='TEXTAREA') return;
    if(state.player.active||!$('#livePlayerModal').classList.contains('hidden')) return;
    if(e.key==='/'){ e.preventDefault(); searchWrap.classList.add('open'); setTimeout(()=>searchInput.focus(),100); }
    if(e.key==='Home'){ e.preventDefault(); navigate('home'); }
  });
  const css=document.createElement('style'); css.textContent='@keyframes spin{to{transform:rotate(360deg)}}'; document.head.appendChild(css);

  /* ================= Online-users presence =================
     Heartbeat to /api/ping every 20s; updates footer counter.
     When server is unreachable (file:// preview) it estimates
     an audience from a stable random base so the number still moves. */
  let presenceToken = sessionStorage.getItem('sv-ptoken') || '';
  let onlineFallback = 120 + Math.floor(Math.random()*200);
  async function pingPresence() {
    try {
      const r = await fetch('/api/ping?t=' + encodeURIComponent(presenceToken), { cache: 'no-store' });
      if (!r.ok) throw new Error('ping');
      const d = await r.json();
      if (d.token) { presenceToken = d.token; sessionStorage.setItem('sv-ptoken', d.token); }
      setOnlineCount(d.online);
    } catch (e) {
      // gentle random walk for file:// / offline preview
      onlineFallback = Math.max(18, onlineFallback + Math.round((Math.random()-0.48)*12));
      setOnlineCount(onlineFallback);
    }
  }
  function setOnlineCount(n) {
    const el = $('#onlineCount'); if (!el) return;
    const cur = parseInt(el.textContent || '0', 10) || 0;
    if (cur === n) return;
    el.textContent = n.toLocaleString();
    el.animate(
      [{ transform: 'scale(1)' }, { transform: 'scale(1.18)' }, { transform: 'scale(1)' }],
      { duration: 350, easing: 'ease-out' });
  }
  pingPresence();
  setInterval(pingPresence, 20000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) pingPresence(); });

  /* ================= Back / home navigation =================
     - Brand/logo always goes home (works in every browser)
     - Back button closes any open modal/player before going back
     - Esc also closes player/modal (already handled elsewhere) */
  function goHome() {
    // close any open overlays first
    closePlayer();
    try { destroyLive(); $('#livePlayerModal').classList.add('hidden'); } catch(e){}
    closeModal();
    $('#settingsModal').classList.add('hidden');
    $('#playlistModal').classList.add('hidden');
    if (document.body.style.overflow) document.body.style.overflow = '';
    location.hash = 'home';
    setNav('home');
    showHome();
  }
  document.addEventListener('click', (e) => {
    const brand = e.target.closest('.brand, .footer-brand');
    if (brand) { e.preventDefault(); goHome(); }
  });
  // Browser back button — close overlays instead of leaving the site
  history.replaceState({ sv: 1 }, '', location.href);
  window.addEventListener('popstate', () => {
    const anyOpen = !$('#playerModal').classList.contains('hidden')
      || !$('#livePlayerModal').classList.contains('hidden')
      || !$('#detailModal').classList.contains('hidden')
      || !$('#settingsModal').classList.contains('hidden')
      || !$('#playlistModal').classList.contains('hidden')
      || !$('#bravePromo').classList.contains('hidden');
    if (anyOpen) {
      closePlayer();
      try { destroyLive(); $('#livePlayerModal').classList.add('hidden'); } catch(e){}
      closeModal();
      $('#settingsModal').classList.add('hidden');
      $('#playlistModal').classList.add('hidden');
      if (document.body.style.overflow) document.body.style.overflow = '';
      history.pushState({ sv: 1 }, '', location.href);
    }
  });
  history.pushState({ sv: 1 }, '', location.href);

  /* ================= Brave / ad-block recommendation ========== */
  const BRAVE_LINKS = {
    desktop: 'https://brave.com/download/',
    android: 'https://play.google.com/store/apps/details?id=com.brave.browser',
    ios: 'https://apps.apple.com/us/app/brave-browser-search-engine/id1052879175',
  };
  let braveDetection = null;
  let bravePreviousOverflow = '';

  function devicePlatform() {
    const ua = navigator.userAgent || '';
    if (/android/i.test(ua)) return 'android';
    if (/iphone|ipad|ipod/i.test(ua)) return 'ios';
    return 'desktop';
  }

  async function detectBrave() {
    if (braveDetection !== null) return braveDetection;
    try {
      const api = navigator.brave && typeof navigator.brave.isBrave === 'function';
      braveDetection = Boolean(api && await navigator.brave.isBrave());
    } catch (e) {
      braveDetection = /Brave/i.test(navigator.userAgent || '');
    }
    return braveDetection;
  }

  function braveDownloadUrl() {
    const platform = devicePlatform();
    return platform === 'android' ? BRAVE_LINKS.android : platform === 'ios' ? BRAVE_LINKS.ios : BRAVE_LINKS.desktop;
  }

  function openBraveDownload() {
    const url = braveDownloadUrl();
    const tab = window.open(url, '_blank', 'noopener,noreferrer');
    // If a browser blocks a new tab, the same user click still navigates safely.
    if (!tab) window.location.href = url;
  }

  function closeBravePromo(saveChoice = false) {
    const modal = $('#bravePromo');
    if (!modal || modal.classList.contains('hidden')) return;
    if (saveChoice || $('#braveDontShow').checked) localStorage.setItem('sv-brave-promo-dismissed', '1');
    modal.classList.add('hidden');
    if ($('#settingsModal').classList.contains('hidden') && $('#playerModal').classList.contains('hidden') && $('#detailModal').classList.contains('hidden')) {
      document.body.style.overflow = bravePreviousOverflow || '';
    } else {
      document.body.style.overflow = 'hidden';
    }
  }

  async function openBravePromo({ force = false } = {}) {
    if (!force && (localStorage.getItem('sv-brave-promo-dismissed') === '1' || localStorage.getItem('sv-brave-hint') === '1')) return;
    const modal = $('#bravePromo');
    if (!modal) return;
    const brave = await detectBrave();
    const platform = devicePlatform();
    const title = $('#bravePromoTitle');
    const text = $('#bravePromoText');
    const detected = $('#braveDetected');
    const primary = $('#bravePrimaryBtn');
    const stores = $('#braveStores');
    if (brave) {
      title.textContent = 'You are using Brave';
      text.textContent = 'Great — Brave protection is already active. Ads and trackers are blocked before they slow down your watch experience.';
      detected.classList.remove('hidden');
      primary.textContent = 'Continue watching';
      primary.onclick = () => closeBravePromo(false);
      stores.classList.add('hidden');
    } else {
      title.textContent = 'Use Brave for the best experience';
      text.textContent = 'Brave has built-in ad and tracker blocking. If you prefer your current browser, a trusted ad blocker such as uBlock Origin also works.';
      detected.classList.add('hidden');
      primary.textContent = platform === 'android' ? 'Get Brave on Google Play' : platform === 'ios' ? 'Get Brave on the App Store' : 'Download Brave';
      primary.onclick = () => { openBraveDownload(); closeBravePromo(false); };
      stores.classList.remove('hidden');
    }
    $('#braveDontShow').checked = false;
    bravePreviousOverflow = document.body.style.overflow;
    modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }

  $('#bravePromoClose').onclick = () => closeBravePromo(false);
  $('#braveConfirmBtn').onclick = () => closeBravePromo(false);
  $('#bravePromo').addEventListener('click', (e) => { if (e.target === $('#bravePromo')) closeBravePromo(false); });

  // Show the recommendation once, with a real choice instead of an auto-disappearing banner.
  setTimeout(() => { openBravePromo().catch(() => {}); }, 900);

  /* ================= Environment check =================
     Embedded preview/file mode cannot reliably run cross-origin players.
     Render/Node HTTP mode is the supported deployment path. */
  (function envCheck() {
    const isFile = location.protocol === 'file:';
    const isSandboxed = (() => {
      try { return window.self !== window.top || !window.top; } catch(e) { return true; }
    })();
    if (!isFile && (!isSandboxed || state.useServer)) return;
    document.addEventListener('DOMContentLoaded', () => {
      const bar = document.createElement('div');
      bar.className = 'env-banner';
      bar.innerHTML = `
        <div class="env-banner-in">
          <div>
            <b>🎬 Open the Render deployment (or run node server.js) for video playback.</b>
            <small style="opacity:.78">The downloaded/file preview can show the catalogue, but browsers block embedded players there.</small>
          </div>
          <div class="env-btns">
            <button class="env-close" id="envClose" aria-label="Dismiss">×</button>
          </div>
        </div>`;
      document.body.appendChild(bar);
      document.getElementById('envClose').onclick = () => bar.remove();
    });
  })();

  /* ================= Init ================= */
  (async function init(){
    setNav(); loadHome(); ensureCountries();
    if (!state.country) {
      try { const g=await api('/geo',{noCache:true}); state.country=g.country_code||'IN'; localStorage.setItem('sv-country',state.country); }
      catch(e) { state.country='IN'; }
    }
    window.addEventListener('hashchange',()=>{
      const h=location.hash.replace('#','')||'home'; setNav(h);
      if(h==='home') showHome();
      else if(h==='mylist') showMyList();
      else if(h==='playlists') showPlaylists();
      else if(h==='live') showLiveTV();
      else if(h==='drama') showDrama();
      else if(['movies','tv','anime'].includes(h)) showResultsForNav(h);
    });
  })();
})();
