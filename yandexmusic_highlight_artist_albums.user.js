// ==UserScript==
// @name         Yandex Music → MusicBrainz: Highlight Artist Albums
// @namespace    https://github.com/yourname/userscripts
// @version      1.4.0
// @description  /artist/<id>/albums: зелёная — найдено, жёлтая — сомнительно, красная — не найдено. Работает при SPA-переходах, бесконечной прокрутке, переотрисовках; кэширует статусы и автоматически перерисовывает карточки при возврате/скролле назад.
// @match        https://music.yandex.ru/*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @connect      musicbrainz.org
//
// @icon        https://musicbrainz.org/favicon.ico
//
// @downloadURL  https://github.com/Druidblack/MusicBrainz-UserScripts/raw/main/yandexmusic_highlight_artist_albums.user.js
// @updateURL    https://github.com/Druidblack/MusicBrainz-UserScripts/raw/main/yandexmusic_highlight_artist_albums.user.js
// ==/UserScript==

(function () {
  'use strict';

  // ---------- Selectors ----------
  const CARD_SEL            = 'div[class^="ArtistAlbumsPage_item__"]';
  const TITLE_SEL           = 'a[class*="AlbumCard_titleLink__"]';
  const ARTIST_LINKS_SEL    = 'a[class*="AlbumCard_artistLink__"]';
  const COVER_WRAPPER_SEL   = 'div[class*="AlbumCard_cover__"], div[class*="AlbumCard_coverBlock__"]';
  const IMG_SEL             = 'img[class*="AlbumCard_image__"], img[alt][src*="get-music-content"]';

  // ---------- MB config ----------
  const MB_BASE      = 'https://musicbrainz.org/ws/2';
  const MB_DELAY_MS  = 800;
  const SCORE_GOOD   = 95;
  const SCORE_MAYBE  = 80;

  // ---------- Utils ----------
  const qs  = (s, r=document) => r.querySelector(s);
  const qsa = (s, r=document) => Array.from(r.querySelectorAll(s));
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const sanitize = s => (s||'').replace(/\s+/g,' ').trim();
  const stripExtras = t => sanitize(t.replace(/[\[(].*?[\])]/g,''));
  const lower = s => sanitize(s).toLowerCase();
  const artistIdFromURL = () => (location.pathname.match(/^\/artist\/(\d+)\/albums/)||[])[1] || null;

  function gmGetJson(url) {
    if (typeof GM_xmlhttpRequest === 'function') {
      return new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
          method: 'GET', url, headers: { Accept: 'application/json' },
          responseType: 'json', timeout: 15000,
          onload: (res) => {
            try {
              if (res.status < 200 || res.status >= 300) return reject(new Error(`MusicBrainz HTTP ${res.status}`));
              resolve(res.response ?? JSON.parse(res.responseText || 'null'));
            } catch (e) { reject(e); }
          },
          onerror: () => reject(new Error('Network error')),
          ontimeout: () => reject(new Error('Timeout')),
        });
      });
    }
    return fetch(url, { headers: { Accept: 'application/json' } }).then(r => {
      if (!r.ok) throw new Error(`MusicBrainz HTTP ${r.status}`);
      return r.json();
    });
  }

  // ---------- Paint helpers ----------
  function ensureRel(el) {
    if (!el) return;
    const cs = getComputedStyle(el);
    if (cs.position === 'static') el.style.position = 'relative';
  }
  function paintStatus(coverEl, status) {
    if (!coverEl) return;
    ensureRel(coverEl);
    let color = '#e74c3c', label = 'MB —';
    if (status === 'good') { color = '#2ecc71'; label = 'MB ✓'; }
    else if (status === 'maybe') { color = '#f1c40f'; label = 'MB ?'; }

    coverEl.style.outline = `3px solid ${color}`;
    coverEl.style.outlineOffset = '-2px';
    coverEl.style.borderRadius = '8px';
    coverEl.style.boxShadow = `0 0 0 2px ${color}55`;

    let badge = coverEl.querySelector('.mb-flag');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'mb-flag';
      coverEl.appendChild(badge);
    }
    Object.assign(badge.style, {
      position:'absolute', top:'6px', left:'6px', zIndex:10,
      padding:'2px 6px', fontSize:'11px', fontWeight:'700',
      background: color, color:'#111', borderRadius:'6px',
      boxShadow: '0 2px 8px rgba(0,0,0,0.35)', userSelect:'none',
    });
    badge.textContent = label;
  }

  // ---------- Meta from card ----------
  function extractCardMeta(card) {
    const aTitle = qs(TITLE_SEL, card);
    const title = aTitle ? sanitize(aTitle.textContent) : '';

    const artistAnchors = qsa(ARTIST_LINKS_SEL, card);
    const artistList = artistAnchors.map(a => sanitize(a.textContent)).filter(Boolean);

    // year: title-attrs first, then visible text
    let year = null;
    const withTitle = qsa('[title]', card);
    for (const n of withTitle) {
      const t = n.getAttribute('title') || '';
      const m = t.match(/\b(19\d{2}|20\d{2})\b/);
      if (m) { year = m[1]; break; }
    }
    if (!year) {
      const txt = (card.textContent || '');
      const m = txt.match(/\b(19\d{2}|20\d{2})\b/);
      if (m) year = m[1];
    }

    let primary = null;
    const typeText = withTitle.map(n => n.getAttribute('title') || '').join(' ').toLowerCase();
    if (/сингл/i.test(typeText)) primary = 'Single';
    else if (/мини[-\s]?альбом|ep/i.test(typeText)) primary = 'EP';
    else if (/альбом/i.test(typeText)) primary = 'Album';

    const href = aTitle?.getAttribute('href') || '';
    const albumId = (href.match(/\/album\/(\d+)/) || [])[1] || `${title}::${artistList.join(',')}::${year||''}`;

    return {
      albumId,
      title,
      titleStripped: stripExtras(title),
      artistList,
      year,
      relPrimary: primary || 'Album',
      coverEl: qs(COVER_WRAPPER_SEL, card) || qs(IMG_SEL, card),
    };
  }

  // ---------- MB queries + matching ----------
  function buildRGQuery(meta, useStripped=false) {
    const t = useStripped ? meta.titleStripped : meta.title;
    const parts = [`releasegroup:"${t.replace(/"/g,'\\"')}"`];
    meta.artistList.forEach(a => parts.push(`artist:"${a.replace(/"/g,'\\"')}"`));
    if (meta.year) parts.push(`firstreleaseyear:${meta.year}`);
    if (meta.relPrimary === 'Single') parts.push('primarytype:single');
    if (meta.relPrimary === 'Album')  parts.push('primarytype:album');
    if (meta.relPrimary === 'EP')     parts.push('primarytype:ep');
    return parts.join(' AND ');
  }
  function buildReleaseQuery(meta, useStripped=false) {
    const t = useStripped ? meta.titleStripped : meta.title;
    const parts = [`release:"${t.replace(/"/g,'\\"')}"`];
    meta.artistList.forEach(a => parts.push(`artist:"${a.replace(/"/g,'\\"')}"`));
    if (meta.year) parts.push(`date:${meta.year}`);
    return parts.join(' AND ');
  }
  const artistOverlap = (metaArtists, mbArtists) => {
    const m1 = metaArtists.map(lower);
    const m2 = mbArtists.map(a => lower(a));
    return m1.some(a => m2.some(b => b.includes(a) || a.includes(b)));
  };
  const titleClose = (metaTitle, mbTitle) => {
    const A = lower(stripExtras(metaTitle));
    const B = lower(stripExtras(mbTitle));
    if (A === B) return true;
    const clean = s => s.replace(/[·•:;()"'!?]/g,'').replace(/\s+/g,' ').trim();
    const AA = clean(A), BB = clean(B);
    return AA === BB || AA.startsWith(BB) || BB.startsWith(AA) || AA.includes(BB) || BB.includes(AA);
  };
  function classifyAgainst(meta, item, isRG) {
    const score = item.score ?? 0;
    const mbArtists = (item['artist-credit'] || []).map(ac => ac.name);
    const artistOk = artistOverlap(meta.artistList, mbArtists);
    let yearOk = true;
    if (meta.year) {
      const dateStr = isRG ? (item['first-release-date'] || '') : (item['date'] || '');
      yearOk = new RegExp('^' + meta.year).test(dateStr);
    }
    const titleOk = titleClose(meta.title, item.title);
    const goodByScore = score >= SCORE_GOOD;
    const maybeByScore = score >= SCORE_MAYBE;

    if ((goodByScore || titleOk) && artistOk && yearOk) return 'good';
    if (artistOk && (maybeByScore || titleOk)) return 'maybe';
    return 'none';
  }
  async function searchStatus(meta) {
    const q1 = buildRGQuery(meta, true);
    const d1 = await gmGetJson(`${MB_BASE}/release-group/?query=${encodeURIComponent(q1)}&limit=8&fmt=json`);
    let hasMaybe = false;
    for (const rg of (d1['release-groups'] || [])) {
      const cls = classifyAgainst(meta, rg, true);
      if (cls === 'good') return 'good';
      if (cls === 'maybe') hasMaybe = true;
    }
    await sleep(MB_DELAY_MS);
    const q2 = buildReleaseQuery(meta, true);
    const d2 = await gmGetJson(`${MB_BASE}/release/?query=${encodeURIComponent(q2)}&limit=8&fmt=json`);
    for (const rel of (d2['releases'] || [])) {
      const cls = classifyAgainst(meta, rel, false);
      if (cls === 'good') return 'good';
      if (cls === 'maybe') hasMaybe = true;
    }
    return hasMaybe ? 'maybe' : 'none';
  }

  // ---------- Caches & queue ----------
  // пер-артистовый кэш в памяти + sessionStorage для повторного визита без reload
  let currentArtistId = artistIdFromURL();
  let statusCache = new Map();                   // albumId -> status
  let inFlight = new Set();                      // albumId -> bool
  const pendingCovers = new Map();               // albumId -> Set(coverEl)

  function cacheKey() { return currentArtistId ? `mb_album_status:${currentArtistId}` : null; }
  function loadCache() {
    statusCache = new Map();
    const key = cacheKey();
    if (!key) return;
    try {
      const raw = sessionStorage.getItem(key);
      if (!raw) return;
      const obj = JSON.parse(raw);
      for (const [id, st] of Object.entries(obj)) statusCache.set(id, st);
    } catch {}
  }
  function saveCache() {
    const key = cacheKey();
    if (!key) return;
    try {
      const obj = {};
      statusCache.forEach((v, k) => obj[k] = v);
      sessionStorage.setItem(key, JSON.stringify(obj));
    } catch {}
  }

  function registerCover(albumId, coverEl) {
    if (!albumId || !coverEl) return;
    let set = pendingCovers.get(albumId);
    if (!set) { set = new Set(); pendingCovers.set(albumId, set); }
    set.add(coverEl);
  }
  function paintAllRegistered(albumId, status) {
    const set = pendingCovers.get(albumId);
    if (set) {
      set.forEach(el => paintStatus(el, status));
      set.clear();
    }
  }

  const queue = [];
  let running = false;
  function enqueue(task) { queue.push(task); if (!running) runQueue(); }
  async function runQueue() {
    running = true;
    while (queue.length) {
      const fn = queue.shift();
      try { await fn(); } catch {}
      await sleep(MB_DELAY_MS);
    }
    running = false;
  }

  // ---------- Card handling ----------
  function processCard(card, retry = 0) {
    if (!card) return;

    const aTitle = qs(TITLE_SEL, card);
    if (!aTitle) {
      if (retry < 6) setTimeout(() => processCard(card, retry + 1), 150);
      return;
    }

    const meta = extractCardMeta(card);
    if (!meta.title || !meta.artistList.length) {
      if (retry < 6) setTimeout(() => processCard(card, retry + 1), 150);
      return;
    }

    // запоминаем обложку для будущей дорисовки (при ответе/повторной отрисовке)
    registerCover(meta.albumId, meta.coverEl);

    // если статус уже есть в кэше — рисуем без запросов
    if (statusCache.has(meta.albumId)) {
      paintStatus(meta.coverEl, statusCache.get(meta.albumId));
      return;
    }

    // если запрос уже идёт — просто ждём и дорисуем при завершении
    if (inFlight.has(meta.albumId)) return;

    // ставим в очередь сетевой запрос
    inFlight.add(meta.albumId);
    enqueue(async () => {
      try {
        const status = await searchStatus(meta);
        statusCache.set(meta.albumId, status);
        saveCache();
        paintAllRegistered(meta.albumId, status);
      } catch {
        statusCache.set(meta.albumId, 'none');
        saveCache();
        paintAllRegistered(meta.albumId, 'none');
      } finally {
        inFlight.delete(meta.albumId);
      }
    });
  }

  function scanAll(root = document) {
    qsa(CARD_SEL, root).forEach((card) => processCard(card));
  }

  // ---------- Routing / SPA ----------
  function isArtistAlbumsPage() {
    return /\/artist\/\d+\/albums/.test(location.pathname);
  }

  function onLocationChange() {
    if (!isArtistAlbumsPage()) return;
    const newArtist = artistIdFromURL();
    if (newArtist !== currentArtistId) {
      // переключили артиста — сбрасываем runtime-состояние, но загружаем/используем пер-артистовый кэш
      currentArtistId = newArtist;
      statusCache.clear();
      inFlight.clear();
      pendingCovers.clear();
      loadCache();
    }
    // первичный проход + дорисовка из кэша
    setTimeout(() => scanAll(), 120);
  }

  let lastHref = location.href;
  function onUrlMaybeChanged() {
    if (location.href === lastHref) return;
    lastHref = location.href;
    onLocationChange();
  }

  ['pushState','replaceState'].forEach(m => {
    const orig = history[m];
    history[m] = function () {
      const ret = orig.apply(this, arguments);
      setTimeout(onUrlMaybeChanged, 0);
      return ret;
    };
  });
  window.addEventListener('popstate', onUrlMaybeChanged);
  setInterval(onUrlMaybeChanged, 400); // страховка на случай нестандартной навигации

  // ловим новые карточки и их переотрисовки
  const mo = new MutationObserver((mutList) => {
    if (!isArtistAlbumsPage()) return;
    for (const m of mutList) {
      m.addedNodes && m.addedNodes.forEach(node => {
        if (!(node instanceof Element)) return;
        if (node.matches && node.matches(CARD_SEL)) processCard(node);
        else if (node.querySelectorAll) qsa(CARD_SEL, node).forEach(processCard);
      });
    }
  });
  mo.observe(document.body, { childList: true, subtree: true });

  // старт
  if (isArtistAlbumsPage()) {
    loadCache();
    scanAll();
  }
})();
