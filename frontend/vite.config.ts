import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const DOCS = fileURLToPath(new URL('../docs/', import.meta.url))
const TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
}

const LANDING_ASSETS = ['index.html', 'screenshot.png', 'logo.svg', 'favicon.svg']

/**
 * The landing page lives in docs/ and is served at "/" everywhere: by the backend,
 * by this dev server, and on static hosting via the rewrite in vercel.json.
 * Copied into the build as landing.html so there is only ever one copy of it.
 */
function landingAtRoot(): Plugin {
  return {
    name: 'kiroku-landing',
    closeBundle() {
      mkdirSync('dist', { recursive: true })
      for (const name of LANDING_ASSETS) {
        if (!existsSync(`${DOCS}${name}`)) continue
        copyFileSync(`${DOCS}${name}`, `dist/${name === 'index.html' ? 'landing.html' : name}`)
      }
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? '').split('?')[0]
        const file = url === '/' ? `${DOCS}index.html` : `${DOCS}${url.slice(1)}`
        const ext = file.slice(file.lastIndexOf('.'))
        if (!url.includes('..') && TYPES[ext] && existsSync(file)) {
          res.setHeader('Content-Type', TYPES[ext])
          res.end(readFileSync(file))
          return
        }
        next()
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), landingAtRoot()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
})
