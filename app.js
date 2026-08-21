/* ============================================================
   StreamVerse v5.2 — client
   ============================================================ */
(() => {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const IMG = 'https://image.tmdb.org/t/p/w500';
  const BACKDROP = 'https://image.tmdb.org/t/p/w1280';
  const CAST_IMG = 'https://image.tmdb.org/t/p/w185';

  const LANGS = [
    ['', 'Original'], ['en-US', 'English'], ['hi-IN', 'Hindi'],
    ['ta-IN', 'Tamil'], ['te-IN', 'Telugu'], ['ml-IN', 'Malayalam'],
    ['kn-IN', 'Kannada'], ['bn-IN', 'Bengali'], ['mr-IN', 'Marathi'],
    ['ja-JP', 'Japanese'], ['ko-KR', 'Korean'], ['zh-CN', 'Chinese'],
    ['es-ES', 'Spanish'], ['fr-FR', 'French'], ['de-DE', 'German'],
    ['pt-BR', 'Portuguese'], ['ru-RU', 'Russian'], ['ar-SA', 'Arabic'],
  ];

  const state = {
    heroItems: [], heroIndex: 0, heroTimer: null, heroPaused: false,
    detail: null,
    lang: localStorage.getItem('sv-lang') || 'en-US',
    region: localStorage.getItem('sv-region') || '',
    country: localStorage.getItem('sv-country') || '',
    countries: [],
    watchlist: JSON.parse(localStorage.getItem('sv-watchlist') || '[]'),
    continue: JSON.parse(localStorage.getItem('sv-continue') || '[]'),
    browse: { page: 1, totalPages: 1, kind: 'movie', genre: 0, loading: false, apiPath: '' },
  };

  let usage = JSON.parse(localStorage.getItem('sv-usage') || 'null') || { bytes: 0, reqs: 0, since: Date.now() };
  const saveUsage = () => localStorage.setItem('sv-usage', JSON.stringify(usage));
  const fmtMB = (b) => (b / 1048576).toFixed(2) + ' MB';

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const STAR = `<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" style="display:inline-block;vertical-align:-1px"><path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/></svg>`;
  const CHECK = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`;
  const PLUS = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>`;
  const PLAY_SM = `<svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;

  const apiCache = new Map();
  let networkBanner = false;

  async function api(p, { noCache = false } = {}) {
    const sep = p.includes('?') ? '&' : '?';
    const url = p + (state.lang ? `${sep}lang=${encodeURIComponent(state.lang)}` : '');
    if (!noCache) {
      const hit = apiCache.get(url);
      if (hit && Date.now() - hit.t < 4 * 60 * 1000) return hit.v;
    }
    let r;
    try { r = await fetch('/api' + url); }
    catch (e) { showNetworkBanner(); throw new Error('network offline'); }
    if (!r.ok) {
      let msg = 'HTTP ' + r.status;
      try { const j = await r.json(); if (j && j.error) msg = j.error; } catch (e) {}
      throw new Error(msg);
    }
    const data = await r.json();
    usage.reqs++;
    try { usage.bytes += parseInt(r.headers.get('content-length') || '0', 10) || 0; } catch (e) {}
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
    b.textContent = 'Could not connect to the server. Check your internet and refresh.';
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
    const h = Math.floor(m / 60); const min = m % 60;
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
  const stillPlaceholder = () =>
    'data:image/svg+xml;utf8,' + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="135"><rect width="100%" height="100%" fill="#15151f"/></svg>');

  function matchScore(m) {
    if (!m.vote_average) return null;
    return Math.min(99, Math.round(m.vote_average * 9.5 + 5));
  }
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

  /* ================= watchlist + continue ================= */
  function inWatchlist(id, media) {
    return state.watchlist.some((x) => x.id === id && x.media === media);
  }
  function toggleWatchlist(item) {
    const id = item.id; const media = item.media_type || mediaOf(item);
    const idx = state.watchlist.findIndex((x) => x.id === id && x.media === media);
    if (idx >= 0) {
      state.watchlist.splice(idx, 1);
      toast('Removed from My List');
    } else {
      state.watchlist.unshift({
        id, media, title: titleOf(item),
        poster: item.poster_path || '', backdrop: item.backdrop_path || '',
        vote_average: item.vote_average || 0,
        release_date: item.release_date || item.first_air_date || '',
        addedAt: Date.now(),
      });
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
    const btn = card.querySelector('.wl-btn');
    if (!btn) return;
    const on = inWatchlist(card.dataset.id, card.dataset.media);
    btn.classList.toggle('in-list', on);
    btn.innerHTML = on ? CHECK : PLUS;
  }
  function recordContinue(item) {
    const id = item.id; const media = item.media_type || mediaOf(item);
    const entry = {
      id, media, title: titleOf(item),
      poster: item.poster_path || '', backdrop: item.backdrop_path || '',
      vote_average: item.vote_average || 0,
      release_date: item.release_date || item.first_air_date || '',
      progress: Math.round(20 + Math.random() * 70),
      at: Date.now(),
    };
    const idx = state.continue.findIndex((x) => x.id === id && x.media === media);
    if (idx >= 0) state.continue.splice(idx, 1);
    state.continue.unshift(entry);
    state.continue = state.continue.slice(0, 12);
    localStorage.setItem('sv-continue', JSON.stringify(state.continue));
    renderContinueRow();
  }

  /* ================= cards ================= */
  function tmdbCard(m) {
    const el = document.createElement('div');
    el.className = 'card';
    el.tabIndex = 0;
    el.setAttribute('role', 'button');
    const media = mediaOf(m);
    el.dataset.id = m.id; el.dataset.media = media;
    const t = esc(titleOf(m));
    const badge = media === 'tv' ? '<span class="card-badge tv">TV</span>'
      : (m.media_type === 'movie' ? '<span class="card-badge">MOVIE</span>' : '');
    const rating = m.vote_average ? `<span class="card-rating" aria-label="Rated ${m.vote_average.toFixed(1)} out of 10">${STAR} ${m.vote_average.toFixed(1)}</span>` : '';
    const onList = inWatchlist(m.id, media);
    el.innerHTML = `
      <img class="card-poster" loading="lazy" src="${esc(posterUrl(m.poster_path))}" alt="${t}" onerror="this.onerror=null;this.src='${placeholderPoster()}'">
      ${badge}
      ${rating}
      <div class="card-actions">
        <button class="card-action wl-btn ${onList ? 'in-list' : ''}" data-id="${m.id}" data-media="${media}" title="${onList ? 'In My List' : 'Add to My List'}" aria-label="Toggle list">${onList ? CHECK : PLUS}</button>
      </div>
      <div class="card-info">
        <div class="card-title">${t}</div>
        <div class="card-sub">
          <span class="yr">${year(m.release_date || m.first_air_date || '')}</span>
          <span class="dot"></span>
          <span>${media === 'tv' ? 'Series' : 'Film'}</span>
        </div>
      </div>
      <div class="card-hover-bar">
        <button class="mini-btn play" data-action="play">${PLAY_SM} Play</button>
        <button class="mini-btn" data-action="info">Details</button>
      </div>`;
    el.onclick = (e) => {
      if (e.target.closest('.wl-btn')) { toggleWatchlist(m); return; }
      if (e.target.closest('[data-action="play"]')) { openDetail(media, m.id, titleOf(m), { autoplay: true }); return; }
      openDetail(media, m.id, titleOf(m));
    };
    el.onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(media, m.id, titleOf(m)); }
    };
    return el;
  }

  function animeCard(a) {
    const el = document.createElement('div');
    el.className = 'card';
    el.tabIndex = 0; el.setAttribute('role', 'button');
    const img = (a.images && a.images.jpg && (a.images.jpg.large_image_url || a.images.jpg.image_url)) || '';
    const t = esc(titleOf(a));
    const yr = a.year ? String(a.year) : (a.aired && a.aired.from ? year(a.aired.from) : '');
    const score = a.score || a.rating || 0;
    const onList = inWatchlist(a.mal_id, 'anime');
    el.dataset.id = a.mal_id; el.dataset.media = 'anime';
    el.innerHTML = `
      <img class="card-poster" loading="lazy" src="${esc(img || placeholderPoster())}" alt="${t}" onerror="this.onerror=null;this.src='${placeholderPoster()}'">
      <span class="card-badge anime">ANIME</span>
      ${score ? `<span class="card-rating">${STAR} ${Number(score).toFixed(1)}</span>` : ''}
      <div class="card-actions">
        <button class="card-action wl-btn ${onList ? 'in-list' : ''}" data-id="${a.mal_id}" data-media="anime" title="Add to My List" aria-label="Toggle list">${onList ? CHECK : PLUS}</button>
      </div>
      <div class="card-info">
        <div class="card-title">${t}</div>
        <div class="card-sub">
          <span class="yr">${yr || '—'}</span><span class="dot"></span><span>Anime</span>
        </div>
      </div>
      <div class="card-hover-bar">
        <button class="mini-btn play" data-action="play">${PLAY_SM} Play</button>
        <button class="mini-btn" data-action="info">Details</button>
      </div>`;
    el.onclick = (e) => {
      if (e.target.closest('.wl-btn')) {
        toggleWatchlist({ id: a.mal_id, media_type: 'anime', title: titleOf(a), poster_path: img ? img.replace(/^https?:\/\//, '') : '' });
        return;
      }
      openAnimeDetail(a.mal_id, img, titleOf(a), e.target.closest('[data-action="play"]'));
    };
    el.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openAnimeDetail(a.mal_id, img, titleOf(a)); } };
    return el;
  }

  function continueCard(c) {
    const el = document.createElement('div');
    el.className = 'card';
    el.tabIndex = 0; el.setAttribute('role', 'button');
    el.dataset.id = c.id; el.dataset.media = c.media;
    const t = esc(c.title);
    const onList = inWatchlist(c.id, c.media);
    el.innerHTML = `
      <img class="card-poster" loading="lazy" src="${esc(posterUrl(c.poster))}" alt="${t}" onerror="this.onerror=null;this.src='${placeholderPoster()}'">
      ${c.media === 'anime' ? '<span class="card-badge anime">ANIME</span>' : (c.media === 'tv' ? '<span class="card-badge tv">TV</span>' : '<span class="card-badge">MOVIE</span>')}
      ${c.vote_average ? `<span class="card-rating">${STAR} ${Number(c.vote_average).toFixed(1)}</span>` : ''}
      <div class="card-actions">
        <button class="card-action wl-btn ${onList ? 'in-list' : ''}" data-id="${c.id}" data-media="${c.media}">${onList ? CHECK : PLUS}</button>
      </div>
      <div class="card-info">
        <div class="card-title">${t}</div>
        <div class="card-sub"><span>${year(c.release_date)}</span><span class="dot"></span><span>${Math.round(c.progress)}% watched</span></div>
      </div>
      <div class="card-hover-bar">
        <button class="mini-btn play" data-action="play">${PLAY_SM} Resume</button>
        <button class="mini-btn" data-action="info">Details</button>
      </div>`;
    el.onclick = (e) => {
      if (e.target.closest('.wl-btn')) { toggleWatchlist(c); return; }
      if (c.media === 'anime') openAnimeDetail(c.id, null, c.title, e.target.closest('[data-action="play"]'));
      else openDetail(c.media, c.id, c.title, { autoplay: !!e.target.closest('[data-action="play"]') });
    };
    return el;
  }

  /* ================= rows ================= */
  function fillRow(rowId, items, fn) {
    const row = document.getElementById(rowId);
    if (!row) return;
    row.innerHTML = '';
    const frag = document.createDocumentFragment();
    items.slice(0, 20).forEach((it) => frag.appendChild(fn(it)));
    row.appendChild(frag);
  }
  function skelRow(rowId, n = 14) {
    const row = document.getElementById(rowId);
    if (!row) return;
    row.innerHTML = '';
    for (let i = 0; i < n; i++) {
      const s = document.createElement('div');
      s.className = 'skel-card skel';
      row.appendChild(s);
    }
  }
  function rowError(rowId, retryFn) {
    const row = document.getElementById(rowId);
    if (!row) return;
    row.innerHTML = '';
    const d = document.createElement('div');
    d.className = 'row-error';
    d.innerHTML = '<span>Could not load right now.</span>';
    const b = document.createElement('button');
    b.textContent = 'Retry';
    b.onclick = retryFn;
    d.appendChild(b);
    row.appendChild(d);
  }
  function loadRow(apiPath, rowId, cardFn) {
    const tryLoad = () => {
      skelRow(rowId);
      api(apiPath)
        .then((data) => {
          const items = data.items || data.data || data.results || [];
          if (items.length) fillRow(rowId, items.slice(0, 20), cardFn);
          else rowError(rowId, tryLoad);
        })
        .catch(() => rowError(rowId, tryLoad));
    };
    tryLoad();
  }

  function loadHome() {
    [
      'rowTrendingRow', 'rowPopularRow', 'rowTopRatedRow', 'rowTvRow', 'rowTvTopRow',
      'rowAnimeRow', 'rowAiringRow', 'rowUpcomingRow', 'rowHorrorRow', 'rowComedyRow', 'rowActionRow',
    ].forEach((id) => skelRow(id));
    renderContinueRow();

    api('/trending').then((tr) => {
      const results = (tr.results || []).filter((x) => x.backdrop_path || x.poster_path);
      state.heroItems = results.slice(0, 8);
      fillRow('rowTrendingRow', state.heroItems.length ? state.heroItems : results.slice(0, 20), tmdbCard);
      $('#rowTrendingCount').textContent = state.heroItems.length ? `Top ${state.heroItems.length} picks` : '';
      if (state.heroItems.length) initHero();
      else { $('#heroTitle').textContent = 'StreamVerse'; $('#heroDesc').textContent = 'Discover movies, TV shows and anime.'; }
    }).catch(() => {
      rowError('rowTrendingRow', loadHome);
      $('#heroTitle').textContent = 'StreamVerse';
      $('#heroDesc').textContent = 'Discover movies, TV shows and anime.';
    });

    loadRow('/movie/popular', 'rowPopularRow', tmdbCard);
    loadRow('/movie/top_rated', 'rowTopRatedRow', tmdbCard);
    loadRow('/tv/popular', 'rowTvRow', tmdbCard);
    loadRow('/tv/top_rated', 'rowTvTopRow', tmdbCard);
    loadRow('/movie/upcoming', 'rowUpcomingRow', tmdbCard);
    loadRow('/movie/genre?g=27', 'rowHorrorRow', tmdbCard);
    loadRow('/movie/genre?g=35', 'rowComedyRow', tmdbCard);
    loadRow('/movie/genre?g=28', 'rowActionRow', tmdbCard);
    loadRow('/anime/top', 'rowAnimeRow', animeCard);
    loadRow('/anime/topairing', 'rowAiringRow', animeCard);
  }

  function renderContinueRow() {
    const section = document.querySelector('[data-row="continue"]');
    if (!state.continue.length) { section.hidden = true; return; }
    section.hidden = false;
    fillRow('rowContinueRow', state.continue, continueCard);
  }

  /* ================= hero ================= */
  function initHero() {
    if (!state.heroItems.length) return;
    renderHero(false);
    clearInterval(state.heroTimer);
    state.heroTimer = setInterval(() => { if (!state.heroPaused) nextHero(); }, 7500);
    $('#heroNext').onclick = () => { nextHero(); resetTimer(); };
    $('#heroPrev').onclick = () => { prevHero(); resetTimer(); };
    const hero = $('#hero');
    hero.onmouseenter = () => { state.heroPaused = true; };
    hero.onmouseleave = () => { state.heroPaused = false; };
    buildHeroDots();
  }
  function buildHeroDots() {
    const wrap = $('#heroDots');
    wrap.innerHTML = '';
    state.heroItems.forEach((_, i) => {
      const b = document.createElement('button');
      b.setAttribute('aria-label', `Slide ${i + 1}`);
      b.onclick = () => { state.heroIndex = i; renderHero(true); resetTimer(); };
      wrap.appendChild(b);
    });
  }
  function resetTimer() {
    clearInterval(state.heroTimer);
    state.heroTimer = setInterval(() => { if (!state.heroPaused) nextHero(); }, 7500);
  }
  function renderHero(animate = true) {
    const it = state.heroItems[state.heroIndex];
    if (!it) return;
    const media = mediaOf(it);
    const bg = $('#heroBg');
    const url = backdropUrl(it.backdrop_path || it.poster_path);
    const apply = () => {
      bg.style.backgroundImage = `url(${url})`;
      bg.classList.add('loaded');
      setTimeout(() => bg.classList.add('zoom'), 80);
    };
    if (animate) {
      bg.classList.remove('loaded', 'zoom');
      bg.style.opacity = 0;
      setTimeout(() => { bg.style.opacity = ''; apply(); }, 300);
    } else apply();

    const tags = $('#heroTags');
    const match = matchScore(it);
    tags.innerHTML =
      `<span class="hero-tag">Featured</span>` +
      `<span class="hero-tag gold">${media === 'tv' ? 'Series' : 'Film'}</span>` +
      (match ? `<span class="hero-tag">${match}% Match</span>` : '');

    $('#heroTitle').textContent = titleOf(it);
    const cert = certificationOf(it);
    $('#heroMeta').innerHTML =
      `<span class="match">${match ? match + '% Match' : 'New'}</span>` +
      `<span>${year(it.release_date || it.first_air_date)}</span>` +
      (cert ? `<span class="chip" style="padding:2px 8px">${esc(cert)}</span>` : '') +
      `<span>${media === 'tv' ? 'TV Series' : 'Movie'}</span>` +
      (it.vote_average ? `<span class="rating">${STAR} ${it.vote_average.toFixed(1)}</span>` : '');
    $('#heroDesc').textContent = it.overview || '';
    if (animate) {
      const hc = $('#heroContent');
      hc.classList.remove('hero-anim'); void hc.offsetWidth; hc.classList.add('hero-anim');
    }
    $$('#heroDots button').forEach((b, i) => b.classList.toggle('active', i === state.heroIndex));
    const onList = inWatchlist(it.id, media);
    const listBtn = $('#heroList');
    listBtn.classList.toggle('active', onList);
    listBtn.innerHTML = onList ? CHECK : PLUS;
    listBtn.title = onList ? 'In My List' : 'Add to My List';
    listBtn.onclick = () => toggleWatchlist(it);
    $('#heroPlay').onclick = () => { recordContinue(it); openDetail(media, it.id, titleOf(it), { autoplay: true }); };
    $('#heroInfo').onclick = () => openDetail(media, it.id, titleOf(it));
  }
  function nextHero() { if (!state.heroItems.length) return; state.heroIndex = (state.heroIndex + 1) % state.heroItems.length; renderHero(true); }
  function prevHero() { if (!state.heroItems.length) return; state.heroIndex = (state.heroIndex - 1 + state.heroItems.length) % state.heroItems.length; renderHero(true); }

  /* ================= nav ================= */
  function setNav(nav) {
    const hash = (nav || location.hash.replace('#', '') || 'home').toLowerCase();
    $$('#navLinks a, #mobileMenu a').forEach((a) => a.classList.toggle('active', a.dataset.nav === hash));
  }
  function showHome() {
    $('#resultsView').classList.add('hidden');
    $('#mylistView').classList.add('hidden');
    $('#content').classList.remove('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    closeMobileMenu();
  }
  function closeMobileMenu() {
    $('#hamburger').classList.remove('open');
    $('#mobileMenu').classList.remove('open');
    $('#navbar').classList.remove('menu-open');
    $('#hamburger').setAttribute('aria-expanded', 'false');
  }
  $$('#navLinks a').forEach((a) => {
    a.onclick = (e) => { e.preventDefault(); navigate(a.dataset.nav); };
  });
  const mm = $('#mobileMenu');
  $$('#navLinks a').forEach((a) => {
    const b = document.createElement('a');
    b.href = '#' + a.dataset.nav; b.dataset.nav = a.dataset.nav; b.textContent = a.textContent;
    b.onclick = (e) => { e.preventDefault(); navigate(a.dataset.nav); };
    mm.appendChild(b);
  });
  $$('.footer-links a').forEach((a) => {
    a.onclick = (e) => { e.preventDefault(); navigate(a.dataset.nav); };
  });
  $('#hamburger').onclick = () => {
    const open = $('#hamburger').classList.toggle('open');
    $('#mobileMenu').classList.toggle('open', open);
    $('#navbar').classList.toggle('menu-open', open);
    $('#hamburger').setAttribute('aria-expanded', open ? 'true' : 'false');
  };

  function navigate(nav) {
    location.hash = nav;
    setNav(nav);
    closeMobileMenu();
    if (nav === 'home') showHome();
    else if (nav === 'mylist') showMyList();
    else showResultsForNav(nav);
  }

  function showResultsForNav(nav) {
    $('#content').classList.add('hidden');
    $('#mylistView').classList.add('hidden');
    $('#resultsView').classList.remove('hidden');
    window.scrollTo({ top: 0 });
    const titles = { movies: 'Movies', tv: 'TV Shows', anime: 'Anime' };
    $('#resultsTitle').textContent = titles[nav] || 'Browse';
    $('#resultsEmpty').classList.add('hidden');
    $('#resultsMore').classList.add('hidden');
    const grid = $('#resultsGrid');
    grid.innerHTML = '';
    for (let i = 0; i < 18; i++) { const s = document.createElement('div'); s.className = 'skel-card skel'; grid.appendChild(s); }

    state.browse.kind = nav === 'anime' ? 'anime' : (nav === 'tv' ? 'tv' : 'movie');
    state.browse.genre = 0;
    state.browse.page = 1;

    renderGenreChips(nav);
    if (nav === 'movies') loadBrowsePage('/movie/popular');
    else if (nav === 'tv') loadBrowsePage('/tv/popular');
    else if (nav === 'anime') loadBrowsePage('/anime/top', true);
  }

  function loadBrowsePage(apiPath, isAnime = false, append = false) {
    state.browse.loading = true;
    state.browse.apiPath = apiPath;
    const grid = $('#resultsGrid');
    if (!append) {
      grid.innerHTML = '';
      for (let i = 0; i < 18; i++) { const s = document.createElement('div'); s.className = 'skel-card skel'; grid.appendChild(s); }
    }
    $('#resultsMore').classList.add('hidden');
    api(apiPath + (apiPath.includes('?') ? '&' : '?') + 'page=' + state.browse.page)
      .then((d) => {
        if (!append) grid.innerHTML = '';
        const items = isAnime ? (d.data || []) : (d.results || []);
        if (!items.length && !append) { $('#resultsEmpty').classList.remove('hidden'); return; }
        $('#resultsEmpty').classList.add('hidden');
        items.forEach((it) => grid.appendChild(isAnime ? animeCard(it) : tmdbCard(it)));
        state.browse.totalPages = Math.min(isAnime ? ((d.pagination && d.pagination.last_visible_page) || 1) : (d.total_pages || 1), 20);
        if (state.browse.page < state.browse.totalPages) $('#resultsMore').classList.remove('hidden');
      })
      .catch(() => { if (!append) grid.innerHTML = '<div class="results-empty">Could not load. Try again.</div>'; })
      .finally(() => { state.browse.loading = false; });
  }
  $('#resultsMore').onclick = () => {
    if (state.browse.loading) return;
    state.browse.page++;
    const isAnime = state.browse.kind === 'anime';
    let path = state.browse.apiPath.split('?')[0];
    if (state.browse.genre) path += (isAnime ? `/anime/genre?g=${state.browse.genre.mal_id}&name=${encodeURIComponent(state.browse.genre.name)}` : `/${state.browse.kind}/genre?g=${state.browse.genre}`);
    loadBrowsePage(path, isAnime, true);
  };
  $('#resultsBack').onclick = () => navigate('home');

  /* ================= genres ================= */
  async function renderGenreChips(nav) {
    const wrap = $('#genreChips');
    wrap.innerHTML = ''; wrap.classList.remove('hidden');
    const mk = (label, fn, active = false) => {
      const b = document.createElement('button');
      b.className = 'cat-chip' + (active ? ' active' : '');
      b.textContent = label;
      b.onclick = () => {
        $$('#genreChips .cat-chip').forEach((x) => x.classList.remove('active'));
        b.classList.add('active');
        state.browse.page = 1;
        fn();
      };
      wrap.appendChild(b);
      return b;
    };
    if (nav === 'movies' || nav === 'tv') {
      const media = nav === 'tv' ? 'tv' : 'movie';
      state.browse.kind = media;
      mk('All', () => loadBrowsePage(`/${media}/popular`), true);
      try {
        const g = await api('/genres?media=' + media);
        (g.genres || []).forEach((x) => {
          mk(x.name, () => { state.browse.genre = x.id; loadBrowsePage(`/${media}/genre?g=${x.id}`); });
        });
      } catch (e) {}
    } else if (nav === 'anime') {
      state.browse.kind = 'anime';
      mk('Top All', () => loadBrowsePage('/anime/top', true), true);
      try {
        const g = await api('/anime/genres');
        (g.genres || []).slice(0, 18).forEach((x) => {
          mk(x.name, () => { state.browse.genre = x; loadBrowsePage(`/anime/genre?g=${x.mal_id}&name=${encodeURIComponent(x.name)}`, true); });
        });
      } catch (e) {}
    } else wrap.classList.add('hidden');
  }

  /* ================= search ================= */
  const searchWrap = $('#searchWrap');
  const searchInput = $('#searchInput');
  $('#searchToggle').onclick = () => {
    searchWrap.classList.toggle('open');
    if (searchWrap.classList.contains('open')) setTimeout(() => searchInput.focus(), 200);
    else searchInput.value = '';
  };
  document.addEventListener('click', (e) => {
    if (!searchWrap.classList.contains('open')) return;
    if (e.target.closest('.search-wrap') || e.target.closest('.search-toggle')) return;
    if (!searchInput.value) searchWrap.classList.remove('open');
  });

  let searchAbort;
  searchInput.addEventListener('input', (e) => {
    const q = e.target.value.trim();
    searchWrap.classList.toggle('has-value', !!q);
    clearTimeout(searchAbort);
    if (!q) return;
    searchAbort = setTimeout(() => doSearch(q), 350);
  });
  searchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(searchInput.value.trim()); if (e.key === 'Escape') { searchInput.value = ''; searchInput.blur(); } });
  $('#searchClear').onclick = () => {
    searchInput.value = '';
    searchWrap.classList.remove('has-value');
    searchInput.focus();
  };

  async function doSearch(q) {
    if (!q) return;
    $('#content').classList.add('hidden');
    $('#mylistView').classList.add('hidden');
    $('#resultsView').classList.remove('hidden');
    $('#genreChips').classList.add('hidden');
    $('#resultsMore').classList.add('hidden');
    $('#resultsTitle').textContent = `Results for “${q}”`;
    const grid = $('#resultsGrid');
    grid.innerHTML = '';
    for (let i = 0; i < 18; i++) { const s = document.createElement('div'); s.className = 'skel-card skel'; grid.appendChild(s); }
    window.scrollTo({ top: 0 });
    try {
      const r = await api('/search?q=' + encodeURIComponent(q));
      grid.innerHTML = '';
      const items = (r.results || []).filter((x) => x.media_type === 'movie' || x.media_type === 'tv' || (!x.media_type && (x.title || x.name)));
      if (items.length) items.slice(0, 30).forEach((it) => grid.appendChild(tmdbCard(it)));
      api('/anime/search?q=' + encodeURIComponent(q)).then((ar) => {
        (ar.data || []).slice(0, 12).forEach((a) => grid.appendChild(animeCard(a)));
        if (!grid.children.length) $('#resultsEmpty').classList.remove('hidden');
        else $('#resultsEmpty').classList.add('hidden');
      }).catch(() => {
        if (!grid.children.length) $('#resultsEmpty').classList.remove('hidden');
      });
      if (!items.length) $('#resultsEmpty').classList.remove('hidden');
    } catch (e) {
      grid.innerHTML = '<div class="results-empty">Search failed: ' + esc(e.message) + '</div>';
    }
  }

  /* ================= My List ================= */
  function showMyList() {
    $('#content').classList.add('hidden');
    $('#resultsView').classList.add('hidden');
    $('#mylistView').classList.remove('hidden');
    window.scrollTo({ top: 0 });
    closeMobileMenu();
    renderMyList();
  }
  function renderMyList() {
    const grid = $('#mylistGrid');
    grid.innerHTML = '';
    if (!state.watchlist.length) { $('#mylistEmpty').classList.remove('hidden'); return; }
    $('#mylistEmpty').classList.add('hidden');
    state.watchlist.forEach((it) => {
      const m = {
        id: it.id, media_type: it.media, title: it.title, name: it.title,
        poster_path: it.poster, backdrop_path: it.backdrop, vote_average: it.vote_average,
        release_date: it.release_date, first_air_date: it.release_date,
      };
      if (it.media === 'anime') {
        grid.appendChild(animeCard({
          mal_id: it.id, title: it.title, title_english: it.title,
          images: { jpg: { image_url: posterUrl(it.poster) } }, score: it.vote_average,
          year: year(it.release_date),
        }));
      } else grid.appendChild(tmdbCard(m));
    });
  }

  /* ================= detail modal ================= */
  async function openDetail(media, id, fallbackTitle, opts = {}) {
    showModal();
    const body = $('#modalBody');
    body.innerHTML = '<div class="skel" style="height:220px;border-radius:14px;margin-bottom:90px"></div>';
    try {
      const d = await api('/details?media=' + media + '&id=' + encodeURIComponent(id));
      state.detail = { media, id: d.id || id, title: d.title || d.name || fallbackTitle };
      renderDetail(d, opts);
    } catch (e) {
      body.innerHTML = '<div class="section-label" style="color:#ff8690">Could not load details.</div>';
    }
  }

  function renderDetail(d, opts = {}) {
    const body = $('#modalBody');
    const media = state.detail.media;
    const isTv = media === 'tv' || !!d.number_of_seasons;
    const genres = (d.genres || []).map((g) => `<span class="chip">${esc(g.name)}</span>`).join('');
    const rating = d.vote_average ? Number(d.vote_average).toFixed(1) : '—';
    const match = matchScore(d);
    const cert = certificationOf({ ...d, media_type: media });
    const backdrop = backdropUrl(d.backdrop_path || d.poster_path || '');
    const runtime = d.runtime ? `<span>${runtimeFmt(d.runtime)}</span>` : '';
    const seasons = d.number_of_seasons ? `<span>${d.number_of_seasons} season${d.number_of_seasons > 1 ? 's' : ''}</span>` : '';
    $('#modalBackdrop').style.backgroundImage = backdrop ? `url(${backdrop})` : 'none';
    const onList = inWatchlist(d.id, media);
    body.innerHTML = `
      <h2 class="modal-title" id="modalTitle">${esc(d.title || d.name)}</h2>
      <div class="modal-meta">
        ${match ? `<span class="match">${match}% Match</span>` : ''}
        <span>${year(d.release_date || d.first_air_date)}</span>
        ${cert ? `<span class="chip" style="padding:2px 9px">${esc(cert)}</span>` : ''}
        ${runtime}
        ${seasons}
        ${d.status ? `<span>${esc(d.status)}</span>` : ''}
        <span class="rating" style="color:var(--gold);font-weight:800">${STAR} ${rating}</span>
      </div>
      <div class="modal-genres">${genres}</div>
      <p class="modal-desc">${esc(d.overview || 'No synopsis available.')}</p>
      <div class="modal-actions">
        <button class="btn btn-play" id="detailPlay">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
          Play
        </button>
        <button class="btn btn-ghost" id="detailList">${onList ? 'In My List' : 'My List'}</button>
      </div>
      <div id="detailExtra"></div>`;
    $('#detailPlay').onclick = () => {
      recordContinue(d);
      openPlayer({ title: d.title || d.name, media, id: d.id, backdrop: backdropUrl(d.backdrop_path || d.poster_path) });
    };
    $('#detailList').onclick = () => {
      toggleWatchlist({ ...d, id: d.id, media_type: media });
      const b = $('#detailList');
      setTimeout(() => { b.textContent = inWatchlist(d.id, media) ? 'In My List' : 'My List'; }, 0);
    };

    renderDetailExtra(d, isTv);
    if (opts.autoplay) {
      setTimeout(() => {
        recordContinue(d);
        openPlayer({ title: d.title || d.name, media, id: d.id, backdrop: backdropUrl(d.backdrop_path || d.poster_path) });
      }, 250);
    }
  }

  async function renderDetailExtra(d, isTv) {
    const wrap = $('#detailExtra');
    if (isTv && d.number_of_seasons) {
      const seasonsBlock = document.createElement('div');
      seasonsBlock.innerHTML = `<div class="section-label">Seasons</div><div class="season-tabs" id="seasonTabs"></div><div class="ep-list" id="epList"></div>`;
      wrap.appendChild(seasonsBlock);
      const seasonList = (d.seasons || []).filter((s) => s.season_number > 0).sort((a, b) => a.season_number - b.season_number);
      const tabs = $('#seasonTabs');
      if (!seasonList.length) seasonList.push({ season_number: 1, name: 'Season 1', episode_count: 0 });
      seasonList.forEach((s) => {
        const b = document.createElement('button');
        b.className = 'season-tab' + (s.season_number === 1 ? ' active' : '');
        b.textContent = `Season ${s.season_number}`;
        b.title = `${s.episode_count || '?'} episodes`;
        b.onclick = () => {
          $$('#seasonTabs .season-tab').forEach((x) => x.classList.remove('active'));
          b.classList.add('active');
          loadEpisodes(d.id, s.season_number);
        };
        tabs.appendChild(b);
      });
      loadEpisodes(d.id, 1);
    }

    const cast = (d.credits && d.credits.cast) || [];
    if (cast.length) {
      const c = document.createElement('div');
      c.innerHTML = `<div class="section-label">Top Cast</div><div class="cast-row" id="castRow"></div>`;
      wrap.appendChild(c);
      const row = $('#castRow');
      cast.slice(0, 12).forEach((p) => {
        const div = document.createElement('div');
        div.className = 'cast-card';
        div.innerHTML = `
          <img class="cast-avatar" loading="lazy" src="${p.profile_path ? CAST_IMG + p.profile_path : placeholderPoster()}" alt="${esc(p.name)}" onerror="this.onerror=null;this.src='${placeholderPoster()}'">
          <div class="cast-name">${esc(p.name)}</div>
          <div class="cast-role">${esc(p.character || '')}</div>`;
        row.appendChild(div);
      });
    }

    const similar = [
      ...((d.recommendations && d.recommendations.results) || []).slice(0, 8),
      ...((d.similar && d.similar.results) || []).slice(0, 8),
    ].filter((v, i, arr) => arr.findIndex((x) => x.id === v.id) === i).slice(0, 12);
    if (similar.length) {
      const s = document.createElement('div');
      s.innerHTML = `<div class="section-label">More Like This</div><div class="mini-row" id="similarRow"></div>`;
      wrap.appendChild(s);
      const row = $('#similarRow');
      similar.forEach((it) => {
        const div = document.createElement('div');
        div.className = 'mini-card';
        div.tabIndex = 0;
        div.innerHTML = `
          <img loading="lazy" src="${esc(posterUrl(it.poster_path))}" alt="${esc(titleOf(it))}" onerror="this.onerror=null;this.src='${placeholderPoster()}'">
          <div class="mc-title">${esc(titleOf(it))}</div>`;
        const m = mediaOf(it);
        div.onclick = () => openDetail(m, it.id, titleOf(it));
        div.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(m, it.id, titleOf(it)); } };
        row.appendChild(div);
      });
    }
  }

  async function loadEpisodes(tvId, seasonNum) {
    const list = $('#epList');
    list.innerHTML = '<div class="row-error" style="border:none;padding:8px"><span>Loading episodes…</span></div>';
    try {
      const data = await api(`/tv/season?id=${tvId}&s=${seasonNum}`);
      list.innerHTML = '';
      (data.episodes || []).forEach((ep) => {
        const el = document.createElement('div');
        el.className = 'ep';
        el.tabIndex = 0;
        el.setAttribute('role', 'button');
        const still = ep.still_path ? `https://image.tmdb.org/t/p/w300${ep.still_path}` : stillPlaceholder();
        el.innerHTML = `
          <img class="ep-still" loading="lazy" src="${still}" alt="" onerror="this.onerror=null;this.src='${stillPlaceholder()}'">
          <div class="ep-body">
            <div class="ep-title">${esc(ep.name || 'Episode ' + ep.episode_number)}</div>
            <div class="ep-meta">
              <span>E${ep.episode_number}</span>
              ${ep.air_date ? `<span>${year(ep.air_date)}</span>` : ''}
              ${ep.vote_average ? `<span>${STAR} ${ep.vote_average.toFixed(1)}</span>` : ''}
              ${ep.runtime ? `<span>${ep.runtime}m</span>` : ''}
            </div>
            <div class="ep-over">${esc(ep.overview || '')}</div>
          </div>
          <div class="ep-play" aria-hidden="true">${PLAY_SM}</div>`;
        const play = () => {
          recordContinue({ id: tvId, media_type: 'tv', title: state.detail.title, vote_average: 0, release_date: '' });
          openPlayer({ title: state.detail.title, media: 'tv', id: tvId, backdrop: $('#modalBackdrop').style.backgroundImage.slice(5, -2) });
        };
        el.onclick = play;
        el.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); play(); } };
        list.appendChild(el);
      });
      if (!(data.episodes || []).length) list.innerHTML = '<div class="row-error" style="border:none"><span>No episode data available for this season.</span></div>';
    } catch (e) {
      list.innerHTML = '<div class="row-error" style="border:none"><span>Could not load episodes.</span></div>';
    }
  }

  /* ================= anime detail ================= */
  async function openAnimeDetail(malId, img, title, autoplay = false) {
    showModal();
    const bodyEl = $('#modalBody');
    bodyEl.innerHTML = '<div class="skel" style="height:220px;border-radius:14px;margin-bottom:90px"></div>';
    try {
      const r = await api('/anime/details?id=' + encodeURIComponent(malId));
      const a = r.data;
      const aTitle = a.title_english || a.title || title;
      const backdrop = (a.trailer && a.trailer.images && a.trailer.images.maximum_image_url)
        || (a.images && a.images.jpg && (a.images.jpg.large_image_url || a.images.jpg.image_url)) || '';
      const genres = (a.genres || []).map((g) => `<span class="chip">${esc(g.name)}</span>`).join('');
      $('#modalBackdrop').style.backgroundImage = backdrop ? `url(${backdrop})` : 'none';
      const onList = inWatchlist(malId, 'anime');
      state.detail = { media: 'anime', id: malId, title: aTitle };
      bodyEl.innerHTML = `
        <h2 class="modal-title" id="modalTitle">${esc(aTitle)}</h2>
        <div class="modal-meta">
          <span>Anime</span>
          <span>${a.year || (a.aired && a.aired.from ? year(a.aired.from) : '—')}</span>
          <span class="rating" style="color:var(--gold);font-weight:800">${STAR} ${a.score || '—'}</span>
          <span>${esc(a.type || 'TV')}</span>
          ${a.status ? `<span>${esc(a.status)}</span>` : ''}
          <span>${a.episodes || '?'} episodes</span>
        </div>
        <div class="modal-genres">${genres}</div>
        <p class="modal-desc">${esc((a.synopsis || 'No synopsis available.').replace(/\[written by.*?\]/i, '').trim())}</p>
        <div class="modal-actions">
          <button class="btn btn-play" id="animePlay">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
            Play
          </button>
          <button class="btn btn-ghost" id="animeList">${onList ? 'In My List' : 'My List'}</button>
          ${a.url ? `<a class="btn btn-ghost" href="${esc(a.url)}" target="_blank" rel="noopener">MyAnimeList</a>` : ''}
        </div>`;
      $('#animePlay').onclick = () => {
        recordContinue({ id: malId, media_type: 'anime', title: aTitle, vote_average: a.score, release_date: String(a.year || '') });
        openPlayer({ title: aTitle, media: 'anime', id: malId, backdrop, external: a.url });
      };
      $('#animeList').onclick = () => {
        toggleWatchlist({ id: malId, media_type: 'anime', title: aTitle, poster_path: backdrop ? backdrop : '' });
        const b = $('#animeList');
        setTimeout(() => { b.textContent = inWatchlist(malId, 'anime') ? 'In My List' : 'My List'; }, 0);
      };
      if (autoplay) {
        setTimeout(() => {
          recordContinue({ id: malId, media_type: 'anime', title: aTitle, vote_average: a.score, release_date: String(a.year || '') });
          openPlayer({ title: aTitle, media: 'anime', id: malId, backdrop, external: a.url });
        }, 200);
      }
    } catch (e) {
      bodyEl.innerHTML = '<div class="section-label" style="color:#ff8690">Could not load details.</div>';
    }
  }

  /* ================= player (where to watch) ================= */
  async function openPlayer({ title, media, id, backdrop, external }) {
    closeModal();
    $('#playerModal').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    $('#playerTitle').textContent = title || 'Now Playing';
    $('#playerArt').style.backgroundImage = backdrop ? `url(${backdrop})` : '';
    $('#playerH1').textContent = title || 'Choose where to watch';
    $('#playerSub').textContent = 'Select a streaming service to continue.';
    const grid = $('#providerGrid');
    grid.innerHTML = '<div class="spinner" style="width:40px;height:40px;border:3px solid rgba(255,255,255,.15);border-top-color:#fff;border-radius:50%;animation:spin .9s linear infinite;margin:20px auto"></div>';
    $('#playerFoot').innerHTML = '';

    if (media === 'anime' && external) {
      renderProviders([
        { name: 'MyAnimeList', logo: '', url: external, tag: 'Info' },
        { name: 'Crunchyroll', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d6/Crunchyroll_logo_2024.svg/512px-Crunchyroll_logo_2024.svg.png', url: 'https://www.crunchyroll.com/search?q=' + encodeURIComponent(title), tag: 'Stream' },
        { name: 'Netflix', logo: 'https://image.tmdb.org/t/p/original/7EWTH47T5qGz8np6zHCY3tqdS3Y.png', url: 'https://www.netflix.com/search?q=' + encodeURIComponent(title), tag: 'Stream' },
      ]);
      return;
    }

    try {
      const region = (state.country || state.region || 'IN').toUpperCase();
      const r = await api(`/watch?media=${media}&id=${encodeURIComponent(id)}&region=${region}`, { noCache: true });
      const regions = r.results || {};
      const p = regions[region] || regions.IN || regions.US || Object.values(regions)[0];
      if (!p) {
        renderProviders([
          { name: 'JustWatch', logo: '', url: 'https://www.justwatch.com/in/search?q=' + encodeURIComponent(title), tag: 'Find' },
          { name: 'Google', logo: '', url: 'https://www.google.com/search?q=' + encodeURIComponent(title + ' watch online'), tag: 'Search' },
        ]);
        $('#playerSub').textContent = 'No streaming info in your region — try the options below.';
        return;
      }
      const services = [];
      const push = (arr, label) => (arr || []).forEach((s) => services.push({
        name: s.provider_name, logo: s.logo_path ? 'https://image.tmdb.org/t/p/original' + s.logo_path : '', url: p.link || '#', tag: label,
      }));
      push(p.flatrate, 'Subscription'); push(p.free, 'Free'); push(p.ads, 'With ads'); push(p.rent, 'Rent'); push(p.buy, 'Buy');
      const seen = {};
      const list = services.filter((s) => (seen[s.name] ? false : (seen[s.name] = true)));
      renderProviders(list.length ? list.slice(0, 14) : [{ name: 'JustWatch', logo: '', url: p.link || '#', tag: 'Find' }]);
      $('#playerSub').textContent = `Available in ${region}. Select a service to continue.`;
    } catch (e) {
      grid.innerHTML = '';
      $('#playerSub').textContent = 'Could not load streaming info right now.';
      $('#playerFoot').innerHTML = `<a href="https://www.google.com/search?q=${encodeURIComponent(title + ' watch online')}" target="_blank" rel="noopener">Search the web</a>`;
    }
  }

  function renderProviders(list) {
    const grid = $('#providerGrid');
    grid.innerHTML = '';
    list.forEach((p) => {
      const a = document.createElement('a');
      a.className = 'provider-tile' + (p.tag === 'Subscription' ? ' flatrate' : '');
      a.href = p.url; a.target = '_blank'; a.rel = 'noopener';
      const logo = p.logo
        ? `<img src="${esc(p.logo)}" alt="" onerror="this.style.display='none'">`
        : `<div style="width:36px;height:36px;border-radius:8px;background:linear-gradient(135deg,#e50914,#ff2d55);display:grid;place-items:center;color:#fff;font-weight:900">${esc(p.name[0] || 'P')}</div>`;
      a.innerHTML = `${logo}<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.name)}</span>` +
        (p.tag ? `<span class="pt-tag" style="font-size:10px;font-weight:700;color:#9ab5ff;display:block;flex-basis:100%;margin-top:-6px;padding-left:47px">${esc(p.tag)}</span>` : '') +
        `<span class="pt-arrow">›</span>`;
      grid.appendChild(a);
    });
  }

  $('#playerClose').onclick = closePlayer;
  function closePlayer() {
    $('#playerModal').classList.add('hidden');
    document.body.style.overflow = $('#detailModal').classList.contains('hidden') ? '' : 'hidden';
  }

  /* ================= modal plumbing ================= */
  function showModal() {
    closePlayer();
    $('#detailModal').classList.remove('hidden');
    $('#modalBody').innerHTML = '';
    $('#modalBackdrop').style.backgroundImage = 'none';
    document.body.style.overflow = 'hidden';
  }
  $('#modalClose').onclick = closeModal;
  $('#detailModal').addEventListener('click', (e) => { if (e.target === $('#detailModal')) closeModal(); });
  function closeModal() {
    $('#detailModal').classList.add('hidden');
    if ($('#playerModal').classList.contains('hidden')) document.body.style.overflow = '';
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closePlayer(); closeModal(); $('#settingsModal').classList.add('hidden'); }
  });

  function trapFocus(container) {
    const focusables = container.querySelectorAll('button, [href], input, select, [tabindex]:not([tabindex="-1"])');
    if (!focusables.length) return;
    const first = focusables[0]; const last = focusables[focusables.length - 1];
    if (container._trap) container.removeEventListener('keydown', container._trap);
    container._trap = (e) => {
      if (e.key !== 'Tab') return;
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    container.addEventListener('keydown', container._trap);
    setTimeout(() => first.focus(), 80);
  }
  const observeModal = new MutationObserver(() => {
    if (!$('#detailModal').classList.contains('hidden')) trapFocus($('#detailModal'));
    if (!$('#playerModal').classList.contains('hidden')) trapFocus($('#playerModal'));
    if (!$('#settingsModal').classList.contains('hidden')) trapFocus($('#settingsModal'));
  });
  observeModal.observe(document.body, { attributes: true, subtree: true, attributeFilter: ['class'] });

  /* ================= settings ================= */
  $('#settingsBtn').onclick = openSettings;
  $('#settingsClose').onclick = () => $('#settingsModal').classList.add('hidden');
  $('#settingsModal').addEventListener('click', (e) => { if (e.target === $('#settingsModal')) $('#settingsModal').classList.add('hidden'); });

  async function openSettings() {
    const m = $('#settingsModal');
    m.classList.remove('hidden');
    const ls = $('#setLang');
    ls.innerHTML = LANGS.map(([c, l]) => `<option value="${c}" ${c === state.lang ? 'selected' : ''}>${esc(l)}</option>`).join('');
    ls.onchange = () => {
      state.lang = ls.value;
      localStorage.setItem('sv-lang', state.lang);
      apiCache.clear();
      toast('Language updated');
      if (!$('#content').classList.contains('hidden')) loadHome();
    };

    await ensureCountries();
    const cs = $('#setCountry');
    cs.innerHTML = '<option value="">Auto-detect</option>' +
      state.countries.map((c) => `<option value="${c.code}" ${c.code === state.country ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
    cs.onchange = () => { state.country = cs.value; localStorage.setItem('sv-country', state.country); toast('Region updated'); };

    $('#setThemeBtn').textContent = document.body.classList.contains('light') ? 'Light theme — switch to Dark' : 'Dark theme — switch to Light';
    $('#setThemeBtn').onclick = () => { toggleTheme(); openSettings(); };

    $('#usageBox').innerHTML = `
      <div class="stat-grid">
        <div class="stat"><b>${fmtMB(usage.bytes)}</b><span>Data used</span></div>
        <div class="stat"><b>${usage.reqs}</b><span>Requests</span></div>
        <div class="stat"><b>${new Date(usage.since).toLocaleDateString()}</b><span>Since</span></div>
        <div class="stat"><b>${state.watchlist.length}</b><span>Saved titles</span></div>
      </div>`;
    $('#usageReset').onclick = () => { usage = { bytes: 0, reqs: 0, since: Date.now() }; saveUsage(); toast('Stats reset'); openSettings(); };
    $('#cacheClear').onclick = async () => {
      try { const r = await api('/cache/clear', { noCache: true }); apiCache.clear(); toast(`Cache cleared (${r.cleared})`); openSettings(); }
      catch (e) { toast('Cache clear failed'); }
    };

    $('#backupInfo').innerHTML = '<div class="section-label">Server status</div>';
    api('/stats', { noCache: true }).then((s) => {
      const dot = (v) => v === 'ok' ? 'Online' : v === 'error' ? 'Offline' : 'Idle';
      $('#backupInfo').innerHTML = `
        <div class="api-chips">
          <span class="chip">TMDB: ${dot(s.api_health.tmdb)}</span>
          <span class="chip">Jikan: ${dot(s.api_health.jikan)}</span>
          <span class="chip">Cinemeta: ${dot(s.api_health.cinemeta)}</span>
          <span class="chip">AniList: ${dot(s.api_health.anilist)}</span>
        </div>
        <div class="tiny-note">Version ${s.version || '?'} · uptime ${Math.floor(s.uptime_s / 60)} min · ${s.cache_items} cached items</div>`;
    }).catch(() => { $('#backupInfo').innerHTML = '<div class="tiny-note">Status unavailable.</div>'; });
  }

  async function ensureCountries() {
    if (state.countries.length) return;
    try {
      const d = await api('/countries');
      state.countries = d.countries || [];
    } catch (e) {
      state.countries = [{ code: 'IN', name: 'India' }, { code: 'US', name: 'United States' }];
    }
  }

  /* ================= theme ================= */
  function toggleTheme() {
    document.body.classList.toggle('light');
    const light = document.body.classList.contains('light');
    localStorage.setItem('sv-theme', light ? 'light' : 'dark');
    const moon = $('#themeBtn .ic-moon'); const sun = $('#themeBtn .ic-sun');
    if (moon) moon.style.display = light ? 'none' : '';
    if (sun) sun.style.display = light ? '' : 'none';
  }
  (function initTheme() {
    const saved = localStorage.getItem('sv-theme');
    const light = saved === 'light' || (!saved && window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches);
    if (light) {
      document.body.classList.add('light');
      const moon = $('#themeBtn .ic-moon'); const sun = $('#themeBtn .ic-sun');
      if (moon) moon.style.display = 'none';
      if (sun) sun.style.display = '';
    }
  })();
  $('#themeBtn').onclick = toggleTheme;

  /* ================= scroll / to-top ================= */
  window.addEventListener('scroll', () => {
    $('#navbar').classList.toggle('scrolled', window.scrollY > 30);
    $('#toTop').classList.toggle('show', window.scrollY > 600);
  }, { passive: true });
  $('#toTop').onclick = () => window.scrollTo({ top: 0, behavior: 'smooth' });

  /* ================= keyboard shortcuts ================= */
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === '/') { e.preventDefault(); searchWrap.classList.add('open'); setTimeout(() => searchInput.focus(), 100); }
    if (e.key === 'Home') { e.preventDefault(); navigate('home'); }
  });

  /* ================= spinner keyframes (injected) ================= */
  const css = document.createElement('style');
  css.textContent = `@keyframes spin{to{transform:rotate(360deg)}}`;
  document.head.appendChild(css);

  /* ================= init ================= */
  (async function init() {
    setNav();
    loadHome();
    ensureCountries();
    if (!state.country) {
      try {
        const g = await api('/geo', { noCache: true });
        state.country = g.country_code || 'IN';
        localStorage.setItem('sv-country', state.country);
      } catch (e) { state.country = 'IN'; }
    }
    window.addEventListener('hashchange', () => {
      const h = location.hash.replace('#', '') || 'home';
      setNav(h);
      if (h === 'home') showHome();
      else if (h === 'mylist') showMyList();
      else if (['movies', 'tv', 'anime'].includes(h)) showResultsForNav(h);
    });
  })();
})();
