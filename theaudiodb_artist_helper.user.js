// ==UserScript==
// @name         TheAudioDB Artist Helper
// @namespace    d.byvaltsev.audiodb.helper
// @version      1.2.2-fanart-extended-fix5-cache
// @description  MusicBrainz data Panel/Wikipedia + Last.fm (tags/stat/years/founded/birth/biography) and an extended summary fanart.tv .
// @author       Druidblack
// @match        https://www.theaudiodb.com/edit_artist.php*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @connect      musicbrainz.org
// @connect      wikidata.org
// @connect      wikipedia.org
// @connect      ru.wikipedia.org
// @connect      en.wikipedia.org
// @connect      coverartarchive.org
// @connect      webservice.fanart.tv
// @connect      ws.audioscrobbler.com
// @connect      www.last.fm
// @inject-into  page
// @icon        https://www.theaudiodb.com/favicon.ico
//
// @downloadURL  https://github.com/Druidblack/MusicBrainz-UserScripts/raw/main/theaudiodb_artist_helper.user.js
// @updateURL    https://github.com/Druidblack/MusicBrainz-UserScripts/raw/main/theaudiodb_artist_helper.user.js
// ==/UserScript==

(function() {
  'use strict';

  /*** ====== НАСТРОЙКИ ====== ***/
  const LFM_API_KEY    = 'API_KEY';
  const FANART_API_KEY = 'API_KEY';
  const MAX_ALIASES = 8;
  const MAX_TAGS = 10;
  const WIKI_PREF_KEY = 'adb_wiki_lang'; // 'ru' | 'en'
  const LFM_PREF_KEY  = 'adb_lfm_lang';  // 'ru' | 'en'
  const CACHE_TTL_MS = 3600 * 1000; // 1 час

  /*** ====== КЭШ (localStorage) ====== **/
  function cacheRead(key, maxAgeMs) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (!obj || typeof obj.t !== 'number') return null;
      if (Date.now() - obj.t > maxAgeMs) return null;
      return obj.v;
    } catch (_) { return null; }
  }
  function cacheWrite(key, value) {
    try { localStorage.setItem(key, JSON.stringify({ t: Date.now(), v: value })); } catch(_) {}
  }
  function cacheKey(prefix, url, headers) {
    const h = headers ? '|' + JSON.stringify(headers) : '';
    return `${prefix}:${url}${h}`;
  }
  async function cachedGetJSON(url, opts={}) {
    const ttl = typeof opts.ttlMs === 'number' ? opts.ttlMs : CACHE_TTL_MS;
    const key = cacheKey('adb_cache_json', url, opts.headers);
    const hit = cacheRead(key, ttl);
    if (hit) return hit;
    const json = await httpGetJSON(url, opts);
    cacheWrite(key, json);
    return json;
  }
  async function cachedGetText(url, opts={}) {
    const ttl = typeof opts.ttlMs === 'number' ? opts.ttlMs : CACHE_TTL_MS;
    const key = cacheKey('adb_cache_text', url);
    const hit = cacheRead(key, ttl);
    if (hit) return hit;
    const text = await httpGetText(url);
    cacheWrite(key, text);
    return text;
  }

  /*** ====== УТИЛИТЫ ====== ***/
  function httpGetJSON(url, opts={}) {
    return new Promise((resolve, reject) => {
      const { headers } = opts;
      if (typeof GM_xmlhttpRequest === 'function') {
        GM_xmlhttpRequest({
          method: 'GET', url, headers,
          onload: r => { try { resolve(JSON.parse(r.responseText)); } catch (e) { reject(e); } },
          onerror: reject, ontimeout: reject
        });
      } else {
        fetch(url, { headers }).then(r => r.ok ? r.json() : Promise.reject(r.statusText)).then(resolve, reject);
      }
    });
  }
  function httpGetText(url) {
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest === 'function') {
        GM_xmlhttpRequest({ method: 'GET', url, onload: r => resolve(r.responseText), onerror: reject, ontimeout: reject });
      } else {
        fetch(url).then(r => r.text()).then(resolve, reject);
      }
    });
  }
  const $  = (sel, root=document) => root.querySelector(sel);
  const $all = (sel, root=document) => Array.from(root.querySelectorAll(sel));
  const esc = s => (s==null?'':String(s)).replace(/[<>&"]/g, m=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[m]));
  function onceFlag(){ if (document.body.dataset.adbArtistHelper) return true; document.body.dataset.adbArtistHelper='1'; return false; }

  /*** ====== ИМЯ АРТИСТА СО СТРАНИЦЫ ====== ***/
  function getArtistNameFromPage() {
    const anchors = $all('a[href^="/artist/"]')
      .filter(a => !a.closest('#footer'))
      .filter(a => /^\s*\/artist\/\d+/.test(a.getAttribute('href')||''));
    const a = anchors[0];
    const name = a ? a.textContent.trim() : '';
    return name || null;
  }

  /*** ====== MusicBrainz ====== ***/
  async function fetchMBSearch(name) {
    const q = `artist:"${name}"`;
    const url = `https://musicbrainz.org/ws/2/artist?query=${encodeURIComponent(q)}&fmt=json`;
    return cachedGetJSON(url);
  }
  function pickBestMBArtist(list, name) {
    if (!list?.artists?.length) return null;
    const lc = (name||'').toLowerCase();
    const exact = list.artists.find(a => (a.name||'').toLowerCase() === lc);
    if (exact) return exact;
    const withAlias = list.artists.find(a => (a.aliases||[]).some(al => (al.name||'').toLowerCase() === lc));
    if (withAlias) return withAlias;
    return list.artists.slice().sort((x,y)=>(y.score||0)-(x.score||0))[0];
  }
  async function fetchMBLookup(mbid) {
    const inc = ['aliases','tags','url-rels','artist-rels'].join('+');
    const url = `https://musicbrainz.org/ws/2/artist/${mbid}?fmt=json&inc=${inc}`;
    return cachedGetJSON(url);
  }
  function parseMBRelations(relations=[]) {
    const R = {
      official_site:null, wikipedia:null, wikidata:null,
      youtube:null, twitter:null, instagram:null, facebook:null, vk:null, soundcloud:null,
      lastfm:null
    };
    for (const rel of relations) {
      const u = rel?.url?.resource || ''; if (!u) continue;
      const url = u.toLowerCase();
      if (rel.type === 'official homepage') R.official_site = u;
      else if (url.includes('wikipedia.org/wiki/')) R.wikipedia = u;
      else if (url.includes('wikidata.org/wiki/')) R.wikidata = u;
      else if (url.includes('last.fm/music/')) R.lastfm = u;
      else if (url.includes('youtube.com') || url.includes('youtu.be')) R.youtube = u;
      else if (url.includes('twitter.com')) R.twitter = u;
      else if (url.includes('instagram.com')) R.instagram = u;
      else if (url.includes('facebook.com')) R.facebook = u;
      else if (url.includes('vk.com')) R.vk = u;
      else if (url.includes('soundcloud.com')) R.soundcloud = u;
    }
    return R;
  }

  /*** ====== Wikidata / Wikipedia ====== ***/
  function extractQID(wikidataUrl){ if (!wikidataUrl) return null; const m = wikidataUrl.match(/\/(Q\d+)(?:$|[?#/])/i); return m?m[1]:null; }
  async function fetchWikidataEntity(qid) {
    if (!qid) return null;
    try {
      const j = await cachedGetJSON(`https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`);
      return j?.entities?.[qid] || null;
    } catch(e){ return null; }
  }
  function getSitelinkTitle(entity, lang) {
    const key = (lang==='ru') ? 'ruwiki' : (lang==='en' ? 'enwiki' : null);
    return key ? (entity?.sitelinks?.[key]?.title || null) : null;
  }
  async function fetchWikipediaIntroByTitle(title, lang='ru') {
    const api = `https://${lang}.wikipedia.org/w/api.php?action=query&prop=extracts&exintro=1&explaintext=1&redirects=1&format=json&origin=*&titles=${encodeURIComponent(title)}`;
    try {
      const j = await cachedGetJSON(api);
      const pages = j?.query?.pages || {};
      const first = Object.values(pages)[0];
      if (first && first.extract !== undefined) return { lang, title: first.title, extract: first.extract || '' };
    } catch(e){}
    return null;
  }
  async function fetchWikipediaIntroBySearch(name, lang='ru') {
    try {
      const s = await cachedGetJSON(`https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(name)}&srlimit=1&format=json&origin=*`);
      const page = s?.query?.search?.[0]; if (!page) return null;
      const d = await cachedGetJSON(`https://${lang}.wikipedia.org/w/api.php?action=query&prop=extracts&exintro=1&explaintext=1&pageids=${page.pageid}&format=json&origin=*`);
      const p = d?.query?.pages?.[page.pageid];
      if (p && p.extract !== undefined) return { lang, title: p.title, extract: p.extract || '' };
    } catch(e){}
    return null;
  }
  async function getWikipediaIntroSmart({ name, qid, preferLang='ru' }) {
    const other = (preferLang === 'ru') ? 'en' : 'ru';
    if (qid) {
      const entity = await fetchWikidataEntity(qid);
      const preferTitle = getSitelinkTitle(entity, preferLang);
      const otherTitle  = getSitelinkTitle(entity, other);
      const prefer = preferTitle ? await fetchWikipediaIntroByTitle(preferTitle, preferLang) : null;
      if (prefer && (prefer.extract||'').trim()) return prefer;
      const fallback = otherTitle ? await fetchWikipediaIntroByTitle(otherTitle, other) : null;
      if (fallback) return fallback;
    }
    const p = await fetchWikipediaIntroBySearch(name, preferLang);
    if (p && (p.extract||'').trim()) return p;
    const o = await fetchWikipediaIntroBySearch(name, other);
    if (o) return o;
    return null;
  }

  /*** ====== Last.fm / fanart.tv ====== ***/
  async function fetchFanart(mbid) {
    if (!FANART_API_KEY || !mbid) return null;
    try { return await cachedGetJSON(`https://webservice.fanart.tv/v3/music/${mbid}?api_key=${FANART_API_KEY}`); }
    catch(e){ return null; }
  }
  async function fetchFanartAlbums(mbid) {
    if (!FANART_API_KEY || !mbid) return null;
    try { return await cachedGetJSON(`https://webservice.fanart.tv/v3/music/albums/${mbid}?api_key=${FANART_API_KEY}`); }
    catch(e){ return null; }
  }

  async function fetchLastfm(name) {
    if (!LFM_API_KEY) return null;
    const url = `https://ws.audioscrobbler.com/2.0/?method=artist.getInfo&artist=${encodeURIComponent(name)}&api_key=${LFM_API_KEY}&format=json`;
    try { const j = await cachedGetJSON(url); if (j?.artist) return j.artist; } catch(e){ }
    return null;
  }
  async function fetchLastfmTopTags(name) {
    if (!LFM_API_KEY) return [];
    try {
      const url = `https://ws.audioscrobbler.com/2.0/?method=artist.getTopTags&artist=${encodeURIComponent(name)}&api_key=${encodeURIComponent(LFM_API_KEY)}&format=json`;
      const j = await cachedGetJSON(url);
      const list = j?.toptags?.tag || [];
      return list
        .slice()
        .sort((a,b)=>(+b.count||0)-(+a.count||0))
        .slice(0, MAX_TAGS)
        .map(t => ({ name: t.name, url: t.url }))
        .filter(t => t.name);
    } catch(e){ return []; }
  }

  // ====== LFM WIKI MULTI-LANG helpers ======
  function lfmArtistSlug(name) {
    return encodeURIComponent(name).replace(/%20/g, '+');
  }
  function sanitizeLfmBase(url) {
    if (!url) return null;
    let u = url.trim();
    if (u && !/^https?:\/\//i.test(u)) u = 'https://' + u.replace(/^\/+/, '');
    u = u.replace(/\/+$/,'');                 // убрать хвостовые слеши
    u = u.replace(/\/\+wiki(?:\/)?$/i,'');    // убрать уже добавленный +wiki
    return u;
  }
  function makeWiki(urlBase) {
    return urlBase.replace(/\/+$/,'') + '/+wiki';
  }
  function normalizeToDefaultAndRu(urlBase) {
    try {
      const u = new URL(urlBase);
      const path = u.pathname.replace(/\/\+wiki.*$/i,'').replace(/\/+$/,'');
      const m = path.match(/^(?:\/[a-z]{2})?\/music\/.+$/i);
      const artistPath = m ? path.replace(/^\/[a-z]{2}/i,'') : ('/music' + path);
      const def = `https://${u.host}${artistPath}`;
      const ru  = `https://${u.host}/ru${artistPath}`;
      return [def, ru];
    } catch {
      return [urlBase, urlBase.replace('://www.last.fm','://www.last.fm/ru')];
    }
  }
  function buildLfmWikiCandidates(baseArtistUrl, pageName) {
    const slug = lfmArtistSlug(pageName);
    const directDef = `https://www.last.fm/music/${slug}`;
    const directRu  = `https://www.last.fm/ru/music/${slug}`;

    const bases = new Set();
    if (baseArtistUrl) {
      const cleaned = sanitizeLfmBase(baseArtistUrl);
      if (cleaned) {
        bases.add(cleaned);
        normalizeToDefaultAndRu(cleaned).forEach(b => bases.add(b));
      }
    }
    bases.add(directDef);
    bases.add(directRu);

    const wikiCandidates = Array.from(bases)
      .filter(Boolean)
      .map(sanitizeLfmBase)
      .filter(Boolean)
      .map(makeWiki);

    return Array.from(new Set(wikiCandidates));
  }

  async function fetchLfmBiography(lfmWikiUrl) {
    try {
      const html = await cachedGetText(lfmWikiUrl);
      const doc  = new DOMParser().parseFromString(html, 'text/html');
      const candidates = ['.wiki-content','#wiki','div[class*="wiki"]','section[class*="wiki"]','article','main'];
      let best = null, bestLen = 0;
      for (const sel of candidates) {
        const els = $all(sel, doc);
        for (const el of els) {
          const txt = (el.innerText || '').trim();
          if (txt.length > bestLen) { best = el; bestLen = txt.length; }
        }
      }
      const text = best ? (best.innerText || '').replace(/\n{3,}/g, '\n\n').trim() : '';
      return text || null;
    } catch(e){ return null; }
  }

  // ===== парсинг мета со страницы Last.fm =====
  async function scrapeLastfmMeta(lfmUrl) {
    if (!lfmUrl) return { yearsActive:null, foundedIn:null, born:null, bornIn:null };
    try {
      const html = await cachedGetText(lfmUrl);
      const doc  = new DOMParser().parseFromString(html, 'text/html');
      const out  = { yearsActive:null, foundedIn:null, born:null, bornIn:null };

      function findBy(labels) {
        const nodes = $all('dt,th,strong,span,div,li', doc);
        for (const n of nodes) {
          const t = (n.textContent||'').trim();
          if (labels.some(lbl => new RegExp(`^\\s*${lbl}\\s*$`, 'i').test(t))) {
            const dd = n.nextElementSibling && ['DD','TD','DIV','SPAN','LI'].includes(n.nextElementSibling.tagName)
              ? n.nextElementSibling : null;
            const cand = dd ? dd.textContent : n.parentElement?.querySelector('dd,td,.metadata-data,.catalogue-metadata-description')?.textContent;
            const val = (cand||'').replace(/\s+/g,' ').trim();
            if (val) return val;
          }
        }
        return null;
      }

      out.yearsActive = findBy(['Years Active','Years active','Годы активности']);
      out.foundedIn   = findBy(['Founded In','Founded in','Основан в','Основана в']);
      out.born        = findBy(['Born','Date of birth','Родился','Родилась','Дата рождения']);
      out.bornIn      = findBy(['Born In','Born in','Place of birth','Место рождения']);
      return out;
    } catch(e){ return { yearsActive:null, foundedIn:null, born:null, bornIn:null }; }
  }

  /*** ====== РЕНДЕР ПАНЕЛИ ====== ***/
  function topTagsFromMB(tags=[]) {
    return tags.slice().sort((a,b)=>(b.count||0)-(a.count||0)).slice(0, MAX_TAGS).map(t => t.name).filter(Boolean);
  }

  function renderPanel({pageName, mbArtist, mbLookup, mbid, links, lfm, lfmTags, lfmMeta, fanart, fanartAlbums}) {
    const footer = document.querySelector('footer#footer');
    if (!footer) return;

    const el = document.createElement('section');
    el.id = 'adb-artist-helper';
    el.style.margin = '24px auto';
    el.style.maxWidth = '1200px';
    el.style.border = '1px solid rgba(0,0,0,.1)';
    el.style.borderRadius = '14px';
    el.style.padding = '16px 18px';
    el.style.background = '#2b2b2b';
    el.style.boxShadow = '0 6px 24px rgba(0,0,0,.08)';
    el.style.backdropFilter = 'saturate(140%) blur(4px)';
    el.style.fontFamily = 'system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif';
    el.style.color = '#fff';

    const aliasList = (mbLookup?.aliases||[]).map(a=>a.name).filter(Boolean).slice(0, MAX_ALIASES);
    const tagsMB = topTagsFromMB(mbLookup?.tags||[]);
    const tagsLfmHtml = (lfmTags||[]).map(t => `<a style="color:#9cd3ff" href="${esc(t.url)}" target="_blank" rel="noopener">${esc(t.name)}</a>`).join(', ');

    const mbTypeRaw   = mbLookup?.type || mbArtist?.type || null;
    const mbGenderRaw = mbLookup?.gender || mbArtist?.gender || null;
    const showGender  = (mbTypeRaw && String(mbTypeRaw).toLowerCase() === 'person');

    function linkOrDash(label, url) {
      if (!url) return `<span title="нет">${label}: —</span>`;
      const short = url.replace(/^https?:\/\//,'').replace(/\/$/,'');
      return `<span>${label}: <a style="color:#9cd3ff" href="${esc(url)}" target="_blank" rel="noopener">${esc(short)}</a></span>`;
    }

    const lastfmLink = links.lastfm || (lfm?.url ? lfm.url : `https://www.last.fm/music/${encodeURIComponent(pageName)}`);
    const fanartLink = mbid ? `https://fanart.tv/artist/${mbid}` : null;

    const cnt = {
      background:  (fanart?.artistbackground||[]).length || 0,
      banner:      (fanart?.artistbanner||[]).length     || 0,
      thumb:       (fanart?.artistthumb||[]).length      || 0,
      logo_hd:     (fanart?.hdmusiclogo||[]).length      || 0,
      logo_sd:     (fanart?.musiclogo||[]).length        || 0,
      musicbanner: (fanart?.musicbanner||[]).length      || 0
    };
    const ac = { albumcover:0, cdart:0, albumthumb:0 };
    const albumsMap = fanartAlbums && typeof fanartAlbums === 'object' ? fanartAlbums.albums : null;
    if (albumsMap && typeof albumsMap === 'object') {
      for (const v of Object.values(albumsMap)) {
        if (!v || typeof v !== 'object') continue;
        ac.albumcover += Array.isArray(v.albumcover) ? v.albumcover.length : 0;
        ac.cdart      += Array.isArray(v.cdart)      ? v.cdart.length      : 0;
        ac.albumthumb += Array.isArray(v.albumthumb) ? v.albumthumb.length : 0;
      }
    }

    const artistParts = `Background=${cnt.background}, Thumb=${cnt.thumb}, Banner=${cnt.banner}, Logo(HD)=${cnt.logo_hd}, Logo=${cnt.logo_sd}, Music Banner=${cnt.musicbanner}`;
    const albumParts  = `Album Cover=${ac.albumcover}, CDArt=${ac.cdart}, Album Thumb=${ac.albumthumb}`;

    const fanartInfoHTML = `
      <div style="margin-top:8px;font-size:13px;opacity:.85">
        fanart.tv: ${artistParts} · Albums: ${albumParts}
        ${fanartLink?` · <a style="color:#9cd3ff" target="_blank" rel="noopener" href="${esc(fanartLink)}">artist</a>`:''}
      </div>`;

    const linksHTML = [
      linkOrDash('Official',  links.official_site),
      linkOrDash('Wikipedia', links.wikipedia),
      linkOrDash('Wikidata',  links.wikidata),
      linkOrDash('Last.fm',   lastfmLink),
      linkOrDash('fanart.tv', fanartLink),
      linkOrDash('YouTube',   links.youtube),
      linkOrDash('Twitter/X', links.twitter),
      linkOrDash('Instagram', links.instagram),
      linkOrDash('Facebook',  links.facebook),
      linkOrDash('VK',        links.vk),
      linkOrDash('SoundCloud',links.soundcloud)
    ].join(' · ');

    const lfmStats = lfm ? `
      <div style="margin-top:8px;font-size:13px;opacity:.85">
        Last.fm: listeners ~ <b>${esc(lfm?.stats?.listeners || '')}</b>, playcount ~ <b>${esc(lfm?.stats?.playcount || '')}</b>
      </div>` : '';

    const preferredWiki = (localStorage.getItem(WIKI_PREF_KEY) || 'ru');
    const preferRuByUrl = /[?&]l=RU\b/i.test(location.search);
    const preferredLfm  = localStorage.getItem(LFM_PREF_KEY) || (preferRuByUrl ? 'ru' : 'en');

    const isoCountry = mbArtist?.country || mbLookup?.country || '—';
    const disamb     = mbArtist?.disambiguation || mbLookup?.disambiguation || null;

    const yearsActive = lfmMeta?.yearsActive || null;
    const foundedIn   = lfmMeta?.foundedIn   || null;
    const born        = lfmMeta?.born        || null;
    const bornIn      = lfmMeta?.bornIn      || null;
    const hasLfmMetaBlock = !!(yearsActive || foundedIn || born || bornIn);

    el.innerHTML = `
      <div style="display:flex; gap:16px; align-items:flex-start; flex-wrap:wrap">
        <div style="flex:1 1 480px; min-width:320px">
          <div style="font-size:18px; font-weight:700; line-height:1.2">
            ADB Artist Helper — <span style="opacity:.8">для</span> <span style="color:#9cffc8">${esc(pageName)}</span>
          </div>
          <div style="margin-top:4px; font-size:13px; opacity:.8">
            Основной источник: <a style="color:#9cd3ff" href="https://musicbrainz.org/" target="_blank" rel="noopener">MusicBrainz</a>
          </div>

          <div style="margin-top:12px; font-size:14px;">
            <div><b>MBID:</b> ${mbid ? `<a style="color:#9cd3ff" href="https://musicbrainz.org/artist/${esc(mbid)}" target="_blank" rel="noopener">${esc(mbid)}</a>` : '—'}
              ${mbid ? `<button id="adb-copy-mbid" style="margin-left:8px; padding:2px 8px; font-size:12px; cursor:pointer;">Copy</button>`:''}
            </div>
            <div style="margin-top:6px"><b>Country (ISO):</b> ${esc(isoCountry)}</div>

            <div style="margin-top:6px"><b>Type (MB):</b> ${esc(mbTypeRaw || '—')}</div>
            ${ showGender && mbGenderRaw ? `<div style="margin-top:6px"><b>Gender (MB):</b> ${esc(mbGenderRaw)}</div>` : '' }

            ${disamb ? `<div style="margin-top:6px"><b>Disambiguation:</b> ${esc(disamb)}</div>` : '<div style="margin-top:6px"><b>Disambiguation:</b> —</div>'}
            <div style="margin-top:6px"><b>Aliases:</b> ${aliasList.length ? esc(aliasList.join(', ')) : '—'}</div>

            ${ hasLfmMetaBlock ? `
              <div style="margin-top:10px; font-size:14px;">
                ${ yearsActive ? `<div><b>Years Active (Last.fm):</b> ${esc(yearsActive)}</div>` : '' }
                ${ foundedIn   ? `<div style="margin-top:6px"><b>Founded In (Last.fm):</b> ${esc(foundedIn)}</div>` : '' }
                ${ born        ? `<div style="margin-top:6px"><b>Born (Last.fm):</b> ${esc(born)}</div>` : '' }
                ${ bornIn      ? `<div style="margin-top:6px"><b>Born In (Last.fm):</b> ${esc(bornIn)}</div>` : '' }
              </div>` : '' }

            <div style="margin-top:6px"><b>Tags (MB):</b> ${tagsMB.length ? esc(tagsMB.join(', ')) : '—'}</div>
            <div style="margin-top:6px"><b>Tags (Last.fm):</b> ${tagsLfmHtml || '—'}</div>

            <div style="margin-top:10px; font-size:13px;">${linksHTML}</div>
            ${lfmStats}
            ${fanartInfoHTML}
          </div>
        </div>

        <div style="flex:2 1 520px; min-width:320px">
          <!-- Wikipedia -->
          <div style="display:flex; align-items:center; gap:8px; margin-top:2px">
            <div style="font-size:14px; font-weight:600;">Wikipedia</div>
            <div id="adb-wiki-toggle" style="display:inline-flex; border:1px solid rgba(255,255,255,.25); border-radius:10px; overflow:hidden;">
              <button data-lang="ru" class="adb-wiki-tab" style="padding:4px 10px; font-size:12px; border:none; background:${preferredWiki==='ru'?'#3a3a3a':'transparent'}; color:#fff; cursor:pointer;">RU</button>
              <button data-lang="en" class="adb-wiki-tab" style="padding:4px 10px; font-size:12px; border:none; border-left:1px solid rgba(255,255,255,.25); background:${preferredWiki==='en'?'#3a3a3a':'transparent'}; color:#fff; cursor:pointer;">EN</button>
            </div>
          </div>
          <div id="adb-wiki-extract" style="color:#fff; font-size:13px; white-space:pre-wrap; background:rgba(255,255,255,.06); padding:10px 12px; border-radius:10px; max-height:220px; overflow:auto; border:1px solid rgba(255,255,255,.12); margin-top:8px">
            Загрузка Wikipedia…
          </div>
          <div id="adb-wiki-source" style="margin-top:8px; font-size:12px; opacity:.8">Источник: —</div>

          <!-- Last.fm Biography + RU/EN toggle -->
          <div style="display:flex; align-items:center; gap:8px; margin-top:18px">
            <div style="font-size:14px; font-weight:600;">Last.fm — Biography</div>
            <div id="adb-lfm-toggle" style="display:inline-flex; border:1px solid rgba(255,255,255,.25); border-radius:10px; overflow:hidden;">
              <button data-lang="ru" class="adb-lfm-tab" style="padding:4px 10px; font-size:12px; border:none; background:${preferredLfm==='ru'?'#3a3a3a':'transparent'}; color:#fff; cursor:pointer;">RU</button>
              <button data-lang="en" class="adb-lfm-tab" style="padding:4px 10px; font-size:12px; border:none; border-left:1px solid rgba(255,255,255,.25); background:${preferredLfm==='en'?'#3a3a3a':'transparent'}; color:#fff; cursor:pointer;">EN</button>
            </div>
          </div>
          <div id="adb-lfm-bio" style="color:#fff; font-size:13px; white-space:pre-wrap; background:rgba(255,255,255,.06); padding:10px 12px; border-radius:10px; max-height:260px; overflow:auto; border:1px solid rgba(255,255,255,.12); margin-top:8px">
            Загрузка биографии с Last.fm…
          </div>
          <div id="adb-lfm-bio-source" style="margin-top:8px; font-size:12px; opacity:.8">Источник: —</div>
        </div>
      </div>
    `;

    // Вставляем сразу после блока с textarea биографии, если он есть
    const bioTa  = document.querySelector('textarea#biographyGB, textarea#biographyRU, textarea[id^="biography"], textarea[name^="biography"]');
    const bioRow = bioTa ? bioTa.closest('.row') : null;
    if (bioRow && bioRow.parentNode) {
      bioRow.insertAdjacentElement('afterend', el);
    } else {
      footer.parentNode.insertBefore(el, footer);
    }

    if (mbid) {
      el.querySelector('#adb-copy-mbid')?.addEventListener('click', () => {
        navigator.clipboard.writeText(mbid).then(()=>{
          const btn = el.querySelector('#adb-copy-mbid');
          btn.textContent = 'Copied!';
          setTimeout(()=>btn.textContent='Copy', 1200);
        });
      });
    }
  }

  /*** ====== ЗАГРУЗКА КОНТЕНТА (Wiki/LFM Bio) ====== ***/
  function setActiveWikiButton(lang) {
    const buttons = $all('#adb-wiki-toggle .adb-wiki-tab');
    buttons.forEach(b => b.style.background = (b.dataset.lang === lang ? '#3a3a3a' : 'transparent'));
  }
  function setActiveLfmButton(lang) {
    const buttons = $all('#adb-lfm-toggle .adb-lfm-tab');
    buttons.forEach(b => b.style.background = (b.dataset.lang === lang ? '#3a3a3a' : 'transparent'));
  }

  async function ensureWikiContent({ name, qid, lang }) {
    const box = $('#adb-wiki-extract');
    const src = $('#adb-wiki-source');
    if (!box || !src) return;
    box.textContent = 'Загрузка Wikipedia…';
    setActiveWikiButton(lang);
    const data = await getWikipediaIntroSmart({ name, qid, preferLang: lang });
    if (!data) { box.textContent = '—'; src.textContent = 'Источник: —'; return; }
    const link = `https://${data.lang}.wikipedia.org/wiki/${encodeURIComponent(data.title)}`;
    box.textContent = data.extract || '—';
    src.innerHTML = `Источник: <a style="color:#9cd3ff" target="_blank" rel="noopener" href="${esc(link)}">${esc(data.title)}</a>`;
  }

  async function ensureLfmBiography({ baseArtistUrl, pageName, lang }) {
    const box = $('#adb-lfm-bio');
    const src = $('#adb-lfm-bio-source');
    if (!box || !src) return;

    setActiveLfmButton(lang);
    const candidates = buildLfmWikiCandidates(baseArtistUrl, pageName);
    const ruList  = candidates.filter(u => /\/\/www\.last\.fm\/ru\//i.test(u));
    const defList = candidates.filter(u => !/\/\/www\.last\.fm\/ru\//i.test(u));
    const ordered = (lang === 'ru') ? [...ruList, ...defList] : [...defList, ...ruList];

    box.textContent = 'Загрузка биографии с Last.fm…';

    for (const url of ordered) {
      const text = await fetchLfmBiography(url);
      if (text && text.trim()) {
        box.textContent = text;
        const nice = url.replace(/^https?:\/\//,'');
        src.innerHTML = `Источник: <a style="color:#9cd3ff" target="_blank" rel="noopener" href="${esc(url)}">${esc(nice)}</a>`;
        return;
      }
    }
    box.textContent = '—';
    src.textContent = 'Источник: —';
  }

  /*** ====== ОСНОВНОЙ ПОТОК ====== ***/
  async function main() {
    if (onceFlag()) return;

    const pageName = getArtistNameFromPage();
    if (!pageName) return;

    // MB
    const mbSearch = await fetchMBSearch(pageName).catch(()=>null);
    const mbArtist = pickBestMBArtist(mbSearch, pageName);
    const mbid = mbArtist?.id || null;
    const mbLookup = mbid ? await fetchMBLookup(mbid).catch(()=>null) : null;
    const links = parseMBRelations(mbLookup?.relations || []);
    const qid = extractQID(links.wikidata);

    // fanart + albums + last.fm
    const [fanart, fanartAlbums, lfm] = await Promise.all([
      fetchFanart(mbid),
      fetchFanartAlbums(mbid),
      fetchLastfm(pageName)
    ]);

    // LFM теги — из getInfo, иначе fallback к topTags
    let lfmTags = [];
    if (lfm?.tags?.tag?.length) {
      lfmTags = lfm.tags.tag
        .slice(0, MAX_TAGS)
        .map(t => ({ name: t.name, url: t.url }))
        .filter(t => t.name);
    } else {
      lfmTags = await fetchLastfmTopTags(pageName);
    }

    // LFM meta
    const lastfmLink = links.lastfm || (lfm?.url ? lfm.url : `https://www.last.fm/music/${encodeURIComponent(pageName)}`);
    const lfmMeta = await scrapeLastfmMeta(lastfmLink);

    // Рендер
    renderPanel({ pageName, mbArtist, mbLookup, mbid, links, lfm, lfmTags, lfmMeta, fanart, fanartAlbums });

    // Wikipedia toggle
    const preferredWiki = (localStorage.getItem(WIKI_PREF_KEY) || 'ru');
    const toggleWiki = $('#adb-wiki-toggle');
    toggleWiki?.addEventListener('click', (e) => {
      const btn = e.target.closest('.adb-wiki-tab');
      if (!btn) return;
      const lang = btn.dataset.lang;
      localStorage.setItem(WIKI_PREF_KEY, lang);
      ensureWikiContent({ name: pageName, qid, lang });
    });
    ensureWikiContent({ name: pageName, qid, lang: preferredWiki });

    // Last.fm toggle
    const preferRuByUrl = /[?&]l=RU\b/i.test(location.search);
    const preferredLfm  = localStorage.getItem(LFM_PREF_KEY) || (preferRuByUrl ? 'ru' : 'en');
    const toggleLfm = $('#adb-lfm-toggle');
    toggleLfm?.addEventListener('click', (e) => {
      const btn = e.target.closest('.adb-lfm-tab');
      if (!btn) return;
      const lang = btn.dataset.lang;
      localStorage.setItem(LFM_PREF_KEY, lang);
      ensureLfmBiography({ baseArtistUrl: lastfmLink, pageName, lang });
    });
    await ensureLfmBiography({ baseArtistUrl: lastfmLink, pageName, lang: preferredLfm });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', main, { once:true });
  } else {
    main();
  }
})();
