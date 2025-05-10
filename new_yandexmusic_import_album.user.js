// ==UserScript==
// @name        MusicBrainz: Import and Search from Yandex Music (new design)
// @description Для импорта альбомов, книг и поиска исполнителей.
// @version     2025.01.00.32.4
// @author      Druidblack
// @namespace   https://github.com/Druidblack/MusicBrainz-UserScripts
//
// @match       https://music.yandex.ru/*
// @require     https://ajax.googleapis.com/ajax/libs/jquery/2.1.4/jquery.min.js
// @run-at      document-idle
// @grant       none
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
      const container = document.querySelector(
        'div.PageHeaderBase_controls__HzGgE > ' +
        '.CommonPageHeader_controlsContainer__4_h22 > ' +
        '.CommonPageHeader_controls__c27E_'
      );
      if (!container || container.querySelector('.mb-buttons')) return;
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

  // --- Альбомная логика (из версии 32.2) ---
  function injectAlbumButtons(container) {
    const rawTitle = $('span.PageHeaderTitle_title__caKyB').first().text().trim()
      || $('.page-album__title span.deco-typo').first().text().trim()
      || $('.page-album__title').text().trim();
    let albumTitle = rawTitle;

    const entityStr = $('div.PageHeaderBase_entityName__9Sj_Q').first().text().trim();
    let relPrimary, relSecondary;

    // базовые исполнители из метаданных
    const metaArtists = $('div.PageHeaderAlbumMeta_meta__zsMI8')
      .find('span.PageHeaderAlbumMeta_artistLabel__2WZSM')
      .map((i,el) => $(el).text().trim()).get();

    // для аудио: вытаскиваем авторов из заголовка до ". «"
    let audioAuthors = [], artistList = metaArtists;
    if (entityStr.toUpperCase().includes('АУДИО')) {
      relPrimary   = 'Other';
      relSecondary = 'Audiobook';
      // текст в кавычках
      const m = rawTitle.match(/«([^»]+)»/);
      if (m) albumTitle = m[1];
      // авторы до ". «"
      const authorsPart = rawTitle.split('. «')[0];
      audioAuthors = authorsPart.split(',').map(a => a.trim()).filter(a => a);
      artistList   = audioAuthors.concat(metaArtists);
    }
    else if (entityStr === 'Сингл') {
      relPrimary = 'Single';
    } else {
      relPrimary = 'Album';
    }

    const yearMatch  = $('div.PageHeaderAlbumMeta_year__2X3NO').first().text().match(/(\d{4})/);
    const year       = yearMatch ? yearMatch[1] : null;
    const label      = $('.page-album__label a.d-link').text().trim();
    const comment = $('.PageHeaderTitle_version__g5BeO').text().trim();

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
      inp.value = value;
      form.appendChild(inp);
    }

    // статические поля релиза
    addField('mediums.0.format','Digital Media');
    addField('name', albumTitle);

    // artist_credit
    if (relSecondary) {
      const countAudio = audioAuthors.length;
      const needPlural = (metaArtists.length > 1);
      artistList.forEach((a,i) => {
        addField(`artist_credit.names.${i}.artist.name`, a);
        if (artistList.length > 1 && i < artistList.length - 1) {
          if (i < countAudio) {
            if (i < countAudio - 1) {
              addField(`artist_credit.names.${i}.join_phrase`, ', ');
            } else {
              addField(
                `artist_credit.names.${i}.join_phrase`,
                needPlural ? ' чтецы: ' : ' чтец: '
              );
            }
          } else {
            const metaIndex = i - countAudio;
            const sep = (metaIndex === metaArtists.length - 2) ? ' & ' : ', ';
            addField(`artist_credit.names.${i}.join_phrase`, sep);
          }
        }
      });
    } else {
      artistList.forEach((a,i) => {
        addField(`artist_credit.names.${i}.artist.name`, a);
        if (i < artistList.length - 1) {
          const sep = (i === artistList.length - 2) ? ' & ' : ', ';
          addField(`artist_credit.names.${i}.join_phrase`, sep);
        }
      });
    }

    addField('labels.0.name', label);
    addField('packaging','None');
    if (year) addField('date.year', year);
    addField('country','XW');
    addField('status','official');
    addField('type', relPrimary);
    if (relSecondary) {
      addField('type', relSecondary);
      addField('language','rus');
    }
    if (comment) addField('comment', comment);
    addField('edit_note','Imported from: '+location.href+' using script from https://github.com/Druidblack/MusicBrainz-UserScripts/blob/main/new_yandexmusic_import_album.user.js');
    addField('urls.0.link_type','980');
    addField('urls.0.url',location.href.replace(/\?.*$/,''));

    // контейнер кнопок
    const wrapper = document.createElement('div');
    wrapper.className        = 'mb-buttons';
    wrapper.style.display    = 'flex';
    wrapper.style.gap        = '20px';
    wrapper.style.alignItems = 'center';

    // Add
    const wrapForm = document.createElement('div');
    wrapForm.className = 'mbForm';
    wrapForm.appendChild(form);
    const btnAdd = document.createElement('input');
    btnAdd.type  = 'button';
    btnAdd.value = 'Add to MusicBrainz';
    styleButton(btnAdd);
    form.appendChild(btnAdd);
    wrapper.appendChild(wrapForm);

    // Search
    const btnSearch = document.createElement('a');
    btnSearch.href        = 'https://musicbrainz.org/search?query='
                              + encodeURIComponent(albumTitle)+'&type=release';
    btnSearch.target      = '_blank';
    styleButton(btnSearch);
    btnSearch.textContent = 'Search on MusicBrainz';
    wrapper.appendChild(btnSearch);

    container.appendChild(wrapper);
    syncButtons.push(btnAdd, btnSearch);
    setTimeout(updateButtonSizes, 0);

    // обработчик Add
    btnAdd.addEventListener('click', async e => {
      e.preventDefault();
      btnAdd.disabled = true;
      btnAdd.value    = 'Loading…';

      // раскрыть «и ещё N»
      const spoiler = document.querySelector('a.PageHeaderAlbumMeta_artistsSpoiler__VOkfE');
      if (spoiler) {
        spoiler.removeAttribute('href');
        spoiler.dispatchEvent(new MouseEvent('click',{bubbles:true}));
        await new Promise(r=>setTimeout(r,100));
      }

      // пересобирать metaArtists
      const updatedMetaArtists = $('span.PageHeaderAlbumMeta_artistLabel__2WZSM')
        .map((i,el)=>$(el).text().trim()).get();
      let dynAlbumList = updatedMetaArtists;
      if (relSecondary) dynAlbumList = audioAuthors.concat(updatedMetaArtists);


      // очистить старые artist_credit
      Array.from(form.querySelectorAll('input[name^="artist_credit.names"]'))
        .forEach(i=>i.remove());

      // вставить заново
      if (relSecondary) {
        const countAudio = audioAuthors.length;
        const needPlural = (metaArtists.length > 1);
        dynAlbumList.forEach((a,i) => {
          addField(`artist_credit.names.${i}.artist.name`, a);
          if (dynAlbumList.length > 1 && i < dynAlbumList.length - 1) {
            if (i < countAudio) {
              if (i < countAudio - 1) addField(`artist_credit.names.${i}.join_phrase`, ', ');
              else                    addField(
                                         `artist_credit.names.${i}.join_phrase`,
                                         needPlural ? ' чтецы: ' : ' чтец: '
                                       );
            } else {
              const metaIndex = i - countAudio;
              const sep = (metaIndex === updatedMetaArtists.length - 2) ? ' & ' : ', ';
              addField(`artist_credit.names.${i}.join_phrase`, sep);
            }
          }
        });
      } else {
        dynAlbumList.forEach((a,i) => {
          addField(`artist_credit.names.${i}.artist.name`, a);
          if (i < dynAlbumList.length - 1) {
            const sep = (i === dynAlbumList.length - 2) ? ' & ' : ', ';
            addField(`artist_credit.names.${i}.join_phrase`, sep);
          }
        });
      }

      // получить треки
      const m = location.pathname.match(/\/album\/(\d+)/);
      if (m) {
        try {
          const res  = await fetch(`/handlers/album.jsx?album=${m[1]}&external-domain=music.yandex.ru`);
          const data = await res.json();
          let tracks = [];
          if (Array.isArray(data.volumes)) data.volumes.forEach(v=>v.forEach(t=>tracks.push(t)));
          else if (Array.isArray(data.tracks)) tracks = data.tracks;

          // очистить старые
          Array.from(form.querySelectorAll('input[name^="mediums.0.track"]'))
            .forEach(i=>i.remove());

          tracks.forEach((t,i)=>{
            addField(`mediums.0.track.${i}.name`,t.title||'');
            addField(`mediums.0.track.${i}.length`,t.durationMs);

            const trackMeta = (t.artists||[]).map(ar=>ar.name);
            const trackList = relSecondary
              ? audioAuthors.concat(trackMeta)
              : trackMeta;

            if (relSecondary) {
              const countA = audioAuthors.length;
              const needPl = (updatedMetaArtists.length > 1);
              trackList.forEach((nm,j) => {
                addField(`mediums.0.track.${i}.artist_credit.names.${j}.name`, nm);
                if (trackList.length > 1 && j < trackList.length - 1) {
                  if (j < countA) {
                    if (j < countA - 1) addField(`mediums.0.track.${i}.artist_credit.names.${j}.join_phrase`, ', ');
                    else                 addField(
                                            `mediums.0.track.${i}.artist_credit.names.${j}.join_phrase`,
                                            needPl ? ' чтецы: ' : ' чтец: '
                                          );
                  } else {
                    const idx = j - countA;
                    const sep = (idx === trackMeta.length - 2) ? ' & ' : ', ';
                    addField(`mediums.0.track.${i}.artist_credit.names.${j}.join_phrase`, sep);
                  }
                }
              });
            } else {
              trackList.forEach((nm,j) => {
                addField(`mediums.0.track.${i}.artist_credit.names.${j}.name`, nm);
                if (j < trackList.length - 1) {
                  const sep = (j === trackList.length - 2) ? ' & ' : ', ';
                  addField(`mediums.0.track.${i}.artist_credit.names.${j}.join_phrase`, sep);
                }
              });
            }
          });
        } catch(err) {
          console.error('Failed to fetch tracklist', err);
        }
      }

      btnAdd.value = 'Submitting…';
      form.submit();
      setTimeout(() => {
        btnAdd.disabled = false;
        btnAdd.value    = 'Add to MusicBrainz';
      }, 1000);
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
