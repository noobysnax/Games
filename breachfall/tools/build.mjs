// Bundles src/ into single-file pages:
//   dist/index.html     standalone page (open it, or host it anywhere static)
//   dist/artifact.html  the same page without <html>/<head>/<body>, for publishing as a Claude artifact
// three.js stays external and loads from the CDN through the import map in index.html.
import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = await build({
  entryPoints: [join(root, 'src/main.js')], bundle: true, format: 'esm', write: false, minify: true, target: 'es2020',
  external: ['three', 'three/addons/*'], legalComments: 'none',
});
const js = out.outputFiles[0].text.replace(/<\/script/g, '<\\/script');
const html = await readFile(join(root, 'index.html'), 'utf8');
const tag = '<script type="module" src="src/main.js"></script>';
if (!html.includes(tag)) throw new Error('index.html no longer has the module script tag the build replaces');
const inline = (h) => h.replace(tag, () => `<script type="module">\n${js}</script>`);
const parts = [...html.matchAll(/<!--page-->([\s\S]*?)<!--\/page-->/g)].map((m) => m[1].trim());
if (parts.length !== 2) throw new Error('index.html should have two <!--page--> blocks (head and body)');
await mkdir(join(root, 'dist'), { recursive: true });
await writeFile(join(root, 'dist/index.html'), inline(html).replace(/<!--\/?page-->\n?/g, ''));
await writeFile(join(root, 'dist/artifact.html'), inline(parts.join('\n\n')) + '\n');
console.log(`built dist/index.html and dist/artifact.html (${(js.length / 1024).toFixed(0)} KB of game code)`);
