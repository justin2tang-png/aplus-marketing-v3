'use strict';

const path = require('node:path');

/** Split extra CLI arguments while preserving quoted values. */
function splitExtraArgs(value = '') {
  const args = [];
  let current = '';
  let quote = null;
  let active = false;
  for (let i = 0; i < value.length; i++) {
    const character = value[i];
    if (character === '\\' && (value[i + 1] === '"' || value[i + 1] === "'")) {
      current += value[++i];
      active = true;
    } else if (quote) {
      if (character === quote) {
        quote = null;
      } else {
        current += character;
      }
    } else if (character === '"' || character === "'") {
      quote = character;
      active = true;
    } else if (/\s/.test(character)) {
      if (active) {
        args.push(current);
        current = '';
        active = false;
      }
    } else {
      current += character;
      active = true;
    }
  }
  if (quote) {
    throw Error('Unclosed quote in extra arguments');
  }
  if (active) {
    args.push(current);
  }
  return args;
}

/**
 * Flags that extra arguments may not set: they would undo the fixed safety flags
 * (--print/--no-tools/--no-extensions/--no-skills/--no-context-files/--no-session) or
 * override provider/model/thinking/system prompt, sessions, files or output mode.
 * Compared case-insensitively on the part before any `=`.
 */
const FORBIDDEN_EXTRA_FLAGS = new Set([
  '--print', '-p', '--mode',
  '--tools', '-t', '--no-tools', '-nt', '--no-builtin-tools', '-nbt',
  '--extension', '--extensions', '-e', '--no-extensions', '-ne',
  '--skill', '--skills', '--no-skills', '-ns',
  '--context-files', '--no-context-files', '-nc',
  '--session', '--sessions', '--no-session', '--session-dir', '--continue', '-c', '--resume', '-r', '--fork', '--export',
  '--provider', '--model', '--models', '--thinking', '--api-key',
  '--system-prompt', '--append-system-prompt', '--prompt-template', '--prompt-templates', '--no-prompt-templates', '-np'
]);

/** Throw if any extra argument conflicts with the fixed Pi flags; returns the args otherwise. */
function validateExtraArgs(args) {
  const rejected = [];
  for (const arg of args) {
    const name = arg.split('=')[0].toLowerCase();
    if (arg === '--' || FORBIDDEN_EXTRA_FLAGS.has(name) || arg.startsWith('@')) {
      rejected.push(name || arg);
    }
  }
  if (rejected.length) {
    throw Error(`Extra arguments not allowed (they would override fixed Pi flags or add input): ${[...new Set(rejected)].join(', ')}`);
  }
  return args;
}

/** Build Pi arguments and append the prompt when argument delivery is selected. */
function buildPiArgs(config, prompt) {
  const args = [
    '--provider', config.provider,
    '--model', config.model,
    '--thinking', config.thinking,
    '--print',
    '--no-tools',
    '--no-extensions',
    '--no-skills',
    '--no-context-files',
    '--no-session',
    ...validateExtraArgs(splitExtraArgs(config.extraArgs))
  ];
  if (config.promptVia === 'arg') {
    args.push(prompt);
  }
  return args;
}

/** Quote an argument for Windows cmd.exe, rejecting line breaks. */
function quoteForCmd(arg) {
  arg = String(arg);
  if (/[\r\n]/.test(arg)) {
    throw Error('Newlines cannot be passed to cmd.exe');
  }
  arg = arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, '$1$1');
  return `"${arg}"`.replace(/[()%!^"<>&|]/g, '^$&');
}

// Known install locations, tried after the path parsed from the shim:
// Pi 1.3.0 (seen on Justin's Windows pi.cmd) and the older 0.73.x package.
const KNOWN_ENTRIES = [
  ['node_modules', '@earendil-works', 'pi-coding-agent', 'dist', 'bundle', 'cli.js'],
  ['node_modules', '@mariozechner', 'pi-coding-agent', 'dist', 'cli.js']
];

/**
 * Extract the JS entry path from an npm cmd-shim (.cmd) file.
 * npm shims end with e.g. `"%_prog%"  "%dp0%\node_modules\<pkg>\dist\cli.js" %*`
 * (older/other generators use `%~dp0\...`, quoted or unquoted). Returns the path relative to
 * the .cmd's directory (may contain `..`), or null when nothing recognisable is found.
 */
function parseCmdShimTarget(content) {
  if (typeof content !== 'string' || !content) {
    return null;
  }
  const pattern = /["']?(?:%dp0%|%~dp0)[\\/]?([^"'%\r\n*<>|]+?\.(?:js|mjs|cjs))(?=["'\s]|$)/gim;
  let last = null;
  for (const match of content.matchAll(pattern)) {
    last = match[1].trim();
  }
  if (!last || path.win32.isAbsolute(last)) {
    return null;
  }
  return last.replace(/\//g, '\\');
}

/**
 * Find Pi's JS entry for node-entry launches: first the target parsed from the .cmd shim,
 * then known locations (Pi 1.3.0 @earendil-works bundle, legacy @mariozechner). Returns {entryPath, entrySource}
 * or null. `tried` lists checked candidates (paths only, no secrets) for diagnostics.
 */
function findNodeEntry(cmdPath, { existsSync, readFileSync }) {
  const dir = path.win32.dirname(cmdPath);
  const tried = [];
  let content = null;
  try {
    content = readFileSync(cmdPath, 'utf8');
  } catch {
    content = null;
  }
  const relative = parseCmdShimTarget(content);
  if (relative) {
    const parsed = path.win32.normalize(path.win32.join(dir, relative));
    tried.push(parsed);
    if (existsSync(parsed)) {
      return { entryPath: parsed, entrySource: 'cmd-shim-parse', tried };
    }
  }
  for (const parts of KNOWN_ENTRIES) {
    const known = path.win32.join(dir, ...parts);
    if (tried.includes(known)) {
      continue;
    }
    tried.push(known);
    if (existsSync(known)) {
      return { entryPath: known, entrySource: 'legacy-path', tried };
    }
  }
  return { entryPath: null, entrySource: null, tried };
}

/** Resolve the executable, arguments and environment for a Pi launch. */
function resolveLaunch({
  cfg: config,
  prompt,
  platform = process.platform,
  env = process.env,
  execPath = process.execPath,
  existsSync = require('node:fs').existsSync,
  readFileSync = require('node:fs').readFileSync
}) {
  let command = config.path;
  const childEnv = {
    ...env
  };
  if (platform === 'win32') {
    command = command.replace(/%([^%]+)%/g, (full, key) => {
      const envKey = Object.keys(env).find(candidate => candidate.toLowerCase() === key.toLowerCase());
      return envKey ? env[envKey] : full;
    });
  }
  const shim = platform === 'win32' && /\.(cmd|bat)$/i.test(command);
  const mode = config.launchMode || 'auto';
  if (shim && mode === 'direct') {
    // Node/Electron refuse to spawn .cmd/.bat without a shell (EINVAL, CVE-2024-27980 fix).
    throw Error('launchMode "direct" cannot start a .cmd/.bat file on Windows; use "auto" or "cmd-shim"');
  }
  let entryInfo = null;
  if (shim && ['auto', 'node-entry'].includes(mode)) {
    entryInfo = findNodeEntry(command, { existsSync, readFileSync });
    if (entryInfo.entryPath) {
      return {
        command: execPath,
        args: [entryInfo.entryPath, ...buildPiArgs(config, prompt)],
        env: {
          ...childEnv,
          ELECTRON_RUN_AS_NODE: '1'
        },
        windowsVerbatimArguments: false,
        promptVia: config.promptVia,
        strategy: 'node-entry',
        entrySource: entryInfo.entrySource,
        entryPath: entryInfo.entryPath,
        tried: entryInfo.tried
      };
    }
    if (mode === 'node-entry') {
      throw Error(`Pi Node entry not found (tried: ${entryInfo.tried.join(', ')})`);
    }
  }
  if (shim && mode !== 'direct') {
    const args = buildPiArgs({
      ...config,
      promptVia: 'stdin'
    }, prompt);
    return {
      command: env.ComSpec || 'cmd.exe',
      args: ['/d', '/s', '/c', '"' + [quoteForCmd(command), ...args.map(quoteForCmd)].join(' ') + '"'],
      env: childEnv,
      windowsVerbatimArguments: true,
      promptVia: 'stdin',
      strategy: 'cmd-shim',
      entrySource: null,
      entryPath: null,
      tried: entryInfo ? entryInfo.tried : []
    };
  }
  return {
    command,
    args: buildPiArgs(config, prompt),
    env: childEnv,
    windowsVerbatimArguments: false,
    promptVia: config.promptVia,
    strategy: 'direct',
    entrySource: null,
    entryPath: null,
    tried: []
  };
}

module.exports = {
  buildPiArgs,
  validateExtraArgs,
  FORBIDDEN_EXTRA_FLAGS,
  parseCmdShimTarget,
  findNodeEntry,
  resolveLaunch,
  quoteForCmd,
  splitExtraArgs
};
