'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase } = require('../../src/main/db');

function databaseFixture(context) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aplus-db-'));
  const file = path.join(directory, 'test.db');
  let database = openDatabase(file);
  context.after(() => {
    database.close();
    fs.rmSync(directory, {
      recursive: true,
      force: true
    });
  });
  return {
    get database() {
      return database;
    },
    reopen() {
      database.close();
      database = openDatabase(file);
      return database;
    }
  };
}
test('new content defaults to draft', context => {
  const {
    database
  } = databaseFixture(context);
  assert.equal(database.createContent({
    title: 'First home'
  }).status, 'draft');
});
test('content search matches the topic', context => {
  const {
    database
  } = databaseFixture(context);
  database.createContent({
    topic: 'KiwiSaver',
    title: 'First home',
    body: 'Advice'
  });
  assert.equal(database.listContents({
    search: 'KiwiSaver'
  }).length, 1);
});
test('content updates persist the changed fields', context => {
  const {
    database
  } = databaseFixture(context);
  const row = database.createContent({
    title: 'Original'
  });
  const updated = database.updateContent(row.id, {
    title: 'Edited',
    status: 'approved'
  });
  assert.equal(updated.title, 'Edited');
  assert.equal(updated.status, 'approved');
});
test('content rejects an invalid status', context => {
  const {
    database
  } = databaseFixture(context);
  const row = database.createContent({
    title: 'Original'
  });
  assert.throws(() => database.updateContent(row.id, {
    status: 'invalid'
  }));
});
test('migration is idempotent and preserves stored content', context => {
  const fixture = databaseFixture(context);
  const row = fixture.database.createContent({
    title: 'Persisted'
  });
  const reopened = fixture.reopen();
  assert.equal(reopened.db.pragma('user_version', {
    simple: true
  }), 1);
  assert.equal(reopened.getContent(row.id).title, 'Persisted');
});
test('deleting content removes the row', context => {
  const {
    database
  } = databaseFixture(context);
  const row = database.createContent({
    title: 'Delete me'
  });
  assert.equal(database.deleteContent(row.id), true);
  assert.equal(database.getContent(row.id), undefined);
});
