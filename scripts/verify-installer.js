#!/usr/bin/env node
'use strict';
/*
 * Post-build gate for the Windows NSIS installer (runs as `postdist:win`). Read-only; never
 * executes the installer or the uninstaller.
 *  1. NSIS CRC of the installer itself.
 *  2. Locate the embedded uninstaller by walking the installer's NSIS data blocks (same block
 *     format electron-builder's UninstallerReader parses; raw-deflate per block, no 7-Zip).
 *  3. NSIS CRC of that uninstaller.
 * Exit code 0 only if all three pass. CRC = CRC32 over [512, firstheader + length - 4), the
 * non-ANAL algorithm in NSIS Source/exehead/fileform.c.
 * Usage: node scripts/verify-installer.js [installer.exe] [--extract <out.exe>] [--json <out.json>]
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');

const SIG = Buffer.from('efbeadde4e756c6c736f6674496e7374', 'hex'); // DEADBEEF "NullsoftInst"
const FH_FLAGS_UNINSTALL = 1;

const TABLE = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function crc32(buf) {
  if (typeof zlib.crc32 === 'function') return zlib.crc32(buf) >>> 0;
  let c = 0xffffffff;
  for (const b of buf) c = TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
const hex = n => n.toString(16).padStart(8, '0');
const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex');

/** Find the NSIS first header (512-aligned, as exehead requires). */
function firstHeader(buf) {
  for (let i = buf.indexOf(SIG); i >= 0; i = buf.indexOf(SIG, i + 1)) {
    const h = i - 4;
    if (h >= 0 && h % 512 === 0) {
      return { offset: h, flags: buf.readUInt32LE(h), headerLength: buf.readUInt32LE(h + 20), total: buf.readUInt32LE(h + 24) };
    }
  }
  return null;
}

/** NSIS integrity check of one exe buffer. */
function checkCrc(buf) {
  const fh = firstHeader(buf);
  if (!fh) return { ok: false, reason: 'no NSIS first header' };
  const end = fh.offset + fh.total;
  if (end > buf.length || fh.total < 32) return { ok: false, reason: `declared length ${fh.total} exceeds file`, ...fh };
  const stored = buf.readUInt32LE(end - 4);
  const calc = crc32(buf.subarray(512, end - 4));
  return { ok: stored === calc, stored: hex(stored), calc: hex(calc), firstHeader: fh.offset, flags: fh.flags, trailing: buf.length - end };
}

/** Walk data blocks after the first header and return every embedded NSIS uninstaller. */
function findEmbeddedUninstallers(buf) {
  const fh = firstHeader(buf);
  if (!fh) throw Error('installer has no NSIS first header');
  const end = fh.offset + fh.total - 4; // stop before the CRC
  let pos = fh.offset + 28;
  const found = [];
  let blocks = 0;
  while (pos + 4 <= end) {
    const raw = buf.readUInt32LE(pos);
    const compressed = (raw & 0x80000000) !== 0;
    const size = raw & 0x7fffffff;
    pos += 4;
    if (size === 0 || pos + size > end) break;
    blocks += 1;
    const head = buf.subarray(pos, pos + Math.min(size, 64));
    // Stored blocks: cheap MZ test before copying. Compressed: inflate only small blocks.
    if (compressed && size < 64 * 1024 * 1024) {
      let data;
      try { data = zlib.inflateRawSync(buf.subarray(pos, pos + size)); } catch { data = null; }
      if (data && data[0] === 0x4d && data[1] === 0x5a) {
        const inner = firstHeader(data);
        if (inner && (inner.flags & FH_FLAGS_UNINSTALL)) found.push(data);
      }
    } else if (!compressed && head[0] === 0x4d && head[1] === 0x5a && size < 64 * 1024 * 1024) {
      const data = buf.subarray(pos, pos + size);
      const inner = firstHeader(data);
      if (inner && (inner.flags & FH_FLAGS_UNINSTALL)) found.push(Buffer.from(data));
    }
    pos += size;
  }
  return { found, blocks };
}

function verifyInstaller(file) {
  const buf = fs.readFileSync(file);
  const result = { installer: { path: file, size: buf.length, sha256: sha256(buf), crc: checkCrc(buf) } };
  const { found, blocks } = findEmbeddedUninstallers(buf);
  result.dataBlocks = blocks;
  result.uninstallersFound = found.length;
  if (found.length === 1) {
    result.uninstaller = { size: found[0].length, sha256: sha256(found[0]), crc: checkCrc(found[0]) };
  }
  result.ok = result.installer.crc.ok && found.length === 1 && result.uninstaller.crc.ok;
  return { result, uninstaller: found[0] };
}

function main(argv) {
  const args = [...argv];
  const opt = name => { const i = args.indexOf(name); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
  const extract = opt('--extract');
  const jsonOut = opt('--json');
  let file = args[0];
  if (!file) {
    const root = path.resolve(__dirname, '..');
    const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    file = path.join(root, 'release', `APlusOperator-Setup-${version}.exe`);
  }
  const { result, uninstaller } = verifyInstaller(file);
  if (extract && uninstaller) fs.writeFileSync(extract, uninstaller);
  if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(result, null, 2) + '\n');
  const line = (label, c) => `${c.ok ? 'OK ' : 'BAD'}  ${label} stored=${c.stored ?? '-'} calc=${c.calc ?? '-'}${c.reason ? ' ' + c.reason : ''}`;
  console.log(`verify-installer: ${file}`);
  console.log(`  size=${result.installer.size} sha256=${result.installer.sha256}`);
  console.log('  ' + line('installer CRC', result.installer.crc));
  console.log(`  embedded uninstallers found: ${result.uninstallersFound} (data blocks scanned: ${result.dataBlocks})`);
  if (result.uninstaller) {
    console.log(`  uninstaller size=${result.uninstaller.size} sha256=${result.uninstaller.sha256}`);
    console.log('  ' + line('uninstaller CRC', result.uninstaller.crc));
  }
  console.log(result.ok ? 'verify-installer: PASS' : 'verify-installer: FAIL (do not ship this installer)');
  return result.ok ? 0 : 1;
}

if (require.main === module) {
  try { process.exitCode = main(process.argv.slice(2)); } catch (e) { console.error(`verify-installer: ERROR ${e.message}`); process.exitCode = 2; }
}

module.exports = { checkCrc, findEmbeddedUninstallers, verifyInstaller, crc32 };
