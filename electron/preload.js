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
  }
});
