import { randomBytes, createCipheriv, createDecipheriv, scrypt } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'

import type {
  ETHAuthProof,
  ExplicitSessionData,
  ImplicitSessionData,
  PendingRequestContext,
  SessionlessConnectionData,
} from '@0xsequence/dapp-client'
import type { Hex } from 'ox'
import { jsonReplacers, jsonRevivers } from '@0xsequence/dapp-client'

export type CliConfig = {
  walletUrl?: string
  origin?: string
  projectAccessKey?: string
  redirectPath?: string
  keymachineUrl?: string
  nodesUrl?: string
  relayerUrl?: string
  transportMode?: 'popup' | 'redirect'
}

export type StorageState = {
  pendingRedirect: boolean
  tempSessionPk: Hex.Hex | null
  pendingRequest: PendingRequestContext | null
  explicitSessions: ExplicitSessionData[]
  implicitSession: ImplicitSessionData | null
  sessionlessConnection: SessionlessConnectionData | null
  ethAuthProof: ETHAuthProof | null
  sessionlessConnectionSnapshot: SessionlessConnectionData | null
}

export type CliState = {
  version: 1
  config: CliConfig
  storage: StorageState
  sessionStorage: Record<string, string>
}

const DEFAULT_STORAGE_STATE: StorageState = {
  pendingRedirect: false,
  tempSessionPk: null,
  pendingRequest: null,
  explicitSessions: [],
  implicitSession: null,
  sessionlessConnection: null,
  ethAuthProof: null,
  sessionlessConnectionSnapshot: null,
}

export const DEFAULT_STATE: CliState = {
  version: 1,
  config: {},
  storage: { ...DEFAULT_STORAGE_STATE },
  sessionStorage: {},
}

type EncryptedPayload = {
  version: 1
  kdf: 'scrypt'
  params: {
    N: number
    r: number
    p: number
    keylen: number
  }
  salt: string
  iv: string
  tag: string
  ciphertext: string
}

const KDF_PARAMS = { N: 16384, r: 8, p: 1, keylen: 32 }

const scryptAsync = async (passphrase: string, salt: Buffer, keylen: number, params: typeof KDF_PARAMS) => {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(passphrase, salt, keylen, params, (err, derivedKey) => {
      if (err) reject(err)
      else resolve(derivedKey as Buffer)
    })
  })
}

const encryptState = async (state: CliState, passphrase: string): Promise<EncryptedPayload> => {
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const key = await scryptAsync(passphrase, salt, KDF_PARAMS.keylen, KDF_PARAMS)
  const cipher = createCipheriv('aes-256-gcm', key, iv)

  const plaintext = JSON.stringify(state, jsonReplacers)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()

  return {
    version: 1,
    kdf: 'scrypt',
    params: { ...KDF_PARAMS },
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  }
}

const decryptState = async (payload: EncryptedPayload, passphrase: string): Promise<CliState> => {
  if (payload.version !== 1 || payload.kdf !== 'scrypt') {
    throw new Error('Unsupported encrypted payload version.')
  }

  const salt = Buffer.from(payload.salt, 'base64')
  const iv = Buffer.from(payload.iv, 'base64')
  const tag = Buffer.from(payload.tag, 'base64')
  const ciphertext = Buffer.from(payload.ciphertext, 'base64')

  const key = await scryptAsync(passphrase, salt, payload.params.keylen, payload.params)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)

  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
  const parsed = JSON.parse(plaintext, jsonRevivers) as CliState
  if (!parsed || parsed.version !== 1) {
    throw new Error('Invalid state payload.')
  }
  return parsed
}

const ensureDir = async (filePath: string): Promise<void> => {
  const dir = path.dirname(filePath)
  await fs.mkdir(dir, { recursive: true, mode: 0o700 })
  try {
    await fs.chmod(dir, 0o700)
  } catch {
    // Ignore chmod failures on some systems.
  }
}

export class StateManager {
  private cache: CliState | null = null

  constructor(private readonly statePath: string, private readonly passphrase: string) {}

  async load(): Promise<CliState> {
    if (this.cache) return this.cache
    try {
      const raw = await fs.readFile(this.statePath, 'utf8')
      const payload = JSON.parse(raw) as EncryptedPayload
      const state = await decryptState(payload, this.passphrase)
      this.cache = {
        ...DEFAULT_STATE,
        ...state,
        storage: { ...DEFAULT_STORAGE_STATE, ...state.storage },
        sessionStorage: state.sessionStorage ?? {},
      }
      return this.cache
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message.includes('no such file') || message.includes('ENOENT')) {
        this.cache = { ...DEFAULT_STATE, storage: { ...DEFAULT_STORAGE_STATE } }
        return this.cache
      }
      throw err
    }
  }

  async save(state: CliState): Promise<void> {
    await ensureDir(this.statePath)
    const payload = await encryptState(state, this.passphrase)
    const serialized = JSON.stringify(payload)
    await fs.writeFile(this.statePath, serialized, { mode: 0o600 })
    try {
      await fs.chmod(this.statePath, 0o600)
    } catch {
      // Ignore chmod failures on some systems.
    }
    this.cache = state
  }

  async update(mutator: (state: CliState) => void | Promise<void>): Promise<CliState> {
    const state = await this.load()
    await mutator(state)
    await this.save(state)
    return state
  }

  verifyPassphrase = async (): Promise<boolean> => {
    try {
      const raw = await fs.readFile(this.statePath, 'utf8')
      const payload = JSON.parse(raw) as EncryptedPayload
      await decryptState(payload, this.passphrase)
      return true
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message.includes('no such file') || message.includes('ENOENT')) return true
      return false
    }
  }
}
