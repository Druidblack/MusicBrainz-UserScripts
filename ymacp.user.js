// ==UserScript==
// @name         Yandex Music Artist Collector Pro
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  Продвинутый сборщик ссылок на артистов с Яндекс.Музыки
// @author       hageshii
// @match        https://music.yandex.ru/*
// @grant        GM_addStyle
// @grant        GM_download
// @run-at       document-idle
// @icon        https://music.yandex.ru/favicon.ico
//
// @downloadURL  https://github.com/Druidblack/MusicBrainz-UserScripts/raw/main/ymacp.user.js
// @updateURL    https://github.com/Druidblack/MusicBrainz-UserScripts/raw/main/ymacp.user.js
// ==/UserScript==

(function() {
    'use strict';

    // Конфигурация
    const config = {
        scrollStep: 600,
        scrollDelay: 800,
        maxScrollAttempts: 150,
        filename: 'yandex_music_artists.txt',
        debugMode: true,
        panelPosition: { top: '150px', right: '20px' }
    };

    // Вспомогательные функции
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    const log = config.debugMode ? console.log.bind(console) : () => {};

    // Состояние
    let collectedLinks = new Set();
    let processedElements = new WeakSet();
    let observer = null;
    let isCollecting = false;

    // Стили интерфейса
    GM_addStyle(`
        #lc-container {
            position: fixed;
            top: ${config.panelPosition.top};
            right: ${config.panelPosition.right};
            z-index: 9999;
            font-family: Arial, sans-serif;
        }
        #lc-button {
            background: #FDCB46;
            color: black;
            border: none;
            padding: 10px 15px;
            border-radius: 16px;
            cursor: pointer;
            font-size: 14px;
            font-weight: bold;
            box-shadow: 0 2px 5px rgba(0,0,0,0.2);
            transition: all 0.3s ease;
        }
        #lc-button:hover {
            background: #ffd963;
            transform: translateY(-2px);
        }
        #lc-button:disabled {
            background: #cccccc;
            cursor: not-allowed;
        }
        #lc-panel {
            display: none;
            background: #0D0D0D;
            border: 2px solid #1B1B1B;
            border-radius: 16px;
            padding: 20px;
            width: 450px;
            max-height: 600px;
            overflow: hidden;
            box-shadow: 0 0 15px rgba(0,0,0,0.7);
            margin-top: 10px;
            opacity: 0;
            transform: translateY(10px);
            transition: all 0.3s ease;
        }
        #lc-panel.visible {
            display: block;
            opacity: 1;
            transform: translateY(0);
        }
        .lc-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 15px;
            padding-bottom: 10px;
            border-bottom: 1px solid #333;
        }
        .lc-header h3 {
            margin: 0;
            color: white;
            font-size: 16px;
        }
        .lc-close-btn {
            background: #333;
            color: #FDCB46;
            border: none;
            width: 28px;
            height: 28px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            font-size: 18px;
            font-weight: bold;
            transition: all 0.2s ease;
        }
        .lc-close-btn:hover {
            background: #444;
            color: #ffdd77;
            transform: scale(1.1);
        }
        .lc-links-area {
            height: 350px;
            width: calc(100% - 5px);
            background: #1a1a1a;
            color: #FDCB46;
            border: 1px solid #333;
            border-radius: 8px;
            padding: 12px 15px;
            font-family: monospace;
            font-size: 12px;
            margin-bottom: 15px;
            resize: none;
            overflow-y: auto;
            line-height: 1.4;
        }
        .lc-links-area::-webkit-scrollbar {
            width: 8px;
        }
        .lc-links-area::-webkit-scrollbar-track {
            background: #1a1a1a;
            border-radius: 4px;
        }
        .lc-links-area::-webkit-scrollbar-thumb {
            background: #FDCB46;
            border-radius: 4px;
        }
        .lc-stats {
            font-size: 13px;
            color: #FDCB46;
            margin-bottom: 15px;
            padding: 8px 12px;
            background: #1a1a1a;
            border-radius: 8px;
            border: 1px solid #333;
        }
        .lc-actions {
            display: flex;
            gap: 10px;
            margin-top: 10px;
        }
        .lc-action-button {
            background: #FDCB46;
            color: black;
            border: none;
            padding: 8px 16px;
            border-radius: 16px;
            cursor: pointer;
            font-size: 13px;
            font-weight: bold;
            transition: all 0.2s ease;
            flex: 1;
        }
        .lc-action-button:hover {
            background: #ffdd77;
            transform: translateY(-1px);
        }
        .lc-action-button:active {
            transform: translateY(1px);
        }
    `);

    // Основная логика
    function isTargetLink(link) {
        try {
            if (!link.href || processedElements.has(link)) return false;
            const href = link.href.toLowerCase();
            return href.includes("artist") &&
                  !["passport", "portal", "users"].some(t => href.includes(t));
        } catch (e) {
            return false;
        }
    }

    async function collectLinks() {
        const links = document.querySelectorAll('a:not([data-processed])');
        let added = 0;

        links.forEach(link => {
            if (isTargetLink(link)) {
                link.setAttribute('data-processed', 'true');
                processedElements.add(link);
                collectedLinks.add(link.href);
                added++;
            }
        });

        return added;
    }

    function setupObserver() {
        return new MutationObserver(async (mutations) => {
            for (const mutation of mutations) {
                if (mutation.addedNodes.length) {
                    const added = await collectLinks();
                    if (added > 0) {
                        log(`Добавлено динамически: ${added} ссылок`);
                        updateUI();
                    }
                }
            }
        });
    }

    async function smoothScrollTo(position) {
        const startPos = window.scrollY;
        const distance = position - startPos;
        if (distance === 0) return;

        const duration = Math.min(1000, Math.abs(distance) * 1.5);
        let startTime = null;

        await new Promise(resolve => {
            function scrollStep(timestamp) {
                if (!startTime) startTime = timestamp;
                const progress = Math.min((timestamp - startTime) / duration, 1);
                window.scrollTo(0, startPos + distance * progress);

                if (progress < 1) {
                    requestAnimationFrame(scrollStep);
                } else {
                    resolve();
                }
            }
            requestAnimationFrame(scrollStep);
        });
    }

    async function smartScroll() {
        if (isCollecting) return;
        isCollecting = true;

        observer = setupObserver();
        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: false,
            characterData: false
        });

        let attempts = 0;
        let lastPosition = window.scrollY;
        let lastCount = collectedLinks.size;
        let unchangedCount = 0;

        // Первоначальный сбор
        await collectLinks();
        updateUI();

        while (attempts < config.maxScrollAttempts && isCollecting) {
            attempts++;

            // Плавная прокрутка
            const targetPos = lastPosition + config.scrollStep;
            await smoothScrollTo(targetPos);
            await sleep(config.scrollDelay);

            // Проверка изменений
            const currentPosition = window.scrollY;
            const currentCount = collectedLinks.size;

            if (Math.abs(currentPosition - lastPosition) < 50 && currentCount === lastCount) {
                unchangedCount++;
                if (unchangedCount > 3) {
                    log("Новые данные не обнаружены, завершаем");
                    break;
                }
            } else {
                unchangedCount = 0;
            }

            lastPosition = currentPosition;
            lastCount = currentCount;
            log(`Шаг ${attempts}: Позиция ${currentPosition}px | Ссылок: ${currentCount}`);
            updateUI();

            // Проверка конца страницы
            if (window.innerHeight + currentPosition >= document.body.scrollHeight - 100) {
                log("Достигнут конец страницы");
                break;
            }
        }

        // Финальная проверка
        if (isCollecting) {
            await smoothScrollTo(document.body.scrollHeight);
            await sleep(config.scrollDelay * 2);
            await collectLinks();
            updateUI();
        }

        observer.disconnect();
        isCollecting = false;
    }

    function stopCollection() {
        isCollecting = false;
    }

    function downloadLinks() {
        if (collectedLinks.size === 0) {
            alert('Нет ссылок для скачивания!');
            return;
        }

        const content = Array.from(collectedLinks).join('\n');
        const filename = config.filename;

        if (typeof GM_download !== 'undefined') {
            GM_download({
                url: 'data:text/plain,' + encodeURIComponent(content),
                name: filename,
                saveAs: true
            });
        } else {
            const blob = new Blob([content], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            setTimeout(() => {
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            }, 100);
        }
    }

    function copyLinks() {
        if (collectedLinks.size === 0) {
            alert('Нет ссылок для копирования!');
            return;
        }

        const textarea = document.getElementById('lc-links-area');
        textarea.select();
        document.execCommand('copy');

        const stats = document.getElementById('lc-stats');
        stats.textContent = `✓ Скопировано ${collectedLinks.size} ссылок!`;
        setTimeout(() => updateUI(), 2000);
    }

    function clearLinks() {
        collectedLinks.clear();
        processedElements = new WeakSet();
        updateUI();
    }

    function updateUI() {
        const linksArea = document.getElementById('lc-links-area');
        const stats = document.getElementById('lc-stats');
        const button = document.getElementById('lc-button');

        if (linksArea) linksArea.value = Array.from(collectedLinks).join('\n');
        if (stats) stats.textContent = `Найдено артистов: ${collectedLinks.size}`;
        if (button) button.textContent = isCollecting ? 'Сбор...' : `Собрать артистов (${collectedLinks.size})`;
    }

    function createUI() {
        // Создаем контейнер
        const container = document.createElement('div');
        container.id = 'lc-container';

        // Кнопка открытия панели
        const button = document.createElement('button');
        button.id = 'lc-button';
        button.textContent = `Собрать артистов (${collectedLinks.size})`;
        button.addEventListener('click', async () => {
            if (isCollecting) {
                stopCollection();
                return;
            }

            button.disabled = true;
            button.textContent = 'Сбор...';

            try {
                clearLinks();
                await smartScroll();
            } catch (error) {
                console.error(error);
                button.textContent = 'Ошибка!';
            } finally {
                button.disabled = false;
                updateUI();
            }
        });

        // Панель управления
        const panel = document.createElement('div');
        panel.id = 'lc-panel';

        // Заголовок панели
        const panelHeader = document.createElement('div');
        panelHeader.className = 'lc-header';
        panelHeader.innerHTML = '<h3>Сборщик артистов Яндекс.Музыки</h3>';

        const closeBtn = document.createElement('button');
        closeBtn.className = 'lc-close-btn';
        closeBtn.innerHTML = '×';
        closeBtn.addEventListener('click', () => {
            panel.classList.remove('visible');
            setTimeout(() => {
                panel.style.display = 'none';
            }, 300);
        });
        panelHeader.appendChild(closeBtn);

        // Область для ссылок
        const linksArea = document.createElement('textarea');
        linksArea.id = 'lc-links-area';
        linksArea.className = 'lc-links-area';
        linksArea.readOnly = true;
        linksArea.placeholder = 'Собранные ссылки появятся здесь...';

        // Статистика
        const stats = document.createElement('div');
        stats.id = 'lc-stats';
        stats.className = 'lc-stats';
        stats.textContent = `Найдено артистов: ${collectedLinks.size}`;

        // Кнопки действий
        const actionButtons = document.createElement('div');
        actionButtons.className = 'lc-actions';

        const copyBtn = document.createElement('button');
        copyBtn.className = 'lc-action-button';
        copyBtn.textContent = 'Копировать';
        copyBtn.addEventListener('click', copyLinks);

        const downloadBtn = document.createElement('button');
        downloadBtn.className = 'lc-action-button';
        downloadBtn.textContent = 'Скачать';
        downloadBtn.addEventListener('click', downloadLinks);

        const clearBtn = document.createElement('button');
        clearBtn.className = 'lc-action-button';
        clearBtn.textContent = 'Очистить';
        clearBtn.addEventListener('click', clearLinks);

        actionButtons.appendChild(copyBtn);
        actionButtons.appendChild(downloadBtn);
        actionButtons.appendChild(clearBtn);

        // Собираем панель
        panel.appendChild(panelHeader);
        panel.appendChild(linksArea);
        panel.appendChild(stats);
        panel.appendChild(actionButtons);

        // Собираем контейнер
        container.appendChild(button);
        container.appendChild(panel);

        // Добавляем в документ
        document.body.appendChild(container);

        // Функция для переключения панели
        function togglePanel() {
            if (panel.classList.contains('visible')) {
                panel.classList.remove('visible');
                setTimeout(() => {
                    panel.style.display = 'none';
                }, 300);
            } else {
                panel.style.display = 'block';
                setTimeout(() => {
                    panel.classList.add('visible');
                }, 10);
            }
        }

        // Обработчики событий
        button.addEventListener('click', togglePanel);
    }

    // Инициализация
    window.addEventListener('load', () => {
        createUI();
    });
})();