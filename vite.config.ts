import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { aeonUiOptimizeDeps, aeonUiViteAliases } from 'aeon-ui-engine/vite'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DESKTOP_ROOT = path.resolve(__dirname, '../HANDCASH-DESKTOP')
const DESKTOP_SRC = path.join(DESKTOP_ROOT, 'src')

// Desktop sources ship a Desktop semver constant; the Mobile shell must show its own.
const pkg = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'),
) as { version: string }

export default defineConfig({
  plugins: [react()],
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    // Same scrypt-ts shims as Desktop — hardened collectable sends need them.
    'process.env.NETWORK': JSON.stringify(''),
    'process.env.BASEURL': JSON.stringify(''),
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'process.env': JSON.stringify({
      NETWORK: '',
      BASEURL: '',
      NODE_ENV: process.env.NODE_ENV ?? 'production',
    }),
  },
  resolve: {
    alias: [
      ...aeonUiViteAliases(),
      { find: '@', replacement: DESKTOP_SRC },
      // Resolve Desktop app modules from the sibling repo.
      { find: /^@desktop\/(.*)/, replacement: path.join(DESKTOP_SRC, '$1') },
      // Prefer Mobile node_modules when bundling Desktop sources (Desktop
      // node_modules may be absent during a parallel/clean mobile-only build).
      // Exact-match only — prefix aliases break @bsv/sdk package exports
      // (e.g. @bsv/sdk/primitives/AESGCM → dist/esm/...).
      {
        find: /^@bsv\/wallet-toolbox-client$/,
        replacement: path.resolve(
          __dirname,
          'node_modules/@bsv/wallet-toolbox-client',
        ),
      },
      {
        find: /^@bsv\/sdk$/,
        replacement: path.resolve(__dirname, 'node_modules/@bsv/sdk'),
      },
    ],
    dedupe: [
      'react',
      'react-dom',
      'xstate',
      '@xstate/react',
      '@bsv/sdk',
      '@bsv/wallet-toolbox-client',
    ],
  },
  optimizeDeps: {
    ...aeonUiOptimizeDeps(),
    include: [
      ...(aeonUiOptimizeDeps().include ?? []),
      'react',
      'react-dom',
      '@bsv/sdk',
      '@bsv/wallet-toolbox-client',
      'html5-qrcode',
      '@zxing/browser',
      '@zxing/library',
      'qrcode',
      'buffer',
    ],
  },
  server: {
    port: 5174,
    host: true,
    fs: {
      allow: [DESKTOP_ROOT, __dirname],
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
  },
})
