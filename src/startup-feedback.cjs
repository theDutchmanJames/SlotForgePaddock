'use strict';
const path = require('node:path');
function create({ BrowserWindow, quit, visible = true }) {
  const win = new BrowserWindow({
    width: 500,
    height: 340,
    useContentSize: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    show: false,
    autoHideMenuBar: true,
    title: 'Opening SlotForge Paddock',
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    backgroundColor: '#171b21',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  let disposed = false,
    ready = false,
    settle;
  const painted = new Promise(resolve => {
    settle = resolve;
  });
  // Do not let a missing splash asset block opening the actual collection.
  const timer = setTimeout(() => settle(false), 3000);
  win.once('ready-to-show', () => {
    ready = true;
    if (visible && !disposed && !win.isDestroyed()) win.show();
    clearTimeout(timer);
    settle(true);
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.on('close', event => {
    if (!disposed) {
      event.preventDefault();
      win.setTitle('Finishing collection preparation…');
      quit();
    }
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'opening.html')).catch(() => {
    clearTimeout(timer);
    settle(false);
  });
  return {
    ready: visible ? painted : Promise.resolve(false),
    focus() {
      if (visible && ready && !disposed && !win.isDestroyed()) {
        win.show();
        win.focus();
      }
    },
    dispose() {
      disposed = true;
      clearTimeout(timer);
      settle(false);
      if (!win.isDestroyed()) win.destroy();
    }
  };
}
// Loading HTML is not the same as having rendered the first database view.
function waitForPage({ ipcMain, window, trusted, timeout = 30000 }) {
  const contents = window.webContents;
  let done = false,
    resolve,
    timer;
  const ready = new Promise(r => {
    resolve = r;
  });
  const finish = result => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    ipcMain.removeListener('sf:startup-ready', onReady);
    window.removeListener('closed', onClosed);
    contents.removeListener('render-process-gone', onFailed);
    resolve(result);
  };
  const onReady = event => {
      if (trusted(event)) finish('ready');
    },
    onClosed = () => finish('cancelled'),
    onFailed = () => finish('failed');
  ipcMain.on('sf:startup-ready', onReady);
  window.once('closed', onClosed);
  contents.once('render-process-gone', onFailed);
  timer = setTimeout(() => finish('timeout'), timeout);
  return { ready, cancel: () => finish('cancelled') };
}
module.exports = { create, waitForPage };
