'use strict';
const Database = require('better-sqlite3');
function openDatabase(filePath) {
  const db = new Database(filePath);
  db.pragma('journal_mode = WAL'); db.pragma('foreign_keys = ON');
  if (db.pragma('user_version', { simple: true }) < 1) db.transaction(() => {
    db.exec(`CREATE TABLE IF NOT EXISTS contents(id INTEGER PRIMARY KEY, topic TEXT, title TEXT, body TEXT, platform TEXT, status TEXT CHECK(status IN ('draft','approved')), provider TEXT, model TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT);
    CREATE TABLE IF NOT EXISTS secrets(name TEXT PRIMARY KEY,ciphertext BLOB,updated_at TEXT);
    CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT); PRAGMA user_version=1;`);
  })();
  const fields = ['topic','title','body','platform','status','provider','model'];
  return {
    db, prepare: (...a) => db.prepare(...a), backup: target => db.backup(target), close: () => db.close(),
    listContents({search = ''} = {}) { return db.prepare('SELECT * FROM contents WHERE title LIKE ? OR body LIKE ? OR topic LIKE ? ORDER BY updated_at DESC,id DESC').all(...Array(3).fill(`%${search}%`)); },
    getContent(id) { return db.prepare('SELECT * FROM contents WHERE id=?').get(id); },
    createContent(obj) { const now = new Date().toISOString(); const values = fields.map(k => obj[k] ?? (k === 'status' ? 'draft' : '')); const r = db.prepare(`INSERT INTO contents(${fields.join(',')},created_at,updated_at) VALUES (${Array(9).fill('?').join(',')})`).run(...values,now,now); return this.getContent(Number(r.lastInsertRowid)); },
    updateContent(id, patch) { const keys = fields.filter(k => Object.hasOwn(patch,k)); if (!keys.length) return this.getContent(id); db.prepare(`UPDATE contents SET ${keys.map(k=>`${k}=?`).join(',')},updated_at=? WHERE id=?`).run(...keys.map(k=>patch[k]),new Date().toISOString(),id); return this.getContent(id); },
    deleteContent(id) { return db.prepare('DELETE FROM contents WHERE id=?').run(id).changes > 0; }
  };
}
module.exports = { openDatabase };
