'use strict';

const Database = require('better-sqlite3');

/** Open the SQLite database and expose content repository operations. */
function openDatabase(filePath) {
  const db = new Database(filePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  if (db.pragma('user_version', {
    simple: true
  }) < 1) {
    db.transaction(() => {
      db.exec(`CREATE TABLE IF NOT EXISTS contents(id INTEGER PRIMARY KEY, topic TEXT, title TEXT, body TEXT, platform TEXT, status TEXT CHECK(status IN ('draft','approved')), provider TEXT, model TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT);
    CREATE TABLE IF NOT EXISTS secrets(name TEXT PRIMARY KEY,ciphertext BLOB,updated_at TEXT);
    CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT); PRAGMA user_version=1;`);
    })();
  }
  const fields = ['topic', 'title', 'body', 'platform', 'status', 'provider', 'model'];
  return {
    db,

    /** Prepare a SQL statement on this connection. */
    prepare: (...args) => db.prepare(...args),

    /** Create an online SQLite backup. */
    backup: target => db.backup(target),

    /** Close the database connection. */
    close: () => db.close(),

    /** List content matching a search, newest updates first. */
    listContents({
      search = ''
    } = {}) {
      return db.prepare('SELECT * FROM contents WHERE title LIKE ? OR body LIKE ? OR topic LIKE ? ORDER BY updated_at DESC,id DESC').all(...Array(3).fill(`%${search}%`));
    },

    /** Return a content row by ID. */
    getContent(id) {
      return db.prepare('SELECT * FROM contents WHERE id=?').get(id);
    },

    /** Insert content with timestamps and a default draft status. */
    createContent(input) {
      const now = new Date().toISOString();
      const values = fields.map(field => input[field] ?? (field === 'status' ? 'draft' : ''));
      const insertResult = db.prepare(`INSERT INTO contents(${fields.join(',')},created_at,updated_at) VALUES (${Array(9).fill('?').join(',')})`).run(...values, now, now);
      return this.getContent(Number(insertResult.lastInsertRowid));
    },

    /** Update supported fields and return the saved row. */
    updateContent(id, patch) {
      const keys = fields.filter(field => Object.hasOwn(patch, field));
      if (!keys.length) {
        return this.getContent(id);
      }
      db.prepare(`UPDATE contents SET ${keys.map(field => `${field}=?`).join(',')},updated_at=? WHERE id=?`).run(...keys.map(field => patch[field]), new Date().toISOString(), id);
      return this.getContent(id);
    },

    /** Delete a content row and report whether it existed. */
    deleteContent(id) {
      return db.prepare('DELETE FROM contents WHERE id=?').run(id).changes > 0;
    }
  };
}

module.exports = {
  openDatabase
};
