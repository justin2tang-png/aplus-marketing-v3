'use strict';

const fs = require('node:fs');
const path = require('node:path');

/** Create and retain scheduled online database backups. */
class BackupManager {

  /** Initialize the backup directory, retention and scheduling clock. */
  constructor({
    db,
    dir,
    keep = 7,
    now = () => new Date(),
    intervalMs = 3600000
  }) {
    Object.assign(this, {
      db,
      dir,
      keep,
      now,
      intervalMs
    });
    fs.mkdirSync(dir, {
      recursive: true
    });
  }

  /** List backup files from newest to oldest, using mtime for legacy names. */
  files() {
    return fs.readdirSync(this.dir).filter(name => /^aplus-.*\.db$/.test(name)).map(name => {
      const match = /^aplus-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.db$/.exec(name);
      const time = match ? new Date(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}Z`).getTime() : NaN;
      return {
        name,
        time: Number.isFinite(time) ? time : fs.statSync(path.join(this.dir, name)).mtimeMs
      };
    }).sort((a, b) => b.time - a.time || b.name.localeCompare(a.name));
  }

  /** Return the newest backup time, or null when no backup exists. */
  latestBackupTime() {
    const file = this.files()[0];
    return file ? new Date(file.time) : null;
  }

  /** Check whether the latest backup is at least 24 hours old. */
  isDue() {
    const last = this.latestBackupTime();
    return !last || this.now() - last >= 86400000;
  }

  /** Run one backup, sharing any already pending operation. */
  runBackup() {
    if (this.pending) {
      return this.pending;
    }
    this.pending = this.performBackup().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  /** Create an online backup, record its time and prune old files. */
  async performBackup() {
    const date = this.now();
    const stamp = date.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
    const target = path.join(this.dir, `aplus-${stamp}.db`);
    await this.db.backup(target);
    this.db.prepare('INSERT OR REPLACE INTO meta VALUES (?,?)').run('last_backup_at', date.toISOString());
    for (const file of this.files().slice(this.keep)) {
      fs.unlinkSync(path.join(this.dir, file.name));
    }
    return this.status();
  }

  /** Return the latest backup time, file count and directory. */
  status() {
    return {
      lastBackupAt: this.latestBackupTime()?.toISOString() || null,
      count: this.files().length,
      dir: this.dir
    };
  }

  /** Check immediately and start an unreferenced periodic timer. */
  async start() {
    if (this.timer) {
      return;
    }
    await this.check();
    this.timer = setInterval(() => this.check().catch(() => {}), this.intervalMs);
    this.timer.unref();
  }

  /** Create a backup only when one is due. */
  async check() {
    if (this.isDue()) {
      await this.runBackup();
    }
  }

  /** Stop the periodic backup timer. */
  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }
}

module.exports = {
  BackupManager
};
