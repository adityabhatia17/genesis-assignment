import { fork, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LIMITS } from '../../../../../contracts/limits.js';
import type { Observation } from './sandbox-entry.js';

const require = createRequire(import.meta.url);

function entryFile(): string {
  const raw = fileURLToPath(import.meta.url);
  const js = raw.endsWith('.ts') ? raw.replace(/\.ts$/, '.js') : raw;
  const sibling = js.includes('/src/') ? js.replace('/src/', '/lib/') : js;
  return sibling.replace(/run-in-sandbox\.js$/, 'sandbox-entry.js');
}

const failed = (scenario: string, error: string): Observation => ({
  scenario,
  error,
  calls: [],
  text: '',
  buttons: [],
  inputs: 0,
  hasImgPayload: false,
});

/**
 * Runs one scenario in a child process with an empty environment.
 * Node's permission model does not block network; this still keeps the
 * model code out of the Functions process. See plan risk R1.
 */
export function runInSandbox(html: string, scenario: string): Promise<Observation> {
  const timeoutMs = LIMITS.variants.scenarioTimeoutMs;
  const nodeModules = dirname(dirname(require.resolve('jsdom/package.json')));
  const entry = entryFile();
  return new Promise((resolve) => {
    let child: ChildProcess;
    try {
      child = fork(entry, [], {
        execArgv: [
          '--permission',
          `--allow-fs-read=${nodeModules}`,
          `--allow-fs-read=${dirname(entry)}`,
          `--max-old-space-size=${LIMITS.variants.sandboxMemoryMb}`,
        ],
        env: {},
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      });
    } catch (err) {
      resolve(failed(scenario, err instanceof Error ? err.message : 'sandbox failed to start'));
      return;
    }
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve(failed(scenario, 'scenario timed out'));
    }, timeoutMs);
    let settled = false;
    const finish = (obs: Observation) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(obs);
    };
    child.once('message', (msg: Observation) => finish(msg));
    child.once('exit', (code) => {
      if (code === 0 || code === null) return;
      finish(failed(scenario, `sandbox exited ${code}`));
    });
    child.send({ html, scenario });
  });
}
