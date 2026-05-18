// ==UserScript==

// @name        MusicBrainz: Import and Search from Yandex Music (new design)
// @description Для импорта альбомов, книг и поиска исполнителей.
// @version     2025.01.00.32.8
// @author      Druidblack
// @namespace   https://github.com/Druidblack/MusicBrainz-UserScripts
//
// @match       https://music.yandex.ru/*
// @require     https://ajax.googleapis.com/ajax/libs/jquery/2.1.4/jquery.min.js
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

  const $ = jQuery.noConflict(true);
  const syncButtons = [];

  // Подстройка размеров кнопок под «Слушать»
  function updateButtonSizes() {
    const listen = document.querySelector(
      'div.PageHeaderBase_controls__HzGgE button[aria-label="Воспроизведение"]'
    );
    if (!listen) return;
    const cs = getComputedStyle(listen), h = parseFloat(cs.height);
    syncButtons.forEach(el => {
      el.style.display       = 'inline-flex';
      el.style.alignItems    = 'center';
      el.style.height        = cs.height;
      el.style.borderRadius  = cs.borderRadius;
      el.style.paddingTop    = cs.paddingTop;
      el.style.paddingBottom = cs.paddingBottom;
      el.style.paddingLeft   = cs.paddingLeft;
      el.style.paddingRight  = cs.paddingRight;
      el.style.fontSize      = cs.fontSize;
      el.style.fontWeight    = cs.fontWeight;
      el.style.fontFamily    = cs.fontFamily;
    });
    document.querySelectorAll('.mb-buttons').forEach(container => {
      container.style.gap = (h * 0.3) + 'px';
    });
  }
  window.addEventListener('resize', updateButtonSizes);

  // Инжект кнопок в зависимости от страницы
  function injectButtons() {
    // Альбом
    if (/\/album\//.test(location.pathname)) {
        const container =
              document.querySelector(
                  'div.PageHeaderBase_controls__HzGgE ' +
                  '[class^="CommonPageHeader_controlsContainer__"] ' +
                  '[class^="CommonPageHeader_controls__"]'
              )
        || document.querySelector(
            'div.PageHeaderBase_controls__HzGgE [class^="CommonPageHeader_controls__"]'
        );

        if (!container) return;

        const albumId = getYandexAlbumIdFromUrl(location.href);
        const existing = container.querySelector('.mb-buttons');
        if (existing) {
          if (existing.dataset && existing.dataset.mbAlbumId === String(albumId || '')) return;
          existing.remove();
        }
        injectAlbumButtons(container);
    }
    // Артист (новый UI / старый UI)
    else if (/\/artist\//.test(location.pathname)) {
      // сначала ищем новый контейнер артиста
      let container = document.querySelector(
        'div.PageHeaderBase_controls__HzGgE > div.PageHeaderArtist_controls__U_6g7'
      );
      // fallback на старый
      if (!container) {
        container = document.querySelector(
          'div.PageHeaderBase_controls__HzGgE > .CommonPageHeader_controlsContainer__4_h22 > .CommonPageHeader_controls__c27E_'
        );
      }
      if (!container || container.querySelector('.mb-buttons')) return;

      // имя артиста: пытаемся новый заголовок, иначе старый
      let name = '';
      const newHeading = document.querySelector(
        'h1.PageHeaderTitle_heading__UADXi span.PageHeaderTitle_title__caKyB'
      );
      if (newHeading) {
        name = newHeading.textContent.trim();
      } else {
        name = $('h1.page-artist__title.typo-h1.typo-h1_big').first().text().trim();
      }
      if (!name) return;
      injectArtistButtons(container, name);
    }
  }

  // --- Альбомная логика: все данные берём из API /albums/{id}/with-tracks ---
  async function injectAlbumButtons(container) {
    const albumId = getYandexAlbumIdFromUrl(location.href);
    if (!albumId) return;

    if (container.dataset.mbAlbumLoading === String(albumId)) return;
    container.dataset.mbAlbumLoading = String(albumId);

    const apiUrl = `https://api.music.yandex.net/albums/${encodeURIComponent(albumId)}/with-tracks`;
    let apiResponse;
    try {
      apiResponse = await requestJson(apiUrl);
    } catch (err) {
      console.error('[MusicBrainz/Yandex] Failed to fetch album data from Yandex API', err);
      delete container.dataset.mbAlbumLoading;
      return;
    }

    const albumData = apiResponse && (apiResponse.result || apiResponse);
    if (!albumData || !albumData.id) {
      console.error('[MusicBrainz/Yandex] Unexpected Yandex API response', apiResponse);
      delete container.dataset.mbAlbumLoading;
      return;
    }

    const normalized = normalizeYandexAlbum(albumData);
    if (container.querySelector('.mb-buttons')) {
      delete container.dataset.mbAlbumLoading;
      return;
    }

    // создаём форму
    const form = document.createElement('form');
    form.method        = 'post';
    form.target        = '_blank';
    form.action        = 'https://musicbrainz.org/release/add';
    form.acceptCharset = 'UTF-8';

    function addField(name, value) {
      const inp = document.createElement('input');
      inp.type  = 'hidden';
      inp.name  = name;
      inp.value = value == null ? '' : value;
      form.appendChild(inp);
    }

    buildReleaseFormFromYandexAlbum(form, addField, normalized, apiUrl);

    // контейнер кнопок
    const wrapper = document.createElement('div');
    wrapper.className        = 'mb-buttons';
    wrapper.dataset.mbAlbumId = String(albumId);
    wrapper.style.display    = 'flex';
    wrapper.style.gap        = '20px';
    wrapper.style.alignItems = 'center';

    // Add
    const wrapForm = document.createElement('div');
    wrapForm.className = 'mbForm';
    wrapForm.appendChild(form);
    const btnAdd = document.createElement('input');
    btnAdd.type  = 'submit';
    btnAdd.value = 'Add to MusicBrainz';
    styleButton(btnAdd);
    form.appendChild(btnAdd);
    wrapper.appendChild(wrapForm);

    // Search
    const btnSearch = document.createElement('a');
    btnSearch.href        = 'https://musicbrainz.org/search?query='
                              + encodeURIComponent(normalized.title)+'&type=release';
    btnSearch.target      = '_blank';
    styleButton(btnSearch);
    btnSearch.textContent = 'Search on MusicBrainz';
    wrapper.appendChild(btnSearch);

    container.appendChild(wrapper);
    syncButtons.push(btnAdd, btnSearch);
    setTimeout(updateButtonSizes, 0);
    delete container.dataset.mbAlbumLoading;
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
    addField('urls.0.link_type','980');
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
  function injectArtistButtons(container, name) {
     // override Yandex grid → flex, чтобы можно было переставлять порядок кнопок
    const cs = getComputedStyle(container);
    container.style.display    = 'flex';
    container.style.alignItems = 'center';
    // подхватим дефолтный gap из grid-стилей, или возьмём 12px
    container.style.gap        = cs.gap || '12px';
    const wrapper = document.createElement('div');
    wrapper.className        = 'mb-buttons';
    wrapper.style.display    = 'flex';
    wrapper.style.gap        = '20px';
    wrapper.style.alignItems = 'center';

    const btn = document.createElement('a');
    btn.href        = 'https://musicbrainz.org/search?query='
                     + encodeURIComponent(name)
                     + '&type=artist';
    btn.target      = '_blank';
    btn.textContent = 'Search Artist on MusicBrainz';
    styleButton(btn);

    wrapper.appendChild(btn);
    container.prepend(wrapper);
    syncButtons.push(btn);
    setTimeout(updateButtonSizes, 0);
  }

  // Универсальная стилизация кнопок
  function styleButton(el) {
    el.style.backgroundColor = '#ffcc33';
    el.style.border          = 'none';
    el.style.outline         = 'none';
    el.style.borderRadius    = '20px';
    el.style.color           = '#121212';
    el.style.cursor          = 'pointer';
    el.style.textDecoration  = 'none';
    el.style.transition      = 'background-color 0.3s ease';
    el.addEventListener('mouseover', ()=>el.style.backgroundColor='#ffd966');
    el.addEventListener('mouseout',  ()=>el.style.backgroundColor='#ffcc33');
  }

  // Запуск и отслеживание SPA-навигации
  injectButtons();
  new MutationObserver(injectButtons).observe(document.body, { childList: true, subtree: true });
  ['pushState','replaceState'].forEach(m=>{
    const orig = history[m];
    history[m] = function(){
      const ret = orig.apply(this,arguments);
      setTimeout(injectButtons,100);
      return ret;
    };
  });
  window.addEventListener('popstate', ()=>setTimeout(injectButtons,100));
})();
