import os from 'node:os'
import path from 'node:path'

import type { CliConfig } from './state.js'

const ENV_PREFIX = 'DAPP_CLIENT_CLI_'

const envValue = (name: string, fallbackName?: string | string[]): string | undefined => {
  const value = process.env[`${ENV_PREFIX}${name}`]
  if (value && value.length > 0) return value

  if (!fallbackName) return undefined
  const fallbacks = Array.isArray(fallbackName) ? fallbackName : [fallbackName]
  for (const key of fallbacks) {
    const fallbackValue = process.env[key]
    if (fallbackValue && fallbackValue.length > 0) return fallbackValue
  }
  return undefined
}

export const DEFAULT_STATE_PATH = path.join(os.homedir(), '.sequence', 'dapp-client-cli', 'state.enc')

export const resolveStatePath = (input?: string): string => {
  if (!input || input.trim().length === 0) return DEFAULT_STATE_PATH
  if (input.startsWith('~')) {
    return path.join(os.homedir(), input.slice(1))
  }
  return input
}

export const configFromEnv = (): Partial<CliConfig> => ({
  walletUrl: envValue('WALLET_URL', 'WALLET_URL'),
  origin: envValue('ORIGIN', 'ORIGIN'),
  projectAccessKey: envValue('ACCESS_KEY', ['PROJECT_ACCESS_KEY', 'ACCESS_KEY']),
  redirectPath: envValue('REDIRECT_PATH', 'REDIRECT_PATH'),
  keymachineUrl: envValue('KEYMACHINE_URL', 'KEYMACHINE_URL'),
  nodesUrl: envValue('NODES_URL', 'NODES_URL'),
  relayerUrl: envValue('RELAYER_URL', 'RELAYER_URL'),
  transportMode: envValue('TRANSPORT_MODE', 'TRANSPORT_MODE') as CliConfig['transportMode'] | undefined,
})

export const mergeConfig = (base: CliConfig, overrides: Partial<CliConfig>): CliConfig => ({
  ...base,
  ...Object.fromEntries(Object.entries(overrides).filter(([, value]) => value !== undefined)),
})

export const redactConfig = (config: CliConfig): Record<string, unknown> => ({
  walletUrl: config.walletUrl,
  origin: config.origin,
  projectAccessKey: config.projectAccessKey ? '***' : undefined,
  redirectPath: config.redirectPath,
  keymachineUrl: config.keymachineUrl,
  nodesUrl: config.nodesUrl,
  relayerUrl: config.relayerUrl,
  transportMode: config.transportMode,
})
