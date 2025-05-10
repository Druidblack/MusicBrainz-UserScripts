# MusicBrainz-UserScripts
Collection of my MusicBrainz Userscripts

# Collection of userscripts for MusicBrainz.

[community.metabrainz.org](https://community.metabrainz.org/t/a-new-musicbrainz-user-script-was-released/77897)

[MB wiki External Resources](http://wiki.musicbrainz.org/External_Resources#User_scripts_.2F_GreaseMonkey_.2F_User_javascripts_.2F_UserJS)

## Installing

To use these userscripts, you need a userscript add-on or extension such as [Tampermonkey](https://www.tampermonkey.net/), [Violentmonkey](https://violentmonkey.github.io/), or [Greasemonkey](https://addons.mozilla.org/en-GB/firefox/addon/greasemonkey/) installed in your browser. More information can be found [here](https://stackapps.com/tags/script/info), [here](https://openuserjs.org/about/Userscript-Beginners-HOWTO), or [here](https://userscripts-mirror.org/about/installing.html).

## Import YandexMusic album into MusicBrainz
![yandexbrainz](https://github.com/Druidblack/MusicBrainz-UserScripts/blob/main/add/yandexbrainz.png)

## Import YandexMusic album into MusicBrainz (new design)

![yandexbrainz album](https://github.com/Druidblack/MusicBrainz-UserScripts/blob/main/add/yandex%20album%20new%20design.jpg)
![yandexbrainz artist](https://github.com/Druidblack/MusicBrainz-UserScripts/blob/main/add/yandex%20artist%20new%20design.jpg)
![yandexbrainz book](https://github.com/Druidblack/MusicBrainz-UserScripts/blob/main/add/yandex%20book%20new%20design.jpg)

One-click importing of album from music.yandex.ru into MusicBrainz

[![Source](https://github.com/Druidblack/MusicBrainz-UserScripts/blob/main/add/Source-button.png)](https://github.com/Druidblack/MusicBrainz-UserScripts/blob/main/new_yandexmusic_import_album.user.js)
[![Install](https://github.com/Druidblack/MusicBrainz-UserScripts/blob/main/add/Install-button.png)](https://github.com/Druidblack/MusicBrainz-UserScripts/raw/main/new_yandexmusic_import_album.user.js)

## Import YandexMusic album into MusicBrainz (old design)

![yandexbrainz album](https://github.com/Druidblack/MusicBrainz-UserScripts/blob/main/add/yandex%20_album.jpg)
![yandexbrainz artist](https://github.com/Druidblack/MusicBrainz-UserScripts/blob/main/add/yandex%20artist.jpg)
![yandexbrainz book](https://github.com/Druidblack/MusicBrainz-UserScripts/blob/main/add/book.jpg)

One-click importing of album from music.yandex.ru into MusicBrainz

[![Source](https://github.com/Druidblack/MusicBrainz-UserScripts/blob/main/add/Source-button.png)](https://github.com/Druidblack/MusicBrainz-UserScripts/blob/main/yandexmusic_import_album.user.js)
[![Install](https://github.com/Druidblack/MusicBrainz-UserScripts/blob/main/add/Install-button.png)](https://github.com/Druidblack/MusicBrainz-UserScripts/raw/main/yandexmusic_import_album.user.js)

## Jellyfin MusicBrainz Import
![jellybrainz](https://github.com/Druidblack/MusicBrainz-UserScripts/blob/main/add/JellyBrainz_Logo.png)

![jellybrainz album](https://github.com/Druidblack/MusicBrainz-UserScripts/blob/main/add/jf_album.jpg)

One-click importing of album from Jellyfin into MusicBrainz

This script requires configuring both the script and the program with which it will work.

If your jellyfin port differs from the standard one (8096). Then in the line 

// @include http://*:8096/web/*

change the port to your own.
In addition to importing data and searching for an album, the script can extract the maximum acceptable quality cover that is stored in jellyfin. (For example, to upload it later as an album cover on the website musicbrainz.org)
In order for this button to work correctly, you need to specify the application address and API key in the variables.

**var apiKey = "ea5497543aa047c798117642bc4161ce"**

**var serverAddress = "192.168.1.161:8096"**

Also, in a program (for example, Tampermonkey), you need to disable the BlackCheck, since the script works with a local address.

**If the script buttons do not appear, you need to reload the page.**

P.S. If you use the plugin to map your music to [apple music](https://repo.xkrivo.net/jellyfin/manifest.json), the script can send the mapped link as the source.

![blackcheck](https://github.com/Druidblack/MusicBrainz-UserScripts/blob/main/add/blackcheck.jpg)

One-click importing of album from Jellyfin into MusicBrainz

[![Source](https://github.com/Druidblack/MusicBrainz-UserScripts/blob/main/add/Source-button.png)](https://github.com/Druidblack/MusicBrainz-UserScripts/blob/main/jellyfin_import_album.user.js)
[![Install](https://github.com/Druidblack/MusicBrainz-UserScripts/blob/main/add/Install-button.png)](https://github.com/Druidblack/MusicBrainz-UserScripts/raw/main/jellyfin_import_album.user.js)


## MusicBrainz Join Phrase Filler for Album and Tracklist  (This script is no longer needed for my scripts for jellyfin and Yandex Music to work).

![Phrase](https://github.com/Druidblack/MusicBrainz-UserScripts/blob/main/add/Join%20Phrase.jpg)

A script that fills in the Join phrase fields if there are several authors of an album or track. The script automatically places commas or &, depending on the situation (the number of performers).

[![Source](https://github.com/Druidblack/MusicBrainz-UserScripts/blob/main/add/Source-button.png)](https://github.com/Druidblack/MusicBrainz-UserScripts/blob/main/join_phrase.user.js)
[![Install](https://github.com/Druidblack/MusicBrainz-UserScripts/blob/main/add/Install-button.png)](https://github.com/Druidblack/MusicBrainz-UserScripts/raw/main/join_phrase.user.js)
