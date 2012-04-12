const { Cu } = require("chrome");

// This is the main entry-point: bootstrap.js calls this when the add-on is
// installed.
//   * main() loads the addon's main.js, which executes all top-level
//     forms. If the module defines an "exports.main=" function, we invoke
//     that too. This is where the addon finally gets to run.
exports.main = function main(loader, id, path) {
  try {
    let program = loader._require(id, path).exports;

    if (typeof(program.onUnload) === 'function')
      require('api-utils/unload').when(program.onUnload);

    if (program.main) {
      let { exit, staticArgs } = require('api-utils/system');
      let { loadReason } = require('@packaging');
      program.main({ loadReason: loadReason, staticArgs: staticArgs },
                   { print: function($) dump($ + '\n'), quit: exit });
    }
  } catch (error) {
    Cu.reportError(error);
    if (loader.globals.console) loader.globals.console.exception(error);
    throw error;
  }
}

exports.unload = function unload(reason) {
  // If add-on is lunched via `cfx run` we need to use `system.exit` to let
  // cfx know we're done (`cfx test` will take care of exit so we don't do
  // anything here).
  let system = require('api-utils/system');
  if (system.env.CFX_COMMAND === 'run' && reason === 'shutdown')
    system.exit(0);
}
