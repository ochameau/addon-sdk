/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */
"use strict";

// This XPCOM components allows to run a sdk addon as a xulrunner application

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cu = Components.utils;

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Services.jsm");

/*
// Give access to nsICommandLine object
// + two methods to control application quit
CommandLine: Object.create(cmdLine, {
  waitBeforeQuitting: { value: function () {
    Services.startup.enterLastWindowClosingSurvivalArea();
  }},
  quit: { value: function () {
    Services.startup.exitLastWindowClosingSurvivalArea();
    Services.startup.quit(Services.startup.eAttemptQuit);
  }}
})
*/

// This method is called by nsICommandLineHandler object defined at EOF
function runApplication(cmdLine) {
  // Enable stdout output
  Services.prefs.setBoolPref("browser.dom.window.dump.enabled", true);

  // Flush startup cache in order to avoid using an old bootstrap.js version
  // Take care that this file (CommandLineHandler.js) is always cached!
  Services.obs.notifyObservers(null, "startupcache-invalidate", null);
  try {
    // Compute various necessary URIs:
    let xreUri = Services.io.newURI("resource://app/", null, null);
    let sdkRoot = xreUri.QueryInterface(Components.interfaces.nsIFileURL).file.parent.parent;
    let sdkRootURI = Services.io.newFileURI(sdkRoot).spec;
    let cfxURI = sdkRootURI + "cfx/";
    let apiutilsURI = sdkRootURI + "packages/api-utils/lib/";
    let loaderURI = apiutilsURI + "loader.js";

    // Loader the module loader
    let Loader = {};
    Cu.import(loaderURI, Loader);

    // Instanciate one instance
    let loader = Loader.Loader({
      main: "./cfx",
      paths: {
        './': cfxURI,
        'api-utils/': apiutilsURI,
        '': apiutilsURI
      },
      resolve: function (id, requirer, base) {
        if (id == "chrome")
          return id;
        if (id[0] == ".")
          return Loader.resolve(id, requirer);
        return id;
      }
    });

    // Inject `console` global
    let module = Loader.Module('api-utils/loader', loaderURI);
    let require = Loader.Require(loader, module);
    loader.globals.console = require('api-utils/globals').console;

    // Execute cfx main module
    Loader.main(loader, "./cfx");

  }
  catch(e) {
    let msg = "Exception while running boostrap.js:\n" + e + "\n" + e.stack;
    dump(msg);
    Cu.reportError(msg);
  }
}

// Register a nsICommandLineHandler xpcom object in order to call
// runApplication method at application startup
function CommandLineHandler() {}
CommandLineHandler.prototype = {
  classID: Components.ID("{537df286-d9ae-4c7a-a633-6266b1325289}"),
  QueryInterface: XPCOMUtils.generateQI([Ci.nsICommandLineHandler]),
  handle: runApplication,
  helpInfo : "",
};

let components = [CommandLineHandler];
let NSGetFactory = XPCOMUtils.generateNSGetFactory(components);
