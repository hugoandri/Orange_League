const { app, BrowserWindow, shell, ipcMain } = require('electron');
const path = require('path');
const { autoUpdater } = require('electron-updater');

// Only quitAndInstall() runs automatically -- the user must confirm first
// (see 'install-update' below and the renderer's updateConfirmModal), so a
// download finishing must never install itself just because the app quits
// in the meantime.
autoUpdater.autoInstallOnAppQuit = false;

let mainWindow = null;

function sendUpdateStatus(status, extra) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-status', Object.assign({ status: status }, extra || {}));
  }
}

autoUpdater.on('checking-for-update', function () { sendUpdateStatus('checking'); });
autoUpdater.on('update-available', function (info) { sendUpdateStatus('available', { version: info.version }); });
autoUpdater.on('update-not-available', function () { sendUpdateStatus('not-available'); });
autoUpdater.on('download-progress', function (progress) { sendUpdateStatus('downloading', { percent: progress.percent }); });
autoUpdater.on('update-downloaded', function () { sendUpdateStatus('downloaded'); });
autoUpdater.on('error', function (err) {
  sendUpdateStatus('error', { message: (err && err.message) || 'Error desconocido' });
});

ipcMain.on('check-for-updates', function () {
  autoUpdater.checkForUpdates().catch(function (err) {
    sendUpdateStatus('error', { message: (err && err.message) || 'Error desconocido' });
  });
});
// Only reached after the user confirms in updateConfirmModal -- quits and
// replaces the app with the already-downloaded version.
ipcMain.on('install-update', function () { autoUpdater.quitAndInstall(); });
// Mac fallback when the app can't self-install (see preload.js's comment) --
// opens the release the update-checker already found, so the player can grab
// the DMG by hand instead of the app silently doing nothing.
ipcMain.on('open-releases-page', function () {
  shell.openExternal('https://github.com/hugoandri/Orange_League/releases/latest');
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'Orange League',
    // Without this, macOS only uses the window's first click to bring it to
    // the foreground -- it does NOT reach the web content, so a user who
    // opens the app and immediately clicks a field (e.g. the signup form)
    // then types gets nothing: that first click never actually focused the
    // input. Needed on every launch since a freshly opened window is never
    // already focused.
    acceptsFirstMouse: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js')
    }
  });
  mainWindow = win;
  win.on('closed', function () { mainWindow = null; });
  win.loadFile(path.join(__dirname, '..', 'index.html'));

  // Real-money purchase links (Telegram/Discord/Orbes-with-Stars) use
  // target="_blank" / window.open expecting the user's actual system
  // browser -- without this, Electron's default is to open a new
  // chrome-less BrowserWindow with no address bar, which also lets the
  // app navigate off file:// to an arbitrary remote origin.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });
}

// Renderer-side "SALIR" button (see electron/preload.js) -- quits the whole
// app, distinct from the game's own "CERRAR SESIÓN" which just signs out.
ipcMain.on('quit-app', () => { app.quit(); });

app.whenReady().then(() => {
  createWindow();

  // macOS convention: re-open a window when the dock icon is clicked and
  // no windows are currently open (the app itself stays running after all
  // windows close, see the 'window-all-closed' handler below).
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) { createWindow(); }
  });
});

// macOS convention: apps stay running (visible in the dock) after their
// last window closes, until the user explicitly quits (Cmd+Q) -- only
// Windows/Linux quit outright when the last window closes.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') { app.quit(); }
});
