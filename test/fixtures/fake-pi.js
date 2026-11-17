#!/usr/bin/env node
'use strict';
process.stdout._handle?.setBlocking(true);
process.stderr._handle?.setBlocking(true);
const args=process.argv.slice(2);if(args.includes('--fake-fail')){require('node:fs').writeSync(2,'fixture failure details');process.exitCode=7;}else if(args.includes('--fake-timeout')){setInterval(()=>{},1000);}else if(args.includes('--fake-empty')){}else if(args.includes('--fake-large')){require('node:fs').writeSync(1,'x'.repeat(3*1024*1024));}else{const input=require('node:fs').readFileSync(0,'utf8');require('node:fs').writeSync(1,JSON.stringify({title:'Fake Pi',body:input,args,cwd:process.cwd()}));}
