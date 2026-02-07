#!/usr/bin/env node
import 'dotenv/config'
import './fetch.js'
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'
import http from 'node:http'
import { execFile } from 'node:child_process'
import { createPublicClient, http as viemHttp } from 'viem'

import { AbiFunction, Address, Secp256k1 } from 'ox'
import {
  DappClient,
  RequestActionType,
  TransportMode,
  getExplorerUrl,
  getNetwork,
  getRpcUrl,
  jsonReplacers,
  type AddExplicitSessionPayload,
  type CreateNewSessionPayload,
  type ExplicitSession,
  type ExplicitSessionConfig,
  type FeeOption,
  type LoginMethod,
  type ModifyExplicitSessionPayload,
  type SendWalletTransactionPayload,
  type SignMessagePayload,
  type SignTypedDataPayload,
  type Transaction,
  type TransactionRequest,
} from '@0xsequence/dapp-client'

import { DEFAULT_STATE_PATH, configFromEnv, mergeConfig, redactConfig, resolveStatePath } from './config.js'
import { readJsonInput } from './input.js'
import { resolvePassphrase } from './passphrase.js'
import { createRedirectUrl } from './redirect.js'
import { StateManager, type CliConfig } from './state.js'
import { FileSequenceStorage, FileSessionStorage } from './storage.js'
import { explicitSessionDefaults } from './explicit-session.config.js'
import { includeFeeOptionPermissions } from './permissions/fee-options.js'

type GlobalArgs = {
  state?: string
  passphrase?: string
  prompt?: boolean
  debug?: boolean
  listen?: boolean
  listenTimeout?: number
  openUrl?: boolean
  showRedirectUrl?: boolean
  walletUrl?: string
  origin?: string
  accessKey?: string
  redirectPath?: string
  keymachineUrl?: string
  nodesUrl?: string
  relayerUrl?: string
  transportMode?: string
}

type ExplicitSessionConfigInput = ExplicitSessionConfig & {
  includeFeeOptionPermissions?: boolean
}

const printJson = (value: unknown): void => {
  console.log(JSON.stringify(value, jsonReplacers, 2))
}

const toBigInt = (value: unknown): bigint | undefined => {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'bigint') return value
  if (typeof value === 'number') return BigInt(value)
  if (typeof value === 'string' && value.trim().length > 0) return BigInt(value)
  return undefined
}

const toNumber = (value: unknown): number | undefined => {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'number') return value
  if (typeof value === 'string' && value.trim().length > 0) return Number(value)
  return undefined
}

const normalizeExplicitSessionConfig = (config: ExplicitSessionConfigInput): ExplicitSessionConfigInput => ({
  ...config,
  valueLimit: toBigInt(config.valueLimit) ?? 0n,
  deadline: toBigInt(config.deadline) ?? 0n,
  chainId: Number(config.chainId),
})

const normalizeExplicitSession = (session: ExplicitSession): ExplicitSession => ({
  ...session,
  valueLimit: toBigInt(session.valueLimit) ?? 0n,
  deadline: toBigInt(session.deadline) ?? 0n,
  chainId: session.chainId !== undefined ? Number(session.chainId) : session.chainId,
})

const normalizeTransaction = (tx: Transaction): Transaction => ({
  ...tx,
  value: toBigInt(tx.value) ?? 0n,
  gasLimit: toBigInt(tx.gasLimit),
})

const waitWithIndicator = async <T>(label: string, task: Promise<T>): Promise<T> => {
  const frames = ['|', '/', '-', '\\']
  let idx = 0
  process.stderr.write(`${label} ${frames[idx]}`)
  const interval = setInterval(() => {
    idx = (idx + 1) % frames.length
    process.stderr.write(`\r${label} ${frames[idx]}`)
  }, 180)

  try {
    const result = await task
    return result
  } finally {
    clearInterval(interval)
    process.stderr.write(`\r${label} done\n`)
  }
}

const formatFeeAmount = (value: string, decimals?: number): string => {
  if (decimals === undefined || decimals < 0) return value
  const amount = BigInt(value)
  const base = 10n ** BigInt(decimals)
  const whole = amount / base
  const remainder = amount % base
  if (remainder === 0n) return whole.toString()
  const fraction = remainder.toString().padStart(decimals, '0').replace(/0+$/, '')
  return `${whole}.${fraction}`
}

const describeFeeOption = (option: FeeOption): string => {
  const symbol = option.token.symbol || option.token.name || 'TOKEN'
  const amount = formatFeeAmount(option.value, option.token.decimals)
  const tokenAddress = option.token.contractAddress ?? 'native'
  return `${amount} ${symbol} (to ${option.to}, token ${tokenAddress}, gasLimit ${option.gasLimit})`
}

const ERC20_BALANCE_OF_ABI = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: 'balance', type: 'uint256' }],
  },
] as const

const isNativeFeeOption = (option: FeeOption): boolean => {
  const tokenAddress = option.token.contractAddress?.toLowerCase()
  return !tokenAddress || tokenAddress === '0x0000000000000000000000000000000000000000'
}

const getFeeOptionAffordability = async (params: {
  chainId: number
  walletAddress: string
  config: CliConfig
  feeOptions: FeeOption[]
}): Promise<boolean[]> => {
  if (!params.config.nodesUrl || !params.config.projectAccessKey) {
    throw new Error('Missing nodesUrl or projectAccessKey in config.')
  }
  const rpcUrl = getRpcUrl(params.chainId, params.config.nodesUrl, params.config.projectAccessKey)
  const client = createPublicClient({
    transport: viemHttp(rpcUrl),
  })

  const walletAddress = params.walletAddress as `0x${string}`
  const tokenBalances = new Map<string, bigint>()

  if (params.feeOptions.some((option) => isNativeFeeOption(option))) {
    const nativeBalance = await client.getBalance({ address: walletAddress })
    tokenBalances.set('native', nativeBalance)
  }

  const erc20Addresses = Array.from(
    new Set(
      params.feeOptions
        .map((option) => option.token.contractAddress?.toLowerCase())
        .filter((address): address is string => Boolean(address) && address !== '0x0000000000000000000000000000000000000000'),
    ),
  )

  await Promise.all(
    erc20Addresses.map(async (address) => {
      const balance = (await client.readContract({
        address: address as `0x${string}`,
        abi: ERC20_BALANCE_OF_ABI,
        functionName: 'balanceOf',
        args: [walletAddress],
      })) as bigint
      tokenBalances.set(address, balance)
    }),
  )

  return params.feeOptions.map((option) => {
    const needed = BigInt(option.value)
    const key = isNativeFeeOption(option) ? 'native' : option.token.contractAddress!.toLowerCase()
    const available = tokenBalances.get(key) ?? 0n
    return available >= needed
  })
}

const resolvePlaceholders = (value: unknown, walletAddress: string | null): unknown => {
  if (typeof value === 'string') {
    if (value === '@currentWallet') {
      if (!walletAddress) {
        throw new Error('Wallet address is not available for @currentWallet placeholder.')
      }
      return walletAddress
    }
    return value
  }
  if (Array.isArray(value)) {
    return value.map((entry) => resolvePlaceholders(entry, walletAddress))
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        resolvePlaceholders(entry, walletAddress),
      ]),
    )
  }
  return value
}

const buildTransactionFromInput = (input: Record<string, unknown>, walletAddress: string | null): Transaction => {
  const resolved = resolvePlaceholders(input, walletAddress) as Record<string, unknown>

  if (!resolved.data) {
    const abi =
      (resolved.abi as string | undefined) ||
      (resolved.functionSignature as string | undefined) ||
      (resolved.function as string | undefined)
    if (abi) {
      const fragment = abi.trim().startsWith('function') ? abi.trim() : `function ${abi.trim()}`
      const fn = AbiFunction.from([fragment])
      const args = resolved.args
      if (!Array.isArray(args)) {
        throw new Error('args must be a JSON array when using abi/functionSignature.')
      }
      resolved.data = AbiFunction.encodeData(fn, args as any[])
    }
  }

  delete (resolved as Record<string, unknown>).abi
  delete (resolved as Record<string, unknown>).functionSignature
  delete (resolved as Record<string, unknown>).function
  delete (resolved as Record<string, unknown>).args

  return normalizeTransaction(resolved as Transaction)
}

const normalizeTransactionRequest = (tx: TransactionRequest): TransactionRequest => ({
  ...tx,
  value: toBigInt(tx.value),
  gasLimit: toBigInt(tx.gasLimit),
})

const configOverridesFromArgs = (argv: GlobalArgs): Partial<CliConfig> => ({
  walletUrl: argv.walletUrl,
  origin: argv.origin,
  projectAccessKey: argv.accessKey,
  redirectPath: argv.redirectPath,
  keymachineUrl: argv.keymachineUrl,
  nodesUrl: argv.nodesUrl,
  relayerUrl: argv.relayerUrl,
  transportMode: argv.transportMode as CliConfig['transportMode'],
})

const ensureConfig = (config: CliConfig): CliConfig => {
  if (!config.walletUrl || !config.origin || !config.projectAccessKey) {
    throw new Error(
      'Missing config. Run `init`, pass wallet-url/origin/access-key, or set WALLET_URL/ORIGIN/PROJECT_ACCESS_KEY in .env.',
    )
  }
  return config
}

const buildRedirectUrl = (origin: string, redirectPath?: string): string =>
  origin + (redirectPath ? redirectPath : '')

const isMainnetChain = (chainId: number): boolean => {
  try {
    return getNetwork(chainId).type === 'mainnet'
  } catch {
    return false
  }
}

const buildDefaultExplicitSessionConfig = (defaults: NonNullable<typeof explicitSessionDefaults>): ExplicitSessionConfig => {
  const nowSeconds = Math.floor(Date.now() / 1000)
  const expiresIn = defaults.expiresInSeconds ?? 60 * 60 * 24
  return {
    chainId: defaults.chainId,
    valueLimit: defaults.valueLimit ?? 0n,
    deadline: BigInt(nowSeconds + expiresIn),
    permissions: defaults.permissions,
  }
}

const withOptionalFeePermissions = async (params: {
  chainId: number
  config: ExplicitSessionConfigInput
  dappClient: DappClient
}): Promise<ExplicitSessionConfig> => {
  const { includeFeeOptionPermissions: includeFeePermissions, ...explicitSessionConfig } = params.config
  if (!includeFeePermissions) return explicitSessionConfig
  const permissions = await includeFeeOptionPermissions({
    dappClient: params.dappClient,
    chainId: params.chainId,
    permissions: explicitSessionConfig.permissions,
  })
  return { ...explicitSessionConfig, permissions }
}

const prepareState = async (argv: GlobalArgs): Promise<StateManager> => {
  const statePath = resolveStatePath(argv.state)
  const noPrompt = argv.prompt === false
  const passphrase = await resolvePassphrase({
    passphrase: argv.passphrase,
    noPrompt,
  })
  const stateManager = new StateManager(statePath, passphrase)
  const valid = await stateManager.verifyPassphrase()
  if (!valid) {
    throw new Error('Invalid passphrase or corrupt state file.')
  }
  return stateManager
}

const loadConfig = async (stateManager: StateManager, overrides: Partial<CliConfig>): Promise<CliConfig> => {
  const state = await stateManager.load()
  const merged = mergeConfig(mergeConfig(state.config, configFromEnv()), overrides)
  return ensureConfig({ ...merged, transportMode: 'redirect' })
}

const createClient = (
  config: CliConfig,
  sequenceStorage: FileSequenceStorage,
  sessionStorage: FileSessionStorage,
): DappClient => {
  return new DappClient(config.walletUrl!, config.origin!, config.projectAccessKey!, {
    transportMode: TransportMode.REDIRECT,
    redirectPath: config.redirectPath,
    keymachineUrl: config.keymachineUrl,
    nodesUrl: config.nodesUrl,
    relayerUrl: config.relayerUrl,
    sequenceStorage,
    sequenceSessionStorage: sessionStorage,
    canUseIndexedDb: false,
  })
}

const ensureNoPendingRedirect = async (storage: FileSequenceStorage): Promise<void> => {
  if (await storage.isRedirectRequestPending()) {
    throw new Error('Pending redirect detected. Run `resume --url <redirect-url>` first.')
  }
}

const handleError = (err: unknown): void => {
  const message = err instanceof Error ? err.message : String(err)
  console.error(message)
  process.exitCode = 1
}

const sendOsNotification = (message: string): void => {
  if (process.platform !== 'darwin') return
  if (process.env.DAPP_CLIENT_CLI_NO_OS_NOTIFY) return
  const script = `display notification ${JSON.stringify(message)} with title "dapp-client-cli"`
  execFile('osascript', ['-e', script], { timeout: 2000 }, () => {})
}

const openRedirectUrl = (url: string): void => {
  if (process.platform !== 'darwin') return
  if (process.env.DAPP_CLIENT_CLI_NO_AUTO_OPEN) return
  execFile('open', [url], { timeout: 2000 }, () => {})
}

const summarizeRedirectUrl = (url: string): string => {
  const parsed = new URL(url)
  const id = parsed.searchParams.get('id') ?? 'n/a'
  return `${parsed.origin}${parsed.pathname} (id=${id})`
}

const printRedirectUrl = (url: string, showFull: boolean): void => {
  if (showFull) {
    console.log(url)
    return
  }
  console.log(`Redirect URL generated: ${summarizeRedirectUrl(url)} (use --show-redirect-url for full URL)`)
}

const notifyRedirect = (url: string, autoOpen = true, showFullUrl = false): void => {
  if (autoOpen) {
    openRedirectUrl(url)
  }
  process.stderr.write('\u0007')
  const message = autoOpen
    ? showFullUrl
      ? 'ACTION REQUIRED: Continue in your browser (full redirect URL printed above).'
      : 'ACTION REQUIRED: Continue in your browser (redirect URL generated and auto-opened).'
    : 'ACTION REQUIRED: Open the redirect URL above to continue.'
  console.error(message)
  sendOsNotification(
    autoOpen
      ? 'Continue in your browser to approve the request.'
      : 'Open the redirect URL in your terminal output to continue.',
  )
}

const tryGetExplorerUrl = (chainId: number, txHash: string): string | undefined => {
  try {
    return getExplorerUrl(chainId, txHash)
  } catch {
    return undefined
  }
}

const executeResume = async (
  stateManager: StateManager,
  overrides: Partial<CliConfig>,
  url: string,
): Promise<unknown> => {
  const storage = new FileSequenceStorage(stateManager)
  const sessionStorage = new FileSessionStorage(stateManager)
  const config = await loadConfig(stateManager, overrides)

  const clientStorage = new FileSequenceStorage(stateManager, { suppressPendingRedirect: true })
  const client = createClient(config, clientStorage, sessionStorage)
  await client.initialize()

  let walletActionEvent: unknown
  let explicitSessionEvent: unknown

  const unsubWallet = client.on('walletActionResponse', (data) => {
    walletActionEvent = data
  })
  const unsubExplicit = client.on('explicitSessionResponse', (data) => {
    explicitSessionEvent = data
  })

  await client.handleRedirectResponse(url)
  await storage.setPendingRedirectRequest(false)
  await storage.getAndClearTempSessionPk()
  await storage.getAndClearPendingRequest()

  unsubWallet()
  unsubExplicit()

  if (walletActionEvent && typeof walletActionEvent === 'object') {
    const event = walletActionEvent as {
      chainId?: number
      response?: { transactionHash?: string }
    }
    if (event.chainId && event.response?.transactionHash) {
      return {
        ...walletActionEvent,
        explorerUrl: tryGetExplorerUrl(event.chainId, event.response.transactionHash),
      }
    }
    return walletActionEvent
  }
  if (explicitSessionEvent) {
    return explicitSessionEvent
  }

  return {
    walletAddress: client.getWalletAddress(),
    isInitialized: client.isInitialized,
    loginMethod: client.loginMethod,
    userEmail: client.userEmail,
    explicitSessions: client.getAllExplicitSessions(),
    implicitSessions: client.getAllImplicitSessions(),
  }
}

const startRedirectListener = async (options: {
  config: CliConfig
  stateManager: StateManager
  overrides: Partial<CliConfig>
  timeoutMs?: number
}): Promise<void> => {
  const { config, stateManager, overrides, timeoutMs } = options
  if (!config.origin) {
    throw new Error('Origin is required to start a redirect listener.')
  }
  const originUrl = new URL(config.origin)
  if (originUrl.protocol !== 'http:') {
    throw new Error('Redirect listener only supports http origins.')
  }
  const port = originUrl.port ? Number(originUrl.port) : 80
  const hostname = originUrl.hostname

  await new Promise<void>((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      if (!req.url) {
        res.writeHead(400, { 'content-type': 'text/plain' })
        res.end('Missing redirect URL.')
        return
      }

      const fullUrl = new URL(req.url, config.origin).toString()
      const parsed = new URL(fullUrl)
      if (!parsed.searchParams.get('id')) {
        res.writeHead(200, { 'content-type': 'text/plain' })
        res.end('Waiting for redirect response...')
        return
      }

      try {
        const result = await executeResume(stateManager, overrides, fullUrl)
        printJson(result)
        res.writeHead(200, { 'content-type': 'text/html' })
        res.end('<p>Redirect handled. You can close this window.</p>')
      } catch (err) {
        handleError(err)
        res.writeHead(500, { 'content-type': 'text/plain' })
        res.end('Failed to handle redirect. Check terminal output.')
      } finally {
        server.close(() => resolve())
      }
    })

    server.on('error', (err) => reject(err))
    server.listen(port, hostname, () => {
      console.error(`Waiting for redirect on ${originUrl.origin}`)
    })

    if (timeoutMs && timeoutMs > 0) {
      setTimeout(() => {
        server.close(() => reject(new Error('Timed out waiting for redirect.')))
      }, timeoutMs)
    }
  })
}

const main = async (): Promise<void> => {
  const rawArgs = hideBin(process.argv)
  const args = rawArgs[0] === '--' ? rawArgs.slice(1) : rawArgs
  await yargs(args)
    .scriptName('dapp-client-cli')
    .example(
      '$0 connect --chain-id 137 --explicit-session @examples/polygon-explicit-session.json',
      'Connect with explicit Polygon permissions from a JSON file',
    )
    .example(
      '$0 send-transaction --chain-id 137 --transactions @examples/polygon-native-transfer.json',
      'Send a Polygon native transfer using an existing session',
    )
    .example(
      '$0 send-wallet-transaction --chain-id 137 --transaction @examples/polygon-native-transfer.json',
      'Request a wallet transaction via redirect using example JSON',
    )
    .option('state', {
      type: 'string',
      describe: 'Path to encrypted state file',
      default: DEFAULT_STATE_PATH,
    })
    .option('passphrase', {
      type: 'string',
      describe: 'Passphrase for encrypted state',
    })
    .option('prompt', {
      type: 'boolean',
      default: true,
      describe: 'Enable passphrase prompt (use --no-prompt to disable)',
    })
    .option('debug', {
      type: 'boolean',
      default: false,
      describe: 'Enable debug logging',
    })
    .option('listen', {
      type: 'boolean',
      default: true,
      describe: 'Start local redirect listener to auto-resume (recommended: keep enabled)',
    })
    .option('open-url', {
      type: 'boolean',
      default: true,
      describe: 'Automatically open redirect URL in your browser (recommended: keep enabled)',
    })
    .option('show-redirect-url', {
      type: 'boolean',
      default: false,
      describe: 'Print full redirect URL (includes full payload)',
    })
    .option('listen-timeout', {
      type: 'number',
      describe: 'Timeout in ms for auto-resume listener',
    })
    .option('wallet-url', {
      type: 'string',
      describe: 'Wallet URL',
    })
    .option('origin', {
      type: 'string',
      describe: 'Dapp origin',
    })
    .option('access-key', {
      type: 'string',
      describe: 'Project access key',
    })
    .option('redirect-path', {
      type: 'string',
      describe: 'Redirect path (appended to origin)',
    })
    .option('keymachine-url', {
      type: 'string',
      describe: 'Key machine URL',
    })
    .option('nodes-url', {
      type: 'string',
      describe: 'Nodes URL template',
    })
    .option('relayer-url', {
      type: 'string',
      describe: 'Relayer URL template',
    })
    .option('transport-mode', {
      type: 'string',
      choices: ['popup', 'redirect'],
      describe: 'Transport mode (CLI forces redirect)',
    })
    .command(
      'init',
      'Initialize CLI configuration',
      (builder) =>
        builder
          .option('wallet-url', { type: 'string', demandOption: false })
          .option('origin', { type: 'string', demandOption: false })
          .option('access-key', { type: 'string', demandOption: false })
          .option('redirect-path', { type: 'string' })
          .option('keymachine-url', { type: 'string' })
          .option('nodes-url', { type: 'string' })
          .option('relayer-url', { type: 'string' }),
      async (argv) => {
        try {
          const stateManager = await prepareState(argv)
          const state = await stateManager.load()
          const overrides = configOverridesFromArgs(argv)
          const merged = mergeConfig(state.config, mergeConfig(configFromEnv(), overrides))
          const config: CliConfig = {
            ...merged,
            transportMode: 'redirect',
          }
          if (!config.walletUrl || !config.origin || !config.projectAccessKey) {
            throw new Error('wallet-url, origin, and access-key are required.')
          }
          await stateManager.update((draft) => {
            draft.config = config
          })
          printJson({ ok: true, config: redactConfig(config) })
        } catch (err) {
          handleError(err)
        }
      },
    )
    .command(
      'connect',
      'Start a new connection (prints redirect URL)',
      (builder) =>
        builder
          .option('chain-id', { type: 'number', demandOption: true })
          .option('explicit-session', {
            type: 'string',
            describe:
              'Explicit session config JSON or @file (example: @examples/polygon-explicit-session.json). Optional: set "includeFeeOptionPermissions": true in JSON.',
          })
          .option('include-implicit', {
            type: 'boolean',
            default: false,
          })
          .option('preferred-login-method', {
            type: 'string',
            choices: ['google', 'apple', 'email', 'passkey', 'mnemonic', 'eoa'],
          })
          .option('email', { type: 'string' }),
      async (argv) => {
        try {
          const stateManager = await prepareState(argv)
          const storage = new FileSequenceStorage(stateManager)
          const sessionStorage = new FileSessionStorage(stateManager)
          await ensureNoPendingRedirect(storage)

          const overrides = configOverridesFromArgs(argv)
          const config = await loadConfig(stateManager, overrides)

          const chainId = Number(argv.chainId)
          let explicitSessionConfig: ExplicitSessionConfig | undefined
          if (argv.explicitSession) {
            const configInput = normalizeExplicitSessionConfig(
              await readJsonInput<ExplicitSessionConfigInput>(argv.explicitSession, 'explicit session config'),
            )
            if (configInput.chainId !== chainId) {
              throw new Error('explicit session chainId must match --chain-id')
            }
            explicitSessionConfig = await withOptionalFeePermissions({
              chainId,
              config: configInput,
              dappClient: createClient(config, storage, sessionStorage),
            })
          } else if (explicitSessionDefaults) {
            const defaults = explicitSessionDefaults
            if (defaults.chainId !== chainId) {
              throw new Error(`default explicit session chainId (${defaults.chainId}) must match --chain-id`)
            }
            explicitSessionConfig = await withOptionalFeePermissions({
              chainId,
              config: {
                ...buildDefaultExplicitSessionConfig(defaults),
                includeFeeOptionPermissions: defaults.includeFeeOptionPermissions,
              },
              dappClient: createClient(config, storage, sessionStorage),
            })
          }

          if (argv.preferredLoginMethod === 'email' && !argv.email) {
            throw new Error('email is required when preferred login method is email.')
          }

          const includeImplicit = argv.includeImplicit ?? false
          const shouldCreateSession = Boolean(explicitSessionConfig) || includeImplicit
          const tempPk = shouldCreateSession ? Secp256k1.randomPrivateKey() : null
          const sessionAddress =
            shouldCreateSession && tempPk ? Address.fromPublicKey(Secp256k1.getPublicKey({ privateKey: tempPk })) : null

          const preferredLoginMethod = argv.preferredLoginMethod as LoginMethod | undefined
          const session =
            shouldCreateSession && sessionAddress
              ? explicitSessionConfig
                ? { sessionAddress, ...explicitSessionConfig }
                : { sessionAddress }
              : undefined

          const payload: CreateNewSessionPayload = {
            origin: config.origin,
            session: session as ExplicitSession | undefined,
            includeImplicitSession: includeImplicit,
            preferredLoginMethod,
            email: preferredLoginMethod === 'email' ? argv.email : undefined,
          }

          if (tempPk) {
            await storage.saveTempSessionPk(tempPk)
          }
          await storage.savePendingRequest({
            chainId,
            action: RequestActionType.CREATE_NEW_SESSION,
            payload,
          })
          await storage.setPendingRedirectRequest(true)

          const redirectUrl = buildRedirectUrl(config.origin!, config.redirectPath)
          const url = await createRedirectUrl({
            action: RequestActionType.CREATE_NEW_SESSION,
            payload,
            walletUrl: config.walletUrl!,
            redirectUrl,
            path: '/request/connect',
            sessionStorage,
          })
          const showFullUrl = Boolean(argv.showRedirectUrl || !argv.openUrl)
          printRedirectUrl(url, showFullUrl)
          notifyRedirect(url, argv.openUrl, showFullUrl)

          if (argv.listen) {
            await startRedirectListener({
              config,
              stateManager,
              overrides,
              timeoutMs: argv.listenTimeout,
            })
          }
        } catch (err) {
          handleError(err)
        }
      },
    )
    .command(
      'resume',
      'Handle a redirect response',
      (builder) =>
        builder.option('url', {
          type: 'string',
          demandOption: true,
          describe: 'Full redirect URL',
        }),
      async (argv) => {
        try {
          const stateManager = await prepareState(argv)
          const result = await executeResume(stateManager, configOverridesFromArgs(argv), argv.url)
          printJson(result)
        } catch (err) {
          handleError(err)
        }
      },
    )
    .command(
      'status',
      'Show current session status',
      () => {},
      async (argv) => {
        try {
          const stateManager = await prepareState(argv)
          const storage = new FileSequenceStorage(stateManager)
          const sessionStorage = new FileSessionStorage(stateManager)
          const config = await loadConfig(stateManager, configOverridesFromArgs(argv))
          const pending = await storage.isRedirectRequestPending()

          const status: Record<string, unknown> = {
            pendingRedirect: pending,
            config: redactConfig(config),
          }

          if (!pending) {
            const client = createClient(config, storage, sessionStorage)
            await client.initialize()
            status.isInitialized = client.isInitialized
            status.walletAddress = client.getWalletAddress()
            status.loginMethod = client.loginMethod
            status.userEmail = client.userEmail
            status.explicitSessions = client.getAllExplicitSessions()
            status.implicitSessions = client.getAllImplicitSessions()
          } else {
            status.note = 'Pending redirect detected. Run resume to finalize.'
          }

          printJson(status)
        } catch (err) {
          handleError(err)
        }
      },
    )
    .command(
      'reset-pending',
      'Clear pending redirect state',
      () => {},
      async (argv) => {
        try {
          const stateManager = await prepareState(argv)
          const storage = new FileSequenceStorage(stateManager)
          await storage.setPendingRedirectRequest(false)
          await storage.getAndClearTempSessionPk()
          await storage.getAndClearPendingRequest()
          printJson({ ok: true })
        } catch (err) {
          handleError(err)
        }
      },
    )
    .command(
      'disconnect',
      'Disconnect and clear sessions',
      (builder) =>
        builder.option('keep-sessionless', {
          type: 'boolean',
          default: true,
        }),
      async (argv) => {
        try {
          const stateManager = await prepareState(argv)
          const storage = new FileSequenceStorage(stateManager)
          const sessionStorage = new FileSessionStorage(stateManager)
          if (await storage.isRedirectRequestPending()) {
            await storage.setPendingRedirectRequest(false)
            await storage.getAndClearTempSessionPk()
            await storage.getAndClearPendingRequest()
          }
          const config = await loadConfig(stateManager, configOverridesFromArgs(argv))
          const client = createClient(config, storage, sessionStorage)
          await client.initialize()
          await client.disconnect({ keepSessionlessConnection: argv.keepSessionless })
          printJson({ ok: true })
        } catch (err) {
          handleError(err)
        }
      },
    )
    .command(
      'upgrade-sessionless',
      'Upgrade a sessionless connection (prints redirect URL)',
      (builder) =>
        builder
          .option('chain-id', { type: 'number', demandOption: true })
          .option('explicit-session', {
            type: 'string',
            describe: 'Explicit session config JSON or @file. Optional: set "includeFeeOptionPermissions": true in JSON.',
          })
          .option('include-implicit', {
            type: 'boolean',
            default: false,
          })
          .option('preferred-login-method', {
            type: 'string',
            choices: ['google', 'apple', 'email', 'passkey', 'mnemonic', 'eoa'],
          })
          .option('email', { type: 'string' }),
      async (argv) => {
        try {
          const stateManager = await prepareState(argv)
          const storage = new FileSequenceStorage(stateManager)
          const sessionStorage = new FileSessionStorage(stateManager)
          await ensureNoPendingRedirect(storage)
          const overrides = configOverridesFromArgs(argv)
          const config = await loadConfig(stateManager, overrides)

          const sessionless = await storage.getSessionlessConnection()
          if (!sessionless) {
            throw new Error('No sessionless connection available to upgrade.')
          }

          const chainId = Number(argv.chainId)
          let explicitSessionConfig: ExplicitSessionConfig | undefined
          if (argv.explicitSession) {
            const configInput = normalizeExplicitSessionConfig(
              await readJsonInput<ExplicitSessionConfigInput>(argv.explicitSession, 'explicit session config'),
            )
            if (configInput.chainId !== chainId) {
              throw new Error('explicit session chainId must match --chain-id')
            }
            explicitSessionConfig = await withOptionalFeePermissions({
              chainId,
              config: configInput,
              dappClient: createClient(config, storage, sessionStorage),
            })
          } else if (explicitSessionDefaults) {
            const defaults = explicitSessionDefaults
            if (defaults.chainId !== chainId) {
              throw new Error(`default explicit session chainId (${defaults.chainId}) must match --chain-id`)
            }
            explicitSessionConfig = await withOptionalFeePermissions({
              chainId,
              config: {
                ...buildDefaultExplicitSessionConfig(defaults),
                includeFeeOptionPermissions: defaults.includeFeeOptionPermissions,
              },
              dappClient: createClient(config, storage, sessionStorage),
            })
          }

          if (argv.preferredLoginMethod === 'email' && !argv.email) {
            throw new Error('email is required when preferred login method is email.')
          }

          const includeImplicit = argv.includeImplicit ?? false
          const shouldCreateSession = Boolean(explicitSessionConfig) || includeImplicit
          if (!shouldCreateSession) {
            throw new Error('Upgrade requires an implicit or explicit session request.')
          }

          const tempPk = Secp256k1.randomPrivateKey()
          const sessionAddress = Address.fromPublicKey(Secp256k1.getPublicKey({ privateKey: tempPk }))

          const preferredLoginMethod = argv.preferredLoginMethod as LoginMethod | undefined
          const session = explicitSessionConfig ? { sessionAddress, ...explicitSessionConfig } : { sessionAddress }

          const payload: CreateNewSessionPayload = {
            origin: config.origin,
            session: session as ExplicitSession | undefined,
            includeImplicitSession: includeImplicit,
            preferredLoginMethod,
            email: preferredLoginMethod === 'email' ? argv.email : undefined,
          }

          await storage.saveTempSessionPk(tempPk)
          await storage.savePendingRequest({
            chainId,
            action: RequestActionType.CREATE_NEW_SESSION,
            payload,
          })
          await storage.setPendingRedirectRequest(true)

          const redirectUrl = buildRedirectUrl(config.origin!, config.redirectPath)
          const url = await createRedirectUrl({
            action: RequestActionType.CREATE_NEW_SESSION,
            payload,
            walletUrl: config.walletUrl!,
            redirectUrl,
            path: '/request/connect',
            sessionStorage,
          })
          const showFullUrl = Boolean(argv.showRedirectUrl || !argv.openUrl)
          printRedirectUrl(url, showFullUrl)
          notifyRedirect(url, argv.openUrl, showFullUrl)

          if (argv.listen) {
            await startRedirectListener({
              config,
              stateManager,
              overrides,
              timeoutMs: argv.listenTimeout,
            })
          }
        } catch (err) {
          handleError(err)
        }
      },
    )
    .command(
      'add-explicit-session',
      'Add an explicit session (prints redirect URL)',
      (builder) =>
        builder
          .option('chain-id', { type: 'number', demandOption: true })
          .option('explicit-session', {
            type: 'string',
            demandOption: true,
            describe: 'Explicit session config JSON or @file. Optional: set "includeFeeOptionPermissions": true in JSON.',
          }),
      async (argv) => {
        try {
          const stateManager = await prepareState(argv)
          const storage = new FileSequenceStorage(stateManager)
          const sessionStorage = new FileSessionStorage(stateManager)
          await ensureNoPendingRedirect(storage)
          const overrides = configOverridesFromArgs(argv)
          const config = await loadConfig(stateManager, overrides)
          const client = createClient(config, storage, sessionStorage)
          await client.initialize()

          if (!client.isInitialized) {
            throw new Error('Client not initialized. Run connect first.')
          }

          const chainId = Number(argv.chainId)
          const explicitSessionConfigInput = normalizeExplicitSessionConfig(
            await readJsonInput<ExplicitSessionConfigInput>(argv.explicitSession, 'explicit session config'),
          )
          if (explicitSessionConfigInput.chainId !== chainId) {
            throw new Error('explicit session chainId must match --chain-id')
          }
          const explicitSessionConfig = await withOptionalFeePermissions({
            chainId,
            config: explicitSessionConfigInput,
            dappClient: client,
          })

          const tempPk = Secp256k1.randomPrivateKey()
          const sessionAddress = Address.fromPublicKey(Secp256k1.getPublicKey({ privateKey: tempPk }))

          const payload: AddExplicitSessionPayload = {
            session: { ...explicitSessionConfig, sessionAddress, type: 'explicit' },
          }

          await storage.saveTempSessionPk(tempPk)
          await storage.savePendingRequest({
            chainId,
            action: RequestActionType.ADD_EXPLICIT_SESSION,
            payload,
          })
          await storage.setPendingRedirectRequest(true)

          const redirectUrl = buildRedirectUrl(config.origin!, config.redirectPath)
          const url = await createRedirectUrl({
            action: RequestActionType.ADD_EXPLICIT_SESSION,
            payload,
            walletUrl: config.walletUrl!,
            redirectUrl,
            path: '/request/connect',
            sessionStorage,
          })
          const showFullUrl = Boolean(argv.showRedirectUrl || !argv.openUrl)
          printRedirectUrl(url, showFullUrl)
          notifyRedirect(url, argv.openUrl, showFullUrl)

          if (argv.listen) {
            await startRedirectListener({
              config,
              stateManager,
              overrides,
              timeoutMs: argv.listenTimeout,
            })
          }
        } catch (err) {
          handleError(err)
        }
      },
    )
    .command(
      'modify-explicit-session',
      'Modify an explicit session (prints redirect URL)',
      (builder) =>
        builder.option('session', {
          type: 'string',
          demandOption: true,
          describe: 'Explicit session JSON or @file',
        }),
      async (argv) => {
        try {
          const stateManager = await prepareState(argv)
          const storage = new FileSequenceStorage(stateManager)
          const sessionStorage = new FileSessionStorage(stateManager)
          await ensureNoPendingRedirect(storage)
          const overrides = configOverridesFromArgs(argv)
          const config = await loadConfig(stateManager, overrides)
          const client = createClient(config, storage, sessionStorage)
          await client.initialize()

          if (!client.isInitialized || !client.getWalletAddress()) {
            throw new Error('Client not initialized. Run connect first.')
          }

          const session = normalizeExplicitSession(
            await readJsonInput<ExplicitSession>(argv.session, 'explicit session'),
          )

          const existing = client.getAllExplicitSessions().find((s) =>
            Address.isEqual(s.sessionAddress, session.sessionAddress),
          )
          if (!existing) {
            throw new Error('Explicit session not found.')
          }

          const payload: ModifyExplicitSessionPayload = {
            walletAddress: client.getWalletAddress()!,
            session,
          }

          await storage.savePendingRequest({
            chainId: session.chainId ?? Number(existing.chainId),
            action: RequestActionType.MODIFY_EXPLICIT_SESSION,
            payload,
          })
          await storage.setPendingRedirectRequest(true)

          const redirectUrl = buildRedirectUrl(config.origin!, config.redirectPath)
          const url = await createRedirectUrl({
            action: RequestActionType.MODIFY_EXPLICIT_SESSION,
            payload,
            walletUrl: config.walletUrl!,
            redirectUrl,
            path: '/request/modify',
            sessionStorage,
          })
          const showFullUrl = Boolean(argv.showRedirectUrl || !argv.openUrl)
          printRedirectUrl(url, showFullUrl)
          notifyRedirect(url, argv.openUrl, showFullUrl)

          if (argv.listen) {
            await startRedirectListener({
              config,
              stateManager,
              overrides,
              timeoutMs: argv.listenTimeout,
            })
          }
        } catch (err) {
          handleError(err)
        }
      },
    )
    .command(
      'sign-message',
      'Request message signature (prints redirect URL)',
      (builder) =>
        builder
          .option('chain-id', { type: 'number', demandOption: true })
          .option('message', { type: 'string', demandOption: true }),
      async (argv) => {
        try {
          const stateManager = await prepareState(argv)
          const storage = new FileSequenceStorage(stateManager)
          const sessionStorage = new FileSessionStorage(stateManager)
          await ensureNoPendingRedirect(storage)
          const overrides = configOverridesFromArgs(argv)
          const config = await loadConfig(stateManager, overrides)
          const client = createClient(config, storage, sessionStorage)
          await client.initialize()

          if (!client.isInitialized || !client.getWalletAddress()) {
            throw new Error('Client not initialized. Run connect first.')
          }

          const chainId = Number(argv.chainId)
          const payload: SignMessagePayload = {
            address: client.getWalletAddress()!,
            message: argv.message,
            chainId,
          }

          await storage.savePendingRequest({
            chainId,
            action: RequestActionType.SIGN_MESSAGE,
            payload,
          })
          await storage.setPendingRedirectRequest(true)

          const redirectUrl = buildRedirectUrl(config.origin!, config.redirectPath)
          const url = await createRedirectUrl({
            action: RequestActionType.SIGN_MESSAGE,
            payload,
            walletUrl: config.walletUrl!,
            redirectUrl,
            path: '/request/sign',
            sessionStorage,
          })
          const showFullUrl = Boolean(argv.showRedirectUrl || !argv.openUrl)
          printRedirectUrl(url, showFullUrl)
          notifyRedirect(url, argv.openUrl, showFullUrl)

          if (argv.listen) {
            await startRedirectListener({
              config,
              stateManager,
              overrides,
              timeoutMs: argv.listenTimeout,
            })
          }
        } catch (err) {
          handleError(err)
        }
      },
    )
    .command(
      'sign-typed-data',
      'Request typed data signature (prints redirect URL)',
      (builder) =>
        builder
          .option('chain-id', { type: 'number', demandOption: true })
          .option('typed-data', { type: 'string', demandOption: true, describe: 'Typed data JSON or @file' }),
      async (argv) => {
        try {
          const stateManager = await prepareState(argv)
          const storage = new FileSequenceStorage(stateManager)
          const sessionStorage = new FileSessionStorage(stateManager)
          await ensureNoPendingRedirect(storage)
          const overrides = configOverridesFromArgs(argv)
          const config = await loadConfig(stateManager, overrides)
          const client = createClient(config, storage, sessionStorage)
          await client.initialize()

          if (!client.isInitialized || !client.getWalletAddress()) {
            throw new Error('Client not initialized. Run connect first.')
          }

          const chainId = Number(argv.chainId)
          const typedData = (await readJsonInput(argv.typedData, 'typed data')) as SignTypedDataPayload['typedData']
          const payload: SignTypedDataPayload = {
            address: client.getWalletAddress()!,
            typedData,
            chainId,
          }

          await storage.savePendingRequest({
            chainId,
            action: RequestActionType.SIGN_TYPED_DATA,
            payload,
          })
          await storage.setPendingRedirectRequest(true)

          const redirectUrl = buildRedirectUrl(config.origin!, config.redirectPath)
          const url = await createRedirectUrl({
            action: RequestActionType.SIGN_TYPED_DATA,
            payload,
            walletUrl: config.walletUrl!,
            redirectUrl,
            path: '/request/sign',
            sessionStorage,
          })
          const showFullUrl = Boolean(argv.showRedirectUrl || !argv.openUrl)
          printRedirectUrl(url, showFullUrl)
          notifyRedirect(url, argv.openUrl, showFullUrl)

          if (argv.listen) {
            await startRedirectListener({
              config,
              stateManager,
              overrides,
              timeoutMs: argv.listenTimeout,
            })
          }
        } catch (err) {
          handleError(err)
        }
      },
    )
    .command(
      'send-wallet-transaction',
      'Request wallet transaction (prints redirect URL)',
      (builder) =>
        builder
          .option('chain-id', { type: 'number', demandOption: true })
          .option('transaction', {
            type: 'string',
            demandOption: true,
            describe: 'Transaction JSON or @file (single object or array, example: @examples/polygon-native-transfer.json)',
          }),
      async (argv) => {
        try {
          const stateManager = await prepareState(argv)
          const storage = new FileSequenceStorage(stateManager)
          const sessionStorage = new FileSessionStorage(stateManager)
          await ensureNoPendingRedirect(storage)
          const overrides = configOverridesFromArgs(argv)
          const config = await loadConfig(stateManager, overrides)
          const client = createClient(config, storage, sessionStorage)
          await client.initialize()

          if (!client.isInitialized || !client.getWalletAddress()) {
            throw new Error('Client not initialized. Run connect first.')
          }

          const chainId = Number(argv.chainId)
          const transactionInput = await readJsonInput<Record<string, unknown> | Record<string, unknown>[]>(
            argv.transaction,
            'transaction',
          )
          const transactionData = Array.isArray(transactionInput) ? transactionInput[0] : transactionInput
          if (!transactionData) {
            throw new Error('transaction must include at least one item.')
          }
          const transaction = buildTransactionFromInput(transactionData, client.getWalletAddress()) as TransactionRequest
          const payload: SendWalletTransactionPayload = {
            address: client.getWalletAddress()!,
            transactionRequest: transaction,
            chainId,
          }

          await storage.savePendingRequest({
            chainId,
            action: RequestActionType.SEND_WALLET_TRANSACTION,
            payload,
          })
          await storage.setPendingRedirectRequest(true)

          const redirectUrl = buildRedirectUrl(config.origin!, config.redirectPath)
          const url = await createRedirectUrl({
            action: RequestActionType.SEND_WALLET_TRANSACTION,
            payload,
            walletUrl: config.walletUrl!,
            redirectUrl,
            path: '/request/transaction',
            sessionStorage,
          })
          const showFullUrl = Boolean(argv.showRedirectUrl || !argv.openUrl)
          printRedirectUrl(url, showFullUrl)
          notifyRedirect(url, argv.openUrl, showFullUrl)

          if (argv.listen) {
            await startRedirectListener({
              config,
              stateManager,
              overrides,
              timeoutMs: argv.listenTimeout,
            })
          }
        } catch (err) {
          handleError(err)
        }
      },
    )
    .command(
      'send-transaction',
      'Send a transaction using an existing session',
      (builder) =>
        builder
          .option('chain-id', { type: 'number', demandOption: true })
          .option('transactions', {
            type: 'string',
            demandOption: true,
            describe: 'Transactions JSON or @file (example: @examples/polygon-native-transfer.json)',
          })
          .option('fee-option', {
            type: 'string',
            describe: 'Fee option JSON or @file (optional override; auto-selected when omitted)',
          }),
      async (argv) => {
        try {
          const stateManager = await prepareState(argv)
          const storage = new FileSequenceStorage(stateManager)
          const sessionStorage = new FileSessionStorage(stateManager)
          await ensureNoPendingRedirect(storage)
          const config = await loadConfig(stateManager, configOverridesFromArgs(argv))
          const client = createClient(config, storage, sessionStorage)
          await client.initialize()

          if (!client.isInitialized) {
            throw new Error('Client not initialized. Run connect first.')
          }

          const chainId = Number(argv.chainId)
          const walletAddress = client.getWalletAddress()
          const rawTransactions = await readJsonInput<Record<string, unknown>[]>(argv.transactions, 'transactions')
          const transactions = rawTransactions.map((tx) => buildTransactionFromInput(tx, walletAddress))
          let feeOption = argv.feeOption ? await readJsonInput<FeeOption>(argv.feeOption, 'fee option') : undefined

          // If no fee option was provided, try to auto-pick a sensible default.
          // Some relayers will refuse to dispatch without a fee payment.
          if (!feeOption) {
            const feeOptions = await waitWithIndicator('Fetching fee options', client.getFeeOptions(chainId, transactions))
            if (feeOptions.length === 0) {
              console.error('No fee options returned; proceeding without fee option (possibly sponsored).')
            } else {
              // Prefer native token (POL/ETH/etc) when available, otherwise just take the first option.
              feeOption = feeOptions.find((o) => isNativeFeeOption(o)) || feeOptions[0]
              console.error(`Auto-selected fee option: ${describeFeeOption(feeOption)}`)
            }
          }

          const txHash = await waitWithIndicator(
            'Sending transaction',
            client.sendTransaction(chainId, transactions, feeOption),
          )
          printJson({ txHash, explorerUrl: tryGetExplorerUrl(chainId, txHash) })
        } catch (err) {
          handleError(err)
        }
      },
    )
    .command(
      'fee-options',
      'Fetch fee options for transactions',
      (builder) =>
        builder
          .option('chain-id', { type: 'number', demandOption: true })
          .option('transactions', { type: 'string', demandOption: true, describe: 'Transactions JSON or @file' }),
      async (argv) => {
        try {
          const stateManager = await prepareState(argv)
          const storage = new FileSequenceStorage(stateManager)
          const sessionStorage = new FileSessionStorage(stateManager)
          await ensureNoPendingRedirect(storage)
          const config = await loadConfig(stateManager, configOverridesFromArgs(argv))
          const client = createClient(config, storage, sessionStorage)
          await client.initialize()

          if (!client.isInitialized) {
            throw new Error('Client not initialized. Run connect first.')
          }

          const chainId = Number(argv.chainId)
          const transactions = (await readJsonInput<Transaction[]>(argv.transactions, 'transactions')).map(
            normalizeTransaction,
          )
          const feeOptions = await client.getFeeOptions(chainId, transactions)
          printJson(feeOptions)
        } catch (err) {
          handleError(err)
        }
      },
    )
    .command(
      'fee-tokens',
      'Fetch fee tokens for a chain',
      (builder) => builder.option('chain-id', { type: 'number', demandOption: true }),
      async (argv) => {
        try {
          const stateManager = await prepareState(argv)
          const storage = new FileSequenceStorage(stateManager)
          const sessionStorage = new FileSessionStorage(stateManager)
          await ensureNoPendingRedirect(storage)
          const config = await loadConfig(stateManager, configOverridesFromArgs(argv))
          const client = createClient(config, storage, sessionStorage)
          await client.initialize()

          if (!client.isInitialized) {
            throw new Error('Client not initialized. Run connect first.')
          }

          const chainId = Number(argv.chainId)
          const tokens = await client.getFeeTokens(chainId)
          printJson(tokens)
        } catch (err) {
          handleError(err)
        }
      },
    )
    .command(
      'has-permission',
      'Check if current sessions have permission for transactions',
      (builder) =>
        builder
          .option('chain-id', { type: 'number', demandOption: true })
          .option('transactions', { type: 'string', demandOption: true, describe: 'Transactions JSON or @file' }),
      async (argv) => {
        try {
          const stateManager = await prepareState(argv)
          const storage = new FileSequenceStorage(stateManager)
          const sessionStorage = new FileSessionStorage(stateManager)
          await ensureNoPendingRedirect(storage)
          const config = await loadConfig(stateManager, configOverridesFromArgs(argv))
          const client = createClient(config, storage, sessionStorage)
          await client.initialize()

          if (!client.isInitialized) {
            throw new Error('Client not initialized. Run connect first.')
          }

          const chainId = Number(argv.chainId)
          const transactions = (await readJsonInput<Transaction[]>(argv.transactions, 'transactions')).map(
            normalizeTransaction,
          )
          const allowed = await client.hasPermission(chainId, transactions)
          printJson({ allowed })
        } catch (err) {
          handleError(err)
        }
      },
    )
    .command(
      'restore-sessionless',
      'Restore cached sessionless connection',
      () => {},
      async (argv) => {
        try {
          const stateManager = await prepareState(argv)
          const storage = new FileSequenceStorage(stateManager)
          const sessionStorage = new FileSessionStorage(stateManager)
          await ensureNoPendingRedirect(storage)
          const config = await loadConfig(stateManager, configOverridesFromArgs(argv))
          const client = createClient(config, storage, sessionStorage)
          await client.initialize()

          const restored = await client.restoreSessionlessConnection()
          printJson({ restored })
        } catch (err) {
          handleError(err)
        }
      },
    )
    .demandCommand(1)
    .strict()
    .help()
    .epilogue(
      'Use minimal commands first (required args only). For mainnet send-transaction, the CLI auto-checks fee options: it auto-selects an affordable option when available, or proceeds without fee option when none are returned (for example sponsored setup). Redirect commands (connect/sign/resume/wallet tx) should normally run with --listen and --open-url enabled. In sandboxed agents (Codex/Claude Code), use escalated permissions so browser launch works.',
    )
    .parseAsync()
}

await main()
