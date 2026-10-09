import { createReadStream, existsSync, statSync } from 'node:fs';
import { cp } from 'node:fs/promises';
import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';

/**
 * Dev-only: the Vite dev server injects an inline React Refresh preamble and talks to its HMR
 * websocket, which the strict production CSP forbids. Relax the CSP in `serve` mode only.
 */
function devCsp(): Plugin {
  return {
    name: 'simple-pdf:dev-csp',
    apply: 'serve',
    transformIndexHtml(html) {
      return html
        .replace(/script-src 'self'/, "script-src 'self' 'unsafe-inline'")
        .replace(/connect-src 'self'/, "connect-src 'self' ws://localhost:* http://localhost:*");
    },
  };
}

/**
 * Serves/copies PDF.js runtime assets (cmaps, standard fonts, wasm, icc) from `pdfjs-dist` as
 * local files under `<renderer root>/pdfjs/`. Never fetched from a CDN. The quickjs scripting
 * sandbox is deliberately excluded (PDF scripting is disabled).
 */
function pdfjsAssets(): Plugin {
  const dirs = ['cmaps', 'standard_fonts', 'wasm', 'iccs'];
  const root = resolve('node_modules/pdfjs-dist');
  let outDir = '';
  return {
    name: 'simple-pdf:pdfjs-assets',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    configureServer(server) {
      server.middlewares.use('/pdfjs', (req, res, next) => {
        const rel = decodeURIComponent((req.url ?? '').split('?')[0] ?? '');
        const file = resolve(root, '.' + rel);
        if (rel.includes('..') || !dirs.some((d) => file.startsWith(resolve(root, d))))
          return next();
        if (!existsSync(file) || !statSync(file).isFile()) return next();
        createReadStream(file).pipe(res);
      });
    },
    async writeBundle() {
      for (const d of dirs) {
        await cp(resolve(root, d), resolve(outDir, 'pdfjs', d), {
          recursive: true,
          filter: (src) => !/quickjs-eval/.test(src),
        });
      }
    },
  };
}

const alias = {
  '@renderer': resolve('src/renderer/src'),
  '@shared': resolve('src/shared'),
};

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': resolve('src/shared') } },
  },
  preload: {
    // Sandboxed preload scripts cannot require() node_modules: keep this one dependency-free.
    resolve: { alias: { '@shared': resolve('src/shared') } },
  },
  renderer: {
    resolve: { alias },
    plugins: [react(), devCsp(), pdfjsAssets()],
  },
});
