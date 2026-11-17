'use strict';
const fs=require('node:fs');
function checkPE(file) {const b=fs.readFileSync(file);if(b.length<64||b.toString('ascii',0,2)!=='MZ')throw Error('Missing DOS header');const p=b.readUInt32LE(60);if(p>b.length-26||b.toString('ascii',p,p+4)!=='PE\u0000\u0000')throw Error('Missing PE header');if(b.readUInt16LE(p+4)!==0x8664)throw Error('Not x86-64');if(b.readUInt16LE(p+24)!==0x20b)throw Error('Not PE32+');if(!(b.readUInt16LE(p+22)&0x2000))throw Error('Not a DLL');return true;}
if(require.main===module){try{if(!process.argv[2])throw Error('Usage: node scripts/check-pe.js <file.node>');checkPE(process.argv[2]);console.log('PASS: PE32+ x86-64 DLL');}catch(e){console.error(e.message);process.exitCode=1;}}
module.exports={checkPE};
