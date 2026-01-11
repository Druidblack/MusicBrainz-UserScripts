// ==UserScript==
// @name         MediUX → TMDb uploader
// @namespace    https://github.com/Druidblack/MusicBrainz-UserScripts
// @version      0.6.10
// @description  MediUX → TMDb uploader
// @author       Druidblack
// @match        https://mediux.pro/*
// @match        https://www.mediux.pro/*
// @match        https://www.themoviedb.org/*
// @match        https://themoviedb.org/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @connect      api.mediux.pro
// @run-at       document-idle
//
// @downloadURL  https://github.com/Druidblack/MusicBrainz-UserScripts/raw/main/mediux_tmdb_uploader.user.js
// @updateURL    https://github.com/Druidblack/MusicBrainz-UserScripts/raw/main/mediux_tmdb_uploader.user.js
// ==/UserScript==

(function () {
  'use strict';

  const CFG = {
    tmdbAutoOpenUploadWindow: true,
    tmdbAutoSubmit: false,
    autoNextAfterInsert: false,

    // none | all | selected_season
    episodeMode: 'selected_season',

    // Preview current image in TMDb panel
    previewInPanel: true,

    uiZ: 999999,

    maxSeasons: 200,
    maxEpisodesPerSeason: 500,

    waitUploadInputMs: 5000,
    waitUploadInputStepMs: 150,
  };

  const IDS = {
    mediuxPanel: 'mediux_tmdb_flow_panel__mediux',
    tmdbPanel:   'mediux_tmdb_flow_panel__tmdb',
  };

  const KEYS = {
    orphanStartSeason: 'mediux_tmdb_orphan_episode_start_season',
  };

  const isMediuxHost = () => /(^|\.)mediux\.pro$/.test(location.hostname);
  const isTMDbHost  = () => /(^|\.)themoviedb\.org$/.test(location.hostname);

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function toast(msg, ms = 2600) {
    const el = document.createElement('div');
    el.textContent = msg;
    el.style.cssText = `
      position: fixed; left: 50%; bottom: 18px; transform: translateX(-50%);
      background: rgba(20,20,20,.92); color: #fff; padding: 10px 12px;
      border-radius: 10px; font: 13px/1.2 system-ui, -apple-system, Segoe UI, Roboto, Arial;
      z-index: ${CFG.uiZ};
      max-width: 80vw; box-shadow: 0 8px 30px rgba(0,0,0,.35);
    `;
    document.documentElement.appendChild(el);
    setTimeout(() => el.remove(), ms);
  }

  function makePanel(title, panelId) {
    const existing = document.getElementById(panelId);
    if (existing) return { box: existing, body: existing.querySelector('[data-body="1"]') };

    const box = document.createElement('div');
    box.id = panelId;
    box.style.cssText = `
      position: fixed; right: 14px; top: 14px; z-index: ${CFG.uiZ};
      width: 600px; max-width: calc(100vw - 28px);
      background: rgba(255,255,255,.96);
      color: #111;
      border: 1px solid rgba(0,0,0,.12);
      border-radius: 14px;
      box-shadow: 0 10px 35px rgba(0,0,0,.18);
      overflow: hidden;
      font: 13px/1.25 system-ui, -apple-system, Segoe UI, Roboto, Arial;
    `;

    const head = document.createElement('div');
    head.style.cssText = `
      padding: 10px 12px;
      background: rgba(0,0,0,.05);
      display: flex; align-items: center; justify-content: space-between;
      gap: 10px;
    `;

    const h = document.createElement('div');
    h.style.cssText = 'font-weight: 700; font-size: 13px;';
    h.textContent = title;

    const close = document.createElement('button');
    close.textContent = '×';
    close.title = 'Закрыть';
    close.style.cssText = `
      border: none; background: transparent; cursor: pointer;
      font-size: 18px; line-height: 1; padding: 0 4px;
      opacity: .7;
    `;
    close.onclick = () => box.remove();

    head.appendChild(h);
    head.appendChild(close);

    const body = document.createElement('div');
    body.dataset.body = '1';
    body.style.cssText = 'padding: 10px 12px; display: grid; gap: 8px;';

    box.appendChild(head);
    box.appendChild(body);

    document.documentElement.appendChild(box);
    return { box, body };
  }

  function btn(text, onClick, kind = 'primary') {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = text;
    b.onclick = onClick;

    const base = `
      width: 100%;
      padding: 9px 10px;
      border-radius: 10px;
      cursor: pointer;
      border: 1px solid rgba(0,0,0,.14);
      font-weight: 600;
    `;
    const styles = {
      primary: `background: rgba(0,0,0,.88); color: #fff;`,
      soft: `background: rgba(0,0,0,.06); color: #111;`,
      warn: `background: rgba(255, 193, 7, .22); color: #111;`,
      danger: `background: rgba(220, 53, 69, .18); color: #111;`,
    };
    b.style.cssText = base + (styles[kind] || styles.primary);
    return b;
  }

  function codeBlock(text) {
    const pre = document.createElement('pre');
    pre.textContent = text;
    pre.style.cssText = `
      white-space: pre-wrap; word-break: break-word;
      background: rgba(0,0,0,.05);
      border: 1px solid rgba(0,0,0,.08);
      border-radius: 10px;
      padding: 8px;
      margin: 0;
      max-height: 260px;
      overflow: auto;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
      font-size: 12px;
    `;
    return pre;
  }

  function isVisible(el) {
    if (!el) return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function randToken() {
    return (Math.random().toString(36).slice(2) + Date.now().toString(36)).toUpperCase();
  }

  function normalizeTMDbUrl(url) {
    if (!url) return null;
    try {
      const u = new URL(url);
      u.hostname = 'www.themoviedb.org';
      return u.toString().replace(/\/+$/, '');
    } catch {
      return null;
    }
  }

  function addQuery(url, params) {
    const u = new URL(url);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
    return u.toString();
  }

  function urlWithHashOpen(url) {
    return url.includes('#') ? url : (url + '#');
  }

  function getOrphanStartSeason() {
    const v = GM_getValue(KEYS.orphanStartSeason, '1');
    const n = parseInt(String(v), 10);
    return Number.isFinite(n) ? n : 1;
  }
  function setOrphanStartSeason(n) {
    const v = (Number.isFinite(n) && n >= 0) ? String(n) : '1';
    GM_setValue(KEYS.orphanStartSeason, v);
  }

  // ========= Storage =========

  function taskKey(token) {
    return 'mediux_tmdb_task_' + token;
  }

  function getTokenFromQueryOrLast() {
    return new URLSearchParams(location.search).get('mediux_token')
      || GM_getValue('mediux_tmdb_last_token', '');
  }

  function loadTask(token) {
    if (!token) return null;
    return GM_getValue(taskKey(token), null);
  }

  function saveTask(task) {
    if (!task?.token) return;
    GM_setValue(taskKey(task.token), task);
  }

  // ============================================================
  // MediUX: YAML dialog
  // ============================================================

  async function ensureYamlDialogOpen() {
    const dlg = [...document.querySelectorAll('div[role="dialog"]')].find(d =>
      d.querySelector('pre code') && /url_poster:|url_background:|seasons:/m.test(d.textContent || '')
    );
    if (dlg) return dlg;

    const clickable = [...document.querySelectorAll('button,a')];
    const opener = clickable.find(el => (el.textContent || '').trim().toLowerCase() === 'yaml');
    if (opener) {
      opener.click();
      for (let i = 0; i < 25; i++) {
        await sleep(200);
        const dlg2 = [...document.querySelectorAll('div[role="dialog"]')].find(d =>
          d.querySelector('pre code') && /url_poster:|url_background:|seasons:/m.test(d.textContent || '')
        );
        if (dlg2) return dlg2;
      }
    }
    return null;
  }

  async function readYamlFromMediux() {
    const dlg = await ensureYamlDialogOpen();
    if (!dlg) return null;
    const code = dlg.querySelector('pre code');
    const txt = (code?.textContent || '').trim();
    return txt || null;
  }

  // ============================================================
  // YAML parser + implicit episodes blocks (multiple)
  // ============================================================

  function parseMediuxYaml(text) {
    const out = {
      url_poster: null,
      url_background: null,
      seasons: {},

      // episodes blocks without season number (may repeat)
      implicit_episode_groups: [],
    };

    const lines = (text || '').split(/\r?\n/).map(l => l.replace(/\t/g, '  '));

    let inSeasons = false;
    let seasonsIndent = null;

    let currentSeason = null;

    // explicit season episodes:
    let inEpisodes = false;
    let episodesIndent = null;
    let currentEpisode = null;

    // implicit group episodes:
    let inImplicit = false;
    let implicitIndent = null;
    let implicitGroup = null;
    let implicitEpisode = null;

    const getIndent = (line) => (line.match(/^\s*/)?.[0]?.length ?? 0);

    function endExplicitEpisodesIfNeeded(indent) {
      if (inEpisodes && episodesIndent !== null && indent <= episodesIndent) {
        inEpisodes = false;
        episodesIndent = null;
        currentEpisode = null;
      }
    }
    function endImplicitIfNeeded(indent) {
      if (inImplicit && implicitIndent !== null && indent <= implicitIndent) {
        inImplicit = false;
        implicitIndent = null;
        implicitGroup = null;
        implicitEpisode = null;
      }
    }

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      const indent = getIndent(line);

      if (/^seasons:\s*$/.test(trimmed)) {
        inSeasons = true;
        seasonsIndent = indent;

        currentSeason = null;

        inEpisodes = false;
        episodesIndent = null;
        currentEpisode = null;

        inImplicit = false;
        implicitIndent = null;
        implicitGroup = null;
        implicitEpisode = null;

        continue;
      }

      if (inSeasons && seasonsIndent !== null && indent <= seasonsIndent) {
        inSeasons = false;
        seasonsIndent = null;

        currentSeason = null;

        inEpisodes = false;
        episodesIndent = null;
        currentEpisode = null;

        inImplicit = false;
        implicitIndent = null;
        implicitGroup = null;
        implicitEpisode = null;
      }

      if (!inSeasons) {
        let m = trimmed.match(/^url_poster:\s*(https?:\/\/\S+)/);
        if (m) { out.url_poster = m[1].trim(); continue; }

        m = trimmed.match(/^url_background:\s*(https?:\/\/\S+)/);
        if (m) { out.url_background = m[1].trim(); continue; }

        continue;
      }

      // inside seasons:
      endExplicitEpisodesIfNeeded(indent);
      endImplicitIfNeeded(indent);

      // implicit episodes block (no season number)
      if (!currentSeason && /^episodes:\s*$/.test(trimmed)) {
        inImplicit = true;
        implicitIndent = indent;
        implicitGroup = { episodes: {} };
        out.implicit_episode_groups.push(implicitGroup);
        implicitEpisode = null;
        continue;
      }

      // parse implicit block
      if (inImplicit && implicitGroup) {
        if (/^(\d+):\s*$/.test(trimmed)) {
          implicitEpisode = trimmed.replace(':', '');
          if (!implicitGroup.episodes[implicitEpisode]) {
            implicitGroup.episodes[implicitEpisode] = { url_poster: null, url_background: null };
          }
          continue;
        }

        if (!implicitEpisode) continue;

        let m = trimmed.match(/^url_poster:\s*(https?:\/\/\S+)/);
        if (m) { implicitGroup.episodes[implicitEpisode].url_poster = m[1].trim(); continue; }

        m = trimmed.match(/^url_background:\s*(https?:\/\/\S+)/);
        if (m) { implicitGroup.episodes[implicitEpisode].url_background = m[1].trim(); continue; }

        continue;
      }

      // explicit season key
      if (!inEpisodes && /^(\d+):\s*$/.test(trimmed)) {
        currentSeason = trimmed.replace(':', '');
        if (!out.seasons[currentSeason]) out.seasons[currentSeason] = { url_poster: null, episodes: {} };
        continue;
      }

      if (!currentSeason) continue;

      // explicit season fields
      if (!inEpisodes) {
        let m = trimmed.match(/^url_poster:\s*(https?:\/\/\S+)/);
        if (m) { out.seasons[currentSeason].url_poster = m[1].trim(); continue; }

        if (/^episodes:\s*$/.test(trimmed)) {
          inEpisodes = true;
          episodesIndent = indent;
          currentEpisode = null;
          continue;
        }
      }

      // explicit season episodes
      if (inEpisodes) {
        if (/^(\d+):\s*$/.test(trimmed)) {
          currentEpisode = trimmed.replace(':', '');
          if (!out.seasons[currentSeason].episodes[currentEpisode]) {
            out.seasons[currentSeason].episodes[currentEpisode] = { url_poster: null, url_background: null };
          }
          continue;
        }

        if (!currentEpisode) continue;

        let m = trimmed.match(/^url_poster:\s*(https?:\/\/\S+)/);
        if (m) { out.seasons[currentSeason].episodes[currentEpisode].url_poster = m[1].trim(); continue; }

        m = trimmed.match(/^url_background:\s*(https?:\/\/\S+)/);
        if (m) { out.seasons[currentSeason].episodes[currentEpisode].url_background = m[1].trim(); continue; }
      }
    }

    return out;
  }

  // Apply implicit episode groups to seasons starting from base season number
  function applyImplicitEpisodeGroups(parsed, startSeason) {
    const groups = parsed?.implicit_episode_groups || [];
    const base = Number.isFinite(parseInt(String(startSeason), 10)) ? parseInt(String(startSeason), 10) : 1;

    if (!groups.length) return { applied: false, base, count: 0, last: base };

    for (let i = 0; i < groups.length; i++) {
      const seasonNum = String(base + i);
      if (!parsed.seasons[seasonNum]) parsed.seasons[seasonNum] = { url_poster: null, episodes: {} };

      const eps = groups[i]?.episodes || {};
      for (const [epNum, epObj] of Object.entries(eps)) {
        parsed.seasons[seasonNum].episodes[epNum] = {
          url_poster: epObj?.url_poster || null,
          url_background: epObj?.url_background || null,
        };
      }
    }

    return { applied: true, base, count: groups.length, last: base + groups.length - 1 };
  }

  function orderedNums(obj, limit) {
    return Object.keys(obj || {})
      .map(n => parseInt(n, 10))
      .filter(Number.isFinite)
      .sort((a, b) => a - b)
      .slice(0, limit)
      .map(n => String(n));
  }

  function hasAnyEpisodes(parsed) {
    const seasons = parsed?.seasons || {};
    return Object.values(seasons).some(s => Object.keys(s?.episodes || {}).length > 0);
  }

  // ============================================================
  // Steps
  // ============================================================

  function buildBaseSteps(parsed, tmdbKind) {
    const steps = [];
    if (parsed.url_poster) steps.push({ kind: 'poster' });
    if (parsed.url_background) steps.push({ kind: 'backdrop' });

    if (tmdbKind === 'tv') {
      const seasonNums = orderedNums(parsed.seasons, CFG.maxSeasons);

      for (const sn of seasonNums) {
        const sObj = parsed.seasons?.[sn];
        if (sObj?.url_poster) steps.push({ kind: 'season_poster', season: sn });
      }

      if (CFG.episodeMode === 'all') {
        for (const sn of seasonNums) {
          const eps = parsed.seasons?.[sn]?.episodes || {};
          const epNums = orderedNums(eps, CFG.maxEpisodesPerSeason);
          for (const ep of epNums) {
            const epObj = eps[ep];
            const src = epObj?.url_background || epObj?.url_poster;
            if (src) steps.push({ kind: 'episode_backdrop', season: sn, episode: ep });
          }
        }
      }
    }

    // If only episodes exist, keep a hub step so flow can open a TMDb page
    if (!steps.length && tmdbKind === 'tv' && hasAnyEpisodes(parsed)) {
      steps.push({ kind: 'hub' });
    }

    return steps;
  }

  function buildEpisodeStepsForSeason(parsed, seasonNumber) {
    const sObj = parsed?.seasons?.[String(seasonNumber)];
    const eps = sObj?.episodes || {};
    const epNums = orderedNums(eps, CFG.maxEpisodesPerSeason);

    const steps = [];
    for (const ep of epNums) {
      const epObj = eps[ep];
      const src = epObj?.url_background || epObj?.url_poster;
      if (src) steps.push({ kind: 'episode_backdrop', season: String(seasonNumber), episode: ep });
    }
    return steps;
  }

  function buildStepUrl(task, step) {
    const base = (task.tmdb_base || task.tmdb_url).replace(/\/+$/, '');

    if (step.kind === 'hub') {
      return urlWithHashOpen(addQuery(base + '/images/posters', { mediux_token: task.token, mediux_kind: 'hub' }));
    }

    if (step.kind === 'poster') {
      return urlWithHashOpen(addQuery(base + '/images/posters', { mediux_token: task.token, mediux_kind: 'poster' }));
    }
    if (step.kind === 'backdrop') {
      return urlWithHashOpen(addQuery(base + '/images/backdrops', { mediux_token: task.token, mediux_kind: 'backdrop' }));
    }
    if (step.kind === 'season_poster') {
      return urlWithHashOpen(addQuery(
        base + `/season/${step.season}/images/posters`,
        { mediux_token: task.token, mediux_kind: 'season_poster', mediux_season: step.season }
      ));
    }
    if (step.kind === 'episode_backdrop') {
      return urlWithHashOpen(addQuery(
        base + `/season/${step.season}/episode/${step.episode}/images/backdrops`,
        {
          mediux_token: task.token,
          mediux_kind: 'episode_backdrop',
          mediux_season: step.season,
          mediux_episode: step.episode,
        }
      ));
    }
    return null;
  }

  // ============================================================
  // MediUX: start flow
  // ============================================================

  function findTMDbLinkOnMediux() {
    const a1 = [...document.querySelectorAll('a[href*="themoviedb.org/"]')].find(a => {
      const img = a.querySelector('img[alt*="TMDb"], img[src*="tmdb-icon.svg"]');
      return !!img;
    });
    if (a1?.href) return normalizeTMDbUrl(a1.href);

    const a2 = document.querySelector('a[href*="themoviedb.org/"]');
    return a2?.href ? normalizeTMDbUrl(a2.href) : null;
  }

  function inferTMDbKindAndId(tmdbUrl) {
    try {
      const u = new URL(tmdbUrl);
      const parts = u.pathname.split('/').filter(Boolean);
      const kind = parts[0]; // movie|tv
      const idOrSlug = parts[1];
      const id = (idOrSlug || '').split('-')[0];
      if ((kind === 'tv' || kind === 'movie') && /^\d+$/.test(id)) return { kind, id };
    } catch {}
    return null;
  }

  async function mediuxStartFlow() {
    const tmdbUrl = findTMDbLinkOnMediux();
    if (!tmdbUrl) return toast('Не нашёл ссылку на TMDb на странице MediUX.');

    const meta = inferTMDbKindAndId(tmdbUrl);
    if (!meta) return toast('Ссылка TMDb есть, но не распознал /tv/{id} или /movie/{id}.');

    const yaml = await readYamlFromMediux();
    if (!yaml) return toast('Не нашёл YAML. Нажми кнопку "YAML" на MediUX и повтори.');

    const parsed = parseMediuxYaml(yaml);

    // Apply implicit episode groups -> seasons base..base+groups-1
    const baseSeason = getOrphanStartSeason();
    const implicitInfo = applyImplicitEpisodeGroups(parsed, baseSeason);

    const steps = buildBaseSteps(parsed, meta.kind);
    if (!steps.length) {
      return toast('В YAML нет изображений для запуска потока (url_poster/url_background/seasons/episodes).');
    }

    const token = randToken();
    const tmdbBase = tmdbUrl.replace(/\/+$/, '');

    const task = {
      token,
      created_at: new Date().toISOString(),
      source_mediux_url: location.href,

      tmdb_url: tmdbUrl,
      tmdb_base: tmdbBase,
      tmdb_kind: meta.kind,
      tmdb_id: meta.id,

      mediux: parsed,

      flow_steps: steps,
      flow_index: 0,

      episode_mode: CFG.episodeMode,

      // NEW: allow multiple additions
      episode_added_seasons: [],

      // implicit info (for chain-add)
      implicit_episodes: implicitInfo.applied
        ? { base_season: implicitInfo.base, groups: implicitInfo.count, last_season: implicitInfo.last }
        : null,
    };

    saveTask(task);
    GM_setValue('mediux_tmdb_last_token', token);

    const firstUrl = buildStepUrl(task, steps[0]);
    window.open(firstUrl, '_blank', 'noopener,noreferrer');

    if (implicitInfo.applied) {
      toast(
        `Поток запущен: ${meta.kind === 'movie' ? 'фильм' : 'сериал'} | шагов: ${steps.length} | эпизоды без сезона → сезоны ${implicitInfo.base}..${implicitInfo.last}`,
        5200
      );
    } else {
      toast(`Поток запущен: ${meta.kind === 'movie' ? 'фильм' : 'сериал'} | шагов: ${steps.length}`, 4200);
    }
  }

  // ============================================================
  // TMDb helpers
  // ============================================================

  function inferSeasonFromPathOrQuery() {
    const m = location.pathname.match(/\/season\/(\d+)\//i);
    if (m) return m[1];
    return new URLSearchParams(location.search).get('mediux_season');
  }

  function inferEpisodeFromPathOrQuery() {
    const m = location.pathname.match(/\/episode\/(\d+)\//i);
    if (m) return m[1];
    return new URLSearchParams(location.search).get('mediux_episode');
  }

  function inferKindHintFromQueryOrPath() {
    const q = new URLSearchParams(location.search).get('mediux_kind');
    if (q) return q;

    const p = location.pathname.toLowerCase();
    if (p.includes('/episode/') && p.includes('/images/backdrops')) return 'episode_backdrop';
    if (p.includes('/images/posters') && p.includes('/season/')) return 'season_poster';
    if (p.includes('/images/posters')) return 'poster';
    if (p.includes('/images/backdrops')) return 'backdrop';
    return null;
  }

  function findUploadFileInput() {
    return document.querySelector('input#upload_files[type="file"]')
      || document.querySelector('input[name="upload_files"][type="file"]')
      || null;
  }

  async function waitForUploadInput(timeoutMs = CFG.waitUploadInputMs) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const input = findUploadFileInput();
      if (input) return input;
      await sleep(CFG.waitUploadInputStepMs);
    }
    return null;
  }

  async function tmdbOpenUploadByHash() {
    if (findUploadFileInput()) return true;

    const base = location.href.split('#')[0];
    location.replace(base + '#_');
    await sleep(60);
    location.replace(base + '#');
    await sleep(160);

    const input = await waitForUploadInput(1200);
    return !!input;
  }

  async function tmdbTryOpenUploadWindowFallback() {
    const openRx = /(upload|загруз|выгруз|добавить|add)/i;
    const imgRx = /(image|изображ|poster|постер|backdrop|background|фон|задник|still|кадр)/i;

    const scopes = [
      document.querySelector('section.images'),
      document.querySelector('.images'),
      document.querySelector('#media_v4'),
      document,
    ].filter(Boolean);

    for (const scope of scopes) {
      const els = [...scope.querySelectorAll('button,a,[role="button"]')].filter(isVisible);
      const cand = els.find(el => {
        const t = (el.textContent || '').trim();
        const href = (el.getAttribute && el.getAttribute('href')) || '';
        if (/\/edit\b/i.test(href)) return false;
        if (/active_nav_item=videos/i.test(href)) return false;
        if (/\bvideos?\b/i.test(t)) return false;
        return openRx.test(t) && imgRx.test(t);
      });
      if (cand) { cand.click(); return true; }
    }
    return false;
  }

  async function tmdbEnsureUploadWindowOpen() {
    const okHash = await tmdbOpenUploadByHash();
    if (okHash) return true;

    const okClick = await tmdbTryOpenUploadWindowFallback();
    if (okClick) {
      const input = await waitForUploadInput();
      return !!input;
    }
    return false;
  }

  function setFileToInput(input, file) {
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  async function downloadAsFile(url, filenameBase) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        responseType: 'blob',
        anonymous: true,
        headers: { 'Accept': 'image/*' },
        onload: (resp) => {
          const blob = resp.response;
          const headers = resp.responseHeaders || '';
          const m = headers.match(/content-type:\s*([^\s;]+)/i);
          const mime = m ? m[1].trim() : (blob?.type || 'image/jpeg');

          let ext = 'jpg';
          if (mime.includes('png')) ext = 'png';
          else if (mime.includes('webp')) ext = 'webp';
          else if (mime.includes('jpeg') || mime.includes('jpg')) ext = 'jpg';

          resolve(new File([blob], `${filenameBase}.${ext}`, { type: mime }));
        },
        onerror: () => reject(new Error('GM_xmlhttpRequest error')),
        ontimeout: () => reject(new Error('GM_xmlhttpRequest timeout')),
      });
    });
  }

  function tryAutoSubmit() {
    const rx = /(submit|save|send|upload|отправить|сохранить|загрузить)/i;
    const b = [...document.querySelectorAll('button,input[type="submit"],button[type="submit"]')]
      .find(x => isVisible(x) && rx.test((x.textContent || x.value || '').trim()));
    if (b) { b.click(); return true; }
    return false;
  }

  function noun(task) {
    return task?.tmdb_kind === 'movie' ? 'фильма' : 'сериала';
  }

  function stepLabel(step, task) {
    if (!step) return '-';
    if (step.kind === 'hub') return 'Старт (эпизоды без постера/сезонов)';
    if (step.kind === 'poster') return `Постер ${noun(task)}`;
    if (step.kind === 'backdrop') return `Задник ${noun(task)} (Backdrop)`;
    if (step.kind === 'season_poster') {
      return step.season === '0' ? 'Сезон 0 (Specials) — постеры' : `Сезон ${step.season} — постеры`;
    }
    if (step.kind === 'episode_backdrop') {
      const s = step.season === '0' ? '0 (Specials)' : step.season;
      return `Сезон ${s}, серия ${step.episode} — задники эпизода`;
    }
    return step.kind;
  }

  function getStepSourceUrl(task, step) {
    if (!task || !step) return null;

    if (step.kind === 'poster') return task.mediux?.url_poster || null;
    if (step.kind === 'backdrop') return task.mediux?.url_background || null;

    if (step.kind === 'season_poster') {
      return task.mediux?.seasons?.[String(step.season)]?.url_poster || null;
    }

    if (step.kind === 'episode_backdrop') {
      const epObj = task.mediux?.seasons?.[String(step.season)]?.episodes?.[String(step.episode)];
      return epObj?.url_background || epObj?.url_poster || null;
    }

    return null;
  }

  function getPreviewBoxForStep(step) {
    if (!step || step.kind === 'poster' || step.kind === 'season_poster') {
      return { w: 220, h: 330, ratio: '2 / 3' };
    }
    if (step.kind === 'backdrop' || step.kind === 'episode_backdrop') {
      return { w: 320, h: 180, ratio: '16 / 9' };
    }
    return { w: 220, h: 330, ratio: '2 / 3' };
  }

  function findFlowIndexForCurrentPage(task) {
    const kind = inferKindHintFromQueryOrPath();
    const sn = inferSeasonFromPathOrQuery();
    const ep = inferEpisodeFromPathOrQuery();

    const steps = task.flow_steps || [];
    const idx = steps.findIndex(s => {
      if (s.kind !== kind) return false;
      if (s.kind === 'season_poster') return String(s.season) === String(sn);
      if (s.kind === 'episode_backdrop') return String(s.season) === String(sn) && String(s.episode) === String(ep);
      return true;
    });

    return (idx >= 0) ? idx : (task.flow_index || 0);
  }

  function currentSeasonFromContext(task) {
    const s = inferSeasonFromPathOrQuery();
    if (s != null) return String(s);

    const idx = task?.flow_index ?? 0;
    const step = task?.flow_steps?.[idx];
    if (step?.kind === 'season_poster') return String(step.season);

    return null;
  }

  function ensureArray(x) {
    return Array.isArray(x) ? x : [];
  }

  function canInsertEpisodes(task) {
    if (!task || task.tmdb_kind !== 'tv') return false;
    if (task.episode_mode !== 'selected_season') return false;
    return hasAnyEpisodes(task.mediux);
  }

  function getImplicitRange(task) {
    const imp = task?.implicit_episodes;
    if (!imp || !Number.isFinite(imp.base_season) || !Number.isFinite(imp.last_season)) return null;
    return { base: imp.base_season, last: imp.last_season };
  }

  function findInsertAtForEpisodes(task) {
    const steps = task.flow_steps || [];
    let lastEp = -1;
    let lastSeasonPoster = -1;

    for (let i = 0; i < steps.length; i++) {
      if (steps[i]?.kind === 'episode_backdrop') lastEp = i;
      if (steps[i]?.kind === 'season_poster') lastSeasonPoster = i;
    }

    if (lastEp >= 0) return lastEp + 1;
    if (lastSeasonPoster >= 0) return lastSeasonPoster + 1;
    return steps.length;
  }

  function insertEpisodeSteps(task, seasonToAdd) {
    const seasonStr = String(seasonToAdd);
    const already = new Set(ensureArray(task.episode_added_seasons).map(String));
    if (already.has(seasonStr)) return { ok: false, reason: `Сезон ${seasonStr} уже добавлен в очередь.` };

    const epSteps = buildEpisodeStepsForSeason(task.mediux, seasonStr);
    if (!epSteps.length) return { ok: false, reason: `В YAML нет эпизодов/ссылок для сезона ${seasonStr}.` };

    const steps = task.flow_steps || [];
    const insertAt = findInsertAtForEpisodes(task);

    steps.splice(insertAt, 0, ...epSteps);
    task.flow_steps = steps;

    task.episode_added_seasons = [...already, seasonStr];

    if ((task.flow_index ?? 0) >= insertAt) {
      task.flow_index = (task.flow_index ?? 0) + epSteps.length;
    }

    return { ok: true, season: seasonStr, count: epSteps.length };
  }

  // NEW: if implicit blocks exist and chosen season is within implicit range,
  // add this season + all subsequent implicit seasons automatically.
  function insertEpisodeSeasonsChain(task, startSeason) {
    const range = getImplicitRange(task);

    const start = parseInt(String(startSeason), 10);
    if (!Number.isFinite(start) || start < 0) return { ok: false, reason: 'Неверный номер сезона.' };

    const results = [];
    if (range && start >= range.base && start <= range.last) {
      for (let s = start; s <= range.last; s++) {
        const r = insertEpisodeSteps(task, String(s));
        if (r.ok) results.push(r);
        // если сезон пустой — просто пропускаем, не останавливаем цепочку
      }
      const total = results.reduce((a, x) => a + (x.count || 0), 0);
      return {
        ok: true,
        chained: true,
        seasons: results.map(r => r.season),
        inserted_steps: total,
      };
    }

    // fallback: add only one season
    const one = insertEpisodeSteps(task, String(start));
    if (!one.ok) return one;

    return {
      ok: true,
      chained: false,
      seasons: [one.season],
      inserted_steps: one.count,
    };
  }

  async function tmdbFillStep(task, step) {
    const srcUrl = getStepSourceUrl(task, step);
    if (!srcUrl) {
      toast('Для текущего шага нет изображения. (Если это эпизоды — добавь их блоком ниже.)', 4200);
      return false;
    }

    let fileBase = null;
    if (step.kind === 'poster') fileBase = `tmdb_${task.tmdb_kind}_${task.tmdb_id}_poster`;
    else if (step.kind === 'backdrop') fileBase = `tmdb_${task.tmdb_kind}_${task.tmdb_id}_backdrop`;
    else if (step.kind === 'season_poster') fileBase = `tmdb_${task.tmdb_kind}_${task.tmdb_id}_season_${step.season}_poster`;
    else if (step.kind === 'episode_backdrop') fileBase = `tmdb_${task.tmdb_kind}_${task.tmdb_id}_s${step.season}_e${step.episode}_episode_backdrop`;
    else fileBase = `tmdb_${task.tmdb_kind}_${task.tmdb_id}_image`;

    let input = findUploadFileInput();

    if (!input && CFG.tmdbAutoOpenUploadWindow) {
      const ok = await tmdbEnsureUploadWindowOpen();
      if (!ok) {
        toast('Не удалось открыть окно загрузки (hash/click). Открой вручную и повтори.', 4200);
        return false;
      }
      input = await waitForUploadInput();
    } else if (!input) {
      input = await waitForUploadInput();
    }

    if (!input) {
      toast('Не нашёл input#upload_files. Открой окно "Выгрузить ..." (Select files...) и повтори.', 4200);
      return false;
    }

    toast('Скачиваю изображение с MediUX…');
    const file = await downloadAsFile(srcUrl, fileBase);

    setFileToInput(input, file);
    toast('Файл вставлен в #upload_files (как ручной выбор).');

    if (CFG.tmdbAutoSubmit) {
      await sleep(300);
      const ok = tryAutoSubmit();
      toast(ok ? 'Нажал Submit/Отправить (если найдено).' : 'Кнопку Submit не нашёл — отправь вручную.');
    }

    return true;
  }

  // ============================================================
  // MediUX UI
  // ============================================================

  function buildInlineNumberSetting(labelText, value, onChange) {
    const wrap = document.createElement('div');
    wrap.style.cssText = `
      border: 1px solid rgba(0,0,0,.10);
      border-radius: 12px;
      background: rgba(0,0,0,.03);
      padding: 10px;
      display: grid;
      gap: 8px;
    `;

    const label = document.createElement('div');
    label.textContent = labelText;
    label.style.cssText = 'font-weight: 700;';

    const row = document.createElement('div');
    row.style.cssText = 'display: flex; gap: 10px; align-items: center;';

    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.step = '1';
    input.value = String(value ?? 1);
    input.style.cssText = `
      width: 120px;
      padding: 8px 10px;
      border-radius: 10px;
      border: 1px solid rgba(0,0,0,.14);
      background: rgba(255,255,255,.92);
      font-weight: 700;
      outline: none;
    `;

    const hint = document.createElement('div');
    hint.textContent = 'Если YAML содержит seasons: episodes: без номера сезона, то первый блок → выбранный сезон, следующий блок → следующий сезон, и т.д.';
    hint.style.cssText = 'font-size: 12px; opacity: .85; line-height: 1.25;';

    input.addEventListener('change', () => {
      const n = parseInt(input.value, 10);
      if (!Number.isFinite(n) || n < 0) {
        input.value = '1';
        onChange(1);
        return;
      }
      onChange(n);
    });

    row.appendChild(input);
    wrap.appendChild(label);
    wrap.appendChild(row);
    wrap.appendChild(hint);

    return { wrap, input };
  }

  function ensureMediuxUI() {
    if (!isMediuxHost()) return;
    if (!/^\/(shows|movies|sets)\//.test(location.pathname)) return;

    const { body } = makePanel('MediUX → TMDb Upload', IDS.mediuxPanel);
    if (!body) return;

    if (body.dataset.filled === '1') return;
    body.dataset.filled = '1';
    body.innerHTML = ''; // важно: при SPA-переходах не копим старые кнопки/блоки

    body.appendChild(codeBlock(
      [
        'Отправка данных с MediUX.',
        '',
        'Эпизоды:',
        `• ${CFG.episodeMode === 'all' ? 'ВСЕ сезоны сразу' : (CFG.episodeMode === 'selected_season' ? 'Добавлять выбранный сезон (можно многократно)' : 'Выкл')}`,
      ].join('\n')
    ));

    const { wrap: orphanWrap } = buildInlineNumberSetting(
      'Начальный сезон для эпизодов без номера сезона',
      getOrphanStartSeason(),
      (n) => {
        setOrphanStartSeason(n);
        toast(`Начальный сезон сохранён: ${n}`);
      }
    );
    body.appendChild(orphanWrap);

    body.appendChild(btn('Перейти на themoviedb.org для загрузки', mediuxStartFlow, 'primary'));

    body.appendChild(btn('Сбросить задачу', () => {
      const token = GM_getValue('mediux_tmdb_last_token', '');
      if (token) GM_deleteValue(taskKey(token));
      GM_setValue('mediux_tmdb_last_token', '');
      toast('Задача удалена.');
    }, 'danger'));
  }

  // ============================================================
  // TMDb UI (preview + add episodes chain)
  // ============================================================

  function ensureTMDbUI() {
    if (!isTMDbHost()) return;

    const hasToken = new URLSearchParams(location.search).has('mediux_token')
      || !!GM_getValue('mediux_tmdb_last_token', '');
    if (!hasToken) return;

    const token = getTokenFromQueryOrLast();
    const task = loadTask(token);
    if (!task) return;

    const steps = task.flow_steps || [];
    if (!steps.length) return;

    const idx = findFlowIndexForCurrentPage(task);
    task.flow_index = idx;

    // Backward compat: migrate old fields if present
    if (!Array.isArray(task.episode_added_seasons)) task.episode_added_seasons = [];
    saveTask(task);

    const curStep = steps[idx];

    const { body } = makePanel('MediUX → TMDb Upload', IDS.tmdbPanel);
    if (!body) return;

    body.innerHTML = '';

    const addedSeasonsText = task.tmdb_kind === 'tv'
      ? (task.episode_added_seasons?.length ? task.episode_added_seasons.join(', ') : '-')
      : '-';

    const range = getImplicitRange(task);
    const implicitLine = range
      ? `Эпизоды без сезона: сезоны ${range.base}..${range.last} (цепочкой добавятся автоматически)`
      : null;

    const episodeModeText =
      (task.tmdb_kind !== 'tv')
        ? '-'
        : (task.episode_mode === 'none'
          ? 'выкл'
          : (task.episode_mode === 'all'
            ? 'все сезоны сразу'
            : 'selected_season (можно добавлять многократно)'
          )
        );

    body.appendChild(codeBlock(
      [
        `Тип: ${task.tmdb_kind === 'movie' ? 'Фильм' : 'Сериал'}`,
        `Шаг: ${idx + 1}/${steps.length}`,
        `Текущее: ${stepLabel(curStep, task)}`,
        `Эпизоды: ${episodeModeText}`,
        `Добавлены сезоны: ${addedSeasonsText}`,
        ...(implicitLine ? [implicitLine] : []),
      ].join('\n')
    ));

    // Preview block
    if (CFG.previewInPanel) {
      const srcUrl = getStepSourceUrl(task, curStep);
      const { w, h, ratio } = getPreviewBoxForStep(curStep);

      const wrap = document.createElement('div');
      wrap.style.cssText = `
        border: 1px solid rgba(0,0,0,.10);
        border-radius: 12px;
        background: rgba(0,0,0,.03);
        padding: 10px;
        display: grid;
        gap: 8px;
      `;

      const title = document.createElement('div');
      title.textContent = 'Предпросмотр текущего изображения';
      title.style.cssText = 'font-weight: 700;';

      const row = document.createElement('div');
      row.style.cssText = 'display: flex; gap: 10px; align-items: start;';

      const frame = document.createElement('div');
      frame.style.cssText = `
        width: ${w}px;
        height: ${h}px;
        border-radius: 10px;
        overflow: hidden;
        background: rgba(0,0,0,.06);
        border: 1px solid rgba(0,0,0,.10);
        flex: 0 0 auto;
      `;

      const img = document.createElement('img');
      img.loading = 'lazy';
      img.alt = stepLabel(curStep, task);
      img.style.cssText = `
        width: 100%;
        height: 100%;
        object-fit: cover;
        aspect-ratio: ${ratio};
        display: block;
      `;

      const meta = document.createElement('div');
      meta.style.cssText = `
        flex: 1 1 auto;
        min-width: 0;
        display: grid;
        gap: 6px;
        align-content: start;
      `;

      const dim = document.createElement('div');
      dim.textContent = 'Разрешение: …';
      dim.style.cssText = 'font-weight: 600;';

      const openBtn = document.createElement('a');
      openBtn.textContent = 'Открыть оригинал';
      openBtn.target = '_blank';
      openBtn.rel = 'noopener noreferrer';
      openBtn.href = srcUrl || '#';
      openBtn.style.cssText = `
        display: inline-block;
        width: max-content;
        font-size: 12px;
        padding: 6px 8px;
        border-radius: 10px;
        background: rgba(0,0,0,.06);
        border: 1px solid rgba(0,0,0,.10);
        text-decoration: none;
        color: #111;
      `;

      const srcLine = document.createElement('div');
      srcLine.style.cssText = 'font-size: 12px; opacity: .85; word-break: break-word;';
      srcLine.textContent = srcUrl ? `Источник: ${srcUrl}` : 'Источник: -';

      meta.appendChild(dim);
      meta.appendChild(openBtn);
      meta.appendChild(srcLine);

      frame.appendChild(img);
      row.appendChild(frame);
      row.appendChild(meta);

      wrap.appendChild(title);
      wrap.appendChild(row);

      body.appendChild(wrap);

      if (srcUrl) {
        img.src = srcUrl;
        img.onload = () => {
          const w2 = img.naturalWidth || 0;
          const h2 = img.naturalHeight || 0;
          dim.textContent = (w2 && h2) ? `Разрешение: ${w2}×${h2}` : 'Разрешение: неизвестно';
        };
        img.onerror = () => {
          dim.textContent = 'Разрешение: не удалось загрузить превью';
        };
      } else {
        dim.textContent = 'Разрешение: нет ссылки для текущего шага';
        img.style.display = 'none';
      }
    }

    body.appendChild(btn('Вставить изображение', async () => {
      try {
        const ok = await tmdbFillStep(task, curStep);
        if (ok && CFG.autoNextAfterInsert) {
          await sleep(250);
          goNext(task);
        }
      } catch (e) {
        console.error(e);
        toast('Ошибка. Подробности в консоли.');
      }
    }, 'primary'));

    body.appendChild(btn('Следующий шаг', () => goNext(task), 'warn'));
    body.appendChild(btn('Предыдущий шаг', () => goPrev(task), 'soft'));

    // Episodes (selected_season): multi-add + chain implicit seasons
    if (canInsertEpisodes(task)) {
      const box = document.createElement('div');
      box.style.cssText = `
        border: 1px solid rgba(0,0,0,.10);
        border-radius: 12px;
        background: rgba(0,0,0,.03);
        padding: 10px;
        display: grid;
        gap: 8px;
      `;

      const label = document.createElement('div');
      label.textContent = 'Эпизоды: добавить в очередь сезон (и цепочку, если YAML без сезона)';
      label.style.cssText = 'font-weight: 700;';

      const row = document.createElement('div');
      row.style.cssText = 'display: flex; gap: 10px; align-items: center;';

      const input = document.createElement('input');
      input.type = 'number';
      input.min = '0';
      input.step = '1';
      input.style.cssText = `
        width: 120px;
        padding: 8px 10px;
        border-radius: 10px;
        border: 1px solid rgba(0,0,0,.14);
        background: rgba(255,255,255,.92);
        font-weight: 800;
        outline: none;
      `;

      const inferred = currentSeasonFromContext(task);
      input.value = String(inferred ?? getOrphanStartSeason());

      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = 'Добавить';
      b.style.cssText = `
        flex: 1 1 auto;
        padding: 9px 10px;
        border-radius: 10px;
        cursor: pointer;
        border: 1px solid rgba(0,0,0,.14);
        background: rgba(255, 193, 7, .22);
        font-weight: 800;
      `;

      b.onclick = () => {
        const season = parseInt(input.value, 10);
        const res = insertEpisodeSeasonsChain(task, season);
        if (!res.ok) {
          saveTask(task);
          return toast(res.reason || 'Не удалось добавить эпизоды.');
        }

        saveTask(task);

        if (res.chained) {
          toast(`Добавлено сезонов цепочкой: ${res.seasons.join(', ')}. Шагов добавлено: ${res.inserted_steps}.`, 5200);
        } else {
          toast(`Добавлен сезон ${res.seasons[0]}. Шагов добавлено: ${res.inserted_steps}.`, 4200);
        }

        ensureTMDbUI();
      };

      row.appendChild(input);
      row.appendChild(b);

      const hint = document.createElement('div');
      hint.style.cssText = 'font-size: 12px; opacity: .85; line-height: 1.25;';
      hint.textContent = range
        ? `Если выбрать сезон в диапазоне ${range.base}..${range.last}, скрипт добавит этот сезон и все следующие сезоны из YAML-блоков автоматически.`
        : 'Если YAML содержит эпизоды по сезонам — добавится только выбранный сезон (можно повторять).';

      box.appendChild(label);
      box.appendChild(row);
      box.appendChild(hint);

      body.appendChild(box);
    }

    body.appendChild(btn('Забыть задачу', () => {
      const tkn = getTokenFromQueryOrLast();
      if (tkn) GM_deleteValue(taskKey(tkn));
      GM_setValue('mediux_tmdb_last_token', '');
      toast('Задача удалена.');
      const panel = document.getElementById(IDS.tmdbPanel);
      if (panel) panel.remove();
    }, 'danger'));
  }

  // ============================================================
  // Flow navigation
  // ============================================================

  function goToIndex(task, newIdx) {
    const stepsNow = task.flow_steps || [];
    newIdx = Math.max(0, Math.min(stepsNow.length - 1, newIdx));
    task.flow_index = newIdx;
    saveTask(task);

    const url = buildStepUrl(task, stepsNow[newIdx]);
    if (!url) return toast('Не удалось построить URL шага.');
    location.href = url;
  }

  function goNext(task) {
    const idx = task.flow_index ?? 0;
    if (idx >= (task.flow_steps?.length ?? 0) - 1) return toast('Это последний шаг.');
    goToIndex(task, idx + 1);
  }

  function goPrev(task) {
    const idx = task.flow_index ?? 0;
    if (idx <= 0) return toast('Это первый шаг.');
    goToIndex(task, idx - 1);
  }

  // ============================================================
  // SPA hook
  // ============================================================

  function installSpaHookOnce() {
    if (window.__mediux_tmdb_spa_hook_installed) return;
    window.__mediux_tmdb_spa_hook_installed = true;

    let lastHref = location.href;

    const fire = () => {
      if (isMediuxHost()) {
        const p = document.getElementById(IDS.mediuxPanel);
        if (p) {
          const body = p.querySelector('[data-body="1"]');
          if (body) { body.dataset.filled = '0'; body.innerHTML = ''; }
        }
        ensureMediuxUI();
      }
      if (isTMDbHost()) {
        ensureTMDbUI();
      }
    };

    const check = () => {
      if (location.href !== lastHref) {
        lastHref = location.href;
        fire();
      }
    };

    const _push = history.pushState;
    history.pushState = function () {
      const r = _push.apply(this, arguments);
      setTimeout(check, 0);
      return r;
    };

    const _replace = history.replaceState;
    history.replaceState = function () {
      const r = _replace.apply(this, arguments);
      setTimeout(check, 0);
      return r;
    };

    window.addEventListener('popstate', () => setTimeout(check, 0), true);
    setInterval(check, 600);
  }

  // ============================================================
  // Boot
  // ============================================================

  installSpaHookOnce();

  if (isMediuxHost()) ensureMediuxUI();
  if (isTMDbHost()) ensureTMDbUI();

})();
