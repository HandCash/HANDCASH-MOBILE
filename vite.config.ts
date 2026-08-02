import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { aeonUiOptimizeDeps, aeonUiViteAliases } from 'aeon-ui-engine/vite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DESKTOP_ROOT = path.resolve(__dirname, '../HANDCASH-DESKTOP')
const DESKTOP_SRC = path.join(DESKTOP_ROOT, 'src')

export default defineConfig({
  plugins: [react()],
  base: './',
  resolve: {
    alias: [
      ...aeonUiViteAliases(),
      { find: '@', replacement: DESKTOP_SRC },
      // Resolve Desktop app modules from the sibling repo.
      { find: /^@desktop\/(.*)/, replacement: path.join(DESKTOP_SRC, '$1') },
    ],
    dedupe: ['react', 'react-dom', 'xstate', '@xstate/react', '@bsv/sdk'],
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
      'qrcode',
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
