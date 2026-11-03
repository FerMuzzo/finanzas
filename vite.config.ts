import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig, type Plugin } from 'vitest/config'
import pkg from './package.json' with { type: 'json' }

// The preview build runs inside a host page that applies its own security policy.
function stripCspForPreview(mode: string): Plugin {
  return {
    name: 'strip-csp-for-preview',
    transformIndexHtml(html) {
      return mode === 'preview' ? html.replace(/\s*<meta http-equiv="Content-Security-Policy"[^>]*>/, '') : html
    },
  }
}

export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [svelte(), stripCspForPreview(mode)],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  build: {
    target: 'es2022',
    sourcemap: false,
    assetsDir: '',
    outDir: mode === 'preview' ? 'dist-preview' : mode === 'e2e' ? 'dist-e2e' : 'dist',
    rollupOptions: {
      output: {
        // The PDF reader's worker is served as .js, a type every static host sends as JavaScript
        assetFileNames: (info: { names?: string[]; name?: string }) =>
          /\.mjs$/.test(info.names?.[0] ?? info.name ?? '') ? '[name]-[hash].js' : '[name]-[hash][extname]',
      },
    },
  },
  test: { environment: 'node', include: ['test/**/*.test.ts'] },
}))
