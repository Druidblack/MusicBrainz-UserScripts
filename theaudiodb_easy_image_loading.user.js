// ==UserScript==
// @name         TheAudioDB: Easy image loading
// @namespace    https://theaudiodb.com/
// @version      1.3.4
// @description  We upload images by dragging on the icon, converting the uploaded image according to the necessary requirements (we check the aspect ratio and convert it to jpg with high resolution) and checking the uploaded images.
// @author      Druidblack
// @match        *://www.theaudiodb.com/*
// @run-at       document-start
// @grant        none
// @icon        https://www.theaudiodb.com/favicon.ico
//
// @downloadURL  https://github.com/Druidblack/MusicBrainz-UserScripts/raw/main/theaudiodb_easy_image_loading.user.js
// @updateURL    https://github.com/Druidblack/MusicBrainz-UserScripts/raw/main/theaudiodb_easy_image_loading.user.js
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


    /* ---- Crop modal ---- */
    .tadb-crop-backdrop{position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.78);display:flex;align-items:center;justify-content:center;padding:16px}
    .tadb-crop-dialog{box-sizing:border-box;max-width:min(1100px,95vw);width:min(1100px,95vw);height:92vh;max-height:92vh;display:flex;flex-direction:column;background:#111;color:#fff;border-radius:16px;box-shadow:0 24px 80px rgba(0,0,0,.55);overflow:hidden;font:14px/1.35 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
    .tadb-crop-head{display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid rgba(255,255,255,.08)}
    .tadb-crop-title{font-weight:700;font-size:15px;line-height:1.2}
    .tadb-crop-sub{padding:0 14px 12px 14px;opacity:.85}
    .tadb-crop-stage{padding:12px 14px 14px 14px;flex:1;min-height:280px}
    .tadb-crop-stage-inner{position:relative;width:100%;height:100%;background:#0b0b0b;border-radius:14px;overflow:hidden}
    .tadb-crop-canvas{position:absolute;inset:0;width:100%;height:100%;user-select:none;pointer-events:none;z-index:1}
    .tadb-crop-shade{position:absolute;inset:0;pointer-events:none;z-index:2}
    .tadb-crop-shade > div{position:absolute;background:rgba(0,0,0,.55)}
    .tadb-crop-rect{position:absolute;border:2px solid rgba(255,255,255,.92);border-radius:10px;box-shadow:0 0 0 1px rgba(0,0,0,.35);cursor:move;touch-action:none;user-select:none;z-index:3}
    .tadb-crop-rect::after{content:'';position:absolute;inset:0;border-radius:10px;background-image:linear-gradient(rgba(255,255,255,.18),rgba(255,255,255,.18)),linear-gradient(90deg,rgba(255,255,255,.18),rgba(255,255,255,.18));background-size:33.333% 1px,1px 33.333%;background-position:0 33.333%,33.333% 0;opacity:.35;pointer-events:none}
    .tadb-crop-handle{position:absolute;width:14px;height:14px;border-radius:999px;background:#fff;box-shadow:0 2px 10px rgba(0,0,0,.35);margin:-7px 0 0 -7px}
    .tadb-crop-handle.nw{left:0;top:0;cursor:nwse-resize}
    .tadb-crop-handle.ne{left:100%;top:0;cursor:nesw-resize}
    .tadb-crop-handle.sw{left:0;top:100%;cursor:nesw-resize}
    .tadb-crop-handle.se{left:100%;top:100%;cursor:nwse-resize}
    .tadb-crop-foot{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 14px;border-top:1px solid rgba(255,255,255,.08);flex-wrap:wrap}
    .tadb-crop-meta{opacity:.9}
    .tadb-crop-error{color:#ffb1b1;opacity:1}
    .tadb-btn{appearance:none;border:0;border-radius:12px;padding:9px 12px;font-weight:650;cursor:pointer}
    .tadb-btn.secondary{background:rgba(255,255,255,.12);color:#fff}
    .tadb-btn.secondary:hover{background:rgba(255,255,255,.16)}
    .tadb-btn.primary{background:#2a7fff;color:#fff}
    .tadb-btn.primary:hover{filter:brightness(1.05)}
    .tadb-crop-actions{display:flex;gap:10px;flex-wrap:wrap}
`;
  document.documentElement.appendChild(style);

  // ---------- Утилиты ----------
  // Нужна для кроппера и геометрии; в v1.3.1 была случайно удалена.
  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

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
function renameToPng(name) {
    const i = name.lastIndexOf('.');
    const base = i > 0 ? name.slice(0, i) : name;
    return base + '.png';
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

  function aspectMatches(w, h, targetAspect, eps = 0.01) {
    const ratio = w / h;
    return Math.abs(ratio - targetAspect) <= eps;
  }

  async function convertPNGFromSource(src, targetW, targetH) {
    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    // Не заливаем фон — сохраняем прозрачность
    ctx.clearRect(0, 0, targetW, targetH);
    ctx.drawImage(src, 0, 0, targetW, targetH);
    if (src.close) try { src.close(); } catch {}
    return await new Promise((resolve, reject) => {
      canvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/png');
    });
  }

  function getSourceSize(src) {
    const w = src.width ?? src.naturalWidth ?? 0;
    const h = src.height ?? src.naturalHeight ?? 0;
    return { w, h };
  }

  function sourceHasTransparency(src, maxDim = 1024) {
    const { w, h } = getSourceSize(src);
    if (!w || !h) return false;

    const scale = Math.min(1, maxDim / Math.max(w, h));
    const cw = Math.max(1, Math.round(w * scale));
    const ch = Math.max(1, Math.round(h * scale));

    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.clearRect(0, 0, cw, ch);
    ctx.drawImage(src, 0, 0, cw, ch);

    const data = ctx.getImageData(0, 0, cw, ch).data;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] < 255) return true;
    }
    return false;
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


  // ---------- Окно обрезки изображения (если соотношение сторон не подходит) ----------
  async function cropToAspectModal(file, opts) {
    const {
      aspect,
      title = 'Обрезка изображения',
      subtitle = '',
      minW = 0,
      minH = 0,
      outNote = ''
    } = opts || {};

    async function loadBitmapForCrop(f) {
      // Важно: не используем blob: URL в <img>, потому что на сайтах с CSP это может быть заблокировано.
      // Предпочтительно createImageBitmap (не зависит от img-src CSP). Иначе — data: URL.
      if (self.createImageBitmap) {
        try { return await createImageBitmap(f); } catch (e) { /* fallback below */ }
      }
      const dataUrl = await new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result);
        fr.onerror = () => reject(new Error('Не удалось прочитать файл изображения (FileReader).'));
        fr.readAsDataURL(f);
      });
      return await new Promise((resolve, reject) => {
        const im = new Image();
        im.onload = () => resolve(im);
        im.onerror = () => reject(new Error('Браузер не смог открыть изображение для предпросмотра.'));
        im.src = dataUrl;
      });
    }

    const bitmap = await loadBitmapForCrop(file);
    const iw = (bitmap && (bitmap.width || bitmap.naturalWidth)) || 0;
    const ih = (bitmap && (bitmap.height || bitmap.naturalHeight)) || 0;
    if (!iw || !ih) throw new Error('Не удалось определить размеры изображения.');

    const backdrop = document.createElement('div');
    backdrop.className = 'tadb-crop-backdrop';
    backdrop.tabIndex = -1;

    const dialog = document.createElement('div');
    dialog.className = 'tadb-crop-dialog';

    dialog.innerHTML = `
      <div class="tadb-crop-head">
        <div class="tadb-crop-title"></div>
      </div>
      <div class="tadb-crop-sub"></div>
      <div class="tadb-crop-stage">
        <div class="tadb-crop-stage-inner">
          <canvas class="tadb-crop-canvas" aria-label="preview"></canvas>
          <div class="tadb-crop-shade" aria-hidden="true">
            <div data-part="top"></div>
            <div data-part="left"></div>
            <div data-part="right"></div>
            <div data-part="bottom"></div>
          </div>
          <div class="tadb-crop-rect" role="application" aria-label="crop">
            <div class="tadb-crop-handle nw" data-h="nw"></div>
            <div class="tadb-crop-handle ne" data-h="ne"></div>
            <div class="tadb-crop-handle sw" data-h="sw"></div>
            <div class="tadb-crop-handle se" data-h="se"></div>
          </div>
        </div>
      </div>
      <div class="tadb-crop-foot">
        <div class="tadb-crop-meta"></div>
        <div class="tadb-crop-actions">
          <button class="tadb-btn secondary" data-act="auto">Авто (центр)</button>
          <button class="tadb-btn secondary" data-act="cancel">Отмена</button>
          <button class="tadb-btn primary" data-act="ok">Обрезать</button>
        </div>
      </div>
    `;

    backdrop.appendChild(dialog);

    dialog.querySelector('.tadb-crop-title').textContent = title;
    dialog.querySelector('.tadb-crop-sub').textContent = subtitle;

    const stage = dialog.querySelector('.tadb-crop-stage-inner');
    const canvas = dialog.querySelector('.tadb-crop-canvas');
    const ctx = canvas.getContext('2d');
    const rectEl = dialog.querySelector('.tadb-crop-rect');
    const metaEl = dialog.querySelector('.tadb-crop-meta');
    const shadeEl = dialog.querySelector('.tadb-crop-shade');

    function getStageSize() {
      return { cw: Math.max(1, stage.clientWidth), ch: Math.max(1, stage.clientHeight) };
    }

    let box = null; // границы изображения в stage (CSS px)
    function redrawPreview() {
      const { cw, ch } = getStageSize();
      const dpr = window.devicePixelRatio || 1;

      const pxW = Math.max(1, Math.floor(cw * dpr));
      const pxH = Math.max(1, Math.floor(ch * dpr));
      if (canvas.width !== pxW) canvas.width = pxW;
      if (canvas.height !== pxH) canvas.height = pxH;
      canvas.style.width = cw + 'px';
      canvas.style.height = ch + 'px';

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cw, ch);

      const scale = Math.min(cw / iw, ch / ih);
      const dw = iw * scale;
      const dh = ih * scale;
      const ox = (cw - dw) / 2;
      const oy = (ch - dh) / 2;

      ctx.drawImage(bitmap, ox, oy, dw, dh);

      box = { x: ox, y: oy, w: dw, h: dh, scale, iw, ih, right: ox + dw, bottom: oy + dh };
      return box;
    }

    function maxRectForAspect(b) {
      let w = b.w;
      let h = w / aspect;
      if (h > b.h) { h = b.h; w = h * aspect; }
      const x = b.x + (b.w - w) / 2;
      const y = b.y + (b.h - h) / 2;
      return { x, y, w, h };
    }

    const MIN_CROP = 48;

    function rectToNatural(b, r) {
      const sx = (r.x - b.x) / b.scale;
      const sy = (r.y - b.y) / b.scale;
      const sw = r.w / b.scale;
      const sh = r.h / b.scale;
      return {
        sx: Math.round(clamp(sx, 0, b.iw)),
        sy: Math.round(clamp(sy, 0, b.ih)),
        sw: Math.round(clamp(sw, 1, b.iw)),
        sh: Math.round(clamp(sh, 1, b.ih))
      };
    }

    function updateShade(b, r) {
      const top = shadeEl.querySelector('[data-part="top"]');
      const left = shadeEl.querySelector('[data-part="left"]');
      const right = shadeEl.querySelector('[data-part="right"]');
      const bottom = shadeEl.querySelector('[data-part="bottom"]');

      top.style.left = b.x + 'px';
      top.style.top = b.y + 'px';
      top.style.width = b.w + 'px';
      top.style.height = Math.max(0, r.y - b.y) + 'px';

      bottom.style.left = b.x + 'px';
      bottom.style.top = (r.y + r.h) + 'px';
      bottom.style.width = b.w + 'px';
      bottom.style.height = Math.max(0, (b.y + b.h) - (r.y + r.h)) + 'px';

      left.style.left = b.x + 'px';
      left.style.top = r.y + 'px';
      left.style.width = Math.max(0, r.x - b.x) + 'px';
      left.style.height = r.h + 'px';

      right.style.left = (r.x + r.w) + 'px';
      right.style.top = r.y + 'px';
      right.style.width = Math.max(0, (b.x + b.w) - (r.x + r.w)) + 'px';
      right.style.height = r.h + 'px';
    }

    function cropErrorIfAny(b, r) {
      const nat = rectToNatural(b, r);
      if ((minW && nat.sw < minW) || (minH && nat.sh < minH)) {
        return `Слишком маленький кроп: ~${nat.sw}×${nat.sh}px (нужно минимум ${minW}×${minH}px)`;
      }
      return '';
    }

    function updateRectUI(b, r, errMsg) {
      rectEl.style.left = r.x + 'px';
      rectEl.style.top = r.y + 'px';
      rectEl.style.width = r.w + 'px';
      rectEl.style.height = r.h + 'px';

      updateShade(b, r);

      const nat = rectToNatural(b, r);
      const parts = [];
      parts.push(`Выбранный кроп: ~${nat.sw}×${nat.sh} px`);
      if (minW || minH) parts.push(`минимум: ${minW}×${minH}px`);
      if (outNote) parts.push(outNote);

      metaEl.textContent = parts.join(' · ');
      metaEl.classList.toggle('tadb-crop-error', !!errMsg);
      if (errMsg) metaEl.textContent = errMsg + ' · ' + metaEl.textContent;
    }

    function anchorForHandle(r, h) {
      if (h === 'nw') return { x: r.x + r.w, y: r.y + r.h };
      if (h === 'ne') return { x: r.x,       y: r.y + r.h };
      if (h === 'sw') return { x: r.x + r.w, y: r.y       };
      return { x: r.x, y: r.y };
    }

    function maxWidthFromAnchor(b, anchor, handle) {
      let maxW = handle.includes('w') ? (anchor.x - b.x) : ((b.x + b.w) - anchor.x);
      const maxH = handle.includes('n') ? (anchor.y - b.y) : ((b.y + b.h) - anchor.y);
      maxW = Math.min(maxW, maxH * aspect);
      return Math.max(0, maxW);
    }

    function rectFromAnchor(anchor, width, handle) {
      const h = width / aspect;
      const x = handle.includes('w') ? (anchor.x - width) : anchor.x;
      const y = handle.includes('n') ? (anchor.y - h) : anchor.y;
      return { x, y, w: width, h };
    }

    function chooseWidthByPointer(anchor, pointer, handle) {
      const wFromX = Math.abs(pointer.x - anchor.x);
      const hFromY = Math.abs(pointer.y - anchor.y);
      const wFromY = hFromY * aspect;

      const r1 = rectFromAnchor(anchor, wFromX, handle);
      const r2 = rectFromAnchor(anchor, wFromY, handle);

      const hx1 = handle.includes('w') ? r1.x : (r1.x + r1.w);
      const hy1 = handle.includes('n') ? r1.y : (r1.y + r1.h);
      const hx2 = handle.includes('w') ? r2.x : (r2.x + r2.w);
      const hy2 = handle.includes('n') ? r2.y : (r2.y + r2.h);

      const d1 = (pointer.x - hx1) ** 2 + (pointer.y - hy1) ** 2;
      const d2 = (pointer.x - hx2) ** 2 + (pointer.y - hy2) ** 2;

      return (d2 < d1) ? wFromY : wFromX;
    }

    function moveRectWithinBox(b, r) {
      const x = clamp(r.x, b.x, b.x + b.w - r.w);
      const y = clamp(r.y, b.y, b.y + b.h - r.h);
      return { ...r, x, y };
    }

    function fitRectToBox(b, r) {
      let w = Math.min(r.w, b.w);
      let h = w / aspect;
      if (h > b.h) { h = b.h; w = h * aspect; }
      const x = clamp(r.x, b.x, b.x + b.w - w);
      const y = clamp(r.y, b.y, b.y + b.h - h);
      return { x, y, w, h };
    }

    return await new Promise((resolve, reject) => {
      let rect = null;

      let dragging = null;
      let start = null;
      let anchor = null;

      function cleanup() {
        window.removeEventListener('resize', onResize, true);
        document.removeEventListener('keydown', onKeyDown, true);
        if (bitmap && bitmap.close) { try { bitmap.close(); } catch {} }
        backdrop.remove();
      }

      function cancel() {
        cleanup();
        const err = new Error('Обрезка отменена пользователем.');
        err._tadbShown = true;
        reject(err);
      }

      function ok() {
        const errMsg = cropErrorIfAny(box, rect);
        if (errMsg) {
          updateRectUI(box, rect, errMsg);
          return;
        }

        const nat = rectToNatural(box, rect);
        const out = document.createElement('canvas');
        out.width = nat.sw;
        out.height = nat.sh;
        const octx = out.getContext('2d');
        octx.drawImage(bitmap, nat.sx, nat.sy, nat.sw, nat.sh, 0, 0, nat.sw, nat.sh);

        cleanup();
        resolve(out);
      }

      function onResize() {
        redrawPreview();
        rect = fitRectToBox(box, rect);
        updateRectUI(box, rect, cropErrorIfAny(box, rect));
      }

      function onKeyDown(e) {
        if (e.key === 'Escape') { e.preventDefault(); cancel(); }
        if (e.key === 'Enter') { e.preventDefault(); ok(); }
      }

      function pointerToStage(e) {
        const r = stage.getBoundingClientRect();
        return { x: e.clientX - r.left, y: e.clientY - r.top };
      }

      function onPointerDown(e) {
        if (!(e.target instanceof Element)) return;

        const handle = e.target.closest('.tadb-crop-handle');
        const insideRect = e.target.closest('.tadb-crop-rect');
        if (!handle && !insideRect) return;

        e.preventDefault();
        e.stopPropagation();

        dragging = handle ? handle.getAttribute('data-h') : 'move';
        start = { p: pointerToStage(e), r: { ...rect } };

        if (dragging !== 'move') anchor = anchorForHandle(rect, dragging);
        else anchor = null;

        rectEl.setPointerCapture(e.pointerId);
      }

      function onPointerMove(e) {
        if (!dragging || !start) return;
        const p = pointerToStage(e);

        if (dragging === 'move') {
          const dx = p.x - start.p.x;
          const dy = p.y - start.p.y;
          rect = moveRectWithinBox(box, { ...start.r, x: start.r.x + dx, y: start.r.y + dy });
          updateRectUI(box, rect, cropErrorIfAny(box, rect));
          return;
        }

        const wantW = chooseWidthByPointer(anchor, p, dragging);
        const maxW = maxWidthFromAnchor(box, anchor, dragging);
        let w = clamp(wantW, MIN_CROP, maxW);
        if (w < MIN_CROP) w = Math.min(maxW, MIN_CROP);

        rect = rectFromAnchor(anchor, w, dragging);
        rect = fitRectToBox(box, rect);
        updateRectUI(box, rect, cropErrorIfAny(box, rect));
      }

      function onPointerUp(e) {
        if (!dragging) return;
        dragging = null;
        start = null;
        anchor = null;
        try { rectEl.releasePointerCapture(e.pointerId); } catch {}
      }

      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) cancel();
      });

      dialog.addEventListener('click', (e) => {
        const btn = e.target && e.target.closest && e.target.closest('button[data-act]');
        if (!btn) return;
        const act = btn.getAttribute('data-act');
        if (act === 'cancel') return cancel();
        if (act === 'auto') {
          rect = maxRectForAspect(box);
          updateRectUI(box, rect, cropErrorIfAny(box, rect));
          return;
        }
        if (act === 'ok') return ok();
      });

      rectEl.addEventListener('pointerdown', onPointerDown);
      rectEl.addEventListener('pointermove', onPointerMove);
      rectEl.addEventListener('pointerup', onPointerUp);
      rectEl.addEventListener('pointercancel', onPointerUp);

      (document.body || document.documentElement).appendChild(backdrop);
      requestAnimationFrame(() => {
        redrawPreview();
        rect = maxRectForAspect(box);
        updateRectUI(box, rect, cropErrorIfAny(box, rect));

        window.addEventListener('resize', onResize, true);
        document.addEventListener('keydown', onKeyDown, true);
        backdrop.focus({ preventScroll: true });
      });
    });
  }

// ---------- Проверки ТОЛЬКО для /upload_clearart.php logo/clearart/cutout и /upload_art.php banner ----------
  async function validateStrictNoConvert(file, uploadHref) {
    const u = new URL(uploadHref, location.origin);
    const pathname = u.pathname.toLowerCase();
    const t = u.searchParams.get('t');

    // /upload_clearart.php: clearart (t=2), cutout (t=3) — только PNG и ровно требуемый размер
    if (/\/upload_clearart\.php/i.test(pathname) && ['2','3'].includes(t)) {
      if (!isPng(file)) failToast('Требуется PNG для этого типа загрузки. Загрузка отменена.');
      const src = await loadBitmapOrImage(file);
      const w = src.width, h = src.height;
      let needW = 0, needH = 0, label = '';      if (t === '2') { needW = 1000; needH = 562; label = 'Clearart'; }
      if (t === '3') { needW = 500;  needH = 500; label = 'Cutout'; }
      if (!(w === needW && h === needH)) {
        if (src.close) try { src.close(); } catch {}
        failToast(`${label}: требуется ровно ${needW}×${needH} PNG. Получено: ${w}×${h}. Загрузка отменена.`);
      }
      if (src.close) try { src.close(); } catch {}
      return file; // без конвертации
    }

        // иначе — не наш строгий случай
    return null;
  }

  // ---------- Автоконвертация + проверки (как в v1.2.6) ----------
  async function maybeConvertForLink(file, uploadHref) {
    // Сначала — строгие проверки без конвертации (clearart/cutout)
    const strict = await validateStrictNoConvert(file, uploadHref);
    if (strict) return strict;

    const u = new URL(uploadHref, location.origin);

    // /upload_clearart.php?t=1 (Logo): разрешаем любые форматы, но ТОЛЬКО если есть прозрачность.
    // При неправильном соотношении сторон — показываем окно кропа (800×310), затем уменьшаем/конвертируем в PNG.
    if (/\/upload_clearart\.php/i.test(u.pathname) && u.searchParams.get('t') === '1') {
      const targetW = 800, targetH = 310;
      const targetAspect = targetW / targetH;

      const src = await loadBitmapOrImage(file);
      const sw = src.width, sh = src.height;

      if (sw < targetW || sh < targetH) {
        if (src.close) try { src.close(); } catch {}
        failToast(`Logo: изображение должно быть не меньше ${targetW}×${targetH} и с прозрачностью. Получено: ${sw}×${sh}. Загрузка отменена.`);
      }

      // Проверяем наличие прозрачности (хотя бы один пиксель с alpha < 255)
      if (!sourceHasTransparency(src)) {
        if (src.close) try { src.close(); } catch {}
        failToast('Logo: изображение не содержит прозрачности (alpha). Нужен прозрачный фон, чтобы конвертировать в PNG. Загрузка отменена.');
      }

      let working = src;

      // Если соотношение сторон не 800:310 — даём пользователю выбрать область
      if (!aspectMatches(sw, sh, targetAspect)) {
        if (src.close) try { src.close(); } catch {}
        toast('Logo: соотношение сторон не 800×310 — открою окно обрезки…', 3500);
        working = await cropToAspectModal(file, {
          aspect: targetAspect,
          title: 'Logo: обрезка до 800×310',
          subtitle: 'Нужно соотношение сторон 800:310 (≈2.58:1). Выберите область внутри изображения (фон должен оставаться прозрачным).',
          minW: targetW,
          minH: targetH,
          outNote: 'после этого скрипт сделает 800×310 PNG'
        });

        // Проверяем прозрачность уже на выбранной области (на всякий случай)
        if (!sourceHasTransparency(working)) {
          failToast('Logo: выбранная область не содержит прозрачности. Нужен прозрачный фон. Загрузка отменена.');
        }
      }

      const { w: ww, h: wh } = getSourceSize(working);
      if (ww < targetW || wh < targetH) {
        if (working.close) try { working.close(); } catch {}
        failToast(`Logo: выбранная область слишком маленькая (${ww}×${wh}). Нужно минимум ${targetW}×${targetH}. Загрузка отменена.`);
      }

      // Если уже PNG и ровно 800×310 — можно загрузить как есть
      if (isPng(file) && sw === targetW && sh === targetH && working === src) {
        if (src.close) try { src.close(); } catch {}
        return file;
      }

      toast('Конвертация: 800×310 PNG (Logo)…');
      const blob = await convertPNGFromSource(working, targetW, targetH);
      return new File([blob], renameToPng(file.name), { type: 'image/png', lastModified: Date.now() });
    }

    if (!/\/upload_art\.php/i.test(u.pathname)) return file;

    const t = u.searchParams.get('t'); // тип арта
    if (!t) return file;

    // /upload_art.php?t=7 (Banner): разрешаем любые форматы.
    // Если изображение больше 1000×185 (или соотношение сторон не 1000:185) — показываем окно кропа,
    // затем уменьшаем/конвертируем в JPG 1000×185.
    if (t === '7') {
      const targetW = 1000, targetH = 185;
      const targetAspect = targetW / targetH;

      const src = await loadBitmapOrImage(file);
      const sw = src.width, sh = src.height;

      // Нельзя делать "правильный" баннер, если исходник меньше требуемого (не апскейлим).
      if (sw < targetW || sh < targetH) {
        if (src.close) try { src.close(); } catch {}
        failToast(`Banner: изображение должно быть не меньше ${targetW}×${targetH}. Получено: ${sw}×${sh}. Загрузка отменена.`);
      }

      let working = src;

      // По запросу: если изображение больше 1000×185 — даём выбрать область кропом (даже если пропорции совпадают).
      if ((sw > targetW || sh > targetH) || !aspectMatches(sw, sh, targetAspect)) {
        if (src.close) try { src.close(); } catch {}
        toast('Banner: открою окно обрезки…', 3500);
        working = await cropToAspectModal(file, {
          aspect: targetAspect,
          title: 'Banner: обрезка до 1000×185',
          subtitle: 'Нужно соотношение сторон 1000:185. Выберите область внутри изображения.',
          minW: targetW,
          minH: targetH,
          outNote: 'после этого скрипт сделает 1000×185 JPG'
        });
      }

      const { w: ww, h: wh } = getSourceSize(working);
      if (ww < targetW || wh < targetH) {
        if (working.close) try { working.close(); } catch {}
        failToast(`Banner: выбранная область слишком маленькая (${ww}×${wh}). Нужно минимум ${targetW}×${targetH}. Загрузка отменена.`);
      }

      // Если всё уже идеально (1000×185 и JPG) и кроп не делали — можно отправлять как есть.
      if (isJpeg(file) && sw === targetW && sh === targetH && working === src) {
        if (src.close) try { src.close(); } catch {}
        return file;
      }

      toast('Конвертация: 1000×185 JPG (Banner)…');
      const blob = await convertJPEGFromSource(working, targetW, targetH, 0.92, '#ffffff');
      return new File([blob], renameToJpg(file.name), { type: 'image/jpeg', lastModified: Date.now() });
    }


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

      if (tooSmall(minW, minH)) {
        if (src.close) try { src.close(); } catch {}
        failToast(`${label} должен быть не меньше ${minW}×${minH}. Получено: ${w}×${h}. Загрузка отменена.`);
      }

      let workingSrc = src;
      if (!aspectIs1by1(w, h)) {
        if (src.close) try { src.close(); } catch {}
        toast(`${label}: соотношение сторон не 1:1 — открою окно обрезки…`, 3500);
        workingSrc = await cropToAspectModal(file, {
          aspect: 1,
          title: `${label}: обрезка до 1:1`,
          subtitle: 'Нужно соотношение сторон 1:1. Выберите область внутри изображения.',
          minW, minH,
          outNote: 'после этого скрипт сделает 700×700 JPG'
        });

        if (workingSrc.width < minW || workingSrc.height < minH) {
          failToast(`${label}: выбранная область слишком маленькая (${workingSrc.width}×${workingSrc.height}). Нужно минимум ${minW}×${minH}.`);
        }
      } else if (w === minW && h === minH && isJpeg(file)) {
        if (src.close) try { src.close(); } catch {}
        return file;
      }

      toast(`Конвертация: 700×700 JPG (${label})…`);
      const blob = await convertJPEGFromSource(workingSrc, 700, 700, 0.92, '#ffffff');
      return new File([blob], renameToJpg(file.name), { type: 'image/jpeg', lastModified: Date.now() });
    }

    if (t === WIDE_THUMB) {
      const minW = 1000, minH = 562;

      if (tooSmall(minW, minH)) {
        if (src.close) try { src.close(); } catch {}
        failToast(`Wide Thumb должен быть не меньше ${minW}×${minH}. Получено: ${w}×${h}. Загрузка отменена.`);
      }

      let workingSrc = src;
      if (!aspectIs16by9(w, h)) {
        if (src.close) try { src.close(); } catch {}
        toast('Wide Thumb: соотношение сторон не 16:9 — открою окно обрезки…', 3500);
        workingSrc = await cropToAspectModal(file, {
          aspect: 16 / 9,
          title: 'Wide Thumb: обрезка до 16:9',
          subtitle: 'Нужно соотношение сторон 16:9. Выберите область внутри изображения.',
          minW, minH,
          outNote: 'после этого скрипт сделает 1000×562 JPG'
        });

        if (workingSrc.width < minW || workingSrc.height < minH) {
          failToast(`Wide Thumb: выбранная область слишком маленькая (${workingSrc.width}×${workingSrc.height}). Нужно минимум ${minW}×${minH}.`);
        }
      } else if (w === minW && h === minH && isJpeg(file)) {
        if (src.close) try { src.close(); } catch {}
        return file;
      }

      toast('Конвертация: 1000×562 JPG (Wide Thumb)…');
      const blob = await convertJPEGFromSource(workingSrc, 1000, 562, 0.92, '#ffffff');
      return new File([blob], renameToJpg(file.name), { type: 'image/jpeg', lastModified: Date.now() });
    }

    if (FANART.has(t)) {
      const minW = 1280, minH = 720;

      if (tooSmall(minW, minH)) {
        if (src.close) try { src.close(); } catch {}
        failToast(`Fanart должен быть не меньше ${minW}×${minH}. Получено: ${w}×${h}. Загрузка отменена.`);
      }

      let workingSrc = src;
      if (!aspectIs16by9(w, h)) {
        if (src.close) try { src.close(); } catch {}
        toast('Fanart: соотношение сторон не 16:9 — открою окно обрезки…', 3500);
        workingSrc = await cropToAspectModal(file, {
          aspect: 16 / 9,
          title: 'Fanart: обрезка до 16:9',
          subtitle: 'Нужно соотношение сторон 16:9. Выберите область внутри изображения.',
          minW, minH,
          outNote: 'после этого скрипт сделает 1280×720 JPG'
        });

        if (workingSrc.width < minW || workingSrc.height < minH) {
          failToast(`Fanart: выбранная область слишком маленькая (${workingSrc.width}×${workingSrc.height}). Нужно минимум ${minW}×${minH}.`);
        }
      } else if (w === minW && h === minH && isJpeg(file)) {
        if (src.close) try { src.close(); } catch {}
        return file;
      }

      toast('Конвертация: 1280×720 JPG (Fanart)…');
      const blob = await convertJPEGFromSource(workingSrc, 1280, 720, 0.92, '#ffffff');
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
