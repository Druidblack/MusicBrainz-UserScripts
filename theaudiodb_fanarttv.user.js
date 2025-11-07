// ==UserScript==
// @name         TheAudioDB → Fanart.tv
// @version      1.1
// @description  Checks on the website fanart.tv availability of images for the artist
// @author      Druidblack
// @namespace   https://github.com/Druidblack/MusicBrainz-UserScripts
// @match        https://www.theaudiodb.com/artist/*
// @grant        GM_xmlhttpRequest
// @connect      webservice.fanart.tv
// @icon        https://musicbrainz.org/favicon.ico
//
// @downloadURL  https://github.com/Druidblack/MusicBrainz-UserScripts/raw/main/theaudiodb_fanarttv.user.js
// @updateURL    https://github.com/Druidblack/MusicBrainz-UserScripts/raw/main/theaudiodb_fanarttv.user.js
// ==/UserScript==

(function () {
  'use strict';

  const FANART_API_KEY = 'api_key';

  if (!/\/artist\/\d+/.test(location.pathname)) return;

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function findExternalLinksHeading() {
    const candidates = $$('b,strong,h1,h2,h3,h4,h5,div,span,p');
    return candidates.find(el => el.textContent.trim().toLowerCase() === 'external links'
      || /\bexternal links\b/i.test(el.textContent.trim())) || null;
  }

  function findFanartMbidFromLink() {
    const a = $('a[href*="fanart.tv/artist/"]');
    if (!a || !a.href) return null;
    const m = a.href.match(/fanart\.tv\/artist\/([0-9a-f-]{36})/i);
    return m ? m[1] : null;
  }

  function insertAfter(refNode, newNode) {
    if (!refNode || !refNode.parentNode) return document.body.prepend(newNode);
    refNode.parentNode.insertBefore(newNode, refNode.nextSibling);
  }

  function removeOldLine() {
    const old = document.getElementById('fanarttv-counts-line');
    if (old) old.remove();
  }

  function renderLine(target, counts) {
    removeOldLine();
    const line = document.createElement('div');
    line.id = 'fanarttv-counts-line';
    line.style.margin = '6px 0 10px';
    line.style.fontSize = '14px';
    line.style.lineHeight = '1.35';

    // Центрирование и аккуратные переносы
    line.style.display = 'block';
    line.style.width = '100%';
    line.style.textAlign = 'center';
    line.style.whiteSpace = 'normal';
    line.style.wordBreak = 'break-word';
    line.style.hyphens = 'auto';

    line.textContent =
      `Background=${counts.background}, ` +
      `Thumb=${counts.thumb}, ` +
      `Banner=${counts.banner}, ` +
      `Logo(HD)=${counts.logoHD}, ` +
      `Logo=${counts.logo}, ` +
      `Music Banner=${counts.musicBanner} · ` +
      `Albums: ` +
      `Album Cover=${counts.albumCover}, ` +
      `CDArt=${counts.cdart}, ` +
      `Album Thumb=${counts.albumThumb}`;
    insertAfter(target, line);
  }

  function computeCounts(json) {
    const getLen = (arr) => Array.isArray(arr) ? arr.length : 0;

    const background   = getLen(json.artistbackground);
    const thumb        = getLen(json.artistthumb);
    const banner       = getLen(json.artistbanner);
    const logoHD       = getLen(json.hdmusiclogo);
    const logo         = getLen(json.musiclogo);
    const musicBanner  = getLen(json.musicbanner);

    let albumCover = 0, cdart = 0, albumThumb = 0;
    const albums = json.albums || {};
    for (const album of Object.values(albums)) {
      albumCover += getLen(album.albumcover);
      cdart      += getLen(album.cdart);
      albumThumb += getLen(album.albumthumb);
    }

    return { background, thumb, banner, logoHD, logo, musicBanner, albumCover, cdart, albumThumb };
  }

  function requestFanart(mbid, onOk, onErr) {
    const url = `https://webservice.fanart.tv/v3/music/${encodeURIComponent(mbid)}?api_key=${encodeURIComponent(FANART_API_KEY)}`;
    GM_xmlhttpRequest({
      method: 'GET',
      url,
      headers: { 'Accept': 'application/json' },
      onload: (res) => {
        try {
          if (res.status >= 200 && res.status < 300) {
            onOk(JSON.parse(res.responseText));
          } else {
            onErr(new Error(`HTTP ${res.status}`));
          }
        } catch (e) { onErr(e); }
      },
      onerror: () => onErr(new Error('Network error')),
      ontimeout: () => onErr(new Error('Timeout')),
    });
  }

  function main() {
    const heading = findExternalLinksHeading();
    if (!heading) return;

    const mbid = findFanartMbidFromLink();
    if (!mbid) return;

    if (!FANART_API_KEY || /YOUR_FANART_API_KEY/.test(FANART_API_KEY)) return;

    requestFanart(
      mbid,
      (json) => renderLine(heading, computeCounts(json || {})),
      () => {}
    );
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', main, { once: true });
  } else {
    main();
  }
})();
