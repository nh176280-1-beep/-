import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomBytes } from 'node:crypto';

export function createStore(directory) {
  const root = resolve(directory);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const read = (name, fallback) => {
    try { return JSON.parse(readFileSync(join(root, name + '.json'), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
  };
  const write = (name, data) => {
    const file = join(root, name + '.json');
    const temp = file + '.tmp';
    writeFileSync(temp, JSON.stringify(data, null, 2), { mode: 0o600 });
    renameSync(temp, file);
  };
  if (!existsSync(join(root, 'session-key.json'))) write('session-key', randomBytes(32).toString('hex'));
  return { read, write, key: read('session-key') };
}
