'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseCmdShimTarget, findNodeEntry, resolveLaunch } = require('../../src/main/providers/launch');
const pi = require('../../src/main/providers/pi-cli');
const { defaults } = require('../../src/main/settings');

const fixtureDir = path.join(__dirname, '..', 'fixtures', 'cmd-shims');
const fixture = name => fs.readFileSync(path.join(fixtureDir, name), 'utf8');
const NPM_DIR = 'C:\\Users\\Justin\\AppData\\Roaming\\npm';
const CMD = `${NPM_DIR}\\pi.cmd`;
const LEGACY = `${NPM_DIR}\\node_modules\\@mariozechner\\pi-coding-agent\\dist\\cli.js`;
const RENAMED = `${NPM_DIR}\\node_modules\\@earendil-works\\pi\\dist\\cli.js`;
const PI130 = `${NPM_DIR}\\node_modules\\@earendil-works\\pi-coding-agent\\dist\\bundle\\cli.js`;

/** Fake Windows filesystem: pi.cmd with the given fixture content plus the listed existing files. */
function fakeFs(shimName, existing) {
  const files = new Set(existing);
  return {
    existsSync: file => files.has(file),
    readFileSync: file => {
      if (file !== CMD || !shimName) {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      }
      return fixture(shimName);
    }
  };
}

function launch(shimName, existing, launchMode = 'auto') {
  return resolveLaunch({
    cfg: { ...piConfig(), launchMode },
    prompt: 'hi',
    platform: 'win32',
    env: { APPDATA: 'C:\\Users\\Justin\\AppData\\Roaming', ComSpec: 'C:\\Windows\\system32\\cmd.exe' },
    execPath: 'C:\\Program Files\\A Plus Operator\\A Plus Operator.exe',
    ...fakeFs(shimName, existing)
  });
}

function piConfig() {
  return {
    path: '%APPDATA%\\npm\\pi.cmd',
    provider: 'openai-codex',
    model: 'gpt-6.1-sol',
    thinking: 'high',
    promptVia: 'stdin',
    extraArgs: ''
  };
}

test('parse: real npm cmd-shim for @mariozechner/pi-coding-agent', () => {
  assert.equal(parseCmdShimTarget(fixture('pi-mariozechner.cmd')), 'node_modules\\@mariozechner\\pi-coding-agent\\dist\\cli.js');
});

test('parse: npm cmd-shim for a hypothetical renamed scope', () => {
  assert.equal(parseCmdShimTarget(fixture('pi-renamed-scope.cmd')), 'node_modules\\@earendil-works\\pi\\dist\\cli.js');
});

test('parse: unquoted %~dp0 form with .mjs entry', () => {
  assert.equal(parseCmdShimTarget(fixture('pi-tilde-unquoted.cmd')), 'node_modules\\pi-agent\\bin\\pi.mjs');
});

test('parse: garbage content yields null', () => {
  assert.equal(parseCmdShimTarget(fixture('garbage.cmd')), null);
});

test('parse: empty / non-string input yields null', () => {
  assert.equal(parseCmdShimTarget(''), null);
  assert.equal(parseCmdShimTarget(null), null);
  assert.equal(parseCmdShimTarget(Buffer.from('x')), null);
});

test('parse: ignores node.exe and keeps the last JS target; supports .bin style ..\\ paths', () => {
  const content = 'IF EXIST "%dp0%\\node.exe" (SET "_prog=%dp0%\\node.exe")\r\n"%_prog%" "%dp0%\\..\\pi\\dist\\cli.js" %*';
  assert.equal(parseCmdShimTarget(content), '..\\pi\\dist\\cli.js');
});

test('parse: single-quoted and forward-slash targets are normalised', () => {
  assert.equal(parseCmdShimTarget("node '%dp0%/node_modules/x/cli.cjs' %*"), 'node_modules\\x\\cli.cjs');
});

test('findNodeEntry reports tried candidates without reading anything else', () => {
  const result = findNodeEntry(CMD, fakeFs('garbage.cmd', []));
  assert.deepEqual(result, { entryPath: null, entrySource: null, tried: [PI130, LEGACY] });
});

test('auto: @mariozechner shim -> node-entry via cmd-shim-parse', () => {
  const result = launch('pi-mariozechner.cmd', [LEGACY]);
  assert.equal(result.strategy, 'node-entry');
  assert.equal(result.entrySource, 'cmd-shim-parse');
  assert.equal(result.entryPath, LEGACY);
  assert.equal(result.args[0], LEGACY);
  assert.equal(result.env.ELECTRON_RUN_AS_NODE, '1');
});

test('auto: renamed-scope shim (Pi 1.3.0 case) -> node-entry at the parsed path, not the legacy one', () => {
  const result = launch('pi-renamed-scope.cmd', [RENAMED]);
  assert.equal(result.strategy, 'node-entry');
  assert.equal(result.entrySource, 'cmd-shim-parse');
  assert.equal(result.entryPath, RENAMED);
  assert.equal(result.command, 'C:\\Program Files\\A Plus Operator\\A Plus Operator.exe');
});

test('auto: parsed target missing but legacy path exists -> legacy-path', () => {
  const result = launch('pi-renamed-scope.cmd', [LEGACY]);
  assert.equal(result.entrySource, 'legacy-path');
  assert.deepEqual(result.tried, [RENAMED, PI130, LEGACY]);
});

test('auto: garbage shim but legacy path exists -> legacy-path', () => {
  const result = launch('garbage.cmd', [LEGACY]);
  assert.equal(result.strategy, 'node-entry');
  assert.equal(result.entrySource, 'legacy-path');
});

test('auto: unreadable shim and nothing found -> cmd-shim fallback, tried recorded', () => {
  const result = launch(null, []);
  assert.equal(result.strategy, 'cmd-shim');
  assert.equal(result.entrySource, null);
  assert.deepEqual(result.tried, [PI130, LEGACY]);
  assert.equal(result.command, 'C:\\Windows\\system32\\cmd.exe');
});

test('auto: renamed shim, parsed target missing, no legacy -> cmd-shim fallback', () => {
  const result = launch('pi-renamed-scope.cmd', []);
  assert.equal(result.strategy, 'cmd-shim');
  assert.deepEqual(result.tried, [RENAMED, PI130, LEGACY]);
});

test('node-entry mode: error lists every tried path', () => {
  assert.throws(() => launch('pi-renamed-scope.cmd', [], 'node-entry'), /tried: .*earendil-works.*mariozechner/);
});

test('diagnostics: reports the planned strategy without spawning and contains no prompt', () => {
  const settings = { ...defaults, 'pi.path': '%APPDATA%\\npm\\pi.cmd', 'pi.launchMode': 'auto' };
  const result = pi.diagnostics(settings, {
    platform: 'win32',
    env: { APPDATA: 'C:\\Users\\Justin\\AppData\\Roaming' },
    execPath: 'C:\\app.exe',
    ...fakeFs('pi-renamed-scope.cmd', [RENAMED])
  });
  assert.equal(result.planned.strategy, 'node-entry');
  assert.equal(result.planned.entrySource, 'cmd-shim-parse');
  assert.equal(result.planned.entryPath, RENAMED);
  assert.equal(Object.hasOwn(result.planned, 'env'), false);
  assert.equal(Object.hasOwn(result.planned, 'args'), false);
});

test('diagnostics: surfaces resolution errors as text', () => {
  const settings = { ...defaults, 'pi.path': 'C:\\npm\\pi.cmd', 'pi.launchMode': 'direct' };
  const result = pi.diagnostics(settings, { platform: 'win32', env: {}, existsSync: () => false, readFileSync: () => '' });
  assert.match(result.planned.error, /direct/);
});

test('parse: REAL pi.cmd from Justin\'s Windows (Pi 1.3.0, @earendil-works, dist\\bundle)', () => {
  assert.equal(parseCmdShimTarget(fixture('pi-windows-real-1.3.0.cmd')), 'node_modules\\@earendil-works\\pi-coding-agent\\dist\\bundle\\cli.js');
});

test('auto: REAL Pi 1.3.0 pi.cmd -> node-entry at dist\\bundle\\cli.js via cmd-shim-parse', () => {
  const result = launch('pi-windows-real-1.3.0.cmd', [PI130]);
  assert.equal(result.strategy, 'node-entry');
  assert.equal(result.entrySource, 'cmd-shim-parse');
  assert.equal(result.entryPath, PI130);
  assert.deepEqual(result.tried, [PI130]);
});

test('auto: unreadable shim but Pi 1.3.0 installed -> known path (legacy-path source)', () => {
  const result = launch(null, [PI130]);
  assert.equal(result.strategy, 'node-entry');
  assert.equal(result.entrySource, 'legacy-path');
  assert.equal(result.entryPath, PI130);
});
