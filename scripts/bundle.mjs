import { build } from 'esbuild';
import { mkdirSync, copyFileSync } from 'node:fs';
mkdirSync('dist', { recursive: true });
for (const app of ['relay', 'bridge']) {
  await build({ entryPoints: [`packages/${app}/src/${app === 'relay' ? 'server' : 'main'}.ts`], outfile: `dist/${app}.mjs`, bundle: true, platform: 'node', target: 'node22', format: 'esm',
    banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" }, logLevel: 'info' });
}
copyFileSync('packages/bridge/src/catalog.py', 'dist/catalog.py');
