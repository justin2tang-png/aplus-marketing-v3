'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const registry = require('../../src/main/providers');
const pi = require('../../src/main/providers/pi-cli');
const { defaults } = require('../../src/main/settings');

function piFixture(context) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aplus-pi-'));
  const executable = path.join(directory, 'fake-pi');
  fs.copyFileSync(path.join(__dirname, '../fixtures/fake-pi.js'), executable);
  fs.chmodSync(executable, 0o755);
  context.after(() => fs.rmSync(directory, {
    recursive: true,
    force: true
  }));
  const settings = {
    ...defaults,
    'pi.path': executable,
    'pi.launchMode': 'direct'
  };
  return (overrides = {}, signal) => pi.generate({
    prompt: 'Hello & 首次置业 KiwiSaver\nsecond line',
    settings: {
      ...settings,
      ...overrides
    },
    signal
  });
}
test('registry lists the Pi provider', () => {
  assert.ok(registry.list().some(provider => provider.id === 'pi-cli'));
});
test('registry rejects an unknown provider', () => {
  assert.throws(() => registry.get('missing'));
});
test('registry rejects an invalid provider', () => {
  assert.throws(() => new registry.ProviderRegistry().register({}));
});
test('registry returns a registered provider', () => {
  const providers = new registry.ProviderRegistry();
  const mock = registry.get('mock');
  providers.register(mock);
  assert.equal(providers.get('mock'), mock);
});
test('mock generates deterministic text', async () => {
  const mock = registry.get('mock');
  assert.equal((await mock.generate({
    topic: 'Home'
  })).text, (await mock.generate({
    topic: 'Home'
  })).text);
});
test('mock includes the topic and its model', async () => {
  const result = await registry.get('mock').generate({
    topic: 'Home'
  });
  assert.equal(result.model, 'mock-1');
  assert.ok(result.text.includes('Home'));
});
test('Pi spawn options disable shell interpretation', () => {
  assert.equal(pi.buildSpawnOptions({
    env: {}
  }).shell, false);
});
test('Pi spawn options hide Windows console windows', () => {
  assert.equal(pi.buildSpawnOptions({
    env: {}
  }).windowsHide, true);
});
test('Pi spawn options preserve launch environment and argument handling', () => {
  const env = {
    ELECTRON_RUN_AS_NODE: '1'
  };
  const options = pi.buildSpawnOptions({
    env,
    windowsVerbatimArguments: true
  });
  assert.equal(options.env, env);
  assert.equal(options.windowsVerbatimArguments, true);
  assert.deepEqual(options.stdio, ['pipe', 'pipe', 'pipe']);
});
test('Pi receives a Unicode multiline stdin prompt', async context => {
  const result = await piFixture(context)();
  assert.equal(JSON.parse(result.text).body, 'Hello & 首次置业 KiwiSaver\nsecond line');
});
test('Pi runs outside the project context', async context => {
  const result = await piFixture(context)();
  assert.equal(JSON.parse(result.text).cwd, os.tmpdir());
});
test('Pi receives the context isolation CLI flag', async context => {
  const result = await piFixture(context)();
  assert.ok(JSON.parse(result.text).args.includes('--no-context-files'));
});
test('Pi receives a plain positional prompt when promptVia is arg', async context => {
  const result = JSON.parse((await piFixture(context)({
    'pi.promptVia': 'arg'
  })).text);
  assert.equal(result.body, '');
  assert.equal(result.args.at(-1), 'Hello & 首次置业 KiwiSaver\nsecond line');
});
test('Pi reports stderr and a nonzero exit code', async context => {
  await assert.rejects(piFixture(context)({
    'pi.extraArgs': '--fake-fail'
  }), /exit code 7: fixture failure details/);
});
test('Pi rejects empty stdout', async context => {
  await assert.rejects(piFixture(context)({
    'pi.extraArgs': '--fake-empty'
  }), /empty output/);
});
test('Pi kills a process when the timeout expires', async context => {
  await assert.rejects(piFixture(context)({
    'pi.extraArgs': '--fake-timeout',
    'pi.timeoutSec': 0.1
  }), /timeout/);
});
test('Pi rejects output exceeding its size limit', async context => {
  await assert.rejects(piFixture(context)({
    'pi.extraArgs': '--fake-large'
  }), /2 MB/);
});
test('Pi rejects an already aborted request', async context => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(piFixture(context)({}, controller.signal), /cancelled/);
});
