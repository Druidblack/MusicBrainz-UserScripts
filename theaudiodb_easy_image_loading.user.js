// ==UserScript==
// @name         TheAudioDB: Easy image loading
// @namespace    https://theaudiodb.com/
// @version      1.2.6a
// @description  We upload images by dragging on the icon, converting the uploaded image according to the necessary requirements (we check the aspect ratio and convert it to jpg with high resolution) and checking the uploaded images.
// @author      Druidblack
// @match        *://www.theaudiodb.com/*
// @run-at       document-start
// @grant        none
// @icon        https://www.theaudiodb.com/favicon.ico
//
// @downloadURL  https://github.com/Druidblack/MusicBrainz-UserScripts/raw/main/theaudiodb_easy_image_loading.user.js
// @updateURL    https://github.com/Druidblack/MusicBrainz-UserScripts/raw/main/TheAudioDB_Easy_image_loading.user.js
// ==/UserScript==
// ==/UserScript==

(function () {
  'use strict';

  // ---------- Стили ----------
  const style = document.createElement('style');
  style.textContent = `
    a[data-tadb-drop-target]{position:relative}
    a[data-tadb-drop-target].tadb-dragover{outline:2px dashed currentColor;outline-offset:3px;filter:brightness(1.1)}
    .tadb-toast{position:fixed;right:16px;bottom:16px;background:rgba(0,0,0,.85);color:#fff;padding:10px 12px;border-radius:10px;z-index:2147483647;font:14px/1.35 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.25);max-width:60vw;word-break:break-word}
    .tadb-hint{margin-left:.5rem;font-size:12px;opacity:.78;white-space:nowrap}
  `;
  document.documentElement.appendChild(style);

  // ---------- Утилиты ----------
  function toast(msg, ms = 3000) {
    const el = document.createElement('div');
    el.className = 'tadb-toast';
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), ms);
  }
  function failToast(msg, ms = 7000) {
    toast(msg, ms);
    const err = new Error(msg);
    err._tadbShown = true;
    throw err;
  }
  function isFileDragEvent(e) {
    if (!e.dataTransfer || !e.dataTransfer.types) return false;
    return Array.from(e.dataTransfer.types).some(t => t === 'Files' || /moz-file/i.test(t));
  }
  function isJpeg(file) { return /^image\/jpeg$/i.test(file.type) || /\.jpe?g$/i.test(file.name); }
  function isPng(file)  { return /^image\/png$/i.test(file.type)  || /\.png$/i.test(file.name); }

  const UPLOAD_LINK_RX = /\/upload_(?:art|clearart)\.php/i;
  function closestUploadLink(el) {
    return el && (el.closest && el.closest(`a[href*="/upload_art.php"], a[href*="/upload_clearart.php"]`)) || null;
  }
  function markTargets() {
    document.querySelectorAll('a[href*="/upload_art.php"], a[href*="/upload_clearart.php"]').forEach(a => {
      a.setAttribute('data-tadb-drop-target', '1');
    });
  }

  function appendAllFormFields(form, fd) {
    const inputs = Array.from(form.querySelectorAll('input'));
    for (const inp of inputs) {
      const name = inp.name; if (!name) continue;
      const type = (inp.type || '').toLowerCase();
      if (type === 'file') continue;
      if (type === 'submit') { if (!fd.has(name)) fd.append(name, inp.value || 'Submit'); continue; }
      if ((type === 'checkbox' || type === 'radio') && !inp.checked) continue;
      if (!fd.has(name)) fd.append(name, inp.value || '');
    }
    const selects = Array.from(form.querySelectorAll('select[name]'));
    for (const sel of selects) {
      const name = sel.name; if (!name) continue;
      if (sel.multiple) Array.from(sel.selectedOptions).forEach(opt => fd.append(name, opt.value));
      else if (!fd.has(name)) fd.append(name, sel.value);
    }
    const textareas = Array.from(form.querySelectorAll('textarea[name]'));
    for (const ta of textareas) {
      const name = ta.name; if (!name) continue;
      if (!fd.has(name)) fd.append(name, ta.value || '');
    }
  }

  function evaluateUploadResult(resp, html) {
    const okStatus = resp.ok || (resp.status >= 200 && resp.status < 400);
    if (!okStatus) return { ok: false, hint: `HTTP ${resp.status}` };
    if (resp.redirected) return { ok: true, hint: 'redirect' };
    const positive = [
      /thank/i, /upload(?:ed| complete| completed)?/i, /success/i,
      /submitted/i, /has been uploaded/i,
      /your (image|art|file) (?:was|has been) (?:successfully )?uploaded/i
    ];
    const negative = [
      /please (login|sign in)/i, /\berror\b/i, /invalid/i, /too (large|big)/i,
      /only .*?(jpg|jpeg|png)/i, /no file/i, /select an image/i, /failed/i, /permission/i
    ];
    if (positive.some(rx => rx.test(html))) return { ok: true, hint: 'positive-phrase' };
    if (negative.some(rx => rx.test(html))) return { ok: false, hint: 'negative-phrase' };
    const hasFormAgain = /<form[^>]*upload_(?:art|clearart)\.php/i.test(html);
    return { ok: !hasFormAgain, hint: hasFormAgain ? 'form-again' : 'unknown-2xx' };
  }

  // ---------- Подсказки размеров ----------
  const LABEL_HINTS = new Map([
    ['Artist Image', '700x700 pixels wide and high JPG image.'],
    ['Logo',         '800x310 pixels Wide and High Transparent PNG image.'],
    ['Wide Thumb',   '1000x562 pixels wide and high JPG image.'],
    ['Clearart',     '1000x562 pixels Wide and High Transparent PNG image.'],
    ['Fanart',       '1280x720 pixels wide and high JPG image.'],
    ['Cutout',       '500x500 pixels Wide and High Transparent PNG image.'],
    ['Banner',       '1000x185 pixels wide and high JPG image.']
  ]);
  function ensureSizeHints(root = document) {
    if (!/^\/artist\/\d+/.test(location.pathname)) return;
    const selectors = 'a,b,strong,span,h1,h2,h3,h4,h5,label,p,li,dt,dd,th,td';
    const nodes = root.querySelectorAll(selectors);
    nodes.forEach(el => {
      if (el.dataset.tadbHinted === '1') return;
      const text = (el.textContent || '').trim(); if (!text) return;
      for (const [label, hint] of LABEL_HINTS) {
        const rx = new RegExp('\\b' + label.replace(/\s+/g, '\\s+') + '\\b', 'i');
        if (rx.test(text)) {
          if (!el.nextElementSibling || !el.nextElementSibling.classList.contains('tadb-hint')) {
            const s = document.createElement('span'); s.className = 'tadb-hint'; s.textContent = ' — ' + hint;
            el.insertAdjacentElement('afterend', s);
          }
          el.dataset.tadbHinted = '1'; break;
        }
      }
    });
  }

  // ---------- Графика ----------
  function renameToJpg(name) {
    const i = name.lastIndexOf('.');
    const base = i > 0 ? name.slice(0, i) : name;
    return base + '.jpg';
  }
  async function loadBitmapOrImage(file) {
    if (self.createImageBitmap) {
      try { return await createImageBitmap(file); } catch {}
    }
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = reject;
        el.src = url;
      });
      return img;
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    }
  }
  function aspectIs16by9(w, h, eps = 0.01) {
    const ratio = w / h;
    const target = 16 / 9;
    return Math.abs(ratio - target) <= eps;
  }
  function aspectIs1by1(w, h, eps = 0.01) {
    const ratio = w / h;
    return Math.abs(ratio - 1) <= eps;
  }
  async function convertJPEGFromSource(src, targetW, targetH, quality = 0.92, bg = '#ffffff') {
    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, targetW, targetH);
    ctx.drawImage(src, 0, 0, targetW, targetH);
    if (src.close) try { src.close(); } catch {}
    return await new Promise((resolve, reject) => {
      canvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/jpeg', quality);
    });
  }

  // ---------- Проверки ТОЛЬКО для /upload_clearart.php logo/clearart/cutout и /upload_art.php banner ----------
  async function validateStrictNoConvert(file, uploadHref) {
    const u = new URL(uploadHref, location.origin);
    const pathname = u.pathname.toLowerCase();
    const t = u.searchParams.get('t');

    // /upload_clearart.php: logo (t=1), clearart (t=2), cutout (t=3) — только PNG и ровно требуемый размер
    if (/\/upload_clearart\.php/i.test(pathname) && ['1','2','3'].includes(t)) {
      if (!isPng(file)) failToast('Требуется PNG для этого типа загрузки. Загрузка отменена.');
      const src = await loadBitmapOrImage(file);
      const w = src.width, h = src.height;
      let needW = 0, needH = 0, label = '';
      if (t === '1') { needW = 800;  needH = 310; label = 'Logo'; }
      if (t === '2') { needW = 1000; needH = 562; label = 'Clearart'; }
      if (t === '3') { needW = 500;  needH = 500; label = 'Cutout'; }
      if (!(w === needW && h === needH)) {
        if (src.close) try { src.close(); } catch {}
        failToast(`${label}: требуется ровно ${needW}×${needH} PNG. Получено: ${w}×${h}. Загрузка отменена.`);
      }
      if (src.close) try { src.close(); } catch {}
      return file; // без конвертации
    }

    // /upload_art.php: banner (t=7) — только JPG и ровно 1000×185
    if (/\/upload_art\.php/i.test(pathname) && t === '7') {
      if (!isJpeg(file)) failToast('Banner: требуется JPG 1000×185. Загрузка отменена.');
      const src = await loadBitmapOrImage(file);
      const w = src.width, h = src.height;
      if (!(w === 1000 && h === 185)) {
        if (src.close) try { src.close(); } catch {}
        failToast(`Banner: требуется ровно 1000×185 JPG. Получено: ${w}×${h}. Загрузка отменена.`);
      }
      if (src.close) try { src.close(); } catch {}
      return file; // без конвертации
    }

    // иначе — не наш строгий случай
    return null;
  }

  // ---------- Автоконвертация + проверки (как в v1.2.6) ----------
  async function maybeConvertForLink(file, uploadHref) {
    // Сначала — строгие проверки без конвертации (logo/clearart/cutout/banner)
    const strict = await validateStrictNoConvert(file, uploadHref);
    if (strict) return strict;

    const u = new URL(uploadHref, location.origin);
    if (!/\/upload_art\.php/i.test(u.pathname)) return file;

    const t = u.searchParams.get('t'); // тип арта
    if (!t) return file;

    const SQUARE = new Set(['5','8','10']); // 1:1, 700x700
    const FANART = new Set(['1','2','3','4']); // 16:9, 1280x720
    const WIDE_THUMB = '6'; // 16:9, 1000x562

    const src = await loadBitmapOrImage(file);
    const w = src.width, h = src.height;
    const tooSmall = (minW, minH) => (w < minW || h < minH);

    if (SQUARE.has(t)) {
      const labelMap = { '5': 'Artist Image', '8': 'Album Cover', '10': 'Back Cover' };
      const label = labelMap[t] || 'Image';
      const minW = 700, minH = 700;

      if (!aspectIs1by1(w, h)) {
        if (src.close) try { src.close(); } catch {}
        failToast(`${label} должен быть 1:1. Получено: ${w}×${h}. Загрузка отменена.`);
      }
      if (tooSmall(minW, minH)) {
        if (src.close) try { src.close(); } catch {}
        failToast(`${label} должен быть не меньше ${minW}×${minH}. Получено: ${w}×${h}. Загрузка отменена.`);
      }
      if (w === minW && h === minH && isJpeg(file)) {
        if (src.close) try { src.close(); } catch {}
        return file;
      }
      toast(`Конвертация: 700×700 JPG (${label})…`);
      const blob = await convertJPEGFromSource(src, 700, 700, 0.92, '#ffffff');
      return new File([blob], renameToJpg(file.name), { type: 'image/jpeg', lastModified: Date.now() });
    }

    if (t === WIDE_THUMB) {
      const minW = 1000, minH = 562;
      if (!aspectIs16by9(w, h)) {
        if (src.close) try { src.close(); } catch {}
        failToast(`Wide Thumb должен быть 16:9. Получено: ${w}×${h}. Загрузка отменена.`);
      }
      if (tooSmall(minW, minH)) {
        if (src.close) try { src.close(); } catch {}
        failToast(`Wide Thumb должен быть не меньше ${minW}×${minH}. Получено: ${w}×${h}. Загрузка отменена.`);
      }
      if (w === minW && h === minH && isJpeg(file)) {
        if (src.close) try { src.close(); } catch {}
        return file;
      }
      toast('Конвертация: 1000×562 JPG (Wide Thumb)…');
      const blob = await convertJPEGFromSource(src, 1000, 562, 0.92, '#ffffff');
      return new File([blob], renameToJpg(file.name), { type: 'image/jpeg', lastModified: Date.now() });
    }

    if (FANART.has(t)) {
      const minW = 1280, minH = 720;
      if (!aspectIs16by9(w, h)) {
        if (src.close) try { src.close(); } catch {}
        failToast(`Fanart должен быть 16:9. Получено: ${w}×${h}. Загрузка отменена.`);
      }
      if (tooSmall(minW, minH)) {
        if (src.close) try { src.close(); } catch {}
        failToast(`Fanart должен быть не меньше ${minW}×${minH}. Получено: ${w}×${h}. Загрузка отменена.`);
      }
      if (w === minW && h === minH && isJpeg(file)) {
        if (src.close) try { src.close(); } catch {}
        return file;
      }
      toast('Конвертация: 1280×720 JPG (Fanart)…');
      const blob = await convertJPEGFromSource(src, 1280, 720, 0.92, '#ffffff');
      return new File([blob], renameToJpg(file.name), { type: 'image/jpeg', lastModified: Date.now() });
    }

    if (src.close) try { src.close(); } catch {}
    return file;
  }

  // ---------- Основной аплоадер ----------
  async function uploadViaLink(anchorEl, file) {
    const href = anchorEl.href;
    const url = new URL(href, location.origin);
    if (!UPLOAD_LINK_RX.test(url.pathname)) {
      toast('Не похоже на ссылку загрузки.');
      return;
    }

    toast('Готовим загрузку…');
    const formPageHtml = await fetch(href, {
      credentials: 'include',
      cache: 'no-store'
    }).then(r => {
      if (!r.ok) throw new Error('Не удалось открыть страницу загрузки (' + r.status + ')');
      return r.text();
    });

    const doc = new DOMParser().parseFromString(formPageHtml, 'text/html');
    const form = doc.querySelector('form[action*="upload_art.php"], form[action*="upload_clearart.php"]') ||
                 doc.querySelector('form[action*="upload_"]');
    if (!form) throw new Error('Не найдена форма загрузки на целевой странице.');

    const actionAttr = form.getAttribute('action') || url.pathname + url.search;
    const actionUrl = new URL(actionAttr, location.origin).toString();

    const fileInput = form.querySelector('input[type="file"]');
    const fileFieldName = (fileInput && fileInput.name) || 'image';

    const sendFile = await maybeConvertForLink(file, href);

    const fd = new FormData();
    appendAllFormFields(form, fd);
    fd.set(fileFieldName, sendFile, sendFile.name);
    if (![...fd.keys()].some(k => /submit/i.test(k))) fd.append('Submit', 'Submit');

    toast('Загружаем изображение…');
    const resp = await fetch(actionUrl, {
      method: 'POST',
      body: fd,
      credentials: 'include'
    });

    const text = await resp.text();
    const verdict = evaluateUploadResult(resp, text);

    if (verdict.ok) {
      toast('Готово! Изображение загружено.');
    } else {
      console.warn('[TheAudioDB DnD] Ответ сервера выглядит как неуспешный.', {
        status: resp.status,
        finalUrl: resp.url || actionUrl,
        hint: verdict.hint,
        htmlPreview: text.slice(0, 1500)
      });
      toast('Похоже, сервер не подтвердил загрузку (' + verdict.hint + '). Проверьте консоль.', 7000);
    }
  }

  // ---------- DnD + подсказки ----------
  function boot() {
    markTargets();
    ensureSizeHints();
  }
  document.addEventListener('DOMContentLoaded', boot);
  const mo = new MutationObserver(() => { markTargets(); ensureSizeHints(); });
  mo.observe(document.documentElement, { childList: true, subtree: true });

  window.addEventListener('dragover', (e) => { if (isFileDragEvent(e)) e.preventDefault(); }, true);
  window.addEventListener('drop', (e) => { if (isFileDragEvent(e)) e.preventDefault(); }, true);

  document.addEventListener('dragover', (e) => {
    if (!isFileDragEvent(e)) return;
    const a = closestUploadLink(e.target);
    if (!a) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    a.classList.add('tadb-dragover');
  }, true);

  document.addEventListener('dragleave', (e) => {
    const a = closestUploadLink(e.target);
    if (a) a.classList.remove('tadb-dragover');
  }, true);

  document.addEventListener('drop', async (e) => {
    if (!isFileDragEvent(e)) return;
    const a = closestUploadLink(e.target);
    if (!a) return;

    e.preventDefault();
    e.stopPropagation();
    a.classList.remove('tadb-dragover');

    const files = e.dataTransfer && e.dataTransfer.files;
    if (!files || !files.length) { toast('Перетащите файл изображения.'); return; }

    const file = files[0];
    try {
      await uploadViaLink(a, file);
    } catch (err) {
      console.error('[TheAudioDB DnD] Ошибка загрузки', err);
      if (!err || !err._tadbShown) {
        toast('Ошибка загрузки: ' + (err && err.message ? err.message : err), 6000);
      }
    }
  }, true);
})();
