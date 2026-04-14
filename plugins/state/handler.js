// Plugin: state — Run state-patches binary after LLM response
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const execFileAsync = promisify(execFile);

export function register(hookDispatcher) {
  hookDispatcher.register('post-response', async (context) => {
    const statePatchesBin = path.join(context.rootDir, 'plugins', 'state', 'state-patches');
    try {
      await execFileAsync(statePatchesBin, ['playground'], { cwd: context.rootDir });
    } catch (err) {
      if (err.code === 'ENOENT') {
        console.warn('⚠️  state-patches binary not found at', statePatchesBin);
      } else {
        console.warn('⚠️  state-patches exited with code', err.code, err.stderr || '');
      }
    }
  }, 100);
}
