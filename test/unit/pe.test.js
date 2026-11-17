'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { checkPE } = require('../../scripts/check-pe');

function peFixture(context, modify = () => {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aplus-pe-'));
  context.after(() => fs.rmSync(directory, {
    recursive: true,
    force: true
  }));
  const file = path.join(directory, 'fixture.node');
  const buffer = Buffer.alloc(256);
  buffer.write('MZ');
  buffer.writeUInt32LE(128, 60);
  buffer.write('PE\0\0', 128);
  buffer.writeUInt16LE(0x8664, 132);
  buffer.writeUInt16LE(0x2000, 150);
  buffer.writeUInt16LE(0x20b, 152);
  modify(buffer);
  fs.writeFileSync(file, buffer);
  return file;
}
test('PE verifier accepts a PE32+ x86-64 DLL', context => {
  assert.equal(checkPE(peFixture(context)), true);
});
test('PE verifier rejects a non-x86-64 architecture', context => {
  assert.throws(() => checkPE(peFixture(context, buffer => buffer.writeUInt16LE(0x14c, 132))), /x86-64/);
});
test('PE verifier rejects an invalid DOS header', context => {
  assert.throws(() => checkPE(peFixture(context, buffer => buffer.fill(0))), /DOS/);
});
test('PE verifier rejects a truncated DOS header', context => {
  const file = peFixture(context);
  fs.writeFileSync(file, Buffer.alloc(2));
  assert.throws(() => checkPE(file), /DOS/);
});
test('PE verifier rejects an invalid PE signature', context => {
  assert.throws(() => checkPE(peFixture(context, buffer => buffer.write('NOPE', 128))), /PE header/);
});
test('PE verifier rejects a non-PE32+ optional header', context => {
  assert.throws(() => checkPE(peFixture(context, buffer => buffer.writeUInt16LE(0x10b, 152))), /PE32\+/);
});
test('PE verifier rejects a file without the DLL flag', context => {
  assert.throws(() => checkPE(peFixture(context, buffer => buffer.writeUInt16LE(0, 150))), /DLL/);
});
