const { contextBridge, ipcRenderer } = require('electron');

// contextIsolation:true means the renderer has no Node/Electron access at
// all unless it's explicitly bridged here -- this is the only surface the
// desktop app's UI (ui.js/auth-ui.js) gets to tell it's running in Electron
// and to ask the main process to quit.
contextBridge.exposeInMainWorld('electronAPI', {
  quitApp: function () { ipcRenderer.send('quit-app'); },
  checkForUpdates: function () { ipcRenderer.send('check-for-updates'); },
  installUpdate: function () { ipcRenderer.send('install-update'); },
  onUpdateStatus: function (callback) {
    ipcRenderer.on('update-status', function (event, data) { callback(data); });
  },
  // Mac builds aren't code-signed with a paid Developer ID, so Squirrel.Mac's
  // signature check on the downloaded update silently fails -- quitAndInstall
  // never quits the app and there's no JS-visible error to react to (see
  // electron/main.js). Renderer uses this to show a manual-install fallback
  // (open the Releases page) instead of a "reiniciar" button that does
  // nothing on Mac.
  platform: process.platform,
  openReleasesPage: function () { ipcRenderer.send('open-releases-page'); },
  // Real reported bug: the footer's version label was a hand-typed literal
  // in index.html ("V1.0") that never actually matched the shipped build.
  // A first attempt at this fix used require('../package.json') right here,
  // which broke EVERYTHING in this file, not just the version -- Electron's
  // sandboxed preload context (the default since nodeIntegration:false,
  // electron/main.js) only allows requiring built-in modules like 'electron'
  // itself, not arbitrary app files; that require() threw while this object
  // literal was still being built, before contextBridge.exposeInMainWorld
  // below ever ran, so window.electronAPI came out fully undefined --
  // quitApp/checkForUpdates/appVersion all silently gone at once. Reading
  // the version from the main process (which has full Node access) over
  // the same synchronous-IPC pattern real world, sandboxed preloads use
  // avoids that entirely.
  appVersion: ipcRenderer.sendSync('get-app-version')
});
