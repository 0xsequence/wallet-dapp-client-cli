import { jsonReplacers } from '@0xsequence/dapp-client'
import type { SequenceSessionStorage } from '@0xsequence/dapp-client'

const REDIRECT_REQUEST_KEY = 'dapp-redirect-request'

const base64Encode = (value: string): string => Buffer.from(value, 'utf8').toString('base64')

const generateId = (): string => `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 9)}`

export type RedirectUrlParams = {
  action: string
  payload: unknown
  walletUrl: string
  redirectUrl: string
  path?: string
  sessionStorage: SequenceSessionStorage
}

export const createRedirectUrl = async (params: RedirectUrlParams): Promise<string> => {
  const { action, payload, walletUrl, redirectUrl, path, sessionStorage } = params
  const id = generateId()
  const request = { id, action, timestamp: Date.now() }
  await sessionStorage.setItem(REDIRECT_REQUEST_KEY, JSON.stringify(request, jsonReplacers))

  const serializedPayload = base64Encode(JSON.stringify(payload ?? {}, jsonReplacers))
  const fullWalletUrl = path ? `${walletUrl}${path}` : walletUrl
  const url = new URL(fullWalletUrl)
  url.searchParams.set('action', action)
  url.searchParams.set('payload', serializedPayload)
  url.searchParams.set('id', id)
  url.searchParams.set('redirectUrl', redirectUrl)
  url.searchParams.set('mode', 'redirect')
  return url.toString()
}
