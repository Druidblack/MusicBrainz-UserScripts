// ==UserScript==
// @name         Yandex Music → Deezer → Harmony (Album Finder)
// @namespace   https://github.com/Druidblack/MusicBrainz-UserScripts
// @version      1.4.3
// @description  On the album page, Yandex Music searches for a release in Deezer and opens Harmony;
// @author       Druidblack
// @match        https://music.yandex.ru/*
// @run-at       document-idle
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
    // В SPA React может удалить целый контейнер вместе с нашей кнопкой.
    // Ссылка btn при этом остаётся, поэтому проверяем присутствие в DOM.
    if (btn) {
      if (!btn.isConnected && document.body) document.body.appendChild(btn);
      return btn;
    }

    // Используем настоящий button, как и стандартные элементы интерфейса.
    btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ym2deezer-btn ym2deezer--searching ym2deezer--floating';
    btn.dataset.href = '';
    btn.dataset.albumId = '';
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
      // При очень быстрой навигации не открываем ссылку от прошлого альбома.
      if (!href || btn.dataset.albumId !== getAlbumIdFromUrl(location.href)) return;
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

  function hideButton() {
    if (!btn) return;
    btn.classList.add('ym2deezer--hidden');
    btn.dataset.href = '';
    btn.dataset.albumId = '';
    btn.setAttribute('aria-disabled', 'true');
    const badge = btn.querySelector('.ym2deezer-badge');
    if (badge) badge.textContent = '';
  }

  function showButton() {
    if (!btn) return;
    btn.classList.remove('ym2deezer--hidden');
  }

  // ---------- Placement ----------
  // На страницах с разными макетами сначала ищем кнопки в основной
  // области, чтобы не спутать их с глобальным музыкальным плеером.
  const PLAY_LABELS = ['Воспроизведение', 'Слушать', 'Play', 'Listen'];
  const TRAILER_LABELS = ['Запустить трейлер', 'Play trailer'];
  const SHAPE_PROPERTIES = [
    'box-sizing', 'height', 'min-height', 'max-height',
    'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
    'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style',
    'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
    'border-radius', 'box-shadow', 'font-family', 'font-size', 'font-weight',
    'font-style', 'line-height', 'letter-spacing', 'text-transform'
  ];

  function getNativeButtons() {
    // Сначала берём кнопки именно из шапки страницы, а не из глобального плеера.
    // Такой же контейнер использует соседний MusicBrainz userscript.
    const scopes = [
      document.querySelector('[class*="PageHeaderBase_controls__"]'),
      document.querySelector('main'),
      document.querySelector('[role="main"]'),
      document
    ].filter(Boolean);

    for (const scope of scopes) {
      const matches = [...scope.querySelectorAll('button[aria-label]')]
        .filter(el => el !== btn && el.isConnected && el.getClientRects().length);
      const playBtn = matches.find(el => PLAY_LABELS.includes(el.getAttribute('aria-label')));
      const trailerBtn = matches.find(el => TRAILER_LABELS.includes(el.getAttribute('aria-label')));
      if (playBtn || trailerBtn) return { playBtn, trailerBtn };
    }
    return { playBtn: null, trailerBtn: null };
  }

  function setFloatingMode() {
    if (!btn || btn.classList.contains('ym2deezer--floating') && btn.parentElement === document.body) return;

    // В режиме fallback кнопка живёт прямо в body, а не в контейнере,
    // который React может скрыть или удалить при смене страницы.
    if (btn.parentElement !== document.body) document.body.appendChild(btn);
    const ownClasses = [...btn.classList].filter(name => name.startsWith('ym2deezer'));
    btn.className = [...new Set([...ownClasses, 'ym2deezer--floating'])].join(' ');
    for (const property of SHAPE_PROPERTIES) btn.style.removeProperty(property);
    btn.style.removeProperty('margin');
  }

  // Важно: у других userscript могут быть собственные кнопки в том же ряду.
  // MusicBrainz держит свой wrapper НЕПОСРЕДСТВЕННО перед «Трейлером»
  // (а если трейлера нет — НЕПОСРЕДСТВЕННО после «Воспроизведение»).
  // Не требуем смежности с этими кнопками: иначе два MutationObserver
  // бесконечно двигают элементы друг друга.
  function isBefore(left, right) {
    return Boolean(left && right &&
      (left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING));
  }

  function placeButtonInline() {
    ensureButton();
    const { playBtn, trailerBtn } = getNativeButtons();

    if (playBtn && trailerBtn && trailerBtn.parentElement) {
      const parent = trailerBtn.parentElement;
      // Позиция корректна, если Harmony находится между нативными кнопками,
      // даже когда между нами и «Трейлером» есть чужие кнопки или обёртки.
      const alreadyPlaced = btn.parentElement === parent &&
        isBefore(btn, trailerBtn) &&
        (playBtn.parentElement !== parent || isBefore(playBtn, btn));
      if (!alreadyPlaced) parent.insertBefore(btn, trailerBtn);
      btn.classList.remove('ym2deezer--floating');
      syncShapeWithNativeButton(trailerBtn);
      return true;
    }

    if (playBtn && playBtn.parentElement) {
      const parent = playBtn.parentElement;
      // MusicBrainz может вставить свой wrapper сразу после playBtn.
      // Не вытесняем его оттуда, если наша кнопка уже стоит правее.
      const alreadyPlaced = btn.parentElement === parent && isBefore(playBtn, btn);
      if (!alreadyPlaced) playBtn.insertAdjacentElement('afterend', btn);
      btn.classList.remove('ym2deezer--floating');
      syncShapeWithNativeButton(playBtn);
      return true;
    }

    // Если шапка ещё загружается, не оставляем кнопку в старом/удалённом DOM.
    setFloatingMode();
    return false;
  }

  function syncShapeWithNativeButton(referenceBtn) {
    if (!btn || !referenceBtn || !referenceBtn.isConnected) return;

    // Классы CSS Modules могут измениться после навигации.
    const ownClasses = [...btn.classList].filter(name => name.startsWith('ym2deezer'));
    const nativeClasses = [...referenceBtn.classList].filter(name => !name.startsWith('ym2deezer'));
    const className = [...nativeClasses, ...ownClasses].join(' ');
    if (btn.className !== className) btn.className = className;

    const computed = getComputedStyle(referenceBtn);
    for (const property of SHAPE_PROPERTIES) {
      const value = computed.getPropertyValue(property);
      if (btn.style.getPropertyValue(property) !== value) {
        btn.style.setProperty(property, value);
      }
    }
    if (btn.style.margin !== '0px') btn.style.margin = '0';
  }

  // ---------- Helpers ----------
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
  async function processAlbum(albumId, requestId) {
    // Результаты старого запроса нельзя отображать после перехода на другой альбом.
    const isCurrent = () => requestId === activeRequestId
      && getAlbumIdFromUrl(location.href) === albumId;

    // 1) Яндекс API
    let res;
    try {
      const ya = await gmGetJson(`https://api.music.yandex.net/albums/${albumId}`);
      res = ya?.result;
    } catch (e) {
      console.warn('[YM→DZ] Yandex API error:', e);
      if (isCurrent()) setButtonState({ state: 'ym2deezer--error', text: 'Yandex API error', href: '#' });
      return;
    }

    if (!isCurrent()) return;

    const title = res?.title || '';
    const year  = res?.year || '';
    const artistName = Array.isArray(res?.artists) && res.artists.length
      ? res.artists.map(a => a.name).join(', ')
      : '';

    if (!title || !artistName) {
      if (isCurrent()) setButtonState({ state: 'ym2deezer--error', text: 'No title/artist', href: '#' });
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

    if (!isCurrent()) return;

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
  // Состояние страницы и состояние сетевого запроса разделены.
  // Проверка выполняется сразу после DOM-перерисовки, а интервал служит
  // страховкой для переходов History API без события popstate.
  let activeAlbumId = null;
  let activeRequestId = 0;
  let syncTimer = null;

  function syncPage() {
    const albumId = getAlbumIdFromUrl(location.href);

    if (!albumId) {
      if (activeAlbumId !== null) {
        activeAlbumId = null;
        ++activeRequestId; // отмена публикации результата предыдущего альбома
      }
      if (btn) {
        // На не-альбомных страницах кнопка должна быть только скрыта,
        // без вмешательства в чужой React-контейнер.
        setFloatingMode();
        hideButton();
      }
      return;
    }

    ensureButton(); // восстанавливаем потерянную кнопку, даже если URL не изменился
    showButton();
    btn.dataset.albumId = albumId;

    if (albumId !== activeAlbumId) {
      activeAlbumId = albumId;
      const requestId = ++activeRequestId;
      setButtonState({ state: 'ym2deezer--searching', text: 'Searching…', href: '' });
      // Обработка идёт параллельно рендеру. Больше нет задержки поиска на 2 секунды.
      processAlbum(albumId, requestId).catch(error => {
        console.warn('[YM→DZ] Unexpected album processing error:', error);
        if (requestId === activeRequestId && getAlbumIdFromUrl(location.href) === albumId) {
          setButtonState({ state: 'ym2deezer--error', text: 'Search error', href: '' });
        }
      });
    }

    // Поправляем положение при каждом изменении DOM, даже если тот же альбом.
    placeButtonInline();
  }

  function scheduleSync(delay = 60) {
    if (syncTimer !== null) return;
    syncTimer = setTimeout(() => {
      syncTimer = null;
      syncPage();
    }, delay);
  }

  // Отслеживаем удаление контейнеров и появление новой шапки альбома.
  // Изменения ВНУТРИ нашей кнопки игнорируются, чтобы не создавать цикл.
  const observer = new MutationObserver(records => {
    if (records.some(record => !btn || !btn.contains(record.target))) {
      scheduleSync();
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  window.addEventListener('popstate', () => scheduleSync(0));
  window.addEventListener('hashchange', () => scheduleSync(0));
  window.addEventListener('pageshow', () => scheduleSync(0));
  window.addEventListener('resize', () => scheduleSync(0));
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) scheduleSync(0);
  });

  // Некоторые переходы Яндекс Музыки не вызывают обычных событий навигации.
  // Редкая проверка URL + DOM страхует и от этих случаев.
  setInterval(syncPage, 750);
  syncPage();
})();
