// ==UserScript==
// @name        Jellyfin MusicBrainz Import
// @description Importing a release from the Jellyfin web interface to MusicBrainz. Buttons are added for importing, searching, and retrieving an image.
// @version     2025.02.00.03
// @author      Druidblack
// @namespace   https://github.com/Druidblack/MusicBrainz-UserScripts
//
// @include     http://*:8096/web/*
//
// @require     https://ajax.googleapis.com/ajax/libs/jquery/2.1.4/jquery.min.js
// @require     https://gist.github.com/raw/2625891/waitForKeyElements.js
//
// @run-at      document-end
// @grant       none
//
// @icon        https://musicbrainz.org/favicon.ico
//
// ==/UserScript==

(function() {
  // --- Предзагрузка изображений для кнопок ---
  (function preloadButtonImages() {
    var imgs = [
      "https://cdn.jsdelivr.net/gh/Druidblack/MusicBrainz-UserScripts@main/add/add.png",
      "https://cdn.jsdelivr.net/gh/Druidblack/MusicBrainz-UserScripts@main/add/add2.png",
      "https://cdn.jsdelivr.net/gh/Druidblack/MusicBrainz-UserScripts@main/add/search.png",
      "https://cdn.jsdelivr.net/gh/Druidblack/MusicBrainz-UserScripts@main/add/search2.png",
      "https://cdn.jsdelivr.net/gh/Druidblack/MusicBrainz-UserScripts@main/add/foto.png",
      "https://cdn.jsdelivr.net/gh/Druidblack/MusicBrainz-UserScripts@main/add/foto2.png"
    ];
    imgs.forEach(function(src) {
      var img = new Image();
      img.src = src;
    });
  })();

  // --- Глобальные переменные ---
  var apiKey = "ea5497543aa047c798117642bc4161ce";
  var serverAddress = "192.168.1.161:8096";
  var albumArtists = [];  // Массив исполнителей альбома
  var currentDetailsId = "";

  // --- Перехват навигационных событий для SPA ---
  (function(history){
    var pushState = history.pushState;
    history.pushState = function() {
      var ret = pushState.apply(history, arguments);
      run();
      return ret;
    };
  })(window.history);
  window.addEventListener("popstate", function(e) { run(); });
  window.addEventListener("hashchange", function(e) { run(); });

  // --- Инициализация jQuery ---
  var myJQ = jQuery.noConflict(true);

  // Создаём форму для импорта в MusicBrainz
  var myform = document.createElement("form");

  // Глобальные переменные для релиза
  var album = "", albumLink = "", releaseYear = "";

  myJQ(document).ready(function(){
    waitForKeyElements("h1.itemName.infoText.parentNameLast", run);
  });

  // --- Основная функция обновления данных и кнопок ---
  function run() {
    myform.innerHTML = ""; // Очистка формы скрытых полей
    extractCommonData();
    waitForKeyElements("div.childrenItemsContainer.itemsContainer.padded-right.vertical-list", extractTracks);
  }

  // --- Извлечение общих данных релиза (для альбома) ---
  function extractCommonData() {
    album = myJQ("h1.itemName.infoText.parentNameLast bdi").first().text().trim();

    albumArtists = myJQ("h3.parentName.musicParentName.focuscontainer-x a.button-link.emby-button")
      .map(function(){ return myJQ(this).text().trim(); }).get();

    albumLink = myJQ("a.button-link.emby-button[href*='music.apple.com']").first().attr("href");
    releaseYear = myJQ("div.itemMiscInfo.itemMiscInfo-primary div.mediaInfoItem").last().text().trim();

    add_field("name", album);
    for (var i = 0; i < albumArtists.length; i++) {
      add_field("artist_credit.names." + i + ".artist.name", albumArtists[i]);
      // Логика join_phrase для авторов альбома (если их больше одного)
      if (albumArtists.length > 1 && i !== albumArtists.length - 1) {
        var join_phrase = (i === albumArtists.length - 2) ? " & " : ", ";
        add_field("artist_credit.names." + i + ".join_phrase", join_phrase);
      }
    }
    add_field("date.year", releaseYear);
    add_field("mediums.0.format", "Digital Media");
    if (albumLink) {
      add_field("urls.0.link_type", "980");
      add_field("urls.0.url", albumLink);
    }
    add_field("edit_note", "Imported from: " + document.location.href + " using Emby script");
  }

  // --- Извлечение данных о треках ---
  function extractTracks(trackContainer) {
    var tracks = trackContainer.find("div.listItem.listItem-border");
    var trackCount = tracks.length;
    var releaseType = (trackCount > 1) ? "Album" : "Single";
    add_field("type", releaseType);

    tracks.each(function(i) {
      var title = myJQ(this).find("div.listItemBodyText bdi").first().text().trim();
      var trackArtistText = myJQ(this).find("div.secondary.listItemBodyText bdi").first().text().trim();
      var dur = myJQ(this).find("div.secondary.listItemMediaInfo div.mediaInfoItem").first().text().trim();

      add_field("mediums.0.track." + i + ".name", title);
      add_field("mediums.0.track." + i + ".length", parseDuration(dur));

      if (trackArtistText) {
        // Если в строке присутствует запятая – разбиваем по запятой
        if (trackArtistText.indexOf(",") !== -1) {
          var trackArtists = trackArtistText.split(",");
          // Если два и более исполнителя, для каждого, кроме последнего, добавляем join_phrase
          if (trackArtists.length >= 2) {
            for (var j = 0; j < trackArtists.length; j++) {
              var individualArtist = trackArtists[j].trim();
              if (individualArtist) {
                add_field("mediums.0.track." + i + ".artist_credit.names." + j + ".artist.name", individualArtist);
                if (j !== trackArtists.length - 1) {
                  var join_phrase = (j === trackArtists.length - 2) ? " & " : ", ";
                  add_field("mediums.0.track." + i + ".artist_credit.names." + j + ".join_phrase", join_phrase);
                }
              }
            }
          } else {
            // Если только один исполнитель после разделения
            var individualArtist = trackArtists[0].trim();
            if (individualArtist) {
              add_field("mediums.0.track." + i + ".artist_credit.names.0.artist.name", individualArtist);
            }
          }
        } else {
          // Если запятых нет, пытаемся сопоставить с исполнителями альбома
          var matchedArtists = [];
          var remaining = trackArtistText;
          for (var j = 0; j < albumArtists.length; j++) {
            var aArtist = albumArtists[j];
            if (remaining.indexOf(aArtist) !== -1) {
              matchedArtists.push(aArtist);
              remaining = remaining.replace(aArtist, "");
            }
          }
          remaining = remaining.trim();
          if (matchedArtists.length >= 2) {
            for (var j = 0; j < matchedArtists.length; j++) {
              add_field("mediums.0.track." + i + ".artist_credit.names." + j + ".artist.name", matchedArtists[j]);
              if (j !== matchedArtists.length - 1) {
                var join_phrase = (j === matchedArtists.length - 2) ? " & " : ", ";
                add_field("mediums.0.track." + i + ".artist_credit.names." + j + ".join_phrase", join_phrase);
              }
            }
            if (remaining.length > 0) {
              add_field("mediums.0.track." + i + ".artist_credit.names." + matchedArtists.length + ".artist.name", remaining);
            }
          } else {
            // Если только один матч или ничего не найдено – добавляем найденное (или оставшееся) как единственного исполнителя
            if (matchedArtists.length === 1) {
              add_field("mediums.0.track." + i + ".artist_credit.names.0.artist.name", matchedArtists[0]);
              if (remaining.length > 0) {
                add_field("mediums.0.track." + i + ".artist_credit.names.1.artist.name", remaining);
                if (2 > 1) { // для двух исполнителей – задаем join_phrase для первого
                  add_field("mediums.0.track." + i + ".artist_credit.names.0.join_phrase", " & ");
                }
              }
            } else if (remaining.length > 0) {
              add_field("mediums.0.track." + i + ".artist_credit.names.0.artist.name", remaining);
            }
          }
        }
      }
    });

    var mainDetailButtons = myJQ("div.mainDetailButtons.focuscontainer-x").first();
    if (!mainDetailButtons.length) {
      mainDetailButtons = myJQ('<div id="mbButtonsContainer" style="position: fixed; bottom: 10px; right: 10px; z-index: 9999;"></div>');
      myJQ(document.body).append(mainDetailButtons);
    }
    addImportButton(mainDetailButtons[0]);
    addSearchButton(mainDetailButtons[0]);
    addImageLinkButton(mainDetailButtons[0]);
  }

  // --- Преобразование строки "М:СС" в миллисекунды ---
  function parseDuration(durationStr) {
    var parts = durationStr.split(":");
    if (parts.length !== 2) return 0;
    var minutes = parseInt(parts[0], 10);
    var seconds = parseInt(parts[1], 10);
    return ((minutes * 60) + seconds) * 1000;
  }

  // --- Функция добавления скрытых полей в форму ---
  function add_field(name, value) {
    var field = document.createElement("input");
    field.type = "hidden";
    field.name = name;
    field.value = value;
    myform.appendChild(field);
  }

  // --- Кнопка импорта (Add to MusicBrainz) ---
  function addImportButton(parentEl) {
    if (parentEl.querySelector(".emby-mb-import-button")) return;
    myform.method = "post";
    myform.target = "_blank";
    myform.action = document.location.protocol + "//musicbrainz.org/release/add";
    myform.acceptCharset = "UTF-8";

    var importButton = document.createElement("button");
    importButton.type = "submit";
    importButton.title = "Add to MusicBrainz";
    importButton.classList.add("emby-mb-import-button");

    importButton.style.backgroundImage = "url('https://cdn.jsdelivr.net/gh/Druidblack/MusicBrainz-UserScripts@main/add/add2.png')";
    importButton.style.backgroundSize = "contain";
    importButton.style.backgroundRepeat = "no-repeat";
    importButton.style.backgroundPosition = "center";
    importButton.style.backgroundColor = "transparent";
    importButton.style.border = "none";
    importButton.style.width = "40px";
    importButton.style.height = "40px";
    importButton.style.cursor = "pointer";
    importButton.style.transition = "opacity 0.3s ease";

    importButton.addEventListener("mouseover", function() {
      importButton.style.backgroundImage = "url('https://cdn.jsdelivr.net/gh/Druidblack/MusicBrainz-UserScripts@main/add/add.png')";
    });
    importButton.addEventListener("mouseout", function() {
      importButton.style.backgroundImage = "url('https://cdn.jsdelivr.net/gh/Druidblack/MusicBrainz-UserScripts@main/add/add2.png')";
    });

    myform.appendChild(importButton);

    var formContainer = document.createElement("div");
    formContainer.style.display = "inline-block";
    formContainer.style.marginLeft = "10px";
    formContainer.appendChild(myform);
    parentEl.appendChild(formContainer);
  }

  // --- Кнопка поиска (Search on MusicBrainz) ---
  function addSearchButton(parentEl) {
    if (parentEl.querySelector(".emby-mb-search-button")) return;

    var searchLinkContainer = document.createElement("div");
    searchLinkContainer.style.display = "inline-block";
    searchLinkContainer.style.marginLeft = "10px";

    var searchLink = document.createElement("a");
    searchLink.classList.add("emby-mb-search-button");

    searchLink.style.backgroundImage = "url('https://cdn.jsdelivr.net/gh/Druidblack/MusicBrainz-UserScripts@main/add/search2.png')";
    searchLink.style.backgroundSize = "contain";
    searchLink.style.backgroundRepeat = "no-repeat";
    searchLink.style.backgroundPosition = "center";
    searchLink.style.width = "40px";
    searchLink.style.height = "40px";
    searchLink.style.display = "inline-block";
    searchLink.style.border = "none";
    searchLink.style.cursor = "pointer";
    searchLink.style.transition = "opacity 0.3s ease";

    searchLink.setAttribute("href", "https://musicbrainz.org/search?query=" + encodeURIComponent(album) + "&type=release");
    searchLink.setAttribute("target", "_blank");

    searchLink.addEventListener("mouseover", function() {
      searchLink.style.backgroundImage = "url('https://cdn.jsdelivr.net/gh/Druidblack/MusicBrainz-UserScripts@main/add/search.png')";
    });
    searchLink.addEventListener("mouseout", function() {
      searchLink.style.backgroundImage = "url('https://cdn.jsdelivr.net/gh/Druidblack/MusicBrainz-UserScripts@main/add/search2.png')";
    });

    searchLinkContainer.appendChild(searchLink);
    parentEl.appendChild(searchLinkContainer);
  }

  // --- Кнопка получения ссылки на изображение (Get Image URL) ---
  function addImageLinkButton(parentEl) {
    if (parentEl.querySelector(".emby-mb-image-button")) return;
    var imageLinkContainer = document.createElement("div");
    imageLinkContainer.style.display = "inline-block";
    imageLinkContainer.style.marginLeft = "10px";

    var imageButton = document.createElement("button");
    imageButton.classList.add("emby-mb-image-button");

    imageButton.style.backgroundImage = "url('https://cdn.jsdelivr.net/gh/Druidblack/MusicBrainz-UserScripts@main/add/foto2.png')";
    imageButton.style.backgroundSize = "contain";
    imageButton.style.backgroundRepeat = "no-repeat";
    imageButton.style.backgroundPosition = "center";
    imageButton.style.backgroundColor = "transparent";
    imageButton.style.border = "none";
    imageButton.style.width = "40px";
    imageButton.style.height = "40px";
    imageButton.style.cursor = "pointer";
    imageButton.style.transition = "opacity 0.3s ease";

    imageButton.addEventListener("mouseover", function() {
      imageButton.style.backgroundImage = "url('https://cdn.jsdelivr.net/gh/Druidblack/MusicBrainz-UserScripts@main/add/foto.png')";
    });
    imageButton.addEventListener("mouseout", function() {
      imageButton.style.backgroundImage = "url('https://cdn.jsdelivr.net/gh/Druidblack/MusicBrainz-UserScripts@main/add/foto2.png')";
    });

    imageButton.addEventListener("click", function() {
      var newLink = createImageLink();
      if (newLink) {
        window.open(newLink, "_blank");
      } else {
        alert("Не удалось извлечь нужные данные для формирования ссылки.");
      }
    });

    imageLinkContainer.appendChild(imageButton);
    parentEl.appendChild(imageLinkContainer);
  }

  // --- Функция извлечения itemId и etag для формирования ссылки на изображение ---
  function createImageLink() {
    var container = myJQ("div.cardScalable div.cardImageContainer.coveredImage");
    if (!container.length) return null;
    var styleAttr = container.attr("style");
    if (!styleAttr) return null;

    var urlMatch = styleAttr.match(/url\((?:'|")?([^'")]+)(?:'|")?\)/);
    if (!urlMatch || urlMatch.length < 2) return null;
    var extractedUrl = urlMatch[1];

    var itemId = "";
    var itemsIndex = extractedUrl.indexOf("/Items/");
    if (itemsIndex !== -1) {
      var start = itemsIndex + "/Items/".length;
      var end = extractedUrl.indexOf("/", start);
      if (end !== -1) {
        itemId = extractedUrl.substring(start, end);
      }
    }

    var etagMatch = extractedUrl.match(/[?&]tag=([^&]+)/);
    var etag = etagMatch ? etagMatch[1] : "";

    if (!itemId || !etag) return null;

    return "http://" + serverAddress + "/Items/" + itemId + "/Images/Primary?tag=" + etag + "&api_key=" + apiKey;
  }

  // --- Функция преобразования строки "М:СС" в миллисекунды ---
  function parseDuration(durationStr) {
    var parts = durationStr.split(":");
    if (parts.length !== 2) return 0;
    var minutes = parseInt(parts[0], 10);
    var seconds = parseInt(parts[1], 10);
    return ((minutes * 60) + seconds) * 1000;
  }

  // --- Функция добавления скрытых полей в форму ---
  function add_field(name, value) {
    var field = document.createElement("input");
    field.type = "hidden";
    field.name = name;
    field.value = value;
    myform.appendChild(field);
  }

  // --- Отслеживание изменения "id" в hash URL (каждую секунду) ---
  function getDetailsId() {
    var hash = window.location.hash;
    var m = hash.match(/\/details\?id=([^&]+)/);
    return m ? m[1] : "";
  }
  currentDetailsId = getDetailsId();
  setInterval(function(){
    var newId = getDetailsId();
    if(newId !== currentDetailsId) {
      currentDetailsId = newId;
      run();
    }
  }, 1000);
})();
