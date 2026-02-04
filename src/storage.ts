import { Address, Hex } from 'ox'

import type {
  ExplicitSessionData,
  ImplicitSessionData,
  PendingRequestContext,
  SequenceSessionStorage,
  SequenceStorage,
  SessionlessConnectionData,
} from '@0xsequence/dapp-client'

import { DEFAULT_STATE, type CliState, type StorageState, StateManager } from './state.js'

const cloneStorageState = (state: StorageState): StorageState => ({
  pendingRedirect: state.pendingRedirect,
  tempSessionPk: state.tempSessionPk,
  pendingRequest: state.pendingRequest,
  explicitSessions: [...state.explicitSessions],
  implicitSession: state.implicitSession,
  sessionlessConnection: state.sessionlessConnection,
  sessionlessConnectionSnapshot: state.sessionlessConnectionSnapshot,
})

export class FileSequenceStorage implements SequenceStorage {
  private readonly suppressPendingRedirect: boolean

  constructor(private readonly stateManager: StateManager, options?: { suppressPendingRedirect?: boolean }) {
    this.suppressPendingRedirect = options?.suppressPendingRedirect ?? false
  }

  private async readState(): Promise<CliState> {
    return await this.stateManager.load()
  }

  async setPendingRedirectRequest(isPending: boolean): Promise<void> {
    await this.stateManager.update((state) => {
      state.storage.pendingRedirect = isPending
    })
  }

  async isRedirectRequestPending(): Promise<boolean> {
    if (this.suppressPendingRedirect) return false
    const state = await this.readState()
    return state.storage.pendingRedirect
  }

  async saveTempSessionPk(pk: Hex.Hex): Promise<void> {
    await this.stateManager.update((state) => {
      state.storage.tempSessionPk = pk
    })
  }

  async getAndClearTempSessionPk(): Promise<Hex.Hex | null> {
    let value: Hex.Hex | null = null
    await this.stateManager.update((state) => {
      value = state.storage.tempSessionPk as Hex.Hex | null
      state.storage.tempSessionPk = null
    })
    return value
  }

  async savePendingRequest(context: PendingRequestContext): Promise<void> {
    await this.stateManager.update((state) => {
      state.storage.pendingRequest = context
    })
  }

  async getAndClearPendingRequest(): Promise<PendingRequestContext | null> {
    let value: PendingRequestContext | null = null
    await this.stateManager.update((state) => {
      value = state.storage.pendingRequest
      state.storage.pendingRequest = null
    })
    return value
  }

  async peekPendingRequest(): Promise<PendingRequestContext | null> {
    const state = await this.readState()
    return state.storage.pendingRequest
  }

  async saveExplicitSession(sessionData: ExplicitSessionData): Promise<void> {
    await this.stateManager.update((state) => {
      const existing = state.storage.explicitSessions.filter(
        (session) =>
          !(
            Address.isEqual(session.walletAddress, sessionData.walletAddress) &&
            session.pk === sessionData.pk &&
            session.chainId === sessionData.chainId
          ),
      )
      state.storage.explicitSessions = [...existing, sessionData]
    })
  }

  async getExplicitSessions(): Promise<ExplicitSessionData[]> {
    const state = await this.readState()
    return [...state.storage.explicitSessions]
  }

  async clearExplicitSessions(): Promise<void> {
    await this.stateManager.update((state) => {
      state.storage.explicitSessions = []
    })
  }

  async saveImplicitSession(sessionData: ImplicitSessionData): Promise<void> {
    await this.stateManager.update((state) => {
      state.storage.implicitSession = sessionData
    })
  }

  async getImplicitSession(): Promise<ImplicitSessionData | null> {
    const state = await this.readState()
    return state.storage.implicitSession ?? null
  }

  async clearImplicitSession(): Promise<void> {
    await this.stateManager.update((state) => {
      state.storage.implicitSession = null
    })
  }

  async saveSessionlessConnection(sessionData: SessionlessConnectionData): Promise<void> {
    await this.stateManager.update((state) => {
      state.storage.sessionlessConnection = sessionData
    })
  }

  async getSessionlessConnection(): Promise<SessionlessConnectionData | null> {
    const state = await this.readState()
    return state.storage.sessionlessConnection ?? null
  }

  async clearSessionlessConnection(): Promise<void> {
    await this.stateManager.update((state) => {
      state.storage.sessionlessConnection = null
    })
  }

  async saveSessionlessConnectionSnapshot(sessionData: SessionlessConnectionData): Promise<void> {
    await this.stateManager.update((state) => {
      state.storage.sessionlessConnectionSnapshot = sessionData
    })
  }

  async getSessionlessConnectionSnapshot(): Promise<SessionlessConnectionData | null> {
    const state = await this.readState()
    return state.storage.sessionlessConnectionSnapshot ?? null
  }

  async clearSessionlessConnectionSnapshot(): Promise<void> {
    await this.stateManager.update((state) => {
      state.storage.sessionlessConnectionSnapshot = null
    })
  }

  async clearAllData(): Promise<void> {
    await this.stateManager.update((state) => {
      state.storage = cloneStorageState(DEFAULT_STATE.storage)
      state.sessionStorage = {}
    })
  }
}

export class FileSessionStorage implements SequenceSessionStorage {
  constructor(private readonly stateManager: StateManager) {}

  async getItem(key: string): Promise<string | null> {
    const state = await this.stateManager.load()
    return state.sessionStorage[key] ?? null
  }

  async setItem(key: string, value: string): Promise<void> {
    await this.stateManager.update((state) => {
      state.sessionStorage[key] = value
    })
  }

  async removeItem(key: string): Promise<void> {
    await this.stateManager.update((state) => {
      delete state.sessionStorage[key]
    })
  }
}
