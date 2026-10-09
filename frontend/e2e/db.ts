// Direct access to the e2e database, for what the app offers no way to do
import { execFileSync } from 'node:child_process'
import path from 'node:path'

const COMPOSE_FILE = path.join(import.meta.dirname, '..', '..', 'docker-compose.e2e.yml')

/**
 * Forgets all failed-login counts. The backend allows 10 failed logins per 15 minutes from one address, and every spec runs from the same
 * one, so a spec that fails a login on purpose calls this afterwards to leave the budget to the others
 */
export const resetRateLimits = () => {
  execFileSync(
    'docker',
    ['compose', '-f', COMPOSE_FILE, 'exec', '-T', 'postgres', 'psql', '-U', 'postgres', '-d', 'data_visualizer_e2e', '-c', 'TRUNCATE "RateLimits"'],
    { stdio: 'ignore' }
  )
}
