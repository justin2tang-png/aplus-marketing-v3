'use strict';
const {buildCopyPrompt,parseCopyOutput}=require('./prompt');
function registerIpc({ipcMain,repo,settings,backup,registry,app,window}) {
 const str=(v,name,max=10000)=>{if(typeof v!=='string'||v.length>max)throw Error(`Invalid ${name}`);return v;};
 const obj=v=>{if(!v||typeof v!=='object'||Array.isArray(v))throw Error('Invalid object');return v;};
 const id=v=>{if(!Number.isSafeInteger(v)||v<1)throw Error('Invalid id');return v;};
 const content=v=>{obj(v);const out={};for(const [k,value]of Object.entries(v)){if(!['topic','title','body','platform','status','provider','model'].includes(k))throw Error('Invalid content field');out[k]=str(value,k,k==='body'?200000:1000);}if(out.status&&!['draft','approved'].includes(out.status))throw Error('Invalid status');return out;};
 const handlers={
 'content:list':v=>repo.listContents(v===undefined?{}:{search:str(obj(v).search??'','search',1000)}),
 'content:get':v=>repo.getContent(id(v)), 'content:create':v=>repo.createContent(content(v)),
 'content:update':v=>{obj(v);return repo.updateContent(id(v.id),content(v.patch));},'content:delete':v=>repo.deleteContent(id(v)),
 'ai:providers':()=>registry.list(), 'ai:generate':async v=>{obj(v);const topic=str(v.topic,'topic',10000);if(!topic.trim())throw Error('Topic is required');const platform=str(v.platform,'platform',100);const tone=str(v.tone,'tone',100);const cfg=settings.getAll();const provider=registry.get(cfg['ai.provider']);const result=await provider.generate({prompt:buildCopyPrompt({topic,platform,tone,brandName:cfg['brand.name']}),topic,settings:cfg});return {...parseCopyOutput(result.text,topic),provider:provider.id,model:result.model};},
 'settings:get':()=>settings.getAll(),'settings:save':v=>{obj(v);if(v['ai.provider'])registry.get(v['ai.provider']);const saved=settings.save(v);backup.keep=saved['backup.keep'];return saved;},
 'secrets:set':v=>{obj(v);settings.setSecret(v.name,v.value);return settings.status();},'secrets:clear':v=>{obj(v);settings.clearSecret(v.name);return settings.status();},'secrets:status':()=>settings.status(),
 'backup:status':()=>backup.status(),'backup:now':()=>backup.runBackup(),
 'app:info':()=>({version:app.getVersion(),userData:app.getPath('userData'),platform:process.platform})};
 for(const [channel,handler]of Object.entries(handlers))ipcMain.handle(channel,(event,value)=>{if(window && (event.sender!==window.webContents || event.senderFrame!==window.webContents.mainFrame))throw Error('Untrusted IPC sender');return handler(value);});
 return ()=>Object.keys(handlers).forEach(c=>ipcMain.removeHandler(c));
}
module.exports={registerIpc};
