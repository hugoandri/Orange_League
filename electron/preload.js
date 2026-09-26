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
  // in index.html ("V1.0") that never actually matched the shipped build
  // (1.0.4 at the time this was fixed) -- confusing enough that the user
  // couldn't tell whether an update had actually landed. Read straight from
  // package.json (the same file electron-builder itself reads to name/tag
  // every release) instead of a string someone has to remember to update by
  // hand each release.
  appVersion: require('../package.json').version
});
