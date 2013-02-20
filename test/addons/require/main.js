﻿/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
"use strict";

exports["test local vs sdk module"] = function (assert) {
  assert.notEqual(require("memory"),
                  require("api-utils/memory"),
                  "Local module takes the priority over sdk modules");
  assert.ok(require("memory").local,
            "this module is really the local one");
}

exports["test 3rd party vs sdk module"] = function (assert) {
  // We are testing with a 3rd party package called `panel` with 3 modules
  // main, page-mod and third-party

  // the only way to require 3rd party package modules are to use absolute paths
  // require("panel/main"), require("panel/page-mod"),
  // require("panel/third-party") and also require("panel") which will refer
  // to panel's main package module.

  // So require(page-mod) shouldn't map the 3rd party
  assert.equal(require("page-mod"),
               require("addon-kit/page-mod"),
               "Third party modules don't overload sdk modules");
  assert.ok(require("page-mod").PageMod,
            "page-mod module is really the sdk one");

  assert.equal(require("panel/page-mod").id, "page-mod",
               "panel/page-mod is the 3rd party");

  // But require(panel) will map to 3rd party main module
  // *and* overload the sdk module
  // and also any local module with the same name
  assert.equal(require("panel").id, "panel-main",
               "Third party main module overload sdk modules");
  assert.equal(require("panel"),
               require("panel/main"),
               "require(panel) maps to require(panel/main)");
  // So that you have to use relative path to ensure getting the local module
  assert.equal(require("./panel").id,
               "local-panel",
               "require(./panel) maps to the local module");

  // It should still be possible to require sdk module with absolute path
  assert.ok(require("addon-kit/panel").Panel,
            "We can bypass this overloading with absolute path to sdk modules");
  assert.equal(require("addon-kit/panel"),
               require("addon-kit/panel"),
               "Old and new layout both work");
}


for each (var f in exports) {
  f({
    ok: function (a, b) {
      if (!a)
        console.log("ok:"+(a)+" -- "+b);
    },
    equal: function (a, b, c) {
      if (a!=b)
        console.log("equal:"+(a==b)+" -- "+c);
    },
    notEqual: function (a, b, c) {
      if (a==b)
        console.log("notEqual:"+(a!=b)+" -- "+c);
    }
  });
}
console.log("all tests executed");
