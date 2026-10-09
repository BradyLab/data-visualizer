// Ports, URLs and backend environment of the e2e stack, shared by playwright.config.ts and run-local.ts
// (imports use .ts extensions because run-local.ts runs under Node's native type stripping)
import path from 'node:path'
import { E2E_PASSWORD } from './users.ts'

export const FRONTEND_PORT = 3100
export const BACKEND_PORT = 3101
export const FRONTEND_URL = `http://localhost:${FRONTEND_PORT}`
export const BACKEND_URL = `http://localhost:${BACKEND_PORT}`

// Folder the e2e backend stores uploaded files in (gitignored)
const UPLOAD_DIR = path.join(import.meta.dirname, '.tmp', 'uploads')

export const BACKEND_ENV = {
  API_PORT: String(BACKEND_PORT),
  BACKEND_URL,
  FRONTEND_URL,
  DB_HOST: 'localhost',
  DB_PORT: '5433',
  DB_NAME: 'data_visualizer_e2e',
  DB_USERNAME: 'postgres',
  DB_PASSWORD: 'postgres',
  DEFAULT_PASSWORD: 'e2e-default-password',
  E2E_PASSWORD,
  JWT_SECRET: 'e2e-only-secret',
  JWT_EXPIRES_IN: '8h',
  UPLOAD_DIR,
}

export const FRONTEND_ENV = { VITE_BACKEND_URL: BACKEND_URL, VITE_API_PATH: '/api' }
