'use strict';
const path = require('node:path');
const defaults = {'ai.provider':'pi-cli','pi.path':process.platform === 'win32' ? path.win32.join(process.env.APPDATA || '', 'npm','pi.cmd') : 'pi','pi.provider':'openai-codex','pi.model':'gpt-6.1-sol','pi.thinking':'high','pi.timeoutSec':360,'pi.launchMode':'auto','pi.promptVia':'stdin','pi.extraArgs':'','brand.name':'A Plus Finance','backup.keep':7};
const choices = {'pi.thinking':['off','minimal','low','medium','high','xhigh'],'pi.launchMode':['auto','node-entry','cmd-shim','direct'],'pi.promptVia':['stdin','arg']};
class SettingsStore {
  constructor({db,safeStorage}) { this.db=db; this.safeStorage=safeStorage; }
  getAll() { const out={...defaults}; for (const r of this.db.prepare('SELECT * FROM settings').all()) if (Object.hasOwn(defaults,r.key)) out[r.key]=JSON.parse(r.value); return out; }
  save(patch) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw Error('Invalid settings');
    for (const [k,v] of Object.entries(patch)) {
      if (!Object.hasOwn(defaults,k)) throw Error(`Unknown setting: ${k}`);
      if (typeof v !== typeof defaults[k] || (typeof v==='string' && v.length>8192)) throw Error(`Invalid ${k}`);
      if (choices[k] && !choices[k].includes(v)) throw Error(`Invalid ${k}`);
      if (k==='pi.timeoutSec' && (!Number.isInteger(v)||v<10||v>1800)) throw Error('Invalid timeout');
      if (k==='backup.keep' && (!Number.isInteger(v)||v<1||v>60)) throw Error('Invalid backup keep');
    }
    const run=this.db.db || this.db;
    run.transaction(()=>{for(const [k,v] of Object.entries(patch)) this.db.prepare('INSERT OR REPLACE INTO settings VALUES (?,?)').run(k,JSON.stringify(v));})();
    return this.getAll();
  }
  validateName(name) { if(typeof name!=='string'|| !/^[a-z0-9_.-]{1,64}$/i.test(name)) throw Error('Invalid secret name'); }
  setSecret(name,value) { this.validateName(name); if(typeof value!=='string'||value.length>65536) throw Error('Invalid secret value'); if(!this.safeStorage.isEncryptionAvailable()) throw Error('Encryption unavailable'); this.db.prepare('INSERT OR REPLACE INTO secrets VALUES (?,?,?)').run(name,this.safeStorage.encryptString(value),new Date().toISOString()); }
  getSecret(name) { this.validateName(name); const r=this.db.prepare('SELECT ciphertext FROM secrets WHERE name=?').get(name); return r ? this.safeStorage.decryptString(r.ciphertext) : undefined; }
  clearSecret(name) { this.validateName(name); this.db.prepare('DELETE FROM secrets WHERE name=?').run(name); }
  listSecrets() { return this.db.prepare('SELECT name FROM secrets ORDER BY name').all().map(({name})=>{const value=this.getSecret(name); return {name,masked:'••••'+(value.length>=8?value.slice(-4):'')};}); }
  status() { return {encryptionAvailable:this.safeStorage.isEncryptionAvailable(),backend:this.safeStorage.getSelectedStorageBackend?.() || (process.platform==='win32'?'dpapi':'unknown'),names:this.listSecrets()}; }
}
module.exports={SettingsStore,defaults};
