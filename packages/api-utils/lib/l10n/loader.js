/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
"use strict";

const { Cc, Ci } = require("chrome");
const { getPreferedLocales, findClosestLocale } = require("api-utils/l10n/locale");
const { defer } = require("api-utils/promise");

// Get URI for the addon root folder:
const { rootURI } = require("@loader/options");

// Global variable that will be set during the call to `load` method
let data = null;

exports.data = function getData() {
  return data;
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
function getBestLocale() {
  // Read localization manifest file that contains list of available languages
  return getAvailableLocales().then(function (availableLocales) {
    // Retrieve list of prefered locales to use
    let preferedLocales = getPreferedLocales();

    // Compute the most preferable locale to use by using these two lists
    return findClosestLocale(availableLocales, preferedLocales);
  });
}

exports.load = function load() {
  // First, search for a locale file:
  return getBestLocale().then(function (bestMatchingLocale) {
    // It may be null if the addon doesn't have any locale file
    if (!bestMatchingLocale)
      throw Error("Unable to find any usable locale file");

    let localeURI = rootURI + "locale/" + bestMatchingLocale + ".json";

    // Locale files only contains one big JSON object that is used as
    // an hashtable of: "key to translate" => "translated key"
    // TODO: We are likely to change this in order to be able to overload
    //       a specific key translation. For a specific package, module or line?
    return readJsonUri(localeURI).then(function (json) {
      data = {
        hash: json,
        bestMatchingLocale: bestMatchingLocale
      };
    });
  });
}
