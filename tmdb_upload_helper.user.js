// ==UserScript==
// @name         TMDB Upload Helper
// @namespace    https://github.com/Druidblack/MusicBrainz-UserScripts
// @author      Druidblack
// @version      1.3.6
// @description  TMDB upload windows: Logo => non-PNG to PNG. Backdrop/Poster => JPEG and downscale; if aspect mismatch show interactive crop UI (correct aspect) then upload. Multi-file DnD: crop sequentially per file, then upload all at once. Added "Skip this file" button.
// @match        https://www.themoviedb.org/*
// @match        https://themoviedb.org/*
// @grant        none
// @run-at       document-start
//
// @downloadURL  https://github.com/Druidblack/MusicBrainz-UserScripts/raw/main/tmdb_upload_helper.user.js
// @updateURL    https://github.com/Druidblack/MusicBrainz-UserScripts/raw/main/tmdb_upload_helper.user.js
// ==/UserScript==

(() => {
  "use strict";

  const LOG = (...a) => console.log("[TMDB Upload Helper]", ...a);

  const ASPECT_TOL = 0.01;

  const BACKDROP_MAX_W = 3840;
  const BACKDROP_MAX_H = 2160;
  const BACKDROP_ASPECT = 16 / 9;

  const POSTER_MAX_W = 2000;
  const POSTER_MAX_H = 3000;
  const POSTER_ASPECT = 2 / 3;

  const JPEG_QUALITY = 0.92;

  // Special token: user chooses "Skip this file"
  const SKIP_TOKEN = "__TMDB_UPLOAD_HELPER_SKIP__";

  // to avoid recursion with our own dispatchEvent('change')
  const replacingInputs = new WeakSet();

  function normText(s) {
    return (s || "").toString().trim().toLowerCase();
  }

  function isImageFile(file) {
    const t = normText(file?.type);
    if (t.startsWith("image/")) return true;
    return /\.(png|jpe?g|webp|bmp|gif|tiff?)$/i.test(file?.name || "");
  }

  function isPng(file) {
    const t = normText(file?.type);
    if (t === "image/png") return true;
    return /\.png$/i.test(file?.name || "");
  }

  function isJpeg(file) {
    const t = normText(file?.type);
    if (t === "image/jpeg") return true;
    return /\.(jpe?g)$/i.test(file?.name || "");
  }

  function fileNameToPng(name) {
    const base = (name || "image").replace(/\.[^.]+$/, "");
    return `${base}.png`;
  }

  function fileNameToJpg(name) {
    const base = (name || "image").replace(/\.[^.]+$/, "");
    return `${base}.jpg`;
  }

  function aspectClose(w, h, targetAspect) {
    if (!w || !h) return false;
    const r = w / h;
    return Math.abs(r - targetAspect) <= ASPECT_TOL;
  }

  async function decodeToBitmap(file) {
    try {
      if (window.createImageBitmap) return await createImageBitmap(file);
    } catch (_) {}

    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = reject;
        el.src = url;
      });
      return { width: img.naturalWidth, height: img.naturalHeight, _img: img };
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function canvasToBlob(canvas, mime, quality) {
    return new Promise((resolve) => canvas.toBlob((b) => resolve(b), mime, quality));
  }

  function drawToCanvas(source, canvas, targetW, targetH, { fillForJpeg = false } = {}) {
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext("2d", { alpha: true });

    if (fillForJpeg) {
      ctx.save();
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, targetW, targetH);
      ctx.restore();
    } else {
      ctx.clearRect(0, 0, targetW, targetH);
    }

    ctx.drawImage(source, 0, 0, targetW, targetH);
  }

  async function fileToPng(file) {
    const bitmap = await decodeToBitmap(file);
    const w = bitmap.width;
    const h = bitmap.height;

    const canvas = document.createElement("canvas");
    if (bitmap instanceof ImageBitmap) {
      drawToCanvas(bitmap, canvas, w, h, { fillForJpeg: false });
      bitmap.close?.();
    } else {
      drawToCanvas(bitmap._img, canvas, w, h, { fillForJpeg: false });
    }

    const blob = await canvasToBlob(canvas, "image/png", 1);
    if (!blob) throw new Error("canvas.toBlob returned null for PNG");

    return new File([blob], fileNameToPng(file.name), {
      type: "image/png",
      lastModified: file.lastModified || Date.now(),
    });
  }

  async function fileToJpegMaybeResize(file, { maxW, maxH, targetAspect }) {
    if (!isImageFile(file)) return file;

    const bitmap = await decodeToBitmap(file);
    const w = bitmap.width;
    const h = bitmap.height;

    const needResize = (w > maxW || h > maxH) && aspectClose(w, h, targetAspect);
    const needJpeg = !isJpeg(file);

    // already JPEG and no resize needed -> keep original
    if (!needResize && !needJpeg) {
      if (bitmap instanceof ImageBitmap) bitmap.close?.();
      return file;
    }

    const outW = needResize ? maxW : w;
    const outH = needResize ? maxH : h;

    const canvas = document.createElement("canvas");

    if (bitmap instanceof ImageBitmap) {
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext("2d", { alpha: true });
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, outW, outH);
      ctx.drawImage(bitmap, 0, 0, outW, outH);
      bitmap.close?.();
    } else {
      drawToCanvas(bitmap._img, canvas, outW, outH, { fillForJpeg: true });
    }

    const blob = await canvasToBlob(canvas, "image/jpeg", JPEG_QUALITY);
    if (!blob) throw new Error("canvas.toBlob returned null for JPEG");

    return new File([blob], fileNameToJpg(file.name), {
      type: "image/jpeg",
      lastModified: file.lastModified || Date.now(),
    });
  }

  function setInputFiles(input, files) {
    const dt = new DataTransfer();
    for (const f of files) dt.items.add(f);
    input.files = dt.files;
  }

  function getWindowTitleText(fromEl) {
    const win = fromEl?.closest?.(".k-window[role='dialog']") || fromEl?.closest?.(".k-window") || null;
    if (!win) return "";

    const t1 = win.querySelector?.(".k-window-title")?.textContent;
    if (t1 && t1.trim()) return t1.trim();

    const lbl = win.getAttribute("aria-labelledby");
    if (lbl) {
      let el = null;
      try {
        el = win.querySelector?.(`#${CSS.escape(lbl)}`);
      } catch (_) {
        el = document.getElementById(lbl);
      }
      const t2 = el?.textContent;
      if (t2 && t2.trim()) return t2.trim();
    }
    return "";
  }

  function detectModeByTitle(titleText) {
    const t = normText(titleText);
    if (t.includes("logo") || t.includes("логотип") || t.includes("лого")) return "logo_png";
    if (t.includes("задник") || t.includes("backdrop")) return "backdrop_jpeg";
    if (t.includes("постер") || t.includes("poster")) return "poster_jpeg";
    return null;
  }

  function ensureCropStylesOnce() {
    if (document.getElementById("tmdb-cropper-style")) return;
    const style = document.createElement("style");
    style.id = "tmdb-cropper-style";
    style.textContent = `
      .tmdb-cropper-overlay{
        position:fixed; inset:0; z-index:999999;
        background: rgba(0,0,0,.72);
        display:flex; align-items:center; justify-content:center;
        padding: 18px;
      }
      .tmdb-cropper-modal{
        width:min(1100px, 96vw);
        max-height: 92vh;
        display:flex;
        flex-direction:column;
        background:#111;
        border:1px solid rgba(255,255,255,.12);
        border-radius: 14px;
        box-shadow: 0 10px 50px rgba(0,0,0,.6);
        overflow:hidden;
        color:#fff;
        font: 14px/1.4 system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
      }
      .tmdb-cropper-head{
        padding: 12px 14px;
        display:flex; align-items:center; justify-content:space-between;
        background: rgba(255,255,255,.04);
        border-bottom:1px solid rgba(255,255,255,.10);
        flex: 0 0 auto;
      }
      .tmdb-cropper-title{ font-weight: 650; letter-spacing:.2px; }
      .tmdb-cropper-sub{ opacity:.8; font-size:12px; margin-top:2px; }

      .tmdb-cropper-body{
        padding: 14px;
        display:flex;
        gap: 14px;
        align-items: stretch;
        flex: 1 1 auto;
        min-height: 0;
      }

      .tmdb-cropper-stage-wrap{
        flex: 1 1 auto;
        display:flex;
        align-items:center;
        justify-content:center;
        background: rgba(255,255,255,.03);
        border:1px solid rgba(255,255,255,.08);
        border-radius: 12px;
        padding: 10px;
        min-height: 0;
        overflow: hidden;
      }

      .tmdb-cropper-stage{
        position:relative;
        display:flex;
        align-items:center;
        justify-content:center;
        width: 100%;
        height: 100%;
        line-height:0;
        user-select:none;
        -webkit-user-select:none;
        touch-action:none;
      }

      .tmdb-cropper-stage img{
        display:block;
        max-width: 100%;
        max-height: 100%;
        width:auto;
        height:auto;
        pointer-events:none;
      }

      .tmdb-img-frame{ position:absolute; }

      .tmdb-cropper-shade{
        position:absolute;
        background: rgba(0,0,0,.35);
        pointer-events:none;
      }
      .tmdb-crop-rect{
        position:absolute;
        border: 2px solid rgba(255,255,255,.95);
        cursor: move;
        box-sizing:border-box;
      }
      .tmdb-crop-handle{
        position:absolute;
        width: 12px; height: 12px;
        background: rgba(255,255,255,.95);
        border-radius: 3px;
        box-shadow: 0 0 0 2px rgba(0,0,0,.35);
      }
      .tmdb-crop-handle.nw{ left:-6px; top:-6px; cursor:nwse-resize; }
      .tmdb-crop-handle.ne{ right:-6px; top:-6px; cursor:nesw-resize; }
      .tmdb-crop-handle.sw{ left:-6px; bottom:-6px; cursor:nesw-resize; }
      .tmdb-crop-handle.se{ right:-6px; bottom:-6px; cursor:nwse-resize; }

      .tmdb-cropper-side{
        width: 280px;
        flex: 0 0 280px;
        display:flex;
        flex-direction:column;
        gap: 10px;
        min-height: 0;
      }
      .tmdb-cropper-note{ opacity:.85; font-size: 13px; }
      .tmdb-cropper-kv{ font-size: 13px; opacity: .9; word-break: break-word; }

      .tmdb-cropper-actions{
        display:flex;
        gap: 10px;
        justify-content:flex-end;
        padding: 12px 14px;
        border-top:1px solid rgba(255,255,255,.10);
        background: rgba(255,255,255,.04);
        flex: 0 0 auto;
        flex-wrap: wrap;
      }
      .tmdb-btn{
        border:1px solid rgba(255,255,255,.18);
        background: rgba(255,255,255,.08);
        color:#fff;
        padding: 8px 12px;
        border-radius: 10px;
        cursor:pointer;
        font-weight: 600;
      }
      .tmdb-btn:hover{ background: rgba(255,255,255,.12); }
      .tmdb-btn.primary{
        background: rgba(46,204,113,.20);
        border-color: rgba(46,204,113,.50);
      }
      .tmdb-btn.primary:hover{ background: rgba(46,204,113,.28); }
      .tmdb-btn.danger{
        background: rgba(231,76,60,.20);
        border-color: rgba(231,76,60,.50);
      }
      .tmdb-btn.danger:hover{ background: rgba(231,76,60,.28); }
      .tmdb-btn.warn{
        background: rgba(241,196,15,.18);
        border-color: rgba(241,196,15,.50);
      }
      .tmdb-btn.warn:hover{ background: rgba(241,196,15,.26); }
    `;
    document.documentElement.appendChild(style);
  }

  /**
   * Returns:
   *  - File (JPEG) after crop
   *  - SKIP_TOKEN if user chose "Skip this file"
   *  - null if cancelled (abort whole batch)
   */
  function openInteractiveCropModal({
    file,
    kindLabel,
    targetAspect,
    maxW,
    maxH,
    queueIndex = 1,
    queueTotal = 1,
  }) {
    ensureCropStylesOnce();

    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);

      const overlay = document.createElement("div");
      overlay.className = "tmdb-cropper-overlay";

      const modal = document.createElement("div");
      modal.className = "tmdb-cropper-modal";

      const head = document.createElement("div");
      head.className = "tmdb-cropper-head";

      const left = document.createElement("div");
      const title = document.createElement("div");
      title.className = "tmdb-cropper-title";
      title.textContent =
        queueTotal > 1
          ? `Обрезка: ${kindLabel} (${queueIndex}/${queueTotal})`
          : `Обрезка: ${kindLabel}`;

      const sub = document.createElement("div");
      sub.className = "tmdb-cropper-sub";
      const ratioLabel = kindLabel === "Задник" ? "16:9" : "2:3";
      sub.textContent = `Файл: ${file.name} • Соотношение: ${ratioLabel}.`;

      left.appendChild(title);
      left.appendChild(sub);

      const closeBtn = document.createElement("button");
      closeBtn.className = "tmdb-btn danger";
      closeBtn.textContent = "Отмена";

      head.appendChild(left);
      head.appendChild(closeBtn);

      const body = document.createElement("div");
      body.className = "tmdb-cropper-body";

      const stageWrap = document.createElement("div");
      stageWrap.className = "tmdb-cropper-stage-wrap";

      const stage = document.createElement("div");
      stage.className = "tmdb-cropper-stage";

      const img = document.createElement("img");
      img.alt = "crop preview";
      img.src = url;

      const frame = document.createElement("div");
      frame.className = "tmdb-img-frame";

      const shadeTop = document.createElement("div");
      const shadeLeft = document.createElement("div");
      const shadeRight = document.createElement("div");
      const shadeBottom = document.createElement("div");
      shadeTop.className = "tmdb-cropper-shade";
      shadeLeft.className = "tmdb-cropper-shade";
      shadeRight.className = "tmdb-cropper-shade";
      shadeBottom.className = "tmdb-cropper-shade";

      const rect = document.createElement("div");
      rect.className = "tmdb-crop-rect";

      const hNW = document.createElement("div");
      const hNE = document.createElement("div");
      const hSW = document.createElement("div");
      const hSE = document.createElement("div");
      hNW.className = "tmdb-crop-handle nw";
      hNE.className = "tmdb-crop-handle ne";
      hSW.className = "tmdb-crop-handle sw";
      hSE.className = "tmdb-crop-handle se";
      rect.appendChild(hNW);
      rect.appendChild(hNE);
      rect.appendChild(hSW);
      rect.appendChild(hSE);

      stage.appendChild(img);
      stage.appendChild(frame);
      frame.appendChild(shadeTop);
      frame.appendChild(shadeLeft);
      frame.appendChild(shadeRight);
      frame.appendChild(shadeBottom);
      frame.appendChild(rect);

      stageWrap.appendChild(stage);

      const side = document.createElement("div");
      side.className = "tmdb-cropper-side";

      const note = document.createElement("div");
      note.className = "tmdb-cropper-note";
      note.innerHTML = `
        <div>• Рамка работает строго по области изображения.</div>
        <div>• Перетаскивайте рамку, масштабируйте за углы.</div>
        <div>• “Авто (центр)” — максимальная рамка по центру.</div>
        <div>• “Пропустить этот файл” — пропустит только текущий файл.</div>
        <div>• “Отмена” — отменит всю пачку.</div>
      `;

      const kv1 = document.createElement("div");
      kv1.className = "tmdb-cropper-kv";
      const kv2 = document.createElement("div");
      kv2.className = "tmdb-cropper-kv";
      const kv3 = document.createElement("div");
      kv3.className = "tmdb-cropper-kv";

      side.appendChild(note);
      side.appendChild(kv1);
      side.appendChild(kv2);
      side.appendChild(kv3);

      body.appendChild(stageWrap);
      body.appendChild(side);

      const actions = document.createElement("div");
      actions.className = "tmdb-cropper-actions";

      const cancel = document.createElement("button");
      cancel.className = "tmdb-btn";
      cancel.textContent = "Отмена";

      const skipBtn = document.createElement("button");
      skipBtn.className = "tmdb-btn warn";
      skipBtn.textContent = "Пропустить этот файл";

      const autoBtn = document.createElement("button");
      autoBtn.className = "tmdb-btn";
      autoBtn.textContent = "Авто (центр)";

      const ok = document.createElement("button");
      ok.className = "tmdb-btn primary";
      ok.textContent = queueTotal > 1 && queueIndex < queueTotal ? "Далее" : "Подтвердить";

      actions.appendChild(cancel);
      actions.appendChild(skipBtn);
      actions.appendChild(autoBtn);
      actions.appendChild(ok);

      modal.appendChild(head);
      modal.appendChild(body);
      modal.appendChild(actions);
      overlay.appendChild(modal);
      document.body.appendChild(overlay);

      // State (in IMAGE frame coordinates)
      const st = {
        imgW: 0,
        imgH: 0,
        x: 0,
        y: 0,
        w: 0,
        h: 0,
        dragging: false,
        dragMode: null, // move|nw|ne|sw|se
        startPX: 0,
        startPY: 0,
        startX: 0,
        startY: 0,
        startW: 0,
        startH: 0,
      };

      const MIN_SIZE = 80;
      const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

      function syncFrameToImage() {
        const imgRect = img.getBoundingClientRect();
        const stageRect = stage.getBoundingClientRect();

        const leftPx = imgRect.left - stageRect.left;
        const topPx = imgRect.top - stageRect.top;

        frame.style.left = `${leftPx}px`;
        frame.style.top = `${topPx}px`;
        frame.style.width = `${imgRect.width}px`;
        frame.style.height = `${imgRect.height}px`;

        st.imgW = imgRect.width;
        st.imgH = imgRect.height;
      }

      function updateUI() {
        rect.style.left = `${st.x}px`;
        rect.style.top = `${st.y}px`;
        rect.style.width = `${st.w}px`;
        rect.style.height = `${st.h}px`;

        shadeTop.style.left = `0px`;
        shadeTop.style.top = `0px`;
        shadeTop.style.width = `${st.imgW}px`;
        shadeTop.style.height = `${st.y}px`;

        shadeBottom.style.left = `0px`;
        shadeBottom.style.top = `${st.y + st.h}px`;
        shadeBottom.style.width = `${st.imgW}px`;
        shadeBottom.style.height = `${Math.max(0, st.imgH - (st.y + st.h))}px`;

        shadeLeft.style.left = `0px`;
        shadeLeft.style.top = `${st.y}px`;
        shadeLeft.style.width = `${st.x}px`;
        shadeLeft.style.height = `${st.h}px`;

        shadeRight.style.left = `${st.x + st.w}px`;
        shadeRight.style.top = `${st.y}px`;
        shadeRight.style.width = `${Math.max(0, st.imgW - (st.x + st.w))}px`;
        shadeRight.style.height = `${st.h}px`;

        const natW = img.naturalWidth || 0;
        const natH = img.naturalHeight || 0;
        kv1.textContent = `Исходник: ${natW}×${natH}`;

        const scaleX = st.imgW ? natW / st.imgW : 1;
        const scaleY = st.imgH ? natH / st.imgH : 1;
        const cropNW = Math.round(st.w * scaleX);
        const cropNH = Math.round(st.h * scaleY);
        kv2.textContent = `Кроп: ~${cropNW}×${cropNH}`;

        const willDownscale = (cropNW > maxW || cropNH > maxH) && maxW && maxH;
        kv3.textContent = willDownscale ? `После: ${maxW}×${maxH} (уменьшение)` : `После: ${cropNW}×${cropNH}`;
      }

      function setAutoCenterCrop(pad = 1.0) {
        const maxW2 = st.imgW * pad;
        const maxH2 = st.imgH * pad;

        const imgAspect = st.imgW / st.imgH;
        let w, h;

        if (imgAspect >= targetAspect) {
          h = maxH2;
          w = h * targetAspect;
          if (w > maxW2) {
            w = maxW2;
            h = w / targetAspect;
          }
        } else {
          w = maxW2;
          h = w / targetAspect;
          if (h > maxH2) {
            h = maxH2;
            w = h * targetAspect;
          }
        }

        st.w = Math.max(MIN_SIZE, Math.round(w));
        st.h = Math.max(MIN_SIZE, Math.round(h));
        st.x = Math.round((st.imgW - st.w) / 2);
        st.y = Math.round((st.imgH - st.h) / 2);

        updateUI();
      }

      function pickDeltaW(mode, dx, dy) {
        let deltaWFromDy;
        if (mode === "se" || mode === "sw") deltaWFromDy = dy * targetAspect;
        else deltaWFromDy = -dy * targetAspect;
        return Math.abs(dx) > Math.abs(deltaWFromDy) ? dx : deltaWFromDy;
      }

      function applyResize(mode, dx, dy) {
        const rightFixed = st.startX + st.startW;
        const bottomFixed = st.startY + st.startH;

        let newX = st.startX;
        let newY = st.startY;

        let deltaW = pickDeltaW(mode, dx, dy);
        let newW, newH;

        if (mode === "se") {
          newW = st.startW + deltaW;
          const maxWBound = st.imgW - st.startX;
          const maxWByH = (st.imgH - st.startY) * targetAspect;
          const maxWAllowed = Math.min(maxWBound, maxWByH);
          newW = clamp(newW, MIN_SIZE, maxWAllowed);
          newH = newW / targetAspect;
        } else if (mode === "sw") {
          newW = st.startW - deltaW;
          const maxWBound = rightFixed;
          const maxWByH = (st.imgH - st.startY) * targetAspect;
          const maxWAllowed = Math.min(maxWBound, maxWByH);
          newW = clamp(newW, MIN_SIZE, maxWAllowed);
          newH = newW / targetAspect;
          newX = rightFixed - newW;
        } else if (mode === "ne") {
          newW = st.startW + deltaW;
          const maxWBound = st.imgW - st.startX;
          const maxWByH = bottomFixed * targetAspect;
          const maxWAllowed = Math.min(maxWBound, maxWByH);
          newW = clamp(newW, MIN_SIZE, maxWAllowed);
          newH = newW / targetAspect;
          newY = bottomFixed - newH;
        } else if (mode === "nw") {
          newW = st.startW - deltaW;
          const maxWBound = rightFixed;
          const maxWByH = bottomFixed * targetAspect;
          const maxWAllowed = Math.min(maxWBound, maxWByH);
          newW = clamp(newW, MIN_SIZE, maxWAllowed);
          newH = newW / targetAspect;
          newX = rightFixed - newW;
          newY = bottomFixed - newH;
        }

        newX = clamp(newX, 0, st.imgW - newW);
        newY = clamp(newY, 0, st.imgH - newH);

        st.x = Math.round(newX);
        st.y = Math.round(newY);
        st.w = Math.round(newW);
        st.h = Math.round(newH);

        updateUI();
      }

      function onPointerDown(e, mode) {
        e.preventDefault();
        e.stopPropagation();

        st.dragging = true;
        st.dragMode = mode;
        st.startPX = e.clientX;
        st.startPY = e.clientY;
        st.startX = st.x;
        st.startY = st.y;
        st.startW = st.w;
        st.startH = st.h;

        rect.setPointerCapture?.(e.pointerId);
      }

      function onPointerMove(e) {
        if (!st.dragging) return;

        const dx = e.clientX - st.startPX;
        const dy = e.clientY - st.startPY;

        if (st.dragMode === "move") {
          const newX = clamp(st.startX + dx, 0, st.imgW - st.w);
          const newY = clamp(st.startY + dy, 0, st.imgH - st.h);
          st.x = Math.round(newX);
          st.y = Math.round(newY);
          updateUI();
          return;
        }

        applyResize(st.dragMode, dx, dy);
      }

      function onPointerUp(e) {
        if (!st.dragging) return;
        st.dragging = false;
        st.dragMode = null;
        rect.releasePointerCapture?.(e.pointerId);
      }

      async function finalizeCropToJpeg() {
        const natW = img.naturalWidth;
        const natH = img.naturalHeight;

        const scaleX = natW / st.imgW;
        const scaleY = natH / st.imgH;

        const cropX = Math.round(st.x * scaleX);
        const cropY = Math.round(st.y * scaleY);
        const cropW = Math.round(st.w * scaleX);
        const cropH = Math.round(st.h * scaleY);

        const needDownscale = (cropW > maxW || cropH > maxH) && maxW && maxH;
        const outW = needDownscale ? maxW : cropW;
        const outH = needDownscale ? maxH : cropH;

        const canvas = document.createElement("canvas");
        canvas.width = outW;
        canvas.height = outH;

        const ctx = canvas.getContext("2d", { alpha: true });
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, outW, outH);

        ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, outW, outH);

        const blob = await canvasToBlob(canvas, "image/jpeg", JPEG_QUALITY);
        if (!blob) throw new Error("canvas.toBlob returned null for JPEG (crop)");

        return new File([blob], fileNameToJpg(file.name), {
          type: "image/jpeg",
          lastModified: file.lastModified || Date.now(),
        });
      }

      function cleanup(result) {
        try { URL.revokeObjectURL(url); } catch (_) {}
        overlay.remove();
        resolve(result);
      }

      const cancelAll = () => cleanup(null);
      const skipThis = () => cleanup(SKIP_TOKEN);

      cancel.addEventListener("click", cancelAll);
      closeBtn.addEventListener("click", cancelAll);
      skipBtn.addEventListener("click", skipThis);

      autoBtn.addEventListener("click", (e) => {
        e.preventDefault();
        syncFrameToImage();
        setAutoCenterCrop(1.0);
      });

      function onKey(e) {
        if (e.key === "Escape") cancelAll();
        if (e.key === "Enter") ok.click();
      }
      document.addEventListener("keydown", onKey, true);

      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) cancelAll();
      });

      ok.addEventListener("click", async () => {
        ok.disabled = true;
        ok.textContent = "Обработка...";
        try {
          const outFile = await finalizeCropToJpeg();
          document.removeEventListener("keydown", onKey, true);
          cleanup(outFile);
        } catch (err) {
          LOG("Crop error:", err);
          ok.disabled = false;
          ok.textContent = queueTotal > 1 && queueIndex < queueTotal ? "Далее" : "Подтвердить";
          alert("Ошибка при обработке изображения. Подробности в консоли.");
        }
      });

      rect.addEventListener("pointerdown", (e) => onPointerDown(e, "move"));
      hNW.addEventListener("pointerdown", (e) => onPointerDown(e, "nw"));
      hNE.addEventListener("pointerdown", (e) => onPointerDown(e, "ne"));
      hSW.addEventListener("pointerdown", (e) => onPointerDown(e, "sw"));
      hSE.addEventListener("pointerdown", (e) => onPointerDown(e, "se"));

      rect.addEventListener("pointermove", onPointerMove);
      rect.addEventListener("pointerup", onPointerUp);
      rect.addEventListener("pointercancel", onPointerUp);

      img.addEventListener("load", () => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            syncFrameToImage();
            setAutoCenterCrop(1.0);
          });
        });
      }, { once: true });

      const oldCleanup = cleanup;
      cleanup = (result) => {
        document.removeEventListener("keydown", onKey, true);
        oldCleanup(result);
      };
    });
  }

  async function processBackdropOrPoster(file, cfg, batch) {
    if (!isImageFile(file)) return file;

    const bm = await decodeToBitmap(file);
    const w = bm.width;
    const h = bm.height;
    if (bm instanceof ImageBitmap) bm.close?.();

    if (aspectClose(w, h, cfg.aspect)) {
      return await fileToJpegMaybeResize(file, {
        maxW: cfg.maxW,
        maxH: cfg.maxH,
        targetAspect: cfg.aspect,
      });
    }

    return await openInteractiveCropModal({
      file,
      kindLabel: cfg.label,
      targetAspect: cfg.aspect,
      maxW: cfg.maxW,
      maxH: cfg.maxH,
      queueIndex: batch?.index ?? 1,
      queueTotal: batch?.total ?? 1,
    });
  }

  async function convertFileForMode(file, mode, batch) {
    if (mode === "logo_png") {
      if (isImageFile(file) && !isPng(file)) return await fileToPng(file);
      return file;
    }

    if (mode === "backdrop_jpeg") {
      return await processBackdropOrPoster(file, {
        label: "Задник",
        aspect: BACKDROP_ASPECT,
        maxW: BACKDROP_MAX_W,
        maxH: BACKDROP_MAX_H,
      }, batch);
    }

    if (mode === "poster_jpeg") {
      return await processBackdropOrPoster(file, {
        label: "Постер",
        aspect: POSTER_ASPECT,
        maxW: POSTER_MAX_W,
        maxH: POSTER_MAX_H,
      }, batch);
    }

    return file;
  }

  async function processAndReplay(input, files, mode, originalEvent) {
    const arr = Array.from(files || []);
    if (!arr.length) return false;

    // Should we intercept?
    if (mode === "logo_png") {
      const need = arr.some((f) => isImageFile(f) && !isPng(f));
      if (!need) return false;
    } else if (mode === "backdrop_jpeg" || mode === "poster_jpeg") {
      const hasImg = arr.some(isImageFile);
      if (!hasImg) return false;
    } else {
      return false;
    }

    originalEvent?.stopImmediatePropagation?.();
    originalEvent?.preventDefault?.();

    replacingInputs.add(input);
    try {
      const out = [];

      // Sequential processing for multi-file DnD
      for (let i = 0; i < arr.length; i++) {
        const f = arr[i];
        const converted = await convertFileForMode(f, mode, { index: i + 1, total: arr.length });

        // Cancel in crop -> abort whole batch (no upload)
        if ((mode === "backdrop_jpeg" || mode === "poster_jpeg") && converted === null) {
          try { input.value = ""; } catch (_) {}
          return true;
        }

        // Skip this file -> just continue
        if ((mode === "backdrop_jpeg" || mode === "poster_jpeg") && converted === SKIP_TOKEN) {
          continue;
        }

        out.push(converted);
      }

      // If everything skipped -> don't trigger upload
      if (!out.length) {
        try { input.value = ""; } catch (_) {}
        return true;
      }

      // Upload ALL in one pack (single change event)
      setInputFiles(input, out);
      input.dispatchEvent(new Event("change", { bubbles: true }));

      // allow sequential uploads again
      setTimeout(() => { try { input.value = ""; } catch (_) {} }, 0);

      return true;
    } finally {
      setTimeout(() => replacingInputs.delete(input), 0);
    }
  }

  function attachToWindow(winEl) {
    const input = winEl.querySelector?.('input#upload_files[type="file"]');
    if (!input) return false;

    const title = getWindowTitleText(input);
    const mode = detectModeByTitle(title);
    if (!mode) return false;

    const tag = input.dataset.tmdbUploadHelperAttached;
    if (tag === mode) return true;
    input.dataset.tmdbUploadHelperAttached = mode;

    // File picker
    input.addEventListener("change", async (e) => {
      if (replacingInputs.has(input)) return;
      const files = input.files;
      if (!files || !files.length) return;
      await processAndReplay(input, files, mode, e);
    }, true);

    // Drag&Drop (capture on whole window)
    const dropRoot = winEl;

    const isFilesDrag = (e) => {
      const types = e.dataTransfer?.types;
      return types && Array.from(types).includes("Files");
    };

    const onDragOver = (e) => {
      if (!isFilesDrag(e)) return;
      e.preventDefault();
    };

    dropRoot.addEventListener("dragenter", onDragOver, true);
    dropRoot.addEventListener("dragover", onDragOver, true);

    dropRoot.addEventListener("drop", async (e) => {
      if (replacingInputs.has(input)) return;

      const files = e.dataTransfer?.files;
      if (!files || !files.length) return;

      if (mode === "logo_png") {
        const need = Array.from(files).some((f) => isImageFile(f) && !isPng(f));
        if (!need) return; // let native handler run
      } else {
        const hasImg = Array.from(files).some(isImageFile);
        if (!hasImg) return;
      }

      e.stopImmediatePropagation();
      e.preventDefault();

      await processAndReplay(input, files, mode, e);
    }, true);

    LOG(`Attached: mode=${mode}, title="${title}"`);
    return true;
  }

  function startObserver() {
    const tryAttach = () => {
      const wins = document.querySelectorAll?.(".k-window[role='dialog']") || [];
      for (const w of wins) attachToWindow(w);
    };

    document.addEventListener("DOMContentLoaded", tryAttach, { once: true });

    const mo = new MutationObserver(() => tryAttach());
    mo.observe(document.documentElement, { childList: true, subtree: true });

    setInterval(tryAttach, 1500);
  }

  startObserver();
})();
