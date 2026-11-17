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
    ...splitExtraArgs(config.extraArgs)
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

/** Resolve the executable, arguments and environment for a Pi launch. */
function resolveLaunch({
  cfg: config,
  prompt,
  platform = process.platform,
  env = process.env,
  execPath = process.execPath,
  existsSync = require('node:fs').existsSync
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
  if (shim && ['auto', 'node-entry'].includes(mode)) {
    const cliPath = path.win32.join(path.win32.dirname(command), 'node_modules', '@mariozechner', 'pi-coding-agent', 'dist', 'cli.js');
    if (existsSync(cliPath)) {
      return {
        command: execPath,
        args: [cliPath, ...buildPiArgs(config, prompt)],
        env: {
          ...childEnv,
          ELECTRON_RUN_AS_NODE: '1'
        },
        windowsVerbatimArguments: false,
        promptVia: config.promptVia,
        strategy: 'node-entry'
      };
    }
    if (mode === 'node-entry') {
      throw Error(`Pi Node entry not found: ${cliPath}`);
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
      strategy: 'cmd-shim'
    };
  }
  return {
    command,
    args: buildPiArgs(config, prompt),
    env: childEnv,
    windowsVerbatimArguments: false,
    promptVia: config.promptVia,
    strategy: 'direct'
  };
}

module.exports = {
  buildPiArgs,
  resolveLaunch,
  quoteForCmd,
  splitExtraArgs
};
