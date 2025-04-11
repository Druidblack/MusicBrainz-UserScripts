// ==UserScript==
// @name         MusicBrainz Join Phrase Filler for Album and Tracklist 
// @namespace    https://github.com/Druidblack/MusicBrainz-UserScripts
// @version      2025.0.12
// @author       Druidblack
// @description  Automatically fills in the join-phrase fields for performing credits on the Album and Tracklist tabs.
// @match        *://musicbrainz.org/*
// @match        *://musicbrainz.eu/*
// @icon         https://musicbrainz.org/favicon.ico
// @grant        none
// @downloadURL  https://github.com/Druidblack/MusicBrainz-UserScripts/raw/main/join_phrase.user.js
// @updateURL   https://github.com/Druidblack/MusicBrainz-UserScripts/raw/main/join_phrase.user.js
// ==/UserScript==

(function() {
    'use strict';

    // Функция эмуляции нативного ввода с использованием нативного setter'а value
    function simulateNativeInput(inputElement, newValue) {
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        nativeInputValueSetter.call(inputElement, newValue);
        inputElement.dispatchEvent(new Event('input', { bubbles: true }));
        inputElement.dispatchEvent(new Event('change', { bubbles: true }));
        // Запоминаем значение для восстановления при фокусе
        inputElement.dataset.fixedValue = newValue;
        attachFocusListener(inputElement);
    }

    // Функция для привязки обработчика события focus к полю ввода.
    // При фокусе поле проверяется – если оно очищено, то восстанавливается сохранённое значение.
    function attachFocusListener(inputElement) {
        if (inputElement.dataset.hasFocusListener) return;
        inputElement.addEventListener('focus', function() {
            setTimeout(() => {
                if (inputElement.dataset.fixedValue && inputElement.value.trim() === "") {
                    simulateNativeInput(inputElement, inputElement.dataset.fixedValue);
                }
            }, 50);
        });
        inputElement.dataset.hasFocusListener = "true";
    }

    // Группирует все join-phrase поля по общему префиксу (часть id до порядкового номера)
    function groupJoinPhraseInputs() {
        const inputs = Array.from(document.querySelectorAll("input[id*='-join-phrase-']"));
        const groups = {};
        inputs.forEach(input => {
            // Идентификаторы имеют вид: <prefix>-join-phrase-<номер>
            const match = input.id.match(/(.*-join-phrase-)\d+$/);
            if (match) {
                const groupKey = match[1];
                if (!groups[groupKey]) {
                    groups[groupKey] = [];
                }
                groups[groupKey].push(input);
            }
        });
        // Для каждой группы сортируем поля по порядковому номеру (из id)
        Object.keys(groups).forEach(groupKey => {
            groups[groupKey].sort((a, b) => {
                const aMatch = a.id.match(/-join-phrase-(\d+)$/);
                const bMatch = b.id.match(/-join-phrase-(\d+)$/);
                return parseInt(aMatch[1], 10) - parseInt(bMatch[1], 10);
            });
        });
        return groups;
    }

    // Основная функция заполнения полей join-phrase согласно требуемой логике:
    // - Если ровно 2 поля: первое получает " & " (если пустое).
    // - Если ровно 3 поля: первое всегда заменяется на ", ", второе – " & " (если пустое), третье – без изменений.
    // - Если больше 3 полей: для всех полей от 0 до count-3 устанавливается ", ",
    //   предпоследнее (count-2) получает " & " (если пустое), последнее остаётся без изменений.
    function fillJoinPhrases() {
        const groups = groupJoinPhraseInputs();
        Object.values(groups).forEach(group => {
            const count = group.length;
            if (count < 2) return; // Если только одно поле – ничего не делаем.

            if (count === 2) {
                // Если ровно 2 поля – в первое ставим " & " (если пустое).
                if (group[0].value.trim() === "") {
                    simulateNativeInput(group[0], " & ");
                }
                // Второе оставляем без изменений.
            } else if (count === 3) {
                // Если ровно 3 поля:
                // Первое поле всегда заменяем на ", " (даже если ранее был " & ").
                simulateNativeInput(group[0], ", ");
                // Второе поле – если пустое, ставим " & ".
                if (group[1].value.trim() === "") {
                    simulateNativeInput(group[1], " & ");
                }
                // Третье поле оставляем без изменений.
            } else if (count > 3) {
                // Если полей больше трёх:
                // Для всех полей от 0 до count-3 ставим ", " (если пустые).
                for (let i = 0; i < count - 2; i++) {
                    if (group[i].value.trim() === "") {
                        simulateNativeInput(group[i], ", ");
                    }
                }
                // Предпоследнее поле (count-2) – если пустое, ставим " & ".
                if (group[count - 2].value.trim() === "") {
                    simulateNativeInput(group[count - 2], " & ");
                }
                // Последнее поле оставляем без изменений.
            }
        });
    }

    // MutationObserver для отслеживания динамически добавляемых узлов в DOM.
    const observer = new MutationObserver((mutationsList) => {
        mutationsList.forEach(mutation => {
            if (mutation.addedNodes.length > 0) {
                setTimeout(fillJoinPhrases, 50);
            }
        });
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // Запускаем функцию заполнения при загрузке страницы.
    window.addEventListener('load', fillJoinPhrases);

    // На случай динамической подгрузки элементов повторно вызываем функцию заполнения в течение ~5 секунд.
    let attempts = 0;
    const intervalId = setInterval(() => {
        fillJoinPhrases();
        attempts++;
        if (attempts >= 10) {
            clearInterval(intervalId);
        }
    }, 500);

    // Первоначальный запуск.
    fillJoinPhrases();
})();
