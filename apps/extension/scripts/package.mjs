// Zip dist/ into the file the Chrome Web Store dashboard accepts.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const manifest = JSON.parse(readFileSync(`${root}dist/manifest.json`, 'utf8'));
if (manifest.host_permissions) {
  throw new Error('dist/ is an e2e build (it has host_permissions). Run `pnpm build` first.');
}
mkdirSync(`${root}release`, { recursive: true });
const out = `${root}release/passvaultify-${manifest.version}.zip`;
if (existsSync(out)) rmSync(out);
execFileSync('zip', ['-r', '-X', '-q', out, '.'], { cwd: `${root}dist` });
console.log(`Packaged ${out}`);
