// Helpers that set up and inspect state through the backend API, so specs only drive the UI for the part they are testing.
// Every dataset gets a unique name and url, so specs never collide with each other or with leftovers of an earlier run
import { expect, type APIRequestContext, type Page } from '@playwright/test'
import { DatasetVisibility, type IDataset } from '@commons/dataset'
import type { FileTypes, IFile } from '@commons/file'
import type { PermissionOptions } from '@commons/permissions'
import { UserStatus, type IUser, type UserRoles } from '@commons/user'
import { BACKEND_ENV, BACKEND_URL, FRONTEND_URL } from './stack'
import { E2E_PASSWORD, USERS, type Role } from './users'

const API = `${BACKEND_URL}/api`

export interface Session {
  token: string
  user: IUser
}

// Logins are cached per worker: the backend rate-limits logins per account, and every spec needs a session
const sessions = new Map<Role, Promise<Session>>()

/** Logs in through the API (once per worker and role); the tests' users are ACTIVE, so this returns a usable token */
export const login = (request: APIRequestContext, role: Role): Promise<Session> => {
  let session = sessions.get(role)
  if (!session) {
    session = (async () => {
      // The backend counts logins per account while they are in flight, so many workers logging in as one account at once can get a 429
      for (let attempt = 1; ; attempt++) {
        const response = await request.post(`${API}/auth/login`, { data: { email: USERS[role].email, password: E2E_PASSWORD } })
        if (response.status() === 429 && attempt < 6) {
          await new Promise((resolve) => setTimeout(resolve, 300 * attempt))
          continue
        }
        expect(response.ok(), `API login as ${role} (status ${response.status()})`).toBeTruthy()
        return (await response.json()) as Session
      }
    })()
    // A failed login must not be cached for the rest of the worker
    session.catch(() => sessions.delete(role))
    sessions.set(role, session)
  }
  return session
}

const bearer = (session: Session) => ({ Authorization: `Bearer ${session.token}` })

/** A short id that is unique across runs and workers */
export const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

/** Creates a dataset (PRIVATE unless overridden) owned by the session's user; `name` and `url` default to unique values */
export const createDataset = async (request: APIRequestContext, session: Session, fields: Partial<IDataset> = {}): Promise<IDataset> => {
  const id = uid()
  const response = await request.post(`${API}/datasets`, {
    headers: bearer(session),
    data: {
      name: `E2E dataset ${id}`,
      url: `e2e-${id}`,
      description: 'Created by an e2e test',
      doi: '',
      attribution: '',
      treatments: [],
      plots: [],
      visibility: DatasetVisibility.PRIVATE,
      ...fields,
    },
  })
  expect(response.status(), 'create dataset').toBe(201)
  return response.json()
}

export const updateDataset = async (request: APIRequestContext, session: Session, id: string, fields: Partial<IDataset>) => {
  const response = await request.put(`${API}/datasets/${id}`, { headers: bearer(session), data: fields })
  expect(response.status(), 'update dataset').toBe(200)
}

export const deleteDataset = async (request: APIRequestContext, session: Session, id: string) => {
  const response = await request.delete(`${API}/datasets/${id}`, { headers: bearer(session) })
  expect(response.ok(), 'delete dataset').toBeTruthy()
}

export const grant = async (
  request: APIRequestContext,
  owner: Session,
  datasetId: string,
  userId: string,
  perm: PermissionOptions
) => {
  const response = await request.post(`${API}/permissions`, {
    headers: bearer(owner),
    data: { user_id: userId, dataset_id: datasetId, perm },
  })
  expect(response.status(), 'grant permission').toBe(201)
}

export const changeGrant = async (
  request: APIRequestContext,
  owner: Session,
  datasetId: string,
  userId: string,
  perm: PermissionOptions
) => {
  const response = await request.put(`${API}/permissions/${userId}/${datasetId}`, { headers: bearer(owner), data: { perm } })
  expect(response.status(), 'change permission').toBe(200)
}

export const revoke = async (request: APIRequestContext, owner: Session, datasetId: string, userId: string) => {
  const response = await request.delete(`${API}/permissions/${userId}/${datasetId}`, { headers: bearer(owner) })
  expect(response.ok(), 'revoke permission').toBeTruthy()
}

const b64 = (value: string) => Buffer.from(value).toString('base64')

/**
 * Uploads a file with the tus protocol, as the frontend does (create the upload, then send the bytes in one request).
 * Returns the HTTP status of the step that ended the upload: 200 or 204 when the file was stored, otherwise the rejection from the create step
 */
export const uploadFile = async (
  request: APIRequestContext,
  session: Session,
  datasetId: string,
  type: FileTypes,
  filename: string,
  content: Buffer
) => {
  const headers = { ...bearer(session), 'Tus-Resumable': '1.0.0', Origin: FRONTEND_URL }
  const created = await request.post(`${API}/files/upload`, {
    headers: {
      ...headers,
      'Upload-Length': String(content.length),
      'Upload-Metadata': `dataset_id ${b64(datasetId)},type ${b64(type)},filename ${b64(filename)}`,
    },
  })
  if (created.status() !== 201) return created.status()
  const sent = await request.patch(created.headers()['location']!, {
    headers: { ...headers, 'Upload-Offset': '0', 'Content-Type': 'application/offset+octet-stream' },
    data: content,
  })
  return sent.status()
}

/** Uploads a file and fails the test unless it was stored */
export const uploadFileOk = async (...args: Parameters<typeof uploadFile>) => {
  expect([200, 204], 'file upload status').toContain(await uploadFile(...args))
}

/**
 * Asks for a download link for the dataset's current file of a type and, if it is issued, fetches the bytes with it
 * (the two steps the Data button takes). status is the first step that failed, or 200
 */
export const download = async (request: APIRequestContext, session: Session | null, datasetId: string, type: FileTypes) => {
  const path = `${API}/files/current/${datasetId}/${type}`
  const issued = await request.post(`${path}/download-token`, { headers: session ? bearer(session) : {} })
  if (!issued.ok()) return { status: issued.status(), body: null }
  const { token } = await issued.json()
  const file = await request.get(`${path}/content`, { params: { token } })
  return { status: file.status(), body: file.ok() ? await file.body() : null }
}

/** The status of a direct read of a file's bytes with the session's login header (null session = a logged-out guest) */
export const readFile = async (request: APIRequestContext, session: Session | null, datasetId: string, type: FileTypes) => {
  const response = await request.get(`${API}/files/current/${datasetId}/${type}/content`, { headers: session ? bearer(session) : {} })
  return { status: response.status(), body: response.ok() ? await response.body() : null }
}

/** Resolves when the page has received a dataset list from the server (the app asks for one on load and on every login) */
export const waitForDatasetList = (page: Page) =>
  page.waitForResponse((r) => r.request().method() === 'GET' && /\/api\/datasets$/.test(r.url()))

/**
 * Opens a page and resolves once its live-update websocket is up and its first dataset list has arrived, so a change made through the
 * API right after is not missed (the server only pushes to sockets that are already connected) and is not overwritten by a late list
 */
export const gotoLive = async (page: Page, url: string) => {
  const socket = page.waitForEvent('websocket', (ws) => ws.url().includes('/socket.io'))
  const list = waitForDatasetList(page)
  await page.goto(url)
  await socket
  await list
}

/** The password a newly invited user starts with (DEFAULT_PASSWORD of the e2e backend) */
export const DEFAULT_PASSWORD = BACKEND_ENV.DEFAULT_PASSWORD

/** A user created by a spec, with the password they can currently log in with */
export interface TestUser extends Session {
  email: string
  password: string
}

/**
 * Invites a user with a unique email (status INVITED, on the default password). Specs that change users create their own,
 * so the seeded accounts, whose saved logins every other spec uses, are never touched
 */
export const inviteUser = async (request: APIRequestContext, admin: Session, role: UserRoles, name = `E2E ${uid()}`): Promise<TestUser> => {
  const email = `e2e-${uid()}@e2e.test`
  const created = await request.post(`${API}/users`, { headers: bearer(admin), data: { name, email, role } })
  expect(created.status(), 'invite user').toBe(201)
  const user: IUser = await created.json()
  // Invited users can log in, but the API refuses most calls until they change the default password
  const response = await request.post(`${API}/auth/login`, { data: { email, password: DEFAULT_PASSWORD } })
  expect(response.ok(), 'login of invited user').toBeTruthy()
  const { token } = (await response.json()) as Session
  return { token, user, email, password: DEFAULT_PASSWORD }
}

/** Changes the password of the session's user and returns the session with the fresh token (older tokens stop working) */
export const changePassword = async (request: APIRequestContext, user: TestUser, newPassword: string): Promise<TestUser> => {
  const response = await request.post(`${API}/auth/change-password`, {
    headers: bearer(user),
    data: { oldPassword: user.password, newPassword },
  })
  expect(response.status(), 'change password').toBe(200)
  const { token } = await response.json()
  return { ...user, token, password: newPassword, user: { ...user.user, status: UserStatus.ACTIVE } }
}

/** Invites a user and takes them through the first password change, so they are ACTIVE and can use the API */
export const activeUser = async (request: APIRequestContext, admin: Session, role: UserRoles, name?: string) =>
  changePassword(request, await inviteUser(request, admin, role, name), `Active-${uid()}-pw`)

export const updateUser = (request: APIRequestContext, admin: Session, id: string, fields: Partial<IUser>) =>
  request.put(`${API}/users/${id}`, { headers: bearer(admin), data: fields })

export const deleteUser = (request: APIRequestContext, admin: Session, id: string) =>
  request.delete(`${API}/users/${id}`, { headers: bearer(admin) })

/** The raw login response, for specs that check what a login does not allow */
export const tryLogin = (request: APIRequestContext, email: string, password: string) =>
  request.post(`${API}/auth/login`, { data: { email, password } })

/** A user's permission on a dataset as the owner sees it: the response status and, if there is one, the level */
export const getPermission = async (request: APIRequestContext, owner: Session, userId: string, datasetId: string) => {
  const response = await request.get(`${API}/permissions/${userId}/${datasetId}`, { headers: bearer(owner) })
  return { status: response.status(), perm: response.ok() ? ((await response.json()).perm as PermissionOptions) : null }
}

export const getDataset = async (request: APIRequestContext, session: Session, id: string): Promise<IDataset> => {
  const response = await request.get(`${API}/datasets/${id}`, { headers: bearer(session) })
  expect(response.status(), 'get dataset').toBe(200)
  return response.json()
}

/** The raw response of a dataset update, for specs that check what an update is refused */
export const tryUpdateDataset = (request: APIRequestContext, session: Session, id: string, fields: Partial<IDataset>) =>
  request.put(`${API}/datasets/${id}`, { headers: bearer(session), data: fields })

/** The raw response of looking a dataset up by its url (null session = a logged-out guest) */
export const getDatasetByUrl = (request: APIRequestContext, session: Session | null, url: string) =>
  request.get(`${API}/datasets/byURL/${url}`, { headers: session ? bearer(session) : {} })

/** Every file record of a dataset, all versions, newest last */
export const listFiles = async (request: APIRequestContext, session: Session, datasetId: string): Promise<IFile[]> => {
  const response = await request.get(`${API}/files/byDataset/${datasetId}`, { headers: bearer(session) })
  expect(response.status(), 'list files').toBe(200)
  const files: IFile[] = await response.json()
  return files.sort((a, b) => a.version - b.version)
}

/** The raw response of listing the datasets (null session = a logged-out guest) */
export const listDatasets = (request: APIRequestContext, session: Session | null) =>
  request.get(`${API}/datasets`, { headers: session ? bearer(session) : {} })

/** The raw response of creating a dataset, for specs that check who may not */
export const tryCreateDataset = (request: APIRequestContext, session: Session) =>
  request.post(`${API}/datasets`, {
    headers: bearer(session),
    data: { name: `Refused ${uid()}`, url: `refused-${uid()}`, description: '', doi: '', attribution: '', treatments: [], plots: [] },
  })
