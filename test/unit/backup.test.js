'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase } = require('../../src/main/db');
const { BackupManager } = require('../../src/main/backup');

function backupFixture(context) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aplus-backup-'));
  const database = openDatabase(path.join(directory, 'source.db'));
  let clock = new Date('2026-01-01T12:00:00Z');
  const backup = new BackupManager({
    db: database,
    dir: path.join(directory, 'backups'),
    keep: 2,
    now: () => clock
  });
  context.after(() => {
    backup.stop();
    database.close();
    fs.rmSync(directory, {
      recursive: true,
      force: true
    });
  });
  return {
    database,
    backup,
    advance: milliseconds => {
      clock = new Date(+clock + milliseconds);
    }
  };
}
test('backup is due when no previous file exists', context => {
  assert.equal(backupFixture(context).backup.isDue(), true);
});
test('backup becomes due at exactly 24 hours', async context => {
  const {
    backup,
    advance
  } = backupFixture(context);
  await backup.runBackup();
  advance(86399000);
  assert.equal(backup.isDue(), false);
  advance(1000);
  assert.equal(backup.isDue(), true);
});
test('start creates an initial backup and an unreferenced timer', async context => {
  const {
    backup
  } = backupFixture(context);
  await backup.start();
  assert.equal(backup.status().count, 1);
  assert.equal(backup.timer.hasRef(), false);
});
test('online backup is a valid SQLite database containing content', async context => {
  const {
    database,
    backup
  } = backupFixture(context);
  database.createContent({
    title: 'Persist me'
  });
  await backup.runBackup();
  const saved = openDatabase(path.join(backup.dir, backup.files()[0].name));
  try {
    assert.equal(saved.listContents()[0].title, 'Persist me');
  } finally {
    saved.close();
  }
});
test('backup prunes files beyond the configured retention', async context => {
  const {
    backup,
    advance
  } = backupFixture(context);
  for (let index = 0; index < 3; index++) {
    await backup.runBackup();
    advance(86400000);
  }
  assert.deepEqual(backup.files().map(file => file.name), ['aplus-20260103-120000.db', 'aplus-20260102-120000.db']);
});
test('backup records the latest backup time in metadata', async context => {
  const {
    database,
    backup
  } = backupFixture(context);
  await backup.runBackup();
  assert.equal(database.prepare('SELECT value FROM meta WHERE key=?').get('last_backup_at').value, '2026-01-01T12:00:00.000Z');
});
test('legacy backup filenames fall back to the file modification time', context => {
  const {
    backup
  } = backupFixture(context);
  const file = path.join(backup.dir, 'aplus-legacy.db');
  fs.writeFileSync(file, '');
  assert.equal(backup.files()[0].time, fs.statSync(file).mtimeMs);
});
