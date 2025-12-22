// ==UserScript==
// @name         TMDB easy language selection
// @namespace    https://github.com/Druidblack/MusicBrainz-UserScripts
// @author       Druidblack
// @version      1.1.0
// @description  When a TMDB language dropdown opens, it auto-filters the list so only the preferred language (e.g. ru-RU) remains.
// @match        https://www.themoviedb.org/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
//
// @downloadURL  https://github.com/Druidblack/MusicBrainz-UserScripts/raw/main/tmdb_easy_language_selection.user.js
// @updateURL    https://github.com/Druidblack/MusicBrainz-UserScripts/raw/main/tmdb_easy_language_selection.user.js
// ==/UserScript==

(function () {
  'use strict';

  const STORE_KEY = 'tmdb_lang_filter_cfg_v1';

  const DEFAULT_CFG = {
    // Предпочитаемый язык (самый надёжный вариант — формат вида ru-RU, en-US, de-DE)
    localeCode: 'ru-RU',

    // Необязательно: свой текст для фильтра (если пусто — используется localeCode)
    // ВАЖНО: чтобы не было "белорусский/русский", лучше фильтровать по коду: "ru-RU"
    filterText: '',

    // Логи в консоль
    debug: false
  };

  function loadCfg() {
    try {
      const raw = GM_getValue(STORE_KEY, '');
      if (!raw) return { ...DEFAULT_CFG };
      return { ...DEFAULT_CFG, ...JSON.parse(raw) };
    } catch {
      return { ...DEFAULT_CFG };
    }
  }

  function saveCfg(cfg) {
    GM_setValue(STORE_KEY, JSON.stringify(cfg));
  }

  let cfg = loadCfg();

  function log(...args) {
    if (cfg.debug) console.log('[TMDB LangFilter]', ...args);
  }

  function norm(s) {
    return (s || '').toString().trim().toLowerCase();
  }

  function isVisible(el) {
    if (!el) return false;
    const style = getComputedStyle(el);
    return style && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
  }

  function popupLooksLikeLanguage(popup) {
    // Языковые списки обычно содержат элементы вида "... (ru-RU)"
    const items = popup.querySelectorAll('li.k-list-item .k-list-item-text');
    if (!items || items.length === 0) return false;

    let hits = 0;
    for (const it of items) {
      const t = (it.textContent || '').trim();
      if (/\([a-z]{2}-[A-Z]{2}\)\s*$/.test(t)) hits++;
      if (hits >= 2) return true;
    }
    return hits >= 1;
  }

  function getDesiredFilter() {
    const ft = (cfg.filterText || '').trim();
    if (ft) return ft;

    const code = (cfg.localeCode || '').trim();
    // Самый надёжный фильтр — сам код "ru-RU" (он уникален и не заденет "be-BY")
    return code || 'ru-RU';
  }

  function applyFilterToPopup(popup) {
    if (!popup || !isVisible(popup) || !popupLooksLikeLanguage(popup)) return;

    const desired = getDesiredFilter();
    if (!desired) return;

    // 1) Если есть поле фильтра — используем его (лучший способ)
    const filterInput = popup.querySelector('.k-list-filter input.k-input-inner');
    if (filterInput) {
      if (filterInput.value !== desired) {
        filterInput.focus();
        filterInput.value = desired;
        filterInput.dispatchEvent(new Event('input', { bubbles: true }));
        filterInput.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Enter' }));
        log('Filter applied via input:', desired);
      }
      return;
    }

    // 2) Фолбэк: если фильтра нет — прячем строки вручную
    const desiredLower = desired.toLowerCase();
    const items = popup.querySelectorAll('li.k-list-item');
    let anyShown = false;

    items.forEach(li => {
      const txt = (li.textContent || '').toLowerCase();
      const match = txt.includes(desiredLower);
      li.style.display = match ? '' : 'none';
      if (match) anyShown = true;
    });

    log('Filter applied via hide/show:', desired, 'anyShown=', anyShown);
  }

  // Чтобы не долбить одно и то же бесконечно:
  const lastApplied = new WeakMap();

  function handlePopups() {
    const desired = getDesiredFilter();
    const popups = document.querySelectorAll('.k-animation-container .k-dropdownlist-popup');

    popups.forEach(popup => {
      if (!isVisible(popup)) return;
      if (!popupLooksLikeLanguage(popup)) return;

      const prev = lastApplied.get(popup);
      // Если уже применяли такой же фильтр и он стоит в input — пропускаем
      const filterInput = popup.querySelector('.k-list-filter input.k-input-inner');
      if (prev === desired && filterInput && filterInput.value === desired) return;

      applyFilterToPopup(popup);
      lastApplied.set(popup, desired);
    });
  }

  // ---------- Меню настроек ----------
  function openSettings() {
    const newCode = prompt(
      'TMDB: предпочитаемый язык (код вида ru-RU, en-US, de-DE)\n\nТекущий: ' + cfg.localeCode,
      cfg.localeCode
    );
    if (newCode === null) return;

    const code = (newCode || '').trim();
    if (!code) {
      alert('Код языка пустой — настройки не сохранены.');
      return;
    }

    const newFilter = prompt(
      'TMDB: текст фильтра (необязательно).\n' +
        'Если оставить пустым — будет использоваться сам код языка (самый точный вариант).\n\n' +
        'Например:\n' +
        '- пусто  -> фильтр "ru-RU" (рекомендуется)\n' +
        '- "русский" -> может быть неоднозначно\n\n' +
        'Текущий: ' + (cfg.filterText || '(пусто)'),
      cfg.filterText || ''
    );
    if (newFilter === null) return;

    const debug = confirm('Включить debug-логи в консоль?');

    cfg = {
      ...cfg,
      localeCode: code,
      filterText: (newFilter || '').trim(),
      debug
    };

    saveCfg(cfg);
    alert('Сохранено. Теперь при открытии языкового списка он будет отфильтрован под выбранный язык.');
  }

  function showCurrent() {
    const desired = getDesiredFilter();
    alert(
      'TMDB LangFilter\n\n' +
        'localeCode: ' + cfg.localeCode + '\n' +
        'filterText: ' + (cfg.filterText || '(пусто)') + '\n' +
        'используемый фильтр: ' + desired
    );
  }

  GM_registerMenuCommand('TMDB: Настроить язык/фильтр…', openSettings);
  GM_registerMenuCommand('TMDB: Показать текущие настройки', showCurrent);

  // ---------- Наблюдатель ----------
  const mo = new MutationObserver(() => {
    handlePopups();
  });

  mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true });

  // Первый проход
  handlePopups();
  log('Initialized with cfg:', cfg);
})();
