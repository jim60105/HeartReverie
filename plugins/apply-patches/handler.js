// Plugin: apply-patches — Run apply-patches binary after LLM response
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const execFileAsync = promisify(execFile);

export function register(hookDispatcher) {
  hookDispatcher.register('post-response', async (context) => {
    const applyPatchesBin = path.join(context.rootDir, 'apply-patches', 'target', 'release', 'apply-patches');
    try {
      await execFileAsync(applyPatchesBin, ['playground'], { cwd: context.rootDir });
    } catch (err) {
      if (err.code === 'ENOENT') {
        console.warn('⚠️  apply-patches binary not found at', applyPatchesBin);
      } else {
        console.warn('⚠️  apply-patches exited with code', err.code, err.stderr || '');
      }
    }
  }, 100);
}
