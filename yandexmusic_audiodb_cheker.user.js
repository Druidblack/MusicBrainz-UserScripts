// ==UserScript==
// @name         Yandex Music → TheAudioDB
// @version      0.7.2-menu-cache
// @description  Найдено — зелёный + кнопка TheAudioDB после меню (высота/центр совпадают). Не найдено — красный. Кэш с TTL (miss→1ч, hit→7д), меню очистки кэша.
// @match        https://music.yandex.ru/*
// @run-at       document-end
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @connect      theaudiodb.com
// @connect      www.theaudiodb.com
// @icon        https://theaudiodb.com/favicon.ico
//
// @downloadURL  https://github.com/Druidblack/MusicBrainz-UserScripts/raw/main/yandexmusic_audiodb_cheker.user.js
// @updateURL    https://github.com/Druidblack/MusicBrainz-UserScripts/raw/main/yandexmusic_audiodb_cheker.user.js
// ==/UserScript==

(function () {
  'use strict';

  /* ── Настройки ─────────────────────────────────── */
  const getApiKey = () => GM_getValue('tadb_api_key', '2');
  const EXACT_MATCH_REQUIRED = () => !!GM_getValue('tadb_exact_match', false);
  const REQUEST_INTERVAL_MS = 650;

  // TTL: сколько хранить запись кэша
  const MISS_TTL_MS = () => +GM_getValue('tadb_miss_ttl_ms', 1 * 60 * 60 * 1000);      // 1 час
  const HIT_TTL_MS  = () => +GM_getValue('tadb_hit_ttl_ms',  7 * 24 * 60 * 60 * 1000); // 7 дней

  /* ── Стили ─────────────────────────────────────── */
  GM_addStyle(`
    .tadb-found    { color: #22c55e !important; }  /* зелёный */
    .tadb-notfound { color: #ef4444 !important; }  /* красный */

    a.tadb-btn{
      display:inline-flex;
      align-items:center;
      justify-content:center;
      margin-left:.5rem;
      padding:0 12px;              /* высота задаётся из JS */
      border:1px solid #22c55e;
      border-radius:9999px;
      font-size:12px;              /* подменим из JS */
      line-height:normal;
      color:#16a34a !important;
      text-decoration:none !important;
      vertical-align:middle;
      align-self:center;
      user-select:none;
      transition:background .15s, border-color .15s;
      white-space:nowrap;
      box-sizing:border-box;
    }
    a.tadb-btn:hover{ background:rgba(34,197,94,0.10); border-color:#16a34a; }
  `);

  /* ── Кэш (с TTL) ───────────────────────────────── */
  const loadCache=()=>{ try{ return JSON.parse(GM_getValue('tadb_cache','{}')); }catch{ return {}; } };
  const saveCache=(obj)=>GM_setValue('tadb_cache', JSON.stringify(obj));
  const cache = loadCache();
  const cacheOrder = new Map(Object.keys(cache).map(k=>[k,Date.now()]));
  const CACHE_MAX=1000;
  const bumpCacheKey=(k)=>{ cacheOrder.set(k,Date.now()); if(cacheOrder.size>CACHE_MAX){ const arr=[...cacheOrder.entries()].sort((a,b)=>a[1]-b[1]); arr.slice(0,arr.length-CACHE_MAX).forEach(([kk])=>{ cacheOrder.delete(kk); delete cache[kk]; }); saveCache(cache); } };

  function now(){ return Date.now(); }
  function isFresh(rec){
    if(!rec || !rec.ts) return false;
    const age = now() - rec.ts;
    const ttl = rec.found ? HIT_TTL_MS() : MISS_TTL_MS();
    return age >= 0 && age < ttl;
  }
  function setCache(key, rec){
    cache[key] = { ...rec, ts: now() };
    bumpCacheKey(key);
    saveCache(cache);
  }
  function clearCacheAll(){
    GM_setValue('tadb_cache','{}');
  }
  function clearCacheForKey(key){
    if(key in cache){ delete cache[key]; saveCache(cache); }
  }

  /* ── Хелперы ───────────────────────────────────── */
  const norm=(s)=>s.normalize('NFKD').toLowerCase().replace(/\s+/g,' ').replace(/[«»"“”'`´’]/g,'').trim();
  const isHeaderSpan=(el)=>el&&el.tagName==='SPAN'&&(el.className||'').includes('PageHeaderTitle_title__');
  function getHeaderSpan(){ return document.querySelector('span[class*="PageHeaderTitle_title__"]'); }
  function getHeaderName(span){ if(!span) return ''; let t=''; span.childNodes.forEach(n=>{ if(n.nodeType===Node.TEXT_NODE) t+=n.textContent; }); return (t||'').trim(); }
  function findArtistMenuButton(){ return document.querySelector('button[class*="PageHeaderArtist_menuControl__"]'); }
  function removeAllTadbButtons(){ document.querySelectorAll('a.tadb-btn').forEach(a=>a.remove()); }

  function ensureInlineFlexParent(menuBtn){
    const parent = menuBtn && menuBtn.parentElement;
    if(!parent) return;
    const cs = getComputedStyle(parent);
    if(cs.display!=='flex' && cs.display!=='inline-flex'){
      parent.style.display='inline-flex';
      parent.style.alignItems='center';
      if(!cs.gap || cs.gap==='normal'){ parent.style.gap='8px'; }
    } else if(cs.alignItems!=='center'){
      parent.style.alignItems='center';
    }
  }

  /* ── Подсветка ─────────────────────────────────── */
  function markFound(el){
    if(!el) return;
    el.classList.remove('tadb-notfound');
    el.classList.add('tadb-found');
    el.title = (el.title?el.title+' • ':'')+'Найдено на TheAudioDB';
  }
  function markNotFound(el){
    if(!el) return;
    el.classList.remove('tadb-found');
    el.classList.add('tadb-notfound');
    el.title = (el.title?el.title+' • ':'')+'Не найдено на TheAudioDB';
  }

  /* ── Синхронизация высоты с меню ──────────────── */
  function syncBtnHeightToMenu(btn){
    const menuBtn = findArtistMenuButton();
    if(!btn || !menuBtn) return;
    const rect = menuBtn.getBoundingClientRect();
    const h = rect.height; // может быть дробным
    const cs = getComputedStyle(menuBtn);
    btn.style.height = h ? `${h}px` : '';
    btn.style.fontSize = cs.fontSize || '';
    btn.style.paddingTop = '0';
    btn.style.paddingBottom = '0';
  }
  let resizeTO=null;
  function scheduleSyncHeight(){
    const btn = document.querySelector('a.tadb-btn');
    if(!btn) return;
    clearTimeout(resizeTO);
    resizeTO = setTimeout(()=>syncBtnHeightToMenu(btn), 50);
  }
  let ro=null;
  function setupResizeObserver(){
    const menuBtn = findArtistMenuButton();
    if(!menuBtn) return;
    if(ro){ try{ ro.disconnect(); }catch{} ro=null; }
    if(window.ResizeObserver){
      ro = new ResizeObserver(()=>scheduleSyncHeight());
      ro.observe(menuBtn);
    }
    scheduleSyncHeight();
    ensureInlineFlexParent(menuBtn);
  }

  /* ── Вставка кнопки строго после меню ─────────── */
  function placeButtonAfterMenu(url){
    const menuBtn = findArtistMenuButton();
    if(!menuBtn || !url) return null;

    removeAllTadbButtons();
    ensureInlineFlexParent(menuBtn);

    const nextEl = menuBtn.nextSibling && menuBtn.nextSibling.nodeType===1 ? menuBtn.nextSibling : null;
    if(nextEl && nextEl.matches && nextEl.matches('a.tadb-btn')){
      nextEl.href = url; nextEl.target='_blank'; nextEl.rel='noopener noreferrer';
      syncBtnHeightToMenu(nextEl);
      setupResizeObserver();
      return nextEl;
    }

    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.className = 'tadb-btn';
    a.textContent = 'TheAudioDB';
    a.title = 'Открыть артиста на TheAudioDB';

    menuBtn.insertAdjacentElement('afterend', a);
    syncBtnHeightToMenu(a);
    setupResizeObserver();
    return a;
  }

  /* ── Очередь ───────────────────────────────────── */
  const queue=[]; let timer=null, busy=false;
  function enqueue(task){ queue.push(task); pump(); }
  function pump(){
    if(busy || timer || queue.length===0) return;
    timer = setTimeout(async()=>{ timer=null; if(busy) return; const job=queue.shift(); if(!job) return; busy=true; try{ await job(); } finally{ busy=false; pump(); } }, REQUEST_INTERVAL_MS);
  }

  /* ── API TheAudioDB ───────────────────────────── */
  function requestTADB(name){
    return new Promise((resolve)=>{
      const url = `https://www.theaudiodb.com/api/v1/json/${getApiKey()}/search.php?s=${encodeURIComponent(name)}`;
      GM_xmlhttpRequest({
        method:'GET', url, timeout:15000,
        onload:(res)=>{
          let result={found:false};
          try{
            const data = JSON.parse(res.responseText||'{}');
            const arr = Array.isArray(data.artists)?data.artists:[];
            if(arr.length>0){
              let pick=null;
              if(EXACT_MATCH_REQUIRED()){
                const n=norm(name);
                pick = arr.find(a=>norm(a.strArtist||'')===n)
                    || arr.find(a=>{ const cand=norm(a.strArtist||''); return cand.includes(n)||n.includes(cand); })
                    || arr[0];
              } else pick=arr[0];
              if(pick && pick.idArtist){
                result={found:true, id:String(pick.idArtist), url:`https://www.theaudiodb.com/artist/${pick.idArtist}`, name:pick.strArtist||name};
              }
            }
          } catch{}
          resolve(result);
        },
        onerror:()=>resolve({found:false}),
        ontimeout:()=>resolve({found:false}),
      });
    });
  }

  async function searchArtistInTADB(name){
    const key=norm(name);
    const rec = cache[key];

    // если в кэше есть и он свежий — возвращаем без запроса
    if(isFresh(rec)) return rec;

    // иначе — делаем запрос и обновляем кэш
    const res = await requestTADB(name);
    setCache(key, res);
    return res;
  }

  /* ── Основная логика ──────────────────────────── */
  const processed=new WeakSet();

  function pickCandidateElements(root=document){
    const headerSpans=root.querySelectorAll('span[class*="PageHeaderTitle_title__"]');
    const cardLinks=root.querySelectorAll('a[class*="ArtistCard_titleLink__"]');
    const generic=root.querySelectorAll('a[href^="/artist/"]');
    const set=new Set([...headerSpans, ...cardLinks, ...generic]);
    return [...set].filter(el=>{
      const t = isHeaderSpan(el) ? getHeaderName(el) : (el.textContent||'').trim();
      return t && !/^\d+$/.test(t) && t.length>=2;
    });
  }

  function processElement(el){
    if(processed.has(el)) return;
    const header=isHeaderSpan(el);
    const name = header ? getHeaderName(el) : (el.textContent||'').trim();
    if(!name) return;
    processed.add(el);

    enqueue(async()=>{
      const res=await searchArtistInTADB(name);
      if(res.found){
        markFound(el);
        if(header) placeButtonAfterMenu(res.url);
      } else {
        markNotFound(el);
        if(header) removeAllTadbButtons();
      }
    });
  }

  function scan(root=document){ pickCandidateElements(root).forEach(processElement); }

  // старт
  scan();

  // SPA/DOM наблюдение
  let rescanScheduled=false;
  function scheduleFullScan(){ if(rescanScheduled) return; rescanScheduled=true; setTimeout(()=>{ rescanScheduled=false; scan(); scheduleSyncHeight(); }, 120); }
  const mo=new MutationObserver((muts)=>{ for(const m of muts){ if(m.type==='childList'){ m.addedNodes.forEach(n=>{ if(n instanceof HTMLElement) scan(n); }); scheduleFullScan(); } } });
  mo.observe(document.documentElement,{childList:true,subtree:true});

  // навигация
  const _ps=history.pushState; history.pushState=function(){ const r=_ps.apply(this,arguments); setTimeout(scan,50); scheduleSyncHeight(); return r; };
  const _rs=history.replaceState; history.replaceState=function(){ const r=_rs.apply(this,arguments); setTimeout(scan,50); scheduleSyncHeight(); return r; };
  window.addEventListener('popstate',()=>{ setTimeout(scan,50); scheduleSyncHeight(); });

  // ресайз окна
  window.addEventListener('resize', scheduleSyncHeight, {passive:true});

  /* ── Меню ─────────────────────────────────────── */
  GM_registerMenuCommand('TheAudioDB: указать API key…', ()=>{
    const cur=getApiKey();
    const next=prompt('Введите API key TheAudioDB (по умолчанию 2):', cur);
    if(next && next!==cur){ GM_setValue('tadb_api_key', next.trim()); alert('Сохранено. Перезагрузите страницу.'); }
  });
  GM_registerMenuCommand('TheAudioDB: TTL — задать (минуты для miss/hit)…', ()=>{
    const missMin = prompt('MISS TTL (минуты, по умолчанию 60):', String(MISS_TTL_MS()/60000));
    const hitMin  = prompt('HIT TTL (минуты, по умолчанию 10080):', String(HIT_TTL_MS()/60000));
    if(missMin) GM_setValue('tadb_miss_ttl_ms', Math.max(1, +missMin)*60000);
    if(hitMin)  GM_setValue('tadb_hit_ttl_ms',  Math.max(1, +hitMin)*60000);
    alert('TTL обновлён.');
  });
  GM_registerMenuCommand('TheAudioDB: очистить кэш (весь)…', ()=>{
    if(confirm('Точно очистить весь кэш TheAudioDB?')){ clearCacheAll(); alert('Кэш очищен.'); }
  });
  GM_registerMenuCommand('TheAudioDB: очистить кэш для текущего артиста…', ()=>{
    const span = getHeaderSpan();
    const name = getHeaderName(span);
    if(!name){ alert('Не удалось определить имя артиста на этой странице.'); return; }
    const key = norm(name);
    clearCacheForKey(key);
    alert(`Кэш очищен для: «${name}». Обновите страницу.`);
  });

})();
