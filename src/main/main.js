'use strict';
const {app,BrowserWindow,ipcMain,safeStorage}=require('electron');const path=require('node:path');const fs=require('node:fs');
const {openDatabase}=require('./db');const {SettingsStore}=require('./settings');const {BackupManager}=require('./backup');const {registerIpc}=require('./ipc');const registry=require('./providers');
if(process.env.APLUS_USER_DATA_DIR)app.setPath('userData',process.env.APLUS_USER_DATA_DIR);
let win,repo,backup,dispose;
if(!app.requestSingleInstanceLock())app.quit();else {
 app.on('second-instance',()=>{if(win){if(win.isMinimized())win.restore();win.show();win.focus();}});
 const createWindow=()=>{win=new BrowserWindow({width:1200,height:850,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true,preload:path.join(__dirname,'preload.js')}});win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',e=>e.preventDefault());win.webContents.on('will-redirect',e=>e.preventDefault());dispose=registerIpc({ipcMain,repo,settings:new SettingsStore({db:repo,safeStorage}),backup,registry,app,window:win});win.on('closed',()=>{dispose();win=null;});win.loadFile(path.join(__dirname,'../renderer/index.html'));};
 app.whenReady().then(async()=>{const dir=app.getPath('userData');fs.mkdirSync(dir,{recursive:true});repo=openDatabase(path.join(dir,'aplus-operator.db'));const settings=new SettingsStore({db:repo,safeStorage});backup=new BackupManager({db:repo,dir:path.join(dir,'backups'),keep:settings.getAll()['backup.keep']});await backup.start();createWindow();app.on('activate',()=>{if(!win)createWindow();});}).catch(()=>{console.error('Application startup failed');app.exit(1);});
 app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});
 let closing=false;app.on('before-quit',e=>{if(closing||!repo)return;e.preventDefault();closing=true;backup.stop();Promise.resolve(backup.pending).finally(()=>{repo.close();repo=null;app.quit();});});
}
