// ==UserScript==
// @name         Yandex Music save link txt
// @namespace    https://github.com/Druidblack/MusicBrainz-UserScripts
// @version      1.4.0
// @description  Adds header buttons on Yandex Music (album/release/artist) to append current URL to a save link txt.
// @match        https://music.yandex.ru/*
// @match        https://music.yandex.com/*
// @run-at       document-idle
// @grant        none
//
// @downloadURL  https://github.com/Druidblack/MusicBrainz-UserScripts/raw/main/yandexmusic_save_link_txt.user.js
// @updateURL    https://github.com/Druidblack/MusicBrainz-UserScripts/raw/main/yandexmusic_save_link_txt.user.js
// ==/UserScript==

(() => {
  "use strict";

  // -------------------------
  // IndexedDB: store FileSystemFileHandle
  // -------------------------
  const DB_NAME = "ym_url_to_txt_db";
  const STORE = "kv";
  const KEY = "fileHandle";

  function idbOpen() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function idbGet(key) {
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function idbSet(key, value) {
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.objectStore(STORE).put(value, key);
    });
  }

  // -------------------------
  // Helpers
  // -------------------------
  let busy = false;

  function ensureStyles() {
    if (document.getElementById("ymtxt-style")) return;
    const st = document.createElement("style");
    st.id = "ymtxt-style";
    st.textContent = `
      button[data-ymtxt-btn="add"].ymtxt-green {
        background-color: #2ecc71 !important;
        color: #fff !important;
      }
      button[data-ymtxt-btn="add"].ymtxt-red {
        background-color: #e74c3c !important;
        color: #fff !important;
      }
      button[data-ymtxt-btn="add"].ymtxt-green:hover,
      button[data-ymtxt-btn="add"].ymtxt-red:hover {
        filter: brightness(1.05);
      }
      button[data-ymtxt-btn="add"].ymtxt-green:disabled,
      button[data-ymtxt-btn="add"].ymtxt-red:disabled {
        opacity: .7 !important;
        filter: none !important;
        cursor: not-allowed !important;
      }
    `;
    document.head.appendChild(st);
  }

  function toast(msg, ms = 2500) {
    let el = document.getElementById("ymtxt-toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "ymtxt-toast";
      el.style.cssText =
        "position:fixed;right:16px;bottom:16px;z-index:999999;" +
        "background:rgba(20,20,20,.92);color:#fff;padding:10px 12px;" +
        "border-radius:12px;font:13px/1.2 system-ui,-apple-system,Segoe UI,Roboto,Arial;" +
        "box-shadow:0 10px 30px rgba(0,0,0,.25);max-width:420px;word-break:break-word;";
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.display = "block";
    clearTimeout(el._t);
    el._t = setTimeout(() => (el.style.display = "none"), ms);
  }

  function normalizeUrl(raw) {
    try {
      const u = new URL(String(raw).trim());
      u.hash = "";
      return u.toString();
    } catch {
      return String(raw || "").trim();
    }
  }

  function normalizeFileText(text) {
    return String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  }

  function containsExactLine(fileText, line) {
    const t = "\n" + normalizeFileText(fileText) + "\n";
    const needle = "\n" + line + "\n";
    return t.includes(needle);
  }

  async function pickTxtFile() {
    if (!("showOpenFilePicker" in window)) {
      throw new Error("Этот браузер не поддерживает выбор файла (File System Access API)");
    }
    const [picked] = await window.showOpenFilePicker({
      multiple: false,
      types: [{ description: "Text file", accept: { "text/plain": [".txt"] } }],
    });
    return picked;
  }

  async function ensureWritePermission(handle) {
    if (typeof handle.requestPermission === "function") {
      const perm = await handle.requestPermission({ mode: "readwrite" });
      if (perm !== "granted") throw new Error("Нет разрешения на запись в файл");
    }
  }

  async function readFileTextSafe(handle) {
    // Для подсветки нам нужно просто прочитать файл.
    // Обычно getFile() работает и без запроса, если разрешение уже было выдано.
    const file = await handle.getFile();
    return await file.text();
  }

  async function appendUrlNoDup(handle, urlLine) {
    const file = await handle.getFile();
    const text = await file.text();

    if (containsExactLine(text, urlLine)) {
      return { appended: false, reason: "duplicate" };
    }

    const writable = await handle.createWritable({ keepExistingData: true });
    await writable.seek(file.size);
    await writable.write(urlLine + "\n");
    await writable.close();

    return { appended: true };
  }

  // -------------------------
  // DOM injection into header controls (album/release + artist)
  // -------------------------
  const BTN_MARK = "data-ymtxt-btn";

  function findControlContainers() {
    const list = new Set();

    const a =
      document.querySelector("div.CommonPageHeader_controls__c27E_") ||
      document.querySelector('div[class*="CommonPageHeader_controls__"]');
    if (a) list.add(a);

    document
      .querySelectorAll('div.PageHeaderArtist_controls__U_6g7, div[class*="PageHeaderArtist_controls__"]')
      .forEach((x) => list.add(x));

    return Array.from(list);
  }

  function pickTemplateButton(container) {
    const buttons = Array.from(container.querySelectorAll('button[type="button"]'));
    if (!buttons.length) return null;

    // избегаем playControl
    return (
      buttons.find((x) => x.textContent.trim() && !Array.from(x.classList).some((c) => c.includes("playControl"))) ||
      buttons.find((x) => x.textContent.trim()) ||
      buttons.find((x) => !Array.from(x.classList).some((c) => c.includes("playControl"))) ||
      buttons[0] ||
      null
    );
  }

  function createStyledButtonFromTemplate(templateBtn, label, markValue, onClick) {
    const btn = templateBtn.cloneNode(true);

    btn.setAttribute(BTN_MARK, markValue);
    btn.type = "button";
    btn.disabled = false;

    btn.removeAttribute("aria-pressed");
    btn.removeAttribute("aria-expanded");
    btn.removeAttribute("aria-haspopup");
    btn.removeAttribute("data-intersection-property-id");

    btn.setAttribute("aria-label", label);
    btn.setAttribute("title", label);

    const templateSpan = templateBtn.querySelector("span");
    const spanClass = templateSpan ? templateSpan.className : "";

    btn.innerHTML = "";
    const span = document.createElement("span");
    if (spanClass) span.className = spanClass;
    span.textContent = label;
    btn.appendChild(span);

    btn.addEventListener("click", onClick);
    return btn;
  }

  function findInsertAfterNode(container) {
    // Альбом/релиз: div.*pinOrDonationControl__*
    const pinWrap =
      container.querySelector('div.PageHeaderAlbumControls_pinOrDonationControl__3aFUW') ||
      container.querySelector('div[class*="PageHeaderAlbumControls_pinOrDonationControl__"]') ||
      container.querySelector('div[class*="pinOrDonationControl__"]');
    if (pinWrap) return pinWrap;

    // Артист: pinControl или aria-label="Закрепить"
    const pinBtn =
      container.querySelector('button.PageHeaderArtist_pinControl__dQToz') ||
      container.querySelector('button[class*="PageHeaderArtist_pinControl__"]') ||
      container.querySelector('button[class*="pinControl__"]') ||
      container.querySelector('button[aria-label="Закрепить"]');
    if (pinBtn) return pinBtn;

    return null;
  }

  function insertButtonsIntoContainer(container) {
    if (container.querySelector(`[${BTN_MARK}="add"]`) || container.querySelector(`[${BTN_MARK}="pick"]`)) return;

    const templateBtn = pickTemplateButton(container);
    if (!templateBtn) return;

    // ВАЖНО: порядок — сначала "В TXT", потом "TXT файл"
    const btnAdd = createStyledButtonFromTemplate(templateBtn, "Сохранить", "add", () => actionAppendLink(btnAdd));
    const btnPick = createStyledButtonFromTemplate(templateBtn, "Файл сохранения", "pick", actionPickFile);

    const afterNode = findInsertAfterNode(container);

    if (afterNode && afterNode.parentNode === container) {
      afterNode.insertAdjacentElement("afterend", btnAdd);
      btnAdd.insertAdjacentElement("afterend", btnPick);
    } else {
      container.appendChild(btnAdd);
      container.appendChild(btnPick);
    }
  }

  function injectAll() {
    ensureStyles();
    const containers = findControlContainers();
    for (const c of containers) insertButtonsIntoContainer(c);
  }

  // -------------------------
  // State / Coloring
  // -------------------------
  function setAddButtonColor(btnAdd, inFile) {
    btnAdd.classList.remove("ymtxt-green", "ymtxt-red");
    btnAdd.classList.add(inFile ? "ymtxt-green" : "ymtxt-red");
  }

  let refreshTimer = null;

  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refreshAddButtonColor, 250);
  }

  async function refreshAddButtonColor() {
    try {
      const addButtons = Array.from(document.querySelectorAll(`button[${BTN_MARK}="add"]`));
      if (!addButtons.length) return;

      const urlLine = normalizeUrl(location.href);
      if (!urlLine) {
        addButtons.forEach((b) => setAddButtonColor(b, false));
        return;
      }

      const handle = await idbGet(KEY);
      if (!handle) {
        // Файл не выбран — считаем “нет в файле” (красная)
        addButtons.forEach((b) => setAddButtonColor(b, false));
        return;
      }

      let text = "";
      try {
        text = await readFileTextSafe(handle);
      } catch {
        // если нет доступа/файл недоступен — красная
        addButtons.forEach((b) => setAddButtonColor(b, false));
        return;
      }

      const inFile = containsExactLine(text, urlLine);
      addButtons.forEach((b) => setAddButtonColor(b, inFile));
    } catch {
      // игнор
    }
  }

  // -------------------------
  // Actions
  // -------------------------
  async function actionPickFile() {
    if (busy) return;
    busy = true;
    try {
      const handle = await pickTxtFile();
      await idbSet(KEY, handle);
      toast("TXT файл выбран ✅");
      scheduleRefresh();
    } catch (e) {
      toast(`Ошибка выбора файла: ${e?.message || e}`);
    } finally {
      busy = false;
    }
  }

  async function actionAppendLink(btnEl) {
    if (busy) return;
    busy = true;
    if (btnEl) btnEl.disabled = true;

    try {
      if (!("FileSystemFileHandle" in window)) {
        toast("Этот браузер не поддерживает File System Access API 😿");
        return;
      }

      let handle = await idbGet(KEY);
      if (!handle) {
        handle = await pickTxtFile();
        await idbSet(KEY, handle);
      }

      await ensureWritePermission(handle);

      const urlLine = normalizeUrl(location.href);
      if (!urlLine) {
        toast("Пустая ссылка — нечего добавлять");
        return;
      }

      const res = await appendUrlNoDup(handle, urlLine);
      if (!res.appended && res.reason === "duplicate") {
        toast("Эта ссылка уже есть ♻️");
      } else {
        toast("Ссылка добавлена ✅");
      }

      scheduleRefresh();
    } catch (e) {
      toast(`Ошибка: ${e?.message || e}`);
    } finally {
      busy = false;
      if (btnEl) btnEl.disabled = false;
    }
  }

  // -------------------------
  // SPA: reinject + recolor on navigation / rerender
  // -------------------------
  function hookHistory() {
    const _pushState = history.pushState;
    history.pushState = function (...args) {
      const ret = _pushState.apply(this, args);
      setTimeout(() => {
        injectAll();
        scheduleRefresh();
      }, 200);
      return ret;
    };

    const _replaceState = history.replaceState;
    history.replaceState = function (...args) {
      const ret = _replaceState.apply(this, args);
      setTimeout(() => {
        injectAll();
        scheduleRefresh();
      }, 200);
      return ret;
    };

    window.addEventListener("popstate", () => {
      setTimeout(() => {
        injectAll();
        scheduleRefresh();
      }, 200);
    });
  }

  function observeDom() {
    const mo = new MutationObserver(() => {
      injectAll();
      scheduleRefresh();
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
  }

  // start
  hookHistory();
  observeDom();
  injectAll();
  scheduleRefresh();
})();
