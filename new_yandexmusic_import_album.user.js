// ==UserScript==

// @name        MusicBrainz: Import and Search from Yandex Music (new design)
// @description Для импорта альбомов, книг и поиска исполнителей.
// @version     2025.01.00.32.11
// @author      Druidblack
// @namespace   https://github.com/Druidblack/MusicBrainz-UserScripts
//
// @match       https://music.yandex.ru/*
// @run-at      document-idle
// @grant       GM_xmlhttpRequest
// @connect     api.music.yandex.net
//
// @icon        https://musicbrainz.org/favicon.ico
//
// @downloadURL  https://github.com/Druidblack/MusicBrainz-UserScripts/raw/main/new_yandexmusic_import_album.user.js
// @updateURL    https://github.com/Druidblack/MusicBrainz-UserScripts/raw/main/new_yandexmusic_import_album.user.js
// ==/UserScript==

(function() {
  'use strict';

  const BUTTON_CLASS = 'mb-yandex-native-button';
  const WRAPPER_CLASS = 'mb-yandex-buttons';
  const HEADER_SELECTOR = '[class*="PageHeaderBase_controls__"]';
  const PLAY_SELECTOR = 'button[aria-label="Воспроизведение"]';
  const TRAILER_SELECTOR = 'button[aria-label="Запустить трейлер"]';

  const syncButtons = new Set();
  const albumCache = new Map();
  const loadingAlbums = new Set();
  let injectScheduled = false;

  injectStyles();

  function injectStyles() {
    if (document.getElementById('mb-yandex-button-styles')) return;

    const style = document.createElement('style');
    style.id = 'mb-yandex-button-styles';
    style.textContent = `
      .${WRAPPER_CLASS} {
        display: inline-flex;
        align-items: center;
        flex-wrap: nowrap;
        vertical-align: middle;
      }

      .${WRAPPER_CLASS} .mbForm {
        display: flex;
        align-items: center;
        margin: 0;
        padding: 0;
      }

      .${BUTTON_CLASS} {
        -webkit-appearance: none;
        appearance: none;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        box-sizing: border-box;
        min-height: 40px;
        padding: 0 16px;
        border: 0;
        border-radius: 999px;
        margin: 0;
        white-space: nowrap;
        cursor: pointer;
        text-decoration: none;
        font: 600 14px/1.2 inherit;
        background-color: #ffcc33 !important;
        color: #121212 !important;
        transition: background-color .15s ease, opacity .15s ease;
      }

      .${BUTTON_CLASS}:hover {
        background-color: #ffd966 !important;
      }

      .${BUTTON_CLASS}:active {
        background-color: #f5c229 !important;
      }

      .${BUTTON_CLASS}:disabled {
        cursor: default;
        opacity: .55;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function findHeaderRoot() {
    return document.querySelector(HEADER_SELECTOR);
  }

  function findNativeButton(root = document) {
    if (!root) return null;
    return root.querySelector(
      `${PLAY_SELECTOR}, ${TRAILER_SELECTOR}, button:not(.${BUTTON_CLASS})`
    );
  }

  function findAlbumPlacement() {
    const root = findHeaderRoot();
    if (!root) return null;

    const play = root.querySelector(PLAY_SELECTOR);
    const trailer = root.querySelector(TRAILER_SELECTOR);
    const controls =
      (trailer && trailer.parentElement) ||
      (play && play.parentElement) ||
      root.querySelector('[class*="CommonPageHeader_controls__"]');

    if (!controls) return null;
    return { root, controls, play, trailer, reference: trailer || play || findNativeButton(root) };
  }

  function findArtistPlacement() {
    const root = findHeaderRoot();
    if (!root) return null;

    const play = root.querySelector(PLAY_SELECTOR);
    const controls =
      (play && play.parentElement) ||
      root.querySelector('[class*="PageHeaderArtist_controls__"]') ||
      root.querySelector('[class*="CommonPageHeader_controls__"]');

    if (!controls) return null;
    return { root, controls, play, reference: play || findNativeButton(root) };
  }

  function placeAlbumWrapper(wrapper) {
    const placement = findAlbumPlacement();
    if (!placement) return false;

    const { controls, play, trailer } = placement;
    if (trailer && trailer.parentElement === controls) {
      if (wrapper.parentElement !== controls || wrapper.nextElementSibling !== trailer) {
        controls.insertBefore(wrapper, trailer);
      }
    } else if (play && play.parentElement === controls) {
      if (wrapper.parentElement !== controls || play.nextElementSibling !== wrapper) {
        play.insertAdjacentElement('afterend', wrapper);
      }
    } else if (wrapper.parentElement !== controls) {
      controls.appendChild(wrapper);
    }

    syncWrapper(wrapper, placement.reference, controls);
    return true;
  }

  function placeArtistWrapper(wrapper) {
    const placement = findArtistPlacement();
    if (!placement) return false;

    const { controls } = placement;
    if (wrapper.parentElement !== controls || controls.firstElementChild !== wrapper) {
      controls.prepend(wrapper);
    }

    syncWrapper(wrapper, placement.reference, controls);
    return true;
  }

  function registerButton(button) {
    syncButtons.add(button);
    return button;
  }

  function createActionButton(text, type = 'button') {
    const button = document.createElement('button');
    button.type = type;
    button.className = BUTTON_CLASS;
    button.textContent = text;
    return registerButton(button);
  }

  function syncButtonWithNative(button, nativeButton) {
    if (!button || !nativeButton || button === nativeButton) return;

    const cs = getComputedStyle(nativeButton);
    const properties = [
      'boxSizing',
      'height',
      'minHeight',
      'paddingTop',
      'paddingRight',
      'paddingBottom',
      'paddingLeft',
      'borderTopWidth',
      'borderRightWidth',
      'borderBottomWidth',
      'borderLeftWidth',
      'borderTopStyle',
      'borderRightStyle',
      'borderBottomStyle',
      'borderLeftStyle',
      'borderTopColor',
      'borderRightColor',
      'borderBottomColor',
      'borderLeftColor',
      'borderTopLeftRadius',
      'borderTopRightRadius',
      'borderBottomRightRadius',
      'borderBottomLeftRadius',
      'fontFamily',
      'fontSize',
      'fontWeight',
      'fontStyle',
      'lineHeight',
      'letterSpacing',
      'textTransform',
      'boxShadow',
      'outlineOffset',
      'overflow',
      'textAlign',
      'verticalAlign',
      'flexShrink'
    ];

    properties.forEach(property => {
      button.style[property] = cs[property];
    });

    // Ширина остаётся автоматической: длинный текст не должен обрезаться.
    button.style.width = 'auto';
    button.style.minWidth = '0';
    button.style.maxWidth = 'none';
    button.style.display = 'inline-flex';
    button.style.alignItems = 'center';
    button.style.justifyContent = 'center';
    button.style.margin = '0';
    button.style.whiteSpace = 'nowrap';
  }

  function getNativeGap(container, nativeButton) {
    if (container) {
      const cs = getComputedStyle(container);
      const gap = cs.columnGap && cs.columnGap !== 'normal' ? cs.columnGap : cs.gap;
      if (gap && gap !== 'normal' && gap !== '0px') return gap;
    }

    if (nativeButton) {
      const height = parseFloat(getComputedStyle(nativeButton).height);
      if (Number.isFinite(height) && height > 0) return `${Math.max(8, Math.round(height * 0.3))}px`;
    }

    return '12px';
  }

  function syncWrapper(wrapper, nativeButton, controls) {
    if (!wrapper) return;
    const reference = nativeButton || findNativeButton(wrapper.closest(HEADER_SELECTOR) || document);
    wrapper.style.gap = getNativeGap(controls || wrapper.parentElement, reference);
    wrapper.querySelectorAll(`.${BUTTON_CLASS}`).forEach(button => {
      registerButton(button);
      syncButtonWithNative(button, reference);
    });
  }

  function updateButtonSizes() {
    syncButtons.forEach(button => {
      if (!button.isConnected) {
        syncButtons.delete(button);
        return;
      }

      const wrapper = button.closest(`.${WRAPPER_CLASS}`);
      const root = (wrapper && wrapper.closest(HEADER_SELECTOR)) || findHeaderRoot();
      const reference = findNativeButton(root || document);
      syncButtonWithNative(button, reference);

      if (wrapper) {
        wrapper.style.gap = getNativeGap(wrapper.parentElement, reference);
      }
    });
  }

  window.addEventListener('resize', updateButtonSizes, { passive: true });

  function removeObsoleteWrappers(kind, id = '') {
    document.querySelectorAll(`.${WRAPPER_CLASS}`).forEach(wrapper => {
      const sameKind = wrapper.dataset.mbKind === kind;
      const sameId = kind !== 'album' || wrapper.dataset.mbAlbumId === String(id);
      if (!sameKind || !sameId) wrapper.remove();
    });
  }

  function getArtistName() {
    const selectors = [
      'h1 [class*="PageHeaderTitle_title__"]',
      'h1[class*="PageHeaderTitle_heading__"]',
      'h1.page-artist__title.typo-h1.typo-h1_big'
    ];

    for (const selector of selectors) {
      const element = document.querySelector(selector);
      const value = element && element.textContent ? element.textContent.trim() : '';
      if (value) return value;
    }
    return '';
  }

  function injectButtons() {
    if (/\/album\/\d+/.test(location.pathname)) {
      const albumId = getYandexAlbumIdFromUrl(location.href);
      if (!albumId) return;

      removeObsoleteWrappers('album', albumId);
      const existing = document.querySelector(
        `.${WRAPPER_CLASS}[data-mb-kind="album"][data-mb-album-id="${albumId}"]`
      );
      if (existing) {
        placeAlbumWrapper(existing);
        return;
      }

      const cached = albumCache.get(albumId);
      if (cached) {
        const wrapper = createAlbumButtons(cached.normalized, albumId, cached.apiUrl);
        if (!placeAlbumWrapper(wrapper)) wrapper.remove();
        return;
      }

      loadAlbumButtons(albumId);
      return;
    }

    if (/\/artist\/\d+/.test(location.pathname)) {
      removeObsoleteWrappers('artist');
      const name = getArtistName();
      if (!name) return;

      let wrapper = document.querySelector(`.${WRAPPER_CLASS}[data-mb-kind="artist"]`);
      if (wrapper && wrapper.dataset.mbArtistName !== name) {
        wrapper.remove();
        wrapper = null;
      }
      if (!wrapper) wrapper = createArtistButtons(name);
      if (!placeArtistWrapper(wrapper)) wrapper.remove();
      return;
    }

    removeObsoleteWrappers('none');
  }

  async function loadAlbumButtons(albumId) {
    if (loadingAlbums.has(albumId)) return;
    loadingAlbums.add(albumId);

    const apiUrl = `https://api.music.yandex.net/albums/${encodeURIComponent(albumId)}/with-tracks`;
    try {
      const apiResponse = await requestJson(apiUrl);
      const albumData = apiResponse && (apiResponse.result || apiResponse);
      if (!albumData || !albumData.id) {
        throw new Error('Unexpected Yandex API response');
      }

      const normalized = normalizeYandexAlbum(albumData);
      albumCache.set(albumId, { normalized, apiUrl });

      // За время запроса пользователь мог перейти на другую страницу.
      if (getYandexAlbumIdFromUrl(location.href) !== String(albumId)) return;

      const existing = document.querySelector(
        `.${WRAPPER_CLASS}[data-mb-kind="album"][data-mb-album-id="${albumId}"]`
      );
      if (existing) {
        placeAlbumWrapper(existing);
        return;
      }

      const wrapper = createAlbumButtons(normalized, albumId, apiUrl);
      if (!placeAlbumWrapper(wrapper)) wrapper.remove();
    } catch (err) {
      console.error('[MusicBrainz/Yandex] Failed to fetch album data from Yandex API', err);
    } finally {
      loadingAlbums.delete(albumId);
    }
  }

  function createAlbumButtons(normalized, albumId, apiUrl) {
    const wrapper = document.createElement('div');
    wrapper.className = `mb-buttons ${WRAPPER_CLASS}`;
    wrapper.dataset.mbKind = 'album';
    wrapper.dataset.mbAlbumId = String(albumId);

    const form = document.createElement('form');
    form.className = 'mbForm';
    form.method = 'post';
    form.target = '_blank';
    form.action = 'https://musicbrainz.org/release/add?skip_confirmation=1';
    form.acceptCharset = 'UTF-8';

    function addField(name, value) {
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = name;
      input.value = value == null ? '' : value;
      form.appendChild(input);
    }

    buildReleaseFormFromYandexAlbum(form, addField, normalized, apiUrl);

    const btnAdd = createActionButton('Add to MusicBrainz', 'submit');
    btnAdd.title = 'Add release to MusicBrainz';
    form.appendChild(btnAdd);
    wrapper.appendChild(form);

    const searchUrl = 'https://musicbrainz.org/search?query=' +
      encodeURIComponent(normalized.title) + '&type=release';
    const btnSearch = createActionButton('Search on MusicBrainz');
    btnSearch.title = 'Search release on MusicBrainz';
    btnSearch.addEventListener('click', () => {
      window.open(searchUrl, '_blank', 'noopener,noreferrer');
    });
    wrapper.appendChild(btnSearch);

    return wrapper;
  }

  function buildReleaseFormFromYandexAlbum(form, addField, normalized, apiUrl) {
    normalized.volumes.forEach((volume, mediumIndex) => {
      addField(`mediums.${mediumIndex}.format`, 'Digital Media');

      volume.forEach((track, trackIndex) => {
        addField(`mediums.${mediumIndex}.track.${trackIndex}.name`, track.title);
        addField(`mediums.${mediumIndex}.track.${trackIndex}.length`, track.durationMs || 0);

        if (track.artists.length > 0) {
          addTrackArtistCredit(
            addField,
            `mediums.${mediumIndex}.track.${trackIndex}.artist_credit`,
            track.artists,
            normalized.isAudiobook ? normalized.audioAuthorCount : 0
          );
        }
      });
    });

    addField('name', normalized.title);
    addReleaseArtistCredit(addField, normalized.artistList, normalized.audioAuthorCount);

    normalized.labels.forEach((labelName, index) => {
      addField(`labels.${index}.name`, labelName);
    });

    addField('packaging','None');
    addDateFields(addField, normalized.releaseDate, normalized.year);
    addField('country','XW');
    addField('status','official');

    if (normalized.isAudiobook) {
      addField('type', 'Other');
      addField('type', 'Audiobook');
      addField('language','rus');
    } else {
      addField('type', normalized.type);
    }

    if (normalized.annotation) addField('annotation', normalized.annotation);
    addField('edit_note','Imported from: '+normalized.sourceUrl+' using metadata API: '+apiUrl+' and script from https://github.com/Druidblack/MusicBrainz-UserScripts/blob/main/new_yandexmusic_import_album.user.js');
    addField('urls.0.link_type','85');
    addField('urls.0.url', normalized.sourceUrl);
  }

  function normalizeYandexAlbum(albumData) {
    const isAudiobook = albumData.type === 'audiobook' || albumData.metaType === 'podcast';
    const rawTitle = cleanText(albumData.title);
    let normalizedTitle = rawTitle;
    let audioAuthors = [];
    let releaseArtists = namesFromArtists(albumData.artists);

    if (isAudiobook) {
      const parsedAudioTitle = parseAudiobookTitle(rawTitle);
      normalizedTitle = parsedAudioTitle.title || rawTitle;
      audioAuthors = parsedAudioTitle.authors;

      // Для аудиокниг авторы часто есть только в названии API-релиза.
      // Если в API есть исполнители/чтецы, добавляем их после авторов.
      releaseArtists = mergeUnique(audioAuthors, releaseArtists);
      if (releaseArtists.length === 0 && rawTitle) releaseArtists = [rawTitle];
    } else if (releaseArtists.length === 0) {
      // Редкий fallback: если у релиза нет artists, берём уникальных исполнителей из треков API.
      releaseArtists = uniqueNames(flattenVolumes(albumData.volumes).reduce((acc, track) => {
        return acc.concat(namesFromArtists(track && track.artists));
      }, []));
    }

    const volumes = normalizeVolumes(albumData.volumes, isAudiobook ? audioAuthors : []);
    const labels = uniqueNames((albumData.labels || []).map(label => cleanText(label && label.name)));

    return {
      id: albumData.id,
      title: normalizedTitle,
      year: albumData.year || yearFromReleaseDate(albumData.releaseDate) || '',
      releaseDate: albumData.releaseDate || '',
      type: detectMusicBrainzReleaseType(albumData, volumes, isAudiobook),
      isAudiobook,
      audioAuthorCount: audioAuthors.length,
      artistList: releaseArtists,
      labels,
      volumes,
      annotation: '',
      sourceUrl: buildCleanYandexAlbumUrl(albumData.id)
    };
  }

  function normalizeVolumes(volumes, defaultTrackArtists) {
    defaultTrackArtists = uniqueNames(defaultTrackArtists || []);
    if (!Array.isArray(volumes) || volumes.length === 0) return [[]];

    return volumes.map(volume => {
      if (!Array.isArray(volume)) return [];
      return volume.map(track => ({
        title: cleanText(track && track.title),
        durationMs: Number(track && track.durationMs) || 0,
        artists: mergeUnique(defaultTrackArtists, namesFromArtists(track && track.artists))
      })).filter(track => track.title.length > 0);
    }).filter(volume => volume.length > 0);
  }

  function flattenVolumes(volumes) {
    if (!Array.isArray(volumes)) return [];
    return volumes.reduce((acc, volume) => Array.isArray(volume) ? acc.concat(volume) : acc, []);
  }

  function parseAudiobookTitle(title) {
    const result = { title, authors: [] };
    if (!title) return result;

    const match = title.match(/^(.*?)«(.*?)»/);
    if (!match) return result;

    const authorsPart = cleanText(match[1]).replace(/[.\s]+$/, '');
    const releaseTitle = cleanText(match[2]);

    if (releaseTitle) result.title = releaseTitle;
    result.authors = splitPeople(authorsPart);
    return result;
  }

  function splitPeople(value) {
    if (!value) return [];
    return uniqueNames(value.split(/,|;|\s+и\s+/i).map(name => cleanText(name).replace(/[.\s]+$/, '')));
  }

  function detectMusicBrainzReleaseType(albumData, volumes, isAudiobook) {
    if (isAudiobook) return 'Other';

    const apiType = String(albumData.type || '').toLowerCase();
    if (apiType === 'single') return 'Single';
    if (apiType === 'ep') return 'EP';
    if (apiType === 'album') return 'Album';

    const trackCount = Number(albumData.trackCount) || flattenNormalizedVolumes(volumes).length;
    return trackCount === 1 ? 'Single' : 'Album';
  }

  function flattenNormalizedVolumes(volumes) {
    if (!Array.isArray(volumes)) return [];
    return volumes.reduce((acc, volume) => acc.concat(Array.isArray(volume) ? volume : []), []);
  }

  function addReleaseArtistCredit(addField, names, audioAuthorCount) {
    names = uniqueNames(names);
    names.forEach((name, i) => {
      addField(`artist_credit.names.${i}.artist.name`, name);

      if (names.length >= 2 && i !== names.length - 1) {
        if (audioAuthorCount > 0 && i < audioAuthorCount) {
          if (i === audioAuthorCount - 1) {
            const remainder = names.length - audioAuthorCount;
            const phrase = (remainder === 1) ? ' чтец: ' : (remainder >= 2 ? ' чтецы: ' : '');
            if (phrase) addField(`artist_credit.names.${i}.join_phrase`, phrase);
          } else {
            addField(`artist_credit.names.${i}.join_phrase`, ', ');
          }
        } else {
          const joinPhrase = (i === names.length - 2) ? ' & ' : ', ';
          addField(`artist_credit.names.${i}.join_phrase`, joinPhrase);
        }
      }
    });
  }

  function addTrackArtistCredit(addField, baseName, names, audioAuthorCount) {
    names = uniqueNames(names);
    audioAuthorCount = Math.max(0, Number(audioAuthorCount) || 0);
    const narratorCount = Math.max(0, names.length - audioAuthorCount);

    names.forEach((name, i) => {
      addField(`${baseName}.names.${i}.name`, name);
      if (names.length >= 2 && i !== names.length - 1) {
        if (audioAuthorCount > 0 && i < audioAuthorCount) {
          if (i < audioAuthorCount - 1) {
            addField(`${baseName}.names.${i}.join_phrase`, ', ');
          } else {
            const phrase = narratorCount === 1 ? ' чтец: ' : (narratorCount >= 2 ? ' чтецы: ' : '');
            if (phrase) addField(`${baseName}.names.${i}.join_phrase`, phrase);
          }
        } else {
          const relativeIndex = i - audioAuthorCount;
          const joinPhrase = (relativeIndex === narratorCount - 2) ? ' & ' : ', ';
          addField(`${baseName}.names.${i}.join_phrase`, joinPhrase);
        }
      }
    });
  }

  function addDateFields(addField, releaseDate, fallbackYear) {
    const match = String(releaseDate || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      addField('date.year',  match[1]);
      addField('date.month', String(parseInt(match[2], 10)));
      addField('date.day',   String(parseInt(match[3], 10)));
      return;
    }

    if (fallbackYear) addField('date.year', fallbackYear);
  }

  function namesFromArtists(artists) {
    if (!Array.isArray(artists)) return [];
    return uniqueNames(artists.map(artist => cleanText(artist && artist.name)));
  }

  function mergeUnique(first, second) {
    return uniqueNames([].concat(first || [], second || []));
  }

  function uniqueNames(names) {
    const result = [];
    const seen = {};
    (names || []).forEach(name => {
      name = cleanText(name);
      if (!name) return;
      const key = name.toLocaleLowerCase();
      if (seen[key]) return;
      seen[key] = true;
      result.push(name);
    });
    return result;
  }

  function cleanText(value) {
    if (value === null || value === undefined) return '';
    return String(value)
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&laquo;/g, '«')
      .replace(/&raquo;/g, '»')
      .replace(/&#8212;/g, '—')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
  }

  function yearFromReleaseDate(releaseDate) {
    const match = String(releaseDate || '').match(/^(\d{4})/);
    return match ? match[1] : '';
  }

  function getYandexAlbumIdFromUrl(url) {
    const match = String(url || '').match(/\/album\/(\d+)/);
    return match ? match[1] : null;
  }

  function buildCleanYandexAlbumUrl(albumId) {
    return `${location.protocol}//music.yandex.ru/album/${encodeURIComponent(albumId)}`;
  }

  function requestJson(url) {
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest === 'function') {
        GM_xmlhttpRequest({
          method: 'GET',
          url,
          headers: { 'Accept': 'application/json' },
          onload: response => {
            if (response.status < 200 || response.status >= 300) {
              reject(new Error('HTTP '+response.status+': '+response.responseText));
              return;
            }
            try {
              resolve(JSON.parse(response.responseText));
            } catch (err) {
              reject(err);
            }
          },
          onerror: reject,
          ontimeout: reject
        });
        return;
      }

      fetch(url, { credentials: 'include', headers: { 'Accept': 'application/json' } })
        .then(response => {
          if (!response.ok) throw new Error('HTTP '+response.status);
          return response.json();
        })
        .then(resolve)
        .catch(reject);
    });
  }

  // --- Кнопка на странице артиста ---
  function createArtistButtons(name) {
    const wrapper = document.createElement('div');
    wrapper.className = `mb-buttons ${WRAPPER_CLASS}`;
    wrapper.dataset.mbKind = 'artist';
    wrapper.dataset.mbArtistName = name;

    const searchUrl = 'https://musicbrainz.org/search?query=' +
      encodeURIComponent(name) + '&type=artist';
    const button = createActionButton('Search Artist on MusicBrainz');
    button.title = 'Search artist on MusicBrainz';
    button.addEventListener('click', () => {
      window.open(searchUrl, '_blank', 'noopener,noreferrer');
    });

    wrapper.appendChild(button);
    return wrapper;
  }

  function scheduleInject(delay = 60) {
    if (injectScheduled) return;
    injectScheduled = true;
    window.setTimeout(() => {
      injectScheduled = false;
      injectButtons();
      updateButtonSizes();
    }, delay);
  }

  // Запуск и отслеживание SPA-навигации.
  injectButtons();
  updateButtonSizes();

  new MutationObserver(() => scheduleInject(80)).observe(document.body, {
    childList: true,
    subtree: true
  });

  ['pushState', 'replaceState'].forEach(method => {
    const original = history[method];
    history[method] = function() {
      const result = original.apply(this, arguments);
      scheduleInject(50);
      return result;
    };
  });

  window.addEventListener('popstate', () => scheduleInject(50));
})();
