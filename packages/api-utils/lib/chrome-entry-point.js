const { Cu } = require("chrome");

// This is the main entry-point: bootstrap.js calls this when the add-on is
// installed. The order of calls is a bit confusing, but here's what
// happens (in temporal order):
// * process.spawn creates a new XUL 'browser' element which will house the
//   main addon code. When e10s is active, this uses a real separate OS
//   process. When e10s is disabled, this element lives in the one original
//   process. Either way, its API is the same.
// * Grab the channel named "require!" and attach a handler which will load
//   modules (in the chrome process) when requested to by the addon
//   process. This handler uses Loader.require to import the module, then
//   calls the module's .initialize() function to connect a new channel.
//   The remote caller winds up with a channel reference, which they can
//   use to send messages to the newly loaded module. This is for e10s.
// * After the channel handler is attached, process.process() (invoked by
//   process.spawn()) will use loadScript() to evaluate code in the
//   'browser' element (which is where the main addon code starts running),
//   to do the following:
//   * create a Loader, initialized with the same manifest and
//     harness-options.json that we've got
//   * invoke it's main() method, with the name and path of the addon's
//     entry module (which comes from linker via harness-options.js, and is
//     usually main.js). That executes main(), above.
//   * main() loads the addon's main.js, which executes all top-level
//     forms. If the module defines an "exports.main=" function, we invoke
//     that too. This is where the addon finally gets to run.
exports.main = function main(loader, id, path) {
  let process = require('api-utils/process');
  process.spawn(id, path)(function(addon) {
    // Listen to `require!` channel's input messages from the add-on process
    // and load modules being required.
    addon.channel('require!').input(function({ requirer: { path }, id }) {
      try {
        loader.prototype.require.call(loader, path, id).initialize(addon.channel(id));
      } catch (error) {
        loader.globals.console.exception(error);
      }
    });
  });
}

exports.unload = function unload(reason) {
  // If add-on is lunched via `cfx run` we need to use `system.exit` to let
  // cfx know we're done (`cfx test` will take care of exit so we don't do
  // anything here).
  let system = require('api-utils/system');
  if (system.env.CFX_COMMAND === 'run' && reason === 'shutdown')
    system.exit(0);
}
