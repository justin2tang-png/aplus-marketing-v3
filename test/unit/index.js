'use strict';
// Ensure test reporter output is flushed when stdout is a pipe.
process.stdout._handle?.setBlocking(true);
process.stderr._handle?.setBlocking(true);
// Node 24 resolves an explicit directory through index.js under --test.
const fs=require('node:fs');const path=require('node:path');
// This offline Node build drops asynchronous pipe writes; preserve runner IPC frames.
for (const [stream,fd] of [[process.stdout,1],[process.stderr,2]]) stream.write=(chunk,encoding,callback)=>{fs.writeSync(fd,typeof chunk==='string'?Buffer.from(chunk,typeof encoding==='string'?encoding:'utf8'):chunk);if(typeof encoding==='function')encoding();if(typeof callback==='function')callback();return true;};
for(const file of fs.readdirSync(__dirname).filter(name=>name.endsWith('.test.js')).sort())require(path.join(__dirname,file));
