/* -*- Mode: Java; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim:set ts=2 sw=2 sts=2 et: */
/* ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1/GPL 2.0/LGPL 2.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is Jetpack Packages.
 *
 * The Initial Developer of the Original Code is Nickolay Ponomarev.
 * Portions created by the Initial Developer are Copyright (C) 2010
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *   Nickolay Ponomarev <asqueella@gmail.com> (Original Author)
 *   Irakli Gozalishvili <gozala@mozilla.com>
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either the GNU General Public License Version 2 or later (the "GPL"), or
 * the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 * in which case the provisions of the GPL or the LGPL are applicable instead
 * of those above. If you wish to allow use of your version of this file only
 * under the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the MPL, indicate your
 * decision by deleting the provisions above and replace them with the notice
 * and other provisions required by the GPL or the LGPL. If you do not delete
 * the provisions above, a recipient may use your version of this file under
 * the terms of any one of the MPL, the GPL or the LGPL.
 *
 * ***** END LICENSE BLOCK ***** */
"use strict";

const { Worker, Loader } = require('api-utils/content');
const { EventEmitter } = require('api-utils/events');
const { List } = require('api-utils/list');
const { Registry } = require('api-utils/utils/registry');
const xulApp = require("api-utils/xul-app");
const { MatchPattern } = require('api-utils/match-pattern');

// Whether or not the host application dispatches a document-element-inserted
// notification when the document element is inserted into the DOM of a page.
// The notification was added in Gecko 2.0b6, it's a better time to attach
// scripts with contentScriptWhen "start" than content-document-global-created,
// since libraries like jQuery assume the presence of the document element.
const HAS_DOCUMENT_ELEMENT_INSERTED =
        xulApp.versionInRange(xulApp.platformVersion, "2.0b6", "*");
const ON_CONTENT = HAS_DOCUMENT_ELEMENT_INSERTED ? 'document-element-inserted' :
                   'content-document-global-created';

// Workaround bug 642145: document-element-inserted is fired multiple times.
// This bug is fixed in Firefox 4.0.1, but we want to keep FF 4.0 compatibility
// Tracking bug 641457. To be removed when 4.0 has disappeared from earth.
const HAS_BUG_642145_FIXED = require("api-utils/xul-app").is("Fennec") ||
        xulApp.versionInRange(xulApp.platformVersion, "2.0.1", "*");

// rules registry
const RULES = {};

const Rules = EventEmitter.resolve({ toString: null }).compose(List, {
  add: function() Array.slice(arguments).forEach(function onAdd(rule) {
    if (this._has(rule))
      return;
    // registering rule to the rules registry
    if (!(rule in RULES))
      RULES[rule] = new MatchPattern(rule);
    this._add(rule);
    this._emit('add', rule);
  }.bind(this)),
  remove: function() Array.slice(arguments).forEach(function onRemove(rule) {
    if (!this._has(rule))
      return;
    this._remove(rule);
    this._emit('remove', rule);
  }.bind(this)),
});

/**
 * PageMod constructor (exported below).
 * @constructor
 */
const PageMod = Loader.compose(EventEmitter, {
  on: EventEmitter.required,
  _listeners: EventEmitter.required,
  contentScript: Loader.required,
  contentScriptFile: Loader.required,
  contentScriptWhen: Loader.required,
  include: null,
  constructor: function PageMod(options) {
    this._onContent = this._onContent.bind(this);
    options = options || {};

    if ('contentScript' in options)
      this.contentScript = options.contentScript;
    if ('contentScriptFile' in options)
      this.contentScriptFile = options.contentScriptFile;
    if ('contentScriptWhen' in options)
      this.contentScriptWhen = options.contentScriptWhen;
    if ('onAttach' in options)
      this.on('attach', options.onAttach);
    if ('onError' in options)
      this.on('error', options.onError);

    let include = options.include;
    let rules = this.include = Rules();
    rules.on('add', this._onRuleAdd = this._onRuleAdd.bind(this));
    rules.on('remove', this._onRuleRemove = this._onRuleRemove.bind(this));

    if (Array.isArray(include))
      rules.add.apply(null, include);
    else
      rules.add(include);

    this.on('error', this._onUncaughtError = this._onUncaughtError.bind(this));
    pageModManager.add(this);

    this._loadingWindows = [];
  },

  destroy: function destroy() {
    for each (let rule in this.include)
      this.include.remove(rule);
    pageModManager.remove(this);
    this._loadingWindows = [];
  },

  _loadingWindows: [],

  _onContent: function _onContent(window) {
    // not registered yet
    if (!pageModManager.has(this))
      return;

    if (require("api-utils/xul-app").is("Fennec")) {
      this._createWorker(window);
      return;
    }
    if (!HAS_BUG_642145_FIXED) {
      if (this._loadingWindows.indexOf(window) != -1)
        return;
      this._loadingWindows.push(window);
    }

    if ('start' == this.contentScriptWhen) {
      this._createWorker(window);
      return;
    }

    let eventName = 'end' == this.contentScriptWhen ? 'load' : 'DOMContentLoaded';
    let self = this;
    window.addEventListener(eventName, function onReady(event) {
      if (event.target.defaultView != window)
        return;
      window.removeEventListener(eventName, onReady, true);

      self._createWorker(window);
    }, true);
  },
  _createWorker: function _createWorker(window) {
    let worker = Worker({
      window: window,
      contentScript: this.contentScript,
      contentScriptFile: this.contentScriptFile,
      contentScriptWhen: this.contentScriptWhen,
      onError: this._onUncaughtError
    });
    this._emit('attach', worker);
    let self = this;
    worker.once('detach', function detach() {
      worker.destroy();

      if (!HAS_BUG_642145_FIXED) {
        let idx = self._loadingWindows.indexOf(window);
        if (idx != -1)
          self._loadingWindows.splice(idx, 1);
      }
    });
  },
  _onRuleAdd: function _onRuleAdd(url) {
    pageModManager.on(url, this._onContent);
  },
  _onRuleRemove: function _onRuleRemove(url) {
    pageModManager.off(url, this._onContent);
  },
  _onUncaughtError: function _onUncaughtError(e) {
    if (this._listeners('error').length == 1)
      console.exception(e);
  }
});
exports.PageMod = function(options) PageMod(options)
exports.PageMod.prototype = PageMod.prototype;

let PageModManager = null;
if (require("api-utils/xul-app").is("Firefox")) {
  const observers = require("api-utils/observer-service");

  PageModManager = Registry.resolve({
    constructor: '_init',
    _destructor: '_registryDestructor'
  }).compose({
    constructor: function PageModRegistry(constructor) {
      this._init(PageMod);
      observers.add(
        ON_CONTENT, this._onContentWindow = this._onContentWindow.bind(this)
      );
    },
    _destructor: function _destructor() {
      observers.remove(ON_CONTENT, this._onContentWindow);
      for (let rule in RULES) {
        this._removeAllListeners(rule);
        delete RULES[rule];
      }
      this._registryDestructor();
    },
    _onContentWindow: function _onContentWindow(domObj) {
      let window = HAS_DOCUMENT_ELEMENT_INSERTED ? domObj.defaultView : domObj;
      // XML documents don't have windows, and we don't yet support them.
      if (!window)
        return;
      for (let rule in RULES)
        if (RULES[rule].test(window.document.URL))
          this._emit(rule, window);
    },
    off: function off(topic, listener) {
      this.removeListener(topic, listener);
      if (!this._listeners(topic).length)
        delete RULES[topic];
    }
  });

}
else if (require("api-utils/xul-app").is("Fennec")) {
  let { Cc, Ci } = require("chrome");

  let globalMM = Cc["@mozilla.org/globalmessagemanager;1"].getService(
                   Ci.nsIChromeFrameMessageManager);

  globalMM.loadFrameScript("data:text/javascript,new " + function FrameScope() {
    sendAsyncMessage("new-tab");
    
    let Cc = Components.classes;
    let Ci = Components.interfaces;
    let Cu = Components.utils;

    let WorkerURL = null;
    function runPageMod(mod) {
      let loader = Cc["@mozilla.org/moz/jssubscript-loader;1"].
                   getService(Ci.mozIJSSubScriptLoader);
      let scope = {};
      let listeners = {};
      scope.Pipe = {
        on: function (name, listener) {
          listeners[name] = listener;
          Cu.reportError("register: "+name);
        },
        emit: function (name, v) {
          if (name == "dump")
            Cu.reportError("dump: "+v);
          else
            Cu.reportError("emit: "+name);
          
        }
      };
      Cu.reportError("WorkerURL: <"+WorkerURL+">"+typeof WorkerURL);
      loader.loadSubScript(WorkerURL, scope);
      listeners["create-worker"](mod);
      Cu.reportError("WorkerURL OK");
      
    }
    
    let ios = Cc['@mozilla.org/network/io-service;1']
          .getService(Ci.nsIIOService);
    function MatchPattern(pattern) {
      if (typeof pattern.test == "function") {

        // For compatibility with -moz-document rules, we require the RegExp's
        // global, ignoreCase, and multiline flags to be set to false.
        if (pattern.global) {
          throw new Error("A RegExp match pattern cannot be set to `global` " +
                          "(i.e. //g).");
        }
        if (pattern.ignoreCase) {
          throw new Error("A RegExp match pattern cannot be set to `ignoreCase` " +
                          "(i.e. //i).");
        }
        if (pattern.multiline) {
          throw new Error("A RegExp match pattern cannot be set to `multiline` " +
                          "(i.e. //m).");
        }

        this.regexp = pattern;
      }
      else {
        let firstWildcardPosition = pattern.indexOf("*");
        let lastWildcardPosition = pattern.lastIndexOf("*");
        if (firstWildcardPosition != lastWildcardPosition)
          throw new Error("There can be at most one '*' character in a wildcard.");

        if (firstWildcardPosition == 0) {
          if (pattern.length == 1)
            this.anyWebPage = true;
          else if (pattern[1] != ".")
            throw new Error("Expected a *.<domain name> string, got: " + pattern);
          else
            this.domain = pattern.substr(2);
        }
        else {
          if (pattern.indexOf(":") == -1) {
            throw new Error("When not using *.example.org wildcard, the string " +
                            "supplied is expected to be either an exact URL to " +
                            "match or a URL prefix. The provided string ('" +
                            pattern + "') is unlikely to match any pages.");
          }

          if (firstWildcardPosition == -1)
            this.exactURL = pattern;
          else if (firstWildcardPosition == pattern.length - 1)
            this.urlPrefix = pattern.substr(0, pattern.length - 1);
          else {
            throw new Error("The provided wildcard ('" + pattern + "') has a '*' " +
                            "in an unexpected position. It is expected to be the " +
                            "first or the last character in the wildcard.");
          }
        }
      }
    }
try {
    MatchPattern.prototype = {

      test: function MatchPattern_test(urlStr) {
        try {
          var url = ios.newURI(urlStr, null, null);
        }
        catch (err) {
          return false;
        }

        // Test the URL against a RegExp pattern.  For compatibility with
        // -moz-document rules, we require the RegExp to match the entire URL,
        // so we not only test for a match, we also make sure the matched string
        // is the entire URL string.
        //
        // Assuming most URLs don't match most match patterns, we call `test` for
        // speed when determining whether or not the URL matches, then call `exec`
        // for the small subset that match to make sure the entire URL matches.
        //
        if (this.regexp && this.regexp.test(urlStr) &&
            this.regexp.exec(urlStr)[0] == urlStr)
          return true;

        if (this.anyWebPage && /^(https?|ftp)$/.test(url.scheme))
          return true;
        if (this.exactURL && this.exactURL == urlStr)
          return true;
        if (this.domain && url.host &&
            url.host.slice(-this.domain.length) == this.domain)
          return true;
        if (this.urlPrefix && 0 == urlStr.indexOf(this.urlPrefix))
          return true;

        return false;
      }

    };

    let obsService = Cc["@mozilla.org/observer-service;1"].
                     getService(Ci.nsIObserverService);
    let pageMods = [];
    var observer = {
      observe: function(subject, topic, data) {
        // XML document don't have `defaultView` set
        // (for ex: XBL XML documents)
        if (!subject.defaultView) return;
        try {
        for each(let pageMod in pageMods) {
          let includes = pageMod.include;
          for each (let rule in includes) {
            let pattern = new MatchPattern(rule);
            if (pattern.test(subject.location.href))
              runPageMod(pageMod);
              Cu.reportError("Match: "+subject.location.href);
          }
        }
        } catch(e) {
          Cu.reportError("fs ex: "+e);
        }
      }
    };
    obsService.addObserver(observer, "document-element-inserted", false);
    
    addMessageListener("worker-url", function (msg) {
      WorkerURL = msg.json;
    });
    addMessageListener("add-page-mods", function (msg) {
      pageMods = msg.json;
    });
    addMessageListener("remove-page-mod", function (pageMod) {
      // TODO: very unlikely it works (work only if JSON values passed over sendAsyncMessage keep unicity)
      pageMods.slice(pageMods.indexOf(pageMod), 1);
    });
    Cu.reportError("Frame script evaluated!");
    } catch(e) {
      Cu.reportError("frame ex: "+e);
    }
  }, true);

  let pageMods = [];
  PageModManager = function () {return {
    add: function (pageMod) {
      let includes = [];
      for each(let r in pageMod.include)
        includes.push(r);
      let pm = {
        include: includes,
        contentScriptWhen: pageMod.contentScriptWhen,
        contentScriptFile: Array.isArray(pageMod.contentScriptFile)?pageMod.contentScriptFile:[pageMod.contentScriptFile],
        contentScript: pageMod.contentScript
      };
      pageMods.push(pm);
      console.log("Go register page mod");
    },
    remove: function (pageMod) {
      // TODO: remove pageMod from `pageMods` list
    },
    on: function (url) {},
    off: function () {}
  };}
  
  globalMM.addMessageListener("new-tab", function (msg) {
    msg.target.frameLoader.messageManager.sendAsyncMessage("add-page-mods", pageMods);
    msg.target.frameLoader.messageManager.sendAsyncMessage("worker-url", require("self").data.url("worker.js"));
  });
  

}
else if (require("api-utils/xul-app").is("Fennec")) {
  let { Cc, Ci } = require("chrome");

  let globalMM = Cc["@mozilla.org/globalmessagemanager;1"].getService(
                   Ci.nsIChromeFrameMessageManager);

  PageModManager = Registry.resolve({
    constructor: '_init',
    _destructor: '_registryDestructor'
  }).compose({
    constructor: function PageModRegistry(constructor) {
      this._init(PageMod);
      globalMM.addMessageListener("Content:LocationChange", this);
    },
    _destructor: function _destructor() {
      globalMM.removeMessageListener("Content:LocationChange", this);
      for (let rule in RULES) {
        this._removeAllListeners(rule);
        delete RULES[rule];
      }
      this._registryDestructor();
    },
    receiveMessage: function receiveMessage(msg) {
      let browser = msg.target;
      let json = msg.json;
      let location = json.location;
      for (let rule in RULES)
        if (RULES[rule].test(location))
          this._emit(rule, browser);
    },
    off: function off(topic, listener) {
      this.removeListener(topic, listener);
      if (!this._listeners(topic).length)
        delete RULES[topic];
    }
  });
}
else {
  throw new Error(
    "The page-mod module is currently only compatible with Firefox and Fennec"
  );
}

const pageModManager = PageModManager();
