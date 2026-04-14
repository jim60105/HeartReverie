// Plugin: state — Run state-patches binary after LLM response; provide status_data
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { readFile } from 'node:fs/promises';

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

/**
 * Provide status_data as a dynamic template variable.
 * Reads current-status.yml from the story directory, falling back to init-status.yml in the series directory.
 */
export async function getDynamicVariables({ storyDir }) {
  if (!storyDir) return {};

  const currentPath = path.join(storyDir, 'current-status.yml');
  const initPath = path.join(path.dirname(storyDir), 'init-status.yml');

  try {
    const content = await readFile(currentPath, 'utf-8');
    return { status_data: content };
  } catch {
    // Fall through to init
  }

  try {
    const content = await readFile(initPath, 'utf-8');
    return { status_data: content };
  } catch {
    // Neither exists
  }

  return { status_data: '' };
}
