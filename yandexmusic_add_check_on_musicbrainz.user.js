// ==UserScript==
// @name         Yandex Music → MusicBrainz: Check Exists
// @version      1.0.0
// @description  Добавляет рядом с "Add to MusicBrainz" и "Search on MusicBrainz" кнопку "Check on MusicBrainz", которая ищет релиз/релиз-группу через API и показывает результат панелью.
// @match        https://music.yandex.ru/*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @connect      musicbrainz.org
// @icon        https://musicbrainz.org/favicon.ico
// @downloadURL  https://github.com/Druidblack/MusicBrainz-UserScripts/raw/main/yandexmusic_add_check_on_musicbrainz.user.js
// @updateURL    https://github.com/Druidblack/MusicBrainz-UserScripts/raw/main/yandexmusic_add_check_on_musicbrainz.user.js
// ==/UserScript==

(function () {
  'use strict';

  const BTN_ID   = 'mb-check-exists-btn';
  const PANEL_ID = 'mb-check-panel';
  const MB_BASE  = 'https://musicbrainz.org/ws/2';

  // ---------- helpers ----------
  const qs  = (s, r=document) => r.querySelector(s);
  const qsa = (s, r=document) => Array.from(r.querySelectorAll(s));
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  function styleButton(el) {
    el.style.backgroundColor = '#ffcc33';
    el.style.border = 'none';
    el.style.outline = 'none';
    el.style.borderRadius = '20px';
    el.style.color = '#121212';
    el.style.cursor = 'pointer';
    el.style.textDecoration = 'none';
    el.style.transition = 'background-color 0.2s ease';
    el.style.padding = '0 18px';
    el.style.height = '36px';
    el.style.display = 'inline-flex';
    el.style.alignItems = 'center';
    el.style.fontWeight = '600';
    el.style.whiteSpace = 'nowrap';
    el.addEventListener('mouseenter', () => (el.style.backgroundColor = '#ffd34d'));
    el.addEventListener('mouseleave', () => (el.style.backgroundColor = '#ffcc33'));
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
  const sanitize    = s => (s || '').replace(/\s+/g, ' ').trim();
  const stripExtras = t => sanitize(t.replace(/[\[(].*?[\])]/g, ''));
  const uniqBy = (arr, key) => { const seen = new Set(); return arr.filter(it => (seen.has(key(it)) ? false : seen.add(key(it)))); };

  // ---------- panel ----------
  function createPanel() {
    let panel = document.getElementById(PANEL_ID);
    if (panel) return panel;
    panel = document.createElement('div');
    panel.id = PANEL_ID;
    Object.assign(panel.style, {
      position:'fixed', right:'16px', bottom:'16px', maxWidth:'560px',
      background:'rgba(18,18,18,0.98)', color:'#fff',
      border:'1px solid rgba(255,255,255,0.12)', borderRadius:'14px',
      padding:'12px 14px', boxShadow:'0 10px 30px rgba(0,0,0,0.4)',
      fontFamily:'system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Cantarell,Noto Sans,sans-serif',
      zIndex: 999999
    });
    panel.innerHTML =
      '<div style="display:flex;gap:10px;align-items:center;justify-content:space-between">' +
      '<strong>MusicBrainz</strong>' +
      '<button id="mb-close" style="all:unset;cursor:pointer;padding:6px">✕</button>' +
      '</div><div id="mb-body" style="margin-top:8px;font-size:14px;line-height:1.4"></div>';
    document.body.appendChild(panel);
    panel.querySelector('#mb-close').addEventListener('click', () => panel.remove());
    return panel;
  }

  // ---------- meta extraction (как в твоём файле) ----------
  function extractAlbumMeta() {
    const rawTitle =
      (qs('span.PageHeaderTitle_title__caKyB')?.textContent || '').trim() ||
      (qs('.page-album__title span.deco-typo')?.textContent || '').trim() ||
      (qs('.page-album__title')?.textContent || '').trim();

    let albumTitle = rawTitle;

    const entityStr = qs('div.PageHeaderBase_entityName__9Sj_Q')?.textContent?.trim() || '';

    const metaArtists = qsa('div.PageHeaderAlbumMeta_meta__zsMI8 span.PageHeaderAlbumMeta_artistLabel__2WZSM')
      .map(el => el.textContent.trim())
      .filter(Boolean);

    let audioAuthors = [];
    let artistList   = metaArtists.slice();
    let relPrimary   = 'Album';
    let relSecondary = null;

    if (entityStr.toUpperCase().includes('АУДИО')) {
      relPrimary   = 'Other';
      relSecondary = 'Audiobook';
      const m = rawTitle.match(/«([^»]+)»/);
      if (m) albumTitle = m[1];
      const authorsPart = rawTitle.split('. «')[0];
      audioAuthors = authorsPart.split(',').map(a => a.trim()).filter(Boolean);
      artistList   = audioAuthors.concat(metaArtists);
    } else if (entityStr === 'Сингл') {
      relPrimary = 'Single';
    }

    const yearMatch = (qs('div.PageHeaderAlbumMeta_year__2X3NO')?.textContent || '').match(/(\d{4})/);
    const year = yearMatch ? yearMatch[1] : null;

    return {
      albumTitle: sanitize(albumTitle),
      albumTitleStripped: stripExtras(albumTitle),
      artistList: artistList.map(sanitize).filter(Boolean),
      year, relPrimary, relSecondary,
    };
  }

  // ---------- MusicBrainz API (CORS-safe) ----------
  function mbGet(pathAndQuery) {
    const url = `${MB_BASE}${pathAndQuery}${pathAndQuery.includes('?') ? '&' : '?'}fmt=json`;
    if (typeof GM_xmlhttpRequest === 'function') {
      return new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
          method: 'GET',
          url,
          headers: { Accept: 'application/json' },
          responseType: 'json',
          timeout: 15000,
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
    // fallback (если внезапно нет грантов)
    return fetch(url, { headers: { Accept: 'application/json' } }).then(r => {
      if (!r.ok) throw new Error(`MusicBrainz HTTP ${r.status}`);
      return r.json();
    });
  }

  const rgQuery = (m, stripped=false) => {
    const t = stripped ? m.albumTitleStripped : m.albumTitle;
    const parts = [`releasegroup:"${t.replace(/"/g,'\\"')}"`];
    m.artistList.forEach(a => parts.push(`artist:"${a.replace(/"/g,'\\"')}"`));
    if (m.year) parts.push(`firstreleaseyear:${m.year}`);
    if (m.relPrimary === 'Single') parts.push('primarytype:single');
    if (m.relPrimary === 'Album')  parts.push('primarytype:album');
    return parts.join(' AND ');
  };
  const relQuery = (m, stripped=false) => {
    const t = stripped ? m.albumTitleStripped : m.albumTitle;
    const parts = [`release:"${t.replace(/"/g,'\\"')}"`];
    m.artistList.forEach(a => parts.push(`artist:"${a.replace(/"/g,'\\"')}"`));
    if (m.year) parts.push(`date:${m.year}`);
    return parts.join(' AND ');
  };

  async function searchReleaseGroups(meta) {
    const queries = [rgQuery(meta,false)];
    if (meta.albumTitleStripped && meta.albumTitleStripped !== meta.albumTitle) queries.push(rgQuery(meta,true));
    const results = [];
    for (const q of queries) {
      const data = await mbGet(`/release-group/?query=${encodeURIComponent(q)}&limit=10`);
      (data['release-groups'] || []).forEach(rg => {
        results.push({
          kind:'release-group', id:rg.id, title:rg.title,
          score:rg.score ?? 0,
          firstReleaseDate: rg['first-release-date'] || '',
          primaryType: rg['primary-type'] || '',
          artistCredit: (rg['artist-credit'] || []).map(ac => ac.name).join(', '),
          url:`https://musicbrainz.org/release-group/${rg.id}`,
        });
      });
      await sleep(250);
    }
    const seen = new Set();
    return results.filter(x => (seen.has(x.id) ? false : seen.add(x.id))).sort((a,b)=>b.score-a.score);
  }

  async function searchReleases(meta) {
    const queries = [relQuery(meta,false)];
    if (meta.albumTitleStripped && meta.albumTitleStripped !== meta.albumTitle) queries.push(relQuery(meta,true));
    const results = [];
    for (const q of queries) {
      const data = await mbGet(`/release/?query=${encodeURIComponent(q)}&limit=10`);
      (data['releases'] || []).forEach(rel => {
        results.push({
          kind:'release', id:rel.id, title:rel.title,
          score:rel.score ?? 0,
          date: rel.date || '',
          status: rel.status || '',
          artistCredit: (rel['artist-credit'] || []).map(ac => ac.name).join(', '),
          url:`https://musicbrainz.org/release/${rel.id}`,
        });
      });
      await sleep(250);
    }
    const seen = new Set();
    return results.filter(x => (seen.has(x.id) ? false : seen.add(x.id))).sort((a,b)=>b.score-a.score);
  }

  function renderResults(meta, rgList, relList) {
    const panel = createPanel();
    const body  = panel.querySelector('#mb-body');
    const found = rgList.length + relList.length;
    const title = meta.albumTitle;
    const artists = meta.artistList.join(', ');

    if (!found) {
      body.innerHTML =
        `<div><strong>Не найдено</strong> по «${escapeHtml(title)}» — ${escapeHtml(artists)}${meta.year ? ' (' + meta.year + ')' : ''}.</div>` +
        `<div style="margin-top:6px"><a target="_blank" href="https://musicbrainz.org/search?query=${encodeURIComponent(title)}&type=release">Открыть поиск вручную</a></div>`;
      return;
    }
    const mk = (it) => {
      const small = it.kind === 'release-group'
        ? `${it.primaryType || 'RG'}${it.firstReleaseDate ? ' • ' + it.firstReleaseDate : ''}`
        : `${it.status || 'Release'}${it.date ? ' • ' + it.date : ''}`;
      return `
        <div style="padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.1)">
          <div style="display:flex;justify-content:space-between;gap:8px;align-items:baseline">
            <a href="${it.url}" target="_blank" style="color:#9ecbff;text-decoration:none">${escapeHtml(it.title)}</a>
            <span style="opacity:0.7;font-size:12px">score: ${it.score}</span>
          </div>
          <div style="opacity:0.9;font-size:13px;margin-top:2px">${escapeHtml(it.artistCredit)}</div>
          <div style="opacity:0.7;font-size:12px">${escapeHtml(small)}</div>
        </div>`;
    };
    body.innerHTML =
      `<div style="margin-bottom:6px"><strong>Найдено: ${found}</strong> по «${escapeHtml(title)}» — ${escapeHtml(artists)}${meta.year ? ' (' + meta.year + ')' : ''}.</div>` +
      rgList.slice(0,5).map(mk).join('') +
      relList.slice(0,5).map(mk).join('') +
      `<div style="margin-top:6px"><a target="_blank" href="https://musicbrainz.org/search?query=${encodeURIComponent(title)}&type=release">Полный поиск на MusicBrainz</a></div>`;
  }

  // ---------- injection: рядом с твоим .mb-buttons ----------
  function attachButton() {
    // только на страницах альбомов
    if (!/\/album\//.test(location.pathname)) return;

    // ждём контейнер из твоего скрипта
    const wrap = qs('.mb-buttons');
    if (!wrap) return;

    // не дублируем кнопку
    if (wrap.querySelector('#' + BTN_ID)) return;

    // делаем кнопку такой же, как твои
    const btn = document.createElement('button');
    btn.id = BTN_ID;
    btn.type = 'button';
    btn.textContent = 'Check on MusicBrainz';
    styleButton(btn);

    // Ставим В КОНЕЦ контейнера (рядом с Add/Search)
    wrap.appendChild(btn);

    // Клик — запрос и панель с результатами
    btn.addEventListener('click', async () => {
      const panel = createPanel();
      const body  = panel.querySelector('#mb-body');
      body.textContent = 'Ищем в MusicBrainz…';

      const meta = extractAlbumMeta();
      if (!meta.albumTitle || !meta.artistList.length) {
        body.textContent = 'Не удалось извлечь название/исполнителя со страницы.';
        return;
      }
      try {
        const [rg, rel] = await Promise.all([searchReleaseGroups(meta), searchReleases(meta)]);
        renderResults(meta, rg, rel);
      } catch (e) {
        body.textContent = 'Ошибка запроса: ' + e.message;
      }
    });

    // Чуть подогнать размеры под «Слушать»
    const listen = qs('div.PageHeaderBase_controls__HzGgE button[aria-label="Воспроизведение"]');
    if (listen) {
      const cs = getComputedStyle(listen);
      btn.style.height = cs.height;
      btn.style.borderRadius = cs.borderRadius;
      btn.style.paddingTop = cs.paddingTop;
      btn.style.paddingBottom = cs.paddingBottom;
      btn.style.paddingLeft = cs.paddingLeft;
      btn.style.paddingRight = cs.paddingRight;
      btn.style.fontSize = cs.fontSize;
      btn.style.fontWeight = cs.fontWeight;
      btn.style.fontFamily = cs.fontFamily;
    }
  }

  // ---------- observers (SPA/DOM) ----------
  const mo = new MutationObserver(() => attachButton());
  mo.observe(document.documentElement || document.body, { childList: true, subtree: true });

  ['pushState','replaceState'].forEach(m => {
    const orig = history[m];
    history[m] = function () {
      const ret = orig.apply(this, arguments);
      setTimeout(attachButton, 100);
      return ret;
    };
  });
  window.addEventListener('popstate', () => setTimeout(attachButton, 100));

  // старт
  attachButton();
})();
