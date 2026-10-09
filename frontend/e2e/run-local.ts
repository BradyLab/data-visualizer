// Runs the e2e tests quickly on a machine where Playwright's "is a server already running?" probe hangs for ~2 minutes per closed port
// (seen on WSL2 with mirrored networking). Starts Postgres, the backend and the frontend itself, waits for their ready messages instead of probing
// ports, runs Playwright against them (it finds them up and reuses them), then stops everything. Usage: npm run test:e2e:fast -- [playwright args]
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import process from 'node:process'
import path from 'node:path'
import { BACKEND_ENV, FRONTEND_ENV, FRONTEND_PORT } from './stack.ts'

// The frontend is served from a production build (a few seconds), not the Vite dev server: the dev server serves hundreds of unbundled
// modules per page load, which made parallel specs slow and flaky. E2E_DEV=1 uses the dev server instead (for debugging with hot reload)
const useDevServer = !!process.env.E2E_DEV
const DIST = path.join(import.meta.dirname, '.tmp', 'dist')

const compose = ['compose', '-f', '../docker-compose.e2e.yml']
const children: ChildProcess[] = []

// Stops the servers (each runs in its own process group, so the npm/tsx/vite children go with it) and wipes the test database
const cleanup = () => {
  for (const child of children) {
    try {
      if (child.pid) process.kill(-child.pid, 'SIGTERM')
    } catch {
      // already gone
    }
  }
  spawnSync('docker', [...compose, 'down', '-v'], { stdio: 'ignore' })
}
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    cleanup()
    process.exit(130)
  })

// Starts a server and resolves once its output contains the ready text; rejects if it exits first or takes over 2 minutes
const start = (name: string, command: string, args: string[], env: Record<string, string>, ready: string) =>
  new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { env: { ...process.env, ...env }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
    children.push(child)
    let output = ''
    const timer = setTimeout(() => reject(new Error(`${name} did not become ready in 2 minutes:\n${output}`)), 120_000)
    const onData = (chunk: Buffer) => {
      output += chunk.toString()
      if (output.includes(ready)) {
        clearTimeout(timer)
        resolve()
      }
    }
    child.stdout?.on('data', onData)
    child.stderr?.on('data', onData)
    child.on('exit', (code) => reject(new Error(`${name} exited with code ${code}:\n${output}`)))
  })

let exitCode = 1
try {
  spawnSync('docker', [...compose, 'down', '-v'], { stdio: 'inherit' })
  const db = spawnSync('docker', [...compose, 'up', '-d', '--wait'], { stdio: 'inherit' })
  if (db.status !== 0) throw new Error('Could not start the e2e database')
  if (!useDevServer) {
    const build = spawnSync('npx', ['vite', 'build', '--outDir', DIST, '--emptyOutDir'], {
      env: { ...process.env, ...FRONTEND_ENV },
      stdio: 'inherit',
    })
    if (build.status !== 0) throw new Error('The frontend build failed')
  }
  await Promise.all([
    start('backend', 'npm', ['--prefix', '../backend-express', 'run', 'e2e:start'], BACKEND_ENV, 'SERVER IS NOW FULLY READY'),
    // Vite prints its URL once it is listening; --strictPort fails instead of moving to another port
    start(
      'frontend',
      'npx',
      useDevServer
        ? ['vite', '--host', '--port', String(FRONTEND_PORT), '--strictPort']
        : ['vite', 'preview', '--outDir', DIST, '--port', String(FRONTEND_PORT), '--strictPort'],
      FRONTEND_ENV,
      `:${FRONTEND_PORT}`
    ),
  ])
  exitCode = spawnSync('npx', ['playwright', 'test', ...process.argv.slice(2)], { stdio: 'inherit' }).status ?? 1
} catch (err) {
  console.error(err instanceof Error ? err.message : err)
} finally {
  cleanup()
}
process.exit(exitCode)
