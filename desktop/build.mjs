import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const desktopRoot = fileURLToPath(new URL('./', import.meta.url));
const projectRoot = path.dirname(desktopRoot);
const stagingRoot = path.resolve(desktopRoot, 'app');
// Only replace this generated staging directory; never touch app data or source.
if (stagingRoot !== path.join(desktopRoot, 'app') || path.relative(desktopRoot, stagingRoot) !== 'app') throw new Error('Invalid desktop staging directory.');
const stat = await fs.lstat(stagingRoot).catch(() => null);
if (stat && (stat.isSymbolicLink() || await fs.realpath(stagingRoot) !== stagingRoot)) throw new Error('Desktop staging must not be a symlink.');
await fs.rm(stagingRoot, { recursive: true, force: true });
await fs.mkdir(path.join(stagingRoot, 'lib'), { recursive: true });
await build({ configFile: path.join(desktopRoot, 'vite.config.mjs') });
await Promise.all(['main.cjs', 'protocol.cjs'].map(file => fs.copyFile(path.join(desktopRoot, file), path.join(stagingRoot, file))));
await Promise.all(['tiktok-provider.js', 'research-provider.js', 'discovery.js'].map(file => fs.copyFile(path.join(projectRoot, 'lib', file), path.join(stagingRoot, 'lib', file))));
const pkg = JSON.parse(await fs.readFile(path.join(projectRoot, 'package.json'), 'utf8'));
await fs.writeFile(path.join(stagingRoot, 'package.json'), JSON.stringify({
  name: 'droplab-desktop', productName: 'DropLab', version: pkg.version,
  description: 'Product discovery and research workspace', author: 'David Pu',
  private: true, type: 'module', main: 'main.cjs',
}, null, 2) + '\n');
const icon = path.join(desktopRoot, 'assets', 'icon.png');
if (await fs.stat(icon).catch(() => null)) await fs.copyFile(icon, path.join(stagingRoot, 'icon.png'));
console.log(`Desktop app staged at ${stagingRoot}`);
