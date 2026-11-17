'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildPiArgs, validateExtraArgs, splitExtraArgs } = require('../../src/main/providers/launch');
const { openDatabase } = require('../../src/main/db');
const { SettingsStore } = require('../../src/main/settings');
const pi = require('../../src/main/providers/pi-cli');
const { defaults } = require('../../src/main/settings');

const base = { provider: 'openai-codex', model: 'gpt-6.1-sol', thinking: 'high', promptVia: 'stdin' };
const stubStorage = { isEncryptionAvailable: () => true, encryptString: v => Buffer.from(v), decryptString: b => b.toString() };

const rejected = [
  '--tools read,bash', '-t bash', '--no-tools', '--extensions', '--extension ./x.js', '-e ./evil.js', '--extension=./evil.js',
  '--skills', '--skill ./s', '--context-files', '--session /tmp/s.jsonl', '--session-dir /tmp', '--continue', '-c', '--resume',
  '--print', '-p', '--mode rpc', '--provider=anthropic', '--model gpt-4o', '--models a,b', '--thinking off', '--api-key=sk-x',
  '--system-prompt hi', '--append-system-prompt=x', '--PROVIDER=openai', '@secret.txt', '-- extra message'
];
for (const value of rejected) {
  test(`extraArgs rejects ${JSON.stringify(value)} (E-1)`, () => {
    assert.throws(() => validateExtraArgs(splitExtraArgs(value)), /not allowed/);
    assert.throws(() => buildPiArgs({ ...base, extraArgs: value }, 'x'), /not allowed/);
  });
}

for (const value of ['', '--offline', '--verbose', '--fake-fail', '--offline --verbose', '--flag "two words"']) {
  test(`extraArgs allows harmless ${JSON.stringify(value)}`, () => {
    const args = buildPiArgs({ ...base, extraArgs: value }, 'x');
    assert.ok(args.includes('--no-tools'));
  });
}

test('Settings save rejects conflicting extraArgs and keeps the previous value (E-1)', context => {
  const db = openDatabase(':memory:');
  context.after(() => db.close());
  const settings = new SettingsStore({ db, safeStorage: stubStorage });
  settings.save({ 'pi.extraArgs': '--offline' });
  assert.throws(() => settings.save({ 'pi.extraArgs': '--tools bash' }), /not allowed/);
  assert.throws(() => settings.save({ 'pi.extraArgs': '-e=./evil.js' }), /not allowed/);
  assert.equal(settings.getAll()['pi.extraArgs'], '--offline');
});

test('provider refuses to spawn when stored extraArgs conflict (defence in depth, E-1)', async () => {
  await assert.rejects(pi.generate({
    prompt: 'x',
    settings: { ...defaults, 'pi.path': '/nonexistent/pi', 'pi.launchMode': 'direct', 'pi.extraArgs': '--no-session=false --tools bash' }
  }), /not allowed/);
  assert.equal(pi.diagnostics({ ...defaults, 'pi.extraArgs': '--extension x' }).planned.error.includes('not allowed'), true);
});
