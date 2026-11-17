'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { buildPiArgs, resolveLaunch, quoteForCmd, splitExtraArgs } = require('../../src/main/providers/launch');
const config = {
  path: '%appdata%\\npm\\pi.CMD',
  provider: 'openai-codex',
  model: 'gpt-6.1-sol',
  thinking: 'high',
  promptVia: 'arg',
  extraArgs: '--flag "two words"',
  launchMode: 'auto'
};
const windowsOptions = {
  cfg: config,
  prompt: '首次置业 KiwiSaver\nsecond line',
  platform: 'win32',
  env: {
    APPDATA: 'C:\\Users\\Becky\\AppData',
    ComSpec: 'C:\\Windows\\cmd.exe'
  },
  execPath: 'C:\\A Plus\\electron.exe',
  existsSync: () => false
};

// Table entries each register a separate test for one quoting behaviour.
const quotingCases = [['double quotes', 'a"b', '^"a\\^"b^"'], ['ampersand', 'a&b', '^"a^&b^"'], ['pipe', 'a|b', '^"a^|b^"'], ['literal environment variable', '%VAR%', '^"^%VAR^%^"'], ['caret', 'a^b', '^"a^^b^"'], ['less than', 'a<b', '^"a^<b^"'], ['greater than', 'a>b', '^"a^>b^"'], ['parentheses', '(text)', '^"^(text^)^"'], ['trailing backslash', 'C:\\path\\', '^"C:\\path\\\\^"'], ['spaces in path', 'C:\\Program Files\\pi.cmd', '^"C:\\Program Files\\pi.cmd^"'], ['Chinese text', '首次置业 KiwiSaver', '^"首次置业 KiwiSaver^"'], ['exclamation mark', 'a!b', '^"a^!b^"']];
for (const [name, input, expected] of quotingCases) {
  test(`quoteForCmd escapes ${name}`, () => {
    assert.equal(quoteForCmd(input), expected);
  });
  test(`resolveLaunch quotes ${name} in cmd-shim arguments`, () => {
    const launch = resolveLaunch({
      ...windowsOptions,
      cfg: {
        ...config,
        launchMode: 'cmd-shim',
        provider: input
      }
    });
    assert.ok(launch.args[3].includes(`^"--provider^" ${expected} ^"--model^"`));
  });
}
for (const newline of ['\n', '\r', '\r\n']) {
  test(`quoteForCmd rejects ${JSON.stringify(newline)}`, () => {
    assert.throws(() => quoteForCmd(`before${newline}after`), /Newlines/);
  });
  test(`resolveLaunch rejects ${JSON.stringify(newline)} in cmd arguments`, () => {
    assert.throws(() => resolveLaunch({
      ...windowsOptions,
      cfg: {
        ...config,
        provider: `before${newline}after`
      }
    }), /Newlines/);
  });
}
test('buildPiArgs includes the provider, model and thinking settings', () => {
  assert.deepEqual(buildPiArgs(config, 'hello').slice(0, 6), ['--provider', 'openai-codex', '--model', 'gpt-6.1-sol', '--thinking', 'high']);
});
for (const flag of ['--print', '--no-tools', '--no-extensions', '--no-skills', '--no-context-files', '--no-session']) {
  test(`buildPiArgs includes ${flag}`, () => {
    assert.ok(buildPiArgs(config, 'hello').includes(flag));
  });
}
test('buildPiArgs appends the positional prompt after extra arguments', () => {
  assert.deepEqual(buildPiArgs(config, 'hello').slice(-3), ['--flag', 'two words', 'hello']);
});
test('buildPiArgs omits the prompt when it is sent through stdin', () => {
  assert.equal(buildPiArgs({
    ...config,
    promptVia: 'stdin'
  }, 'hello').includes('hello'), false);
});
test('splitExtraArgs preserves empty quoted arguments', () => {
  assert.deepEqual(splitExtraArgs("a '' 'b c'"), ['a', '', 'b c']);
});
test('splitExtraArgs rejects unclosed quotes', () => {
  assert.throws(() => splitExtraArgs('"oops'), /Unclosed quote/);
});
test('node-entry finds cli.js with Windows paths even on Linux', () => {
  const cliPath = path.win32.join(windowsOptions.env.APPDATA, 'npm', 'node_modules', '@mariozechner', 'pi-coding-agent', 'dist', 'cli.js');
  const launch = resolveLaunch({
    ...windowsOptions,
    existsSync: candidate => candidate === cliPath
  });
  assert.equal(launch.strategy, 'node-entry');
  assert.equal(launch.args[0], cliPath);
});
test('node-entry uses execPath and enables ELECTRON_RUN_AS_NODE', () => {
  const launch = resolveLaunch({
    ...windowsOptions,
    existsSync: () => true
  });
  assert.equal(launch.command, windowsOptions.execPath);
  assert.equal(launch.env.ELECTRON_RUN_AS_NODE, '1');
  assert.equal(launch.env.APPDATA, windowsOptions.env.APPDATA);
  assert.equal(windowsOptions.env.ELECTRON_RUN_AS_NODE, undefined);
});
test('node-entry passes newlines and Chinese as one plain positional prompt', () => {
  const launch = resolveLaunch({
    ...windowsOptions,
    existsSync: () => true
  });
  assert.equal(launch.promptVia, 'arg');
  assert.equal(launch.windowsVerbatimArguments, false);
  assert.deepEqual(launch.args.slice(1), buildPiArgs(config, windowsOptions.prompt));
  assert.equal(launch.args.at(-1), '首次置业 KiwiSaver\nsecond line');
});
test('cmd-shim forces stdin even when promptVia is arg', () => {
  const launch = resolveLaunch({
    ...windowsOptions,
    cfg: {
      ...config,
      launchMode: 'cmd-shim'
    },
    existsSync: () => true
  });
  assert.equal(launch.strategy, 'cmd-shim');
  assert.equal(launch.promptVia, 'stdin');
  assert.equal(launch.args.join('').includes(windowsOptions.prompt), false);
});
test('auto falls back to cmd-shim when cli.js is missing', () => {
  const launch = resolveLaunch(windowsOptions);
  assert.equal(launch.strategy, 'cmd-shim');
  assert.equal(launch.command, windowsOptions.env.ComSpec);
  assert.deepEqual(launch.args.slice(0, 3), ['/d', '/s', '/c']);
  assert.equal(launch.windowsVerbatimArguments, true);
});
test('cmd-shim uses cmd.exe when ComSpec is absent', () => {
  assert.equal(resolveLaunch({
    ...windowsOptions,
    env: {}
  }).command, 'cmd.exe');
});
test('resolveLaunch quotes a shim path containing spaces', () => {
  const launch = resolveLaunch({
    ...windowsOptions,
    cfg: {
      ...config,
      path: 'C:\\Program Files\\pi.cmd'
    }
  });
  assert.ok(launch.args[3].startsWith('"^"C:\\Program Files\\pi.cmd^" '));
});
for (const variable of ['%APPDATA%', '%appdata%', '%AppData%']) {
  test(`resolveLaunch expands ${variable} case-insensitively`, () => {
    const launch = resolveLaunch({
      ...windowsOptions,
      cfg: {
        ...config,
        path: `${variable}\\npm\\pi.exe`
      },
      env: {
        aPpDaTa: 'C:\\Profile'
      }
    });
    assert.equal(launch.command, 'C:\\Profile\\npm\\pi.exe');
  });
}
test('node-entry mode throws when cli.js is missing', () => {
  assert.throws(() => resolveLaunch({
    ...windowsOptions,
    cfg: {
      ...config,
      launchMode: 'node-entry'
    }
  }), /Pi Node entry not found: .*cli\.js/);
});
test('Windows executable uses direct mode', () => {
  assert.equal(resolveLaunch({
    ...windowsOptions,
    cfg: {
      ...config,
      path: 'pi.exe'
    }
  }).strategy, 'direct');
});
test('direct mode on Linux preserves the prompt as a plain argument', () => {
  const launch = resolveLaunch({
    ...windowsOptions,
    platform: 'linux',
    cfg: {
      ...config,
      path: '/opt/Pi Agent/pi',
      launchMode: 'direct'
    }
  });
  assert.equal(launch.strategy, 'direct');
  assert.equal(launch.command, '/opt/Pi Agent/pi');
  assert.deepEqual(launch.args, buildPiArgs(config, windowsOptions.prompt));
  assert.equal(launch.env.ELECTRON_RUN_AS_NODE, undefined);
});
