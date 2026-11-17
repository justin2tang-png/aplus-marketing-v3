#!/usr/bin/env node
'use strict';

process.stdout._handle?.setBlocking(true);
process.stderr._handle?.setBlocking(true);
const args = process.argv.slice(2);
if (args.includes('--fake-fail')) {
  require('node:fs').writeSync(2, 'fixture failure details');
  process.exitCode = 7;
} else if (args.includes('--fake-fail-secret')) {
  require('node:fs').writeSync(2, 'auth failed key=sk-live-abcdefghijklmnop Authorization: Bearer ghp_tokenvalue123 jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2ln password=s3cr3tvalue');
  process.exitCode = 7;
} else if (args.includes('--fake-timeout')) {
  setInterval(() => {}, 1000);
} else if (args.includes('--fake-empty')) {
  // Exit successfully without writing stdout.
} else if (args.includes('--fake-large')) {
  // Many separate chunks, so the parent sees repeated data events past the 2 MB cap.
  for (let i = 0; i < 48; i += 1) {
    require('node:fs').writeSync(1, 'x'.repeat(64 * 1024));
  }
} else {
  const input = require('node:fs').readFileSync(0, 'utf8');
  require('node:fs').writeSync(1, JSON.stringify({
    title: 'Fake Pi',
    body: input,
    args,
    cwd: process.cwd()
  }));
}
