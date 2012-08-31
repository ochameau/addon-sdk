/* -*- Mode: Java; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim:set ts=2 sw=2 sts=2 et: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
"use strict";

let { Class } = require('./heritage');
let { EventTarget } = require('./event/target');
let { Namespace } = require('./namespace');
let { enqueue, dequeue, isQueued, queued } = require("./queue");

let ContentScript = Class({
  initialize: function(options) {
    this.options = options.options;
    this.uri = options.uri;
    this.code = options.code;
  }
});

let spawn = Method();

spawn.define(ContentScript, function(script, target) {
  let port = Port();
  let options = this.options;
  let window = ownedDocument(target).defaultView;
  let proto = window;

  // Instantiate trusted code in another Sandbox in order to prevent content
  // script from messing with standard classes used by proxy and API code.
  let apiSandbox = sandbox(window, { wantXrays: true });
  
  // Build content proxies only if the document has a non-system principal
  if (XPCNativeWrapper.unwrap(window) !== window) {
    apiSanbox.console = console;
    // Execute the proxy code
    load(apiSanbox, CONTENT_PROXY_URL);
    // Get a reference of the window's proxy
    proto = apiSanbox.create(window);
  }

  // Create the sandbox and bind it to window in order for content scripts to
  // have access to all standard globals (window, document, ...)
  let worker = sandbox(window, {
    sandboxPrototype: proto,
    wantXrays: true
  });
  merge(script, {
    // We need "this === window === top" to be true in top level scope:
    get window() { return script },
    get top() { return script },
    // Use the Greasemonkey naming convention to provide access to the
    // unwrapped window object so the content script can access document
    // JavaScript values.
    // NOTE: this functionality is experimental and may change or go away
    // at any time!
    get unsafeWindow() { return window.wrappedJSObject }
  });

  // Load trusted code that will inject content script API.
  // We need to expose JS objects defined in same principal in order to
  // avoid having any kind of wrapper.
  load(apiSanbox, CONTENT_WORKER_URL);

  let onEvent = function(type, message) {
    emit(port, message);
  };

  apiSandbox.ContentWorker.inject(worker, chromeAPI,
                                  onEvent, options);
  on(port, "console", function(kind) {
    console[kind].apply(console, Array.slice(arguments, 1));
  });

  script.urls.forEach(function(url) {
    load(worker, url);
  });
});