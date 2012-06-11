/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
"use strict";

const { Cc, Ci } = require("chrome");
const { getPreferedLocales, findClosestLocale } = require("api-utils/l10n/locale");
const { defer } = require("api-utils/promise");

// Get URI for the addon root folder:
const { rootURI } = require("@loader/options");

// Two global objects initialized during `init()` call:
// A dictionnary which maps keys to translate into translated strings
let globalHash = {};
// A string for the selected locale, like "ja-JP-mac"
let bestMatchingLocale = null;

exports.get = function get(k) {
  return k in globalHash ? globalHash[k] : null;
}

// Returns the full length locale code: ja-JP-mac, en-US or fr
exports.locale = function locale() {
  return bestMatchingLocale;
}
// Returns the short locale code: ja, en, fr
exports.language = function language() {
  return bestMatchingLocale
         ? bestMatchingLocale.split("-")[0].toLowerCase()
         : null;
}

function readURI(uri) {
  let { promise, resolve, reject } = defer();

  let request = Cc["@mozilla.org/xmlextras/xmlhttprequest;1"].
                createInstance(Ci.nsIXMLHttpRequest);
  request.open('GET', uri, true);
  request.overrideMimeType('text/plain');
  request.onload = function () {
    resolve(request.responseText);
  }
  request.onerror = function () {
    reject("Failed to read: " + uri + " (status: " + request.status + ")");
  }
  request.send();

  return promise;
}

function readJsonUri(uri) {
  return readURI(uri).then(function (content) {
    try {
      return JSON.parse(content);
    }
    catch(e) {
      throw Error("Error while reading locale file:\n" + uri + "\n" + e);
    }
  });
}

// Returns the array stored in `locales.json` manifest that list available
// locales files
function getAvailableLocales() {
  let uri = rootURI + "locales.json";
  return readJsonUri(uri).then(function (manifest) {
    return "locales" in manifest &&
           Array.isArray(manifest.locales) ?
           manifest.locales : [];
  });
}

// Returns URI of the best locales file to use from the XPI
function getBestLocaleFile() {
  // Read localization manifest file that contains list of available languages
  return getAvailableLocales().then(function (availableLocales) {
    // Retrieve list of prefered locales to use
    let preferedLocales = getPreferedLocales();

    // Compute the most preferable locale to use by using these two lists
    bestMatchingLocale = findClosestLocale(availableLocales, preferedLocales);

    // It may be null if the addon doesn't have any locale file
    if (!bestMatchingLocale)
      return null;

    let localeURI = rootURI + "locale/" + bestMatchingLocale + ".json";
    return localeURI;
  });

}

exports.init = function init() {
  // First, search for a locale file:
  return getBestLocaleFile().then(function (localeURI) {
    if (!localeURI)
      throw Error("Unable to find any usable locale file");

    // Locale files only contains one big JSON object that is used as
    // an hashtable of: "key to translate" => "translated key"
    // TODO: We are likely to change this in order to be able to overload
    //       a specific key translation. For a specific package, module or line?
    return readJsonUri(localeURI).then(function (json) {
      globalHash = json;
    });
  });
}
