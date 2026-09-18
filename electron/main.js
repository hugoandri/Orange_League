const { app, BrowserWindow } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'Orange League',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.loadFile(path.join(__dirname, '..', 'index.html'));
}

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
