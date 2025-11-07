// ==UserScript==
// @name         Yandex Music → Deezer → Harmony (Album Finder)
// @namespace   https://github.com/Druidblack/MusicBrainz-UserScripts
// @version      1.3.0
// @description  On the album page, Yandex Music searches for a release in Deezer and opens Harmony;
// @author       Druidblack
// @match        https://music.yandex.ru/album/*
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @connect      api.music.yandex.net
// @connect      api.deezer.com
// @connect      harmony.pulsewidth.org.uk
// @icon         https://harmony.pulsewidth.org.uk/favicon.ico
//
// @downloadURL  https://github.com/Druidblack/MusicBrainz-UserScripts/raw/main/yandexmusic_import_album_harmony.user.js
// @updateURL    https://github.com/Druidblack/MusicBrainz-UserScripts/raw/main/yandexmusic_import_album_harmony.user.js
// ==/UserScript==

(function () {
  'use strict';

  const HARMONY_BASE   = 'https://harmony.pulsewidth.org.uk/release';
  const HARMONY_REGION = 'GB,US,DE,JP';

  // ---------- Styles ----------
  GM_addStyle(`
    .ym2deezer-btn {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      /* padding/height/radius подтягиваются из кнопки «Слушать» скриптом */
      font: 600 14px/1.1 system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, 'Helvetica Neue', Arial, sans-serif;
      text-decoration: none;
      box-shadow: 0 2px 8px rgba(0,0,0,.18);
      transition: background-color .12s ease, box-shadow .12s ease, opacity .12s ease;
      color: #000 !important;
      background: #5a5a5a; /* базовый фон (если вдруг без state-класса) */
      white-space: nowrap;
      border: none;
      cursor: pointer;
      margin: 0 8px;
      vertical-align: middle;
    }

    /* фиксируем чёрный цвет текста во всех состояниях */
    .ym2deezer-btn,
    .ym2deezer-btn:visited,
    .ym2deezer-btn:hover,
    .ym2deezer-btn:active { color: #000 !important; }

    .ym2deezer-btn:hover {
      transform: none; /* не «прыгает» */
      box-shadow: 0 6px 16px rgba(0,0,0,.22);
      /* фон задаём только в state-hover ниже, чтобы не мигало */
    }

    /* иконка Harmony вместо текста */
    .ym2deezer-icon {
      width: 18px;
      height: 18px;
      display: inline-block;
      flex: 0 0 auto;
      vertical-align: middle;
      object-fit: contain;
      image-rendering: auto;
    }

    /* плавающий режим — как fallback, если не нашли место в шапке */
    .ym2deezer--floating {
      position: fixed;
      top: 12px;
      right: 12px;
      z-index: 99999;
      margin: 0;
      border-radius: 10px; /* fallback, если «Слушать» не найдена */
      padding: 8px 14px;   /* fallback */
    }

    .ym2deezer-badge {
      display: inline-block;
      font: 700 11px/1 system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, 'Helvetica Neue', Arial, sans-serif;
      padding: 3px 6px;
      border-radius: 6px;
      background: rgba(255,255,255,.2);
      color: #000 !important;
    }

    /* состояния (основные цвета) */
    .ym2deezer--searching { background-color: #ff9f1c; }
    .ym2deezer--found     { background-color: #2ecc71; }
    .ym2deezer--fallback  { background-color: #3498db; }
    .ym2deezer--error     { background-color: #e74c3c; }

    /* лёгкое осветление на hover — без конфликтов и мерцания */
    .ym2deezer--searching:hover { background-color: #ffad42; }
    .ym2deezer--found:hover     { background-color: #55d88a; }
    .ym2deezer--fallback:hover  { background-color: #4aa6e1; }
    .ym2deezer--error:hover     { background-color: #ef6b60; }
  `);

  // ---------- UI ----------
  let btn = null;

  function ensureButton() {
    if (btn) return btn;
    btn = document.createElement('a');
    btn.className = 'ym2deezer-btn ym2deezer--searching ym2deezer--floating';
    btn.href = '#';
    btn.target = '_blank';
    btn.rel = 'noopener';
    btn.title = 'Open in Harmony (via Deezer)';

    btn.innerHTML = `
      <img class="ym2deezer-icon" alt="Harmony icon">
      <span class="ym2deezer-badge">Searching…</span>
    `;

    const iconEl = btn.querySelector('.ym2deezer-icon');
    loadHarmonyIcon(iconEl); // грузим иконку через GMXHR + blob (обход CSP)

    document.body.appendChild(btn);
    return btn;
  }

  function setButtonState({ state, text, href }) {
    ensureButton();
    btn.classList.remove('ym2deezer--searching','ym2deezer--found','ym2deezer--fallback','ym2deezer--error');
    btn.classList.add(state);

    const badge = btn.querySelector('.ym2deezer-badge');
    if (badge) badge.textContent = text || '';

    if (href) btn.href = href;
  }

  // ---------- Placement ----------
  function placeButtonInline() {
    ensureButton();

    const playBtn    = document.querySelector('button[aria-label="Воспроизведение"]');
    const trailerBtn = document.querySelector('button[aria-label="Запустить трейлер"]');

    // Вставка строго перед «Трейлер»
    if (playBtn && trailerBtn && trailerBtn.parentElement) {
      const parent = trailerBtn.parentElement;
      // Если уже стоит прямо перед «Трейлер» — ничего не делаем
      if (btn.parentElement === parent && btn.nextSibling === trailerBtn) {
        btn.classList.remove('ym2deezer--floating');
        return true;
      }
      parent.insertBefore(btn, trailerBtn);
      btn.classList.remove('ym2deezer--floating');
      syncShapeWithPlay();
      return true;
    }

    // Если «Трейлер» нет — ставим сразу после «Слушать»
    if (playBtn && playBtn.parentElement) {
      if (playBtn.nextSibling === btn) {
        btn.classList.remove('ym2deezer--floating');
        return true;
      }
      playBtn.insertAdjacentElement('afterend', btn);
      btn.classList.remove('ym2deezer--floating');
      syncShapeWithPlay();
      return true;
    }

    // Фолбэк — плавающая кнопка
    if (!btn.classList.contains('ym2deezer--floating')) {
      btn.classList.add('ym2deezer--floating');
    }
    return false;
  }

  // Подгоняем форму под кнопку «Слушать»: высота, радиусы, паддинги, типографика
  function syncShapeWithPlay() {
    if (!btn) return;
    const playBtn = document.querySelector('button[aria-label="Воспроизведение"]');
    if (!playBtn) return;

    const cs = getComputedStyle(playBtn);

    btn.style.height        = cs.height;
    btn.style.borderRadius  = cs.borderRadius;

    btn.style.paddingTop    = cs.paddingTop;
    btn.style.paddingBottom = cs.paddingBottom;
    btn.style.paddingLeft   = cs.paddingLeft;
    btn.style.paddingRight  = cs.paddingRight;

    btn.style.fontSize      = cs.fontSize;
    btn.style.lineHeight    = cs.lineHeight;
    btn.style.fontWeight    = cs.fontWeight;
  }

  // ---------- Helpers ----------
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const getAlbumIdFromUrl = (url) => (url.match(/\/album\/(\d+)(?:[/?#]|$)/) || [])[1] || null;
  const normalize = (str) => (str || '').toLowerCase().replace(/\s+/g, ' ').trim();

  function buildHarmonyUrl(deezerLink, region = HARMONY_REGION) {
    const qs = new URLSearchParams({
      url: deezerLink,
      gtin: '',
      region,
      deezer: '',
      itunes: '',
      spotify: '',
      tidal: ''
    });
    return `${HARMONY_BASE}?${qs.toString()}`;
  }

  // ---------- Networking ----------
  function gmGetJson(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        headers: { 'Accept': 'application/json' },
        responseType: 'json',
        onload: (res) => {
          try {
            const json = res.response ?? JSON.parse(res.responseText);
            resolve(json);
          } catch (e) { reject(e); }
        },
        onerror: (e) => reject(e),
        ontimeout: () => reject(new Error('Timeout')),
      });
    });
  }

  function gmGetRaw(url, responseType = 'text') {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        responseType,
        onload: (res) => {
          if (res.status >= 200 && res.status < 300) {
            resolve(res.response);
          } else {
            reject(new Error(`HTTP ${res.status}`));
          }
        },
        onerror: reject,
        ontimeout: () => reject(new Error('Timeout')),
      });
    });
  }

  // Загружаем иконку Harmony через GMXHR + blob (обход CSP), с кэшем на сессию
  async function loadHarmonyIcon(imgEl) {
    if (!imgEl) return;
    if (window.__harmonyIconUrl) {
      imgEl.src = window.__harmonyIconUrl;
      return;
    }
    // 1) Пытаемся harmony-logo.svg
    try {
      const svg = await gmGetRaw('https://harmony.pulsewidth.org.uk/harmony-logo.svg', 'text');
      const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
      window.__harmonyIconUrl = url;
      imgEl.src = url;
      return;
    } catch (_) {}
    // 2) Пытаемся favicon.svg
    try {
      const svg2 = await gmGetRaw('https://harmony.pulsewidth.org.uk/favicon.svg', 'text');
      const url2 = URL.createObjectURL(new Blob([svg2], { type: 'image/svg+xml' }));
      window.__harmonyIconUrl = url2;
      imgEl.src = url2;
      return;
    } catch (_) {}
    // 3) Пытаемся favicon.ico
    try {
      const ico = await gmGetRaw('https://harmony.pulsewidth.org.uk/favicon.ico', 'arraybuffer');
      const url3 = URL.createObjectURL(new Blob([ico], { type: 'image/x-icon' }));
      window.__harmonyIconUrl = url3;
      imgEl.src = url3;
      return;
    } catch (_) {}
    // 4) Фолбэк: рисуем inline SVG с буквой H, чтобы не было "битого" файла
    imgEl.outerHTML = `
      <svg class="ym2deezer-icon" viewBox="0 0 24 24" aria-hidden="true">
        <rect x="0" y="0" width="24" height="24" rx="4" fill="white"></rect>
        <text x="12" y="16" text-anchor="middle" font-size="14" font-weight="700" fill="#000">H</text>
      </svg>
    `;
  }

  // ---------- Core ----------
  async function processAlbum(albumId) {
    setButtonState({ state: 'ym2deezer--searching', text: 'Searching…', href: '#' });

    // 1) Яндекс API
    let res;
    try {
      const ya = await gmGetJson(`https://api.music.yandex.net/albums/${albumId}`);
      res = ya?.result;
    } catch (e) {
      console.warn('[YM→DZ] Yandex API error:', e);
      setButtonState({ state: 'ym2deezer--error', text: 'Yandex API error', href: '#' });
      return;
    }

    const title = res?.title || '';
    const year  = res?.year || '';
    const artistName = Array.isArray(res?.artists) && res.artists.length
      ? res.artists.map(a => a.name).join(', ')
      : '';

    if (!title || !artistName) {
      setButtonState({ state: 'ym2deezer--error', text: 'No title/artist', href: '#' });
      return;
    }

    // 2) Deezer поиск альбомов
    const qPrimary   = `album:"${title}" artist:"${artistName}"`;
    const qSecondary = `"${title}" "${artistName}" ${year || ''}`.trim();

    let dzData = null;
    try {
      const dz1 = await gmGetJson(`https://api.deezer.com/search/album?q=${encodeURIComponent(qPrimary)}`);
      dzData = dz1?.data;
      if (!dzData || dzData.length === 0) {
        const dz2 = await gmGetJson(`https://api.deezer.com/search/album?q=${encodeURIComponent(qSecondary)}`);
        dzData = dz2?.data;
      }
    } catch (e) {
      console.warn('[YM→DZ] Deezer API error:', e);
    }

    // 3) Ранжирование совпадений
    let deezerLink = null;
    if (Array.isArray(dzData) && dzData.length) {
      const nTitle  = normalize(title);
      const nArtist = normalize(artistName);

      dzData.sort((a, b) => score(b) - score(a));
      function score(item) {
        const t = normalize(item.title);
        const a = normalize(item.artist?.name);
        let s = 0;
        if (t === nTitle) s += 3;
        if (a === nArtist) s += 3;
        if (year && item.release_date && String(item.release_date).startsWith(String(year))) s += 1;
        if (normalize(item.record_type) === 'album') s += 1;
        return s;
      }

      const pick = dzData[0];
      if (pick?.link) deezerLink = pick.link;
    }

    // 4) Куда вести кнопку
    if (!deezerLink) {
      const searchQuery = `${title} ${artistName} ${year || ''}`.trim();
      const fallback = `https://www.deezer.com/search/${encodeURIComponent(searchQuery)}`;
      setButtonState({
        state: 'ym2deezer--fallback',
        text: `${artistName} — ${title}`,
        href: fallback
      });
      return;
    }

    // Нашли deezer-альбом → строим ссылку на Harmony
    const harmonyUrl = buildHarmonyUrl(deezerLink, HARMONY_REGION);
    setButtonState({
      state: 'ym2deezer--found',
      text: `${artistName} — ${title}`,
      href: harmonyUrl
    });
  }

  // ---------- SPA watcher ----------
  let lastProcessedHref = null;
  async function routerLoop() {
    while (true) {
      const href = location.href;
      if (href !== lastProcessedHref) {
        lastProcessedHref = href;
        const id = getAlbumIdFromUrl(href);
        if (id) {
          ensureButton();
          // Подождём рендер и вставим между «Слушать» и «Трейлер»
          for (let i = 0; i < 20; i++) {
            const placed = placeButtonInline();
            if (placed) break;
            await sleep(100);
          }
          syncShapeWithPlay();
          processAlbum(id);
        }
      } else {
        // SPA может перерисовывать хедер — поддерживаем позицию и форму, но без дёргания
        placeButtonInline();
        syncShapeWithPlay();
      }
      await sleep(300);
    }
  }

  window.addEventListener('resize', () => {
    // при изменении размеров подровняем форму под «Слушать»
    syncShapeWithPlay();
  });

  // Start
  ensureButton();
  routerLoop();

})();
