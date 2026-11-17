'use strict';
const path=require('node:path');
function splitExtraArgs(value='') {
  const args=[]; let current='',quote=null,active=false;
  for(let i=0;i<value.length;i++) { const c=value[i]; if(c==='\\' && (value[i+1]==='"'||value[i+1]==="'")) {current+=value[++i];active=true;} else if(quote) { if(c===quote) quote=null; else current+=c; } else if(c==='"'||c==="'") {quote=c;active=true;} else if(/\s/.test(c)) {if(active){args.push(current);current='';active=false;}} else {current+=c;active=true;} }
  if(quote) throw Error('Unclosed quote in extra arguments'); if(active) args.push(current); return args;
}
function buildPiArgs(cfg,prompt) { const a=['--provider',cfg.provider,'--model',cfg.model,'--thinking',cfg.thinking,'--print','--no-tools','--no-extensions','--no-skills','--no-context-files','--no-session',...splitExtraArgs(cfg.extraArgs)]; if(cfg.promptVia==='arg') a.push(prompt); return a; }
function quoteForCmd(arg) { arg=String(arg); if(/[\r\n]/.test(arg)) throw Error('Newlines cannot be passed to cmd.exe'); arg=arg.replace(/(\\*)"/g,'$1$1\\"').replace(/(\\*)$/,'$1$1'); return (`"${arg}"`).replace(/[()%!^"<>&|]/g,'^$&'); }
function resolveLaunch({cfg,prompt,platform=process.platform,env=process.env,execPath=process.execPath,existsSync=require('node:fs').existsSync}) {
  let command=cfg.path; const childEnv={...env}; if(platform==='win32') command=command.replace(/%([^%]+)%/g,(full,key)=>{const k=Object.keys(env).find(k=>k.toLowerCase()===key.toLowerCase());return k?env[k]:full;});
  const shim=platform==='win32' && /\.(cmd|bat)$/i.test(command); const mode=cfg.launchMode||'auto';
  if(shim && ['auto','node-entry'].includes(mode)) {const cli=path.win32.join(path.win32.dirname(command),'node_modules','@mariozechner','pi-coding-agent','dist','cli.js'); if(existsSync(cli)) return {command:execPath,args:[cli,...buildPiArgs(cfg,prompt)],env:{...childEnv,ELECTRON_RUN_AS_NODE:'1'},windowsVerbatimArguments:false,promptVia:cfg.promptVia,strategy:'node-entry'}; if(mode==='node-entry') throw Error(`Pi Node entry not found: ${cli}`);}
  if(shim && mode!=='direct') {const args=buildPiArgs({...cfg,promptVia:'stdin'},prompt); return {command:env.ComSpec||'cmd.exe',args:['/d','/s','/c','"'+[quoteForCmd(command),...args.map(quoteForCmd)].join(' ')+'"'],env:childEnv,windowsVerbatimArguments:true,promptVia:'stdin',strategy:'cmd-shim'};}
  return {command,args:buildPiArgs(cfg,prompt),env:childEnv,windowsVerbatimArguments:false,promptVia:cfg.promptVia,strategy:'direct'};
}
module.exports={buildPiArgs,resolveLaunch,quoteForCmd,splitExtraArgs};
