'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase } = require('../../src/main/db');
const { SettingsStore } = require('../../src/main/settings');
const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: value => Buffer.from('encrypted:' + Buffer.from([...Buffer.from(value)].map(byte => byte ^ 91)).toString('base64')),
  decryptString: ciphertext => Buffer.from([...Buffer.from(ciphertext.toString().slice(10), 'base64')].map(byte => byte ^ 91)).toString(),
  getSelectedStorageBackend: () => 'test'
};

function settingsFixture(context) {
  const database = openDatabase(':memory:');
  context.after(() => database.close());
  return {
    database,
    settings: new SettingsStore({
      db: database,
      safeStorage
    })
  };
}
test('settings return the default Pi timeout', context => {
  assert.equal(settingsFixture(context).settings.getAll()['pi.timeoutSec'], 360);
});
test('settings save a valid backup retention value', context => {
  const {
    settings
  } = settingsFixture(context);
  settings.save({
    'backup.keep': 4
  });
  assert.equal(settings.getAll()['backup.keep'], 4);
});
for (const [name, patch] of [['backup retention', {
  'backup.keep': 0
}], ['thinking level', {
  'pi.thinking': 'bad'
}], ['timeout', {
  'pi.timeoutSec': 2
}]]) {
  test(`settings reject invalid ${name}`, context => {
    assert.throws(() => settingsFixture(context).settings.save(patch));
  });
}
test('invalid settings leave the entire save unapplied', context => {
  const {
    settings
  } = settingsFixture(context);
  assert.throws(() => settings.save({
    'brand.name': 'Changed',
    'pi.timeoutSec': 2
  }));
  assert.equal(settings.getAll()['brand.name'], 'A Plus Finance');
});
test('secret encryption round trips through safeStorage', context => {
  const {
    settings
  } = settingsFixture(context);
  settings.setSecret('openai.apiKey', 'unit-fixture-value');
  assert.equal(settings.getSecret('openai.apiKey'), 'unit-fixture-value');
});
test('secret ciphertext does not contain plaintext', context => {
  const {
    database,
    settings
  } = settingsFixture(context);
  const value = 'unit-fixture-value';
  settings.setSecret('openai.apiKey', value);
  assert.equal(database.prepare('SELECT ciphertext FROM secrets').get().ciphertext.includes(Buffer.from(value)), false);
});
test('long secrets reveal only their last four characters in listings', context => {
  const {
    settings
  } = settingsFixture(context);
  settings.setSecret('openai.apiKey', 'unit-fixture-value');
  assert.deepEqual(settings.listSecrets(), [{
    name: 'openai.apiKey',
    masked: '••••alue'
  }]);
});
test('short secrets are completely masked', context => {
  const {
    settings
  } = settingsFixture(context);
  settings.setSecret('short', 'abc');
  assert.deepEqual(settings.listSecrets(), [{
    name: 'short',
    masked: '••••'
  }]);
});
test('secret names reject spaces', context => {
  assert.throws(() => settingsFixture(context).settings.setSecret('bad name', 'a'));
});
test('secret status reports the selected storage backend', context => {
  assert.equal(settingsFixture(context).settings.status().backend, 'test');
});
test('clearing a secret removes its value', context => {
  const {
    settings
  } = settingsFixture(context);
  settings.setSecret('short', 'abc');
  settings.clearSecret('short');
  assert.equal(settings.getSecret('short'), undefined);
});
test('secret writes fail when encryption is unavailable', context => {
  const {
    database
  } = settingsFixture(context);
  const settings = new SettingsStore({
    db: database,
    safeStorage: {
      ...safeStorage,
      isEncryptionAvailable: () => false
    }
  });
  assert.throws(() => settings.setSecret('new', 'x'), /unavailable/);
  assert.equal(database.prepare('SELECT count(*) AS count FROM secrets').get().count, 0);
});

test('listSecrets masks undecryptable secrets instead of throwing', context => {
  const { database } = settingsFixture(context);
  const writer = new SettingsStore({ db: database, safeStorage });
  writer.setSecret('openai.apiKey', 'sk-test-1234567890');
  const broken = { ...safeStorage, decryptString: () => { throw new Error('DPAPI failure'); } };
  const reader = new SettingsStore({ db: database, safeStorage: broken });
  assert.deepEqual(reader.listSecrets(), [{ name: 'openai.apiKey', masked: '•••• (cannot decrypt)' }]);
});
