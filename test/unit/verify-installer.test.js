'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { checkCrc, findEmbeddedUninstallers, crc32 } = require('../../scripts/verify-installer');

const SIG = Buffer.from('efbeadde4e756c6c736f6674496e7374', 'hex');

/** Build a minimal NSIS-shaped exe: 1024-byte "MZ" stub, first header, payload, CRC. */
function fakeNsis({ flags = 0, payload = Buffer.alloc(0), corrupt = false } = {}) {
  const stub = Buffer.alloc(1024); stub.write('MZ');
  const fh = Buffer.alloc(28);
  fh.writeUInt32LE(flags, 0); SIG.copy(fh, 4);
  const total = 28 + payload.length + 4;
  fh.writeUInt32LE(28, 20); fh.writeUInt32LE(total, 24);
  const body = Buffer.concat([stub, fh, payload]);
  const crc = Buffer.alloc(4); crc.writeUInt32LE((crc32(body.subarray(512)) ^ (corrupt ? 1 : 0)) >>> 0);
  return Buffer.concat([body, crc]);
}
const block = (data, compress) => {
  const body = compress ? zlib.deflateRawSync(data) : data;
  const len = Buffer.alloc(4); len.writeUInt32LE((body.length | (compress ? 0x80000000 : 0)) >>> 0);
  return Buffer.concat([len, body]);
};

test('valid NSIS CRC passes, a flipped CRC fails', () => {
  assert.equal(checkCrc(fakeNsis()).ok, true);
  assert.equal(checkCrc(fakeNsis({ corrupt: true })).ok, false);
  assert.equal(checkCrc(Buffer.from('MZ not nsis')).ok, false);
});

test('finds exactly one embedded uninstaller (compressed) and reports its CRC', () => {
  const good = fakeNsis({ flags: 1, payload: Buffer.from('uninstall data') });
  const dll = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(100)]);
  const installer = fakeNsis({ payload: Buffer.concat([block(Buffer.from('hdr'), true), block(dll, true), block(good, true), block(Buffer.alloc(2000), false)]) });
  const { found } = findEmbeddedUninstallers(installer);
  assert.equal(found.length, 1);
  assert.deepEqual(found[0], good);
  assert.equal(checkCrc(found[0]).ok, true);
});

test('a corrupt embedded uninstaller is detected', () => {
  const bad = fakeNsis({ flags: 1, payload: Buffer.from('uninstall data'), corrupt: true });
  const installer = fakeNsis({ payload: block(bad, false) });
  const { found } = findEmbeddedUninstallers(installer);
  assert.equal(found.length, 1);
  assert.equal(checkCrc(found[0]).ok, false);
});
