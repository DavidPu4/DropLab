'use strict';

// The renderer is already bundled and the Node API modules use only built-ins.
// Returning false is electron-builder's supported signal that dependencies are
// handled externally. It also stops collection falling back to the web project.
module.exports = async function bundledDesktopDependencies() { return false; };
