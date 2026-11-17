'use strict';
const fs=require('node:fs'); const path=require('node:path');
class BackupManager {
  constructor({db,dir,keep=7,now=()=>new Date(),intervalMs=3600000}) { Object.assign(this,{db,dir,keep,now,intervalMs}); fs.mkdirSync(dir,{recursive:true}); }
  files() { return fs.readdirSync(this.dir).filter(n=>/^aplus-.*\.db$/.test(n)).map(name=>{const m=/^aplus-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.db$/.exec(name); const time=m?new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`).getTime():NaN; return {name,time:Number.isFinite(time)?time:fs.statSync(path.join(this.dir,name)).mtimeMs};}).sort((a,b)=>b.time-a.time || b.name.localeCompare(a.name)); }
  latestBackupTime() { const f=this.files()[0]; return f?new Date(f.time):null; }
  isDue() { const last=this.latestBackupTime(); return !last || this.now()-last>=86400000; }
  runBackup() { if(this.pending) return this.pending; this.pending=this.performBackup().finally(()=>{this.pending=null;}); return this.pending; }
  async performBackup() { const date=this.now(); const stamp=date.toISOString().replace(/[-:]/g,'').replace('T','-').slice(0,15); const target=path.join(this.dir,`aplus-${stamp}.db`); await this.db.backup(target); this.db.prepare('INSERT OR REPLACE INTO meta VALUES (?,?)').run('last_backup_at',date.toISOString()); for(const f of this.files().slice(this.keep)) fs.unlinkSync(path.join(this.dir,f.name)); return this.status(); }
  status() { return {lastBackupAt:this.latestBackupTime()?.toISOString() || null,count:this.files().length,dir:this.dir}; }
  async start() { if(this.timer) return; await this.check(); this.timer=setInterval(()=>this.check().catch(()=>{}),this.intervalMs); this.timer.unref(); }
  async check() { if(this.isDue()) await this.runBackup(); }
  stop() { clearInterval(this.timer); this.timer=null; }
}
module.exports={BackupManager};
