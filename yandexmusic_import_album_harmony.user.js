// ==UserScript==
// @name         Yandex Music → Deezer → Harmony (Album Finder)
// @namespace   https://github.com/Druidblack/MusicBrainz-UserScripts
// @version      1.4.1
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
      justify-content: center;
      gap: 8px;
      box-sizing: border-box;
      margin: 0;
      vertical-align: middle;
      white-space: nowrap;
      text-decoration: none;
      cursor: pointer;
      color: #000 !important;
      background-image: none !important;
    }

    .ym2deezer-btn:hover,
    .ym2deezer-btn:active,
    .ym2deezer-btn:focus-visible {
      color: #000 !important;
      transform: none;
    }

    .ym2deezer-icon {
      width: 18px;
      height: 18px;
      display: inline-block;
      flex: 0 0 auto;
      vertical-align: middle;
      object-fit: contain;
      image-rendering: auto;
      pointer-events: none;
    }

    /* Не рисуем отдельную "капсулу" внутри нативной кнопки. */
    .ym2deezer-badge {
      display: inline;
      padding: 0;
      margin: 0;
      border: 0;
      border-radius: 0;
      background: none;
      color: inherit !important;
      font: inherit;
      line-height: inherit;
      pointer-events: none;
    }

    /* Плавающий режим — только fallback, пока шапка альбома не отрисована. */
    .ym2deezer--floating {
      position: fixed;
      top: 12px;
      right: 12px;
      z-index: 99999;
      min-height: 40px;
      padding: 8px 14px;
      border: 0;
      border-radius: 10px;
      font: 600 14px/1.1 system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, 'Helvetica Neue', Arial, sans-serif;
      box-shadow: 0 2px 8px rgba(0,0,0,.18);
    }

    /* Цвета состояний. !important нужен, чтобы перебить фон нативного класса. */
    .ym2deezer--searching { background-color: #ff9f1c !important; }
    .ym2deezer--found     { background-color: #2ecc71 !important; }
    .ym2deezer--fallback  { background-color: #3498db !important; }
    .ym2deezer--error     { background-color: #e74c3c !important; }

    .ym2deezer--searching:hover { background-color: #ffad42 !important; }
    .ym2deezer--found:hover     { background-color: #55d88a !important; }
    .ym2deezer--fallback:hover  { background-color: #4aa6e1 !important; }
    .ym2deezer--error:hover     { background-color: #ef6b60 !important; }

    .ym2deezer--hidden { display: none !important; }
  `);

  // ---------- UI ----------
  let btn = null;

  function ensureButton() {
    if (btn) return btn;

    // Используем настоящий button, как и стандартные элементы интерфейса.
    btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ym2deezer-btn ym2deezer--searching ym2deezer--floating';
    btn.dataset.href = '';
    btn.title = 'Open in Harmony (via Deezer)';
    btn.setAttribute('aria-label', 'Open in Harmony via Deezer');
    btn.setAttribute('aria-disabled', 'true');

    btn.innerHTML = `
      <img class="ym2deezer-icon" alt="">
      <span class="ym2deezer-badge">Searching…</span>
    `;

    btn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();

      const href = btn.dataset.href;
      if (!href) return;
      window.open(href, '_blank', 'noopener,noreferrer');
    });

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

    btn.dataset.href = href && href !== '#' ? href : '';
    btn.setAttribute('aria-disabled', btn.dataset.href ? 'false' : 'true');
  }

  // показать/скрыть на не-альбомных страницах
  const isAlbumPage = () => /^\/album\/\d+/.test(location.pathname);

  function hideButton() {
    if (!btn) return;
    btn.classList.add('ym2deezer--hidden');
    btn.dataset.href = '';
    btn.setAttribute('aria-disabled', 'true');
    const badge = btn.querySelector('.ym2deezer-badge');
    if (badge) badge.textContent = '';
  }

  function showButton() {
    if (!btn) return;
    btn.classList.remove('ym2deezer--hidden');
  }

  // ---------- Placement ----------
  function placeButtonInline() {
    ensureButton();

    const playBtn    = document.querySelector('button[aria-label="Воспроизведение"]');
    const trailerBtn = document.querySelector('button[aria-label="Запустить трейлер"]');

    // Вставка строго перед «Трейлер».
    if (playBtn && trailerBtn && trailerBtn.parentElement) {
      const parent = trailerBtn.parentElement;
      if (btn.parentElement !== parent || btn.nextSibling !== trailerBtn) {
        parent.insertBefore(btn, trailerBtn);
      }
      btn.classList.remove('ym2deezer--floating');
      syncShapeWithNativeButton(trailerBtn);
      return true;
    }

    // Если «Трейлер» нет — ставим сразу после «Слушать».
    if (playBtn && playBtn.parentElement) {
      if (playBtn.nextSibling !== btn) {
        playBtn.insertAdjacentElement('afterend', btn);
      }
      btn.classList.remove('ym2deezer--floating');
      syncShapeWithNativeButton(playBtn);
      return true;
    }

    // Фолбэк — плавающая кнопка.
    btn.classList.add('ym2deezer--floating');
    return false;
  }

  // Берём классы и геометрию соседней нативной кнопки Яндекс Музыки.
  function syncShapeWithNativeButton(referenceBtn = null) {
    if (!btn) return;

    const playBtn = document.querySelector('button[aria-label="Воспроизведение"]');
    const trailerBtn = document.querySelector('button[aria-label="Запустить трейлер"]');
    const ref = referenceBtn || trailerBtn || playBtn;
    if (!ref || ref === btn) return;

    // CSS-модули Яндекс Музыки используют динамические имена классов.
    // Копируем их с соседней кнопки, сохраняя собственные state-классы.
    const ownClasses = Array.from(btn.classList).filter((name) => name.startsWith('ym2deezer'));
    const nativeClasses = Array.from(ref.classList).filter((name) => !name.startsWith('ym2deezer'));
    btn.className = [...nativeClasses, ...ownClasses].join(' ');

    const cs = getComputedStyle(ref);
    const shapeProperties = [
      'box-sizing',
      'height',
      'min-height',
      'max-height',
      'padding-top',
      'padding-right',
      'padding-bottom',
      'padding-left',
      'border-top-width',
      'border-right-width',
      'border-bottom-width',
      'border-left-width',
      'border-top-style',
      'border-right-style',
      'border-bottom-style',
      'border-left-style',
      'border-top-color',
      'border-right-color',
      'border-bottom-color',
      'border-left-color',
      'border-radius',
      'box-shadow',
      'font-family',
      'font-size',
      'font-weight',
      'font-style',
      'line-height',
      'letter-spacing',
      'text-transform'
    ];

    for (const property of shapeProperties) {
      btn.style.setProperty(property, cs.getPropertyValue(property));
    }

    // Родительский контейнер сам задаёт расстояние между кнопками через gap.
    btn.style.margin = '0';
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
    // 4) Фолбэк: inline SVG, чтобы не было "битого" файла
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
          showButton();
          // Подождём рендер и вставим между «Слушать» и «Трейлер»
          for (let i = 0; i < 20; i++) {
            const placed = placeButtonInline();
            if (placed) break;
            await sleep(100);
          }
          syncShapeWithNativeButton();
          processAlbum(id);
        } else {
          // Не страница альбома — прячем кнопку
          hideButton();
        }
      } else {
        // Поддерживаем позицию и форму только на страницах альбома
        if (isAlbumPage()) {
          placeButtonInline();
          syncShapeWithNativeButton();
        } else {
          hideButton();
        }
      }
      await sleep(300);
    }
  }

  window.addEventListener('resize', () => {
    // при изменении размеров подровняем форму под «Слушать»
    if (isAlbumPage()) syncShapeWithNativeButton();
  });

  // ---------- Start ----------
  ensureButton();
  // моментальная реакция при первой загрузке
  if (!isAlbumPage()) hideButton();
  routerLoop();

})();
