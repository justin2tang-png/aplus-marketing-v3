'use strict';

const path = require('node:path');
const { splitExtraArgs, validateExtraArgs } = require('./providers/launch');
const { redactSecrets } = require('./redact');
const defaults = {
  'ai.provider': 'pi-cli',
  'pi.path': process.platform === 'win32' ? path.win32.join(process.env.APPDATA || '', 'npm', 'pi.cmd') : 'pi',
  'pi.provider': 'openai-codex',
  'pi.model': 'gpt-6.1-sol',
  'pi.thinking': 'high',
  'pi.timeoutSec': 360,
  'pi.launchMode': 'auto',
  'pi.promptVia': 'stdin',
  'pi.extraArgs': '',
  'brand.name': 'A Plus Finance',
  'backup.keep': 7
};
const choices = {
  'pi.thinking': ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'],
  'pi.launchMode': ['auto', 'node-entry', 'cmd-shim', 'direct'],
  'pi.promptVia': ['stdin', 'arg']
};

/** Persist validated settings and encrypted secrets. */
class SettingsStore {

  /** Use the injected database and encryption backend. */
  constructor({
    db,
    safeStorage,
    logger = console
  }) {
    this.db = db;
    this.safeStorage = safeStorage;
    this.logger = logger;
  }

  /** Merge persisted settings with application defaults. */
  getAll() {
    const result = {
      ...defaults
    };
    for (const row of this.db.prepare('SELECT * FROM settings').all()) {
      if (!Object.hasOwn(defaults, row.key)) {
        continue;
      }
      // A corrupt row must not stop the app: keep the default for that key and warn
      // (key + reason only, redacted; the stored value itself is never logged).
      let value;
      try {
        value = JSON.parse(row.value);
      } catch (error) {
        this.logger.warn(redactSecrets(`settings: ignoring corrupt value for "${row.key}" (${error.name}); using default`));
        continue;
      }
      if (typeof value !== typeof defaults[row.key]) {
        this.logger.warn(redactSecrets(`settings: ignoring wrong-type value for "${row.key}"; using default`));
        continue;
      }
      result[row.key] = value;
    }
    return result;
  }

  /** Validate the entire patch before saving settings atomically. */
  save(patch) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      throw Error('Invalid settings');
    }
    for (const [key, value] of Object.entries(patch)) {
      if (!Object.hasOwn(defaults, key)) {
        throw Error(`Unknown setting: ${key}`);
      }
      if (typeof value !== typeof defaults[key] || typeof value === 'string' && value.length > 8192) {
        throw Error(`Invalid ${key}`);
      }
      if (choices[key] && !choices[key].includes(value)) {
        throw Error(`Invalid ${key}`);
      }
      if (key === 'pi.timeoutSec' && (!Number.isInteger(value) || value < 10 || value > 1800)) {
        throw Error('Invalid timeout');
      }
      if (key === 'backup.keep' && (!Number.isInteger(value) || value < 1 || value > 60)) {
        throw Error('Invalid backup keep');
      }
    }
    if (Object.hasOwn(patch, 'pi.extraArgs')) {
      validateExtraArgs(splitExtraArgs(patch['pi.extraArgs']));
    }
    const merged = { ...this.getAll(), ...patch };
    if (merged['pi.launchMode'] === 'direct' && /\.(cmd|bat)\s*$/i.test(merged['pi.path'])) {
      throw Error('Launch mode "direct" cannot run a .cmd/.bat Pi path (Windows EINVAL); choose "auto" or "cmd-shim"');
    }
    const run = this.db.db || this.db;
    run.transaction(() => {
      for (const [key, value] of Object.entries(patch)) {
        this.db.prepare('INSERT OR REPLACE INTO settings VALUES (?,?)').run(key, JSON.stringify(value));
      }
    })();
    return this.getAll();
  }

  /** Reject unsupported secret names. */
  validateName(name) {
    if (typeof name !== 'string' || !/^[a-z0-9_.-]{1,64}$/i.test(name)) {
      throw Error('Invalid secret name');
    }
  }

  /** Encrypt and store a secret, requiring encryption availability. */
  setSecret(name, value) {
    this.validateName(name);
    if (typeof value !== 'string' || value.length > 65536) {
      throw Error('Invalid secret value');
    }
    if (!this.encryptionUsable()) {
      throw Error('Encryption unavailable');
    }
    this.db.prepare('INSERT OR REPLACE INTO secrets VALUES (?,?,?)').run(name, this.safeStorage.encryptString(value), new Date().toISOString());
  }

  /** Decrypt a secret for use in the main process only. */
  getSecret(name) {
    this.validateName(name);
    const row = this.db.prepare('SELECT ciphertext FROM secrets WHERE name=?').get(name);
    return row ? this.safeStorage.decryptString(row.ciphertext) : undefined;
  }

  /** Remove a stored secret by name. */
  clearSecret(name) {
    this.validateName(name);
    this.db.prepare('DELETE FROM secrets WHERE name=?').run(name);
  }

  /** List secret names with masked values safe for the renderer. */
  listSecrets() {
    return this.db.prepare('SELECT name FROM secrets ORDER BY name').all().map(({
      name
    }) => {
      let value;
      try {
        value = this.getSecret(name);
      } catch {
        // e.g. DPAPI blob created under another Windows user; never expose ciphertext.
        return { name, masked: '•••• (cannot decrypt)' };
      }
      return {
        name,
        masked: '••••' + (value.length >= 8 ? value.slice(-4) : '')
      };
    });
  }

  /** Storage backend name; getSelectedStorageBackend exists on Linux only. */
  backend() {
    try {
      if (typeof this.safeStorage.getSelectedStorageBackend === 'function') {
        return this.safeStorage.getSelectedStorageBackend();
      }
    } catch {
      // fall through
    }
    return process.platform === 'win32' ? 'dpapi' : 'unknown';
  }

  /**
   * True only when secrets would really be encrypted. Linux 'basic_text' uses a hard-coded
   * key (effectively plaintext), so it is treated as unavailable.
   */
  encryptionUsable() {
    if (!this.safeStorage.isEncryptionAvailable()) {
      return false;
    }
    return this.backend() !== 'basic_text';
  }

  /** Report encryption availability, backend and masked secrets. */
  status() {
    return {
      encryptionAvailable: this.encryptionUsable(),
      backend: this.backend(),
      names: this.listSecrets()
    };
  }
}

module.exports = {
  SettingsStore,
  defaults
};
