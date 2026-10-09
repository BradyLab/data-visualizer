// Test accounts created by backend-express/seeders-e2e/seeder-e2e-01-users.ts, and where each one's saved login lives
import path from 'node:path'

export const E2E_PASSWORD = 'e2e-Passw0rd!'

export const USERS = {
  admin: { email: 'admin@e2e.test', name: 'E2E Admin' },
  lab: { email: 'lab@e2e.test', name: 'E2E Lab Member' },
  external: { email: 'external@e2e.test', name: 'E2E External' },
} as const

export type Role = keyof typeof USERS

/** Saved browser state (the login token in localStorage) written by auth.setup.ts; use with test.use({ storageState: authFile('lab') }) */
export const authFile = (role: Role) => path.join(import.meta.dirname, '.auth', `${role}.json`)

/** Browser state of a logged-out visitor */
export const LOGGED_OUT = { cookies: [], origins: [] }
