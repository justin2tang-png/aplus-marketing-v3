'use strict';

const fs = require('node:fs');

/** Verify that a native module is a PE32+ x86-64 DLL. */
function checkPE(file) {
  const buffer = fs.readFileSync(file);
  if (buffer.length < 64 || buffer.toString('ascii', 0, 2) !== 'MZ') {
    throw Error('Missing DOS header');
  }
  const peOffset = buffer.readUInt32LE(60);
  if (peOffset > buffer.length - 26 || buffer.toString('ascii', peOffset, peOffset + 4) !== 'PE\u0000\u0000') {
    throw Error('Missing PE header');
  }
  if (buffer.readUInt16LE(peOffset + 4) !== 0x8664) {
    throw Error('Not x86-64');
  }
  if (buffer.readUInt16LE(peOffset + 24) !== 0x20b) {
    throw Error('Not PE32+');
  }
  if (!(buffer.readUInt16LE(peOffset + 22) & 0x2000)) {
    throw Error('Not a DLL');
  }
  return true;
}
if (require.main === module) {
  try {
    if (!process.argv[2]) {
      throw Error('Usage: node scripts/check-pe.js <file.node>');
    }
    checkPE(process.argv[2]);
    console.log('PASS: PE32+ x86-64 DLL');
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}

module.exports = {
  checkPE
};
