'use strict';

const { app, BrowserWindow, dialog, ipcMain, safeStorage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { openDatabase } = require('./db');
const { SettingsStore } = require('./settings');
const { BackupManager } = require('./backup');
const { registerIpc } = require('./ipc');
const registry = require('./providers');
const { redactSecrets } = require('./redact');
if (process.env.APLUS_USER_DATA_DIR) {
  app.setPath('userData', process.env.APLUS_USER_DATA_DIR);
}
let mainWindow;
let repository;
let backup;
let removeIpcHandlers;
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.show();
      mainWindow.focus();
    }
  });

  const createWindow = () => {
    mainWindow = new BrowserWindow({
      width: 1200,
      height: 850,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        preload: path.join(__dirname, 'preload.js')
      }
    });
    mainWindow.webContents.setWindowOpenHandler(() => ({
      action: 'deny'
    }));
    mainWindow.webContents.on('will-navigate', e => e.preventDefault());
    mainWindow.webContents.on('will-redirect', e => e.preventDefault());
    removeIpcHandlers = registerIpc({
      ipcMain,
      repo: repository,
      settings: new SettingsStore({
        db: repository,
        safeStorage
      }),
      backup,
      registry,
      app,
      window: mainWindow
    });
    mainWindow.on('closed', () => {
      removeIpcHandlers();
      mainWindow = null;
    });
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  };
  app.whenReady().then(async () => {
    const dir = app.getPath('userData');
    fs.mkdirSync(dir, {
      recursive: true
    });
    repository = openDatabase(path.join(dir, 'aplus-operator.db'));
    const settings = new SettingsStore({
      db: repository,
      safeStorage
    });
    backup = new BackupManager({
      db: repository,
      dir: path.join(dir, 'backups'),
      keep: settings.getAll()['backup.keep']
    });
    await backup.start();
    createWindow();
    app.on('activate', () => {
      if (!mainWindow) {
        createWindow();
      }
    });
  }).catch((error) => {
    // Startup errors never contain secrets (they come from DB/backup/window setup); record them
    // so a failure on Justin's/Becky's Windows PC can be diagnosed without a console window.
    const detail = redactSecrets(error && error.stack ? error.stack : String(error));
    try {
      fs.writeFileSync(path.join(app.getPath('userData'), 'startup-error.log'), `${new Date().toISOString()}\n${detail}\n`);
    } catch {
      // ignore: userData may be the thing that failed
    }
    console.error('Application startup failed:', detail);
    dialog.showErrorBox('A Plus Operator 启动失败 / failed to start', detail.slice(0, 2000));
    app.exit(1);
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
  let closing = false;
  app.on('before-quit', e => {
    if (closing || !repository) {
      return;
    }
    e.preventDefault();
    closing = true;
    backup.stop();
    Promise.resolve(backup.pending).finally(() => {
      repository.close();
      repository = null;
      app.quit();
    });
  });
}
