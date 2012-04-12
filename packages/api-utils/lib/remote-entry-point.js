const { Cu } = require("chrome");

// process.process() will eventually cause a call to main() to be evaluated
// in the addon's context. This function loads and executes the addon's
// entry point module.
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

exports.unload = function unload() {
  require('api-utils/unload').send(reason, callback);
}
