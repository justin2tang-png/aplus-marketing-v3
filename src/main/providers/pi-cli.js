'use strict';

const { spawn } = require('node:child_process');
const os = require('node:os');
const { resolveLaunch } = require('./launch');
const { redactSecrets } = require('../redact');

/** Build shell-free spawn options for the resolved Pi process. */
function buildSpawnOptions(launch) {
  return {
    shell: false,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
    cwd: os.tmpdir(),
    env: launch.env,
    windowsVerbatimArguments: launch.windowsVerbatimArguments
  };
}

module.exports = {
  buildSpawnOptions,
  id: 'pi-cli',
  label: 'Pi Agent CLI',

  /** Generate a post using this provider. */
  generate({
    prompt,
    settings,
    signal
  }) {
    const config = {};
    for (const key of ['path', 'provider', 'model', 'thinking', 'timeoutSec', 'launchMode', 'promptVia', 'extraArgs']) {
      config[key] = settings[`pi.${key}`];
    }
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        return reject(Error('Pi cancelled'));
      }
      let launch;
      try {
        launch = resolveLaunch({
          cfg: config,
          prompt
        });
      } catch (e) {
        reject(e);
        return;
      }
      let child;
      try {
        child = spawn(launch.command, launch.args, buildSpawnOptions(launch));
      } catch (e) {
        reject(e);
        return;
      }
      let stdout = [];
      let stderr = [];
      let sizes = [0, 0];
      let failure = null;
      let done = false;
      const kill = () => {
        if (process.platform === 'win32' && child.pid) {
          const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
            windowsHide: true,
            stdio: 'ignore'
          });
          killer.on('error', () => child.kill());
        } else {
          child.kill('SIGKILL');
        }
      };
      const fail = message => {
        // Fail and kill only once (e.g. many chunks after the 2 MB cap must not spawn many taskkills).
        if (failure || done) {
          return;
        }
        failure = Error(message);
        kill();
      };
      const abort = () => fail('Pi cancelled');
      const timer = setTimeout(() => fail('Pi timeout'), config.timeoutSec * 1000);
      signal?.addEventListener('abort', abort, {
        once: true
      });
      const finish = (error, result) => {
        if (done) {
          return;
        }
        done = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        error ? reject(error) : resolve(result);
      };
      [child.stdout, child.stderr].forEach((stream, index) => stream.on('data', chunk => {
        if (failure) {
          return;
        }
        sizes[index] += chunk.length;
        if (sizes[index] > 2 * 1024 * 1024) {
          fail('Pi output exceeds 2 MB');
          return;
        }
        (index === 0 ? stdout : stderr).push(chunk);
      }));
      child.on('error', e => finish(e));
      child.stdin.on('error', () => {});
      child.on('close', code => {
        const text = Buffer.concat(stdout).toString('utf8');
        const tail = redactSecrets(Buffer.concat(stderr).toString('utf8').slice(-1000));
        if (failure || code !== 0 || !text.trim()) {
          finish(Error(`${failure?.message || (!text.trim() ? 'Pi empty output' : 'Pi failed')}; exit code ${code}: ${tail}`));
        } else {
          finish(null, {
            text,
            model: config.model
          });
        }
      });
      if (launch.promptVia === 'stdin') {
        child.stdin.write(prompt);
      }
      child.stdin.end();
    });
  }
};
