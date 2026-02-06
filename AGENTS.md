# Agent Guide (Codex / Claude / etc.)

This repo is a standalone CLI wrapper around `@0xsequence/dapp-client` (v3.0.0-beta.12). It runs in **redirect mode**, auto-opens redirect URLs in browser by default, and prints a short redirect summary by default (`--show-redirect-url` for full URL). State is encrypted at rest and persisted on disk.

## Quick Start

```bash
pnpm install
pnpm run build
pnpm start -- --help
```

### Required config
Create/update `.env` (local only) or export env vars:

```
WALLET_URL=https://v3.sequence-dev.app
RELAYER_URL=https://dev-{network}-relayer.sequence.app
NODES_URL=https://dev-nodes.sequence.app/{network}
PROJECT_ACCESS_KEY=...
ORIGIN=http://localhost:3000
REDIRECT_PATH=/
DAPP_CLIENT_CLI_PASSPHRASE=...
```

Treat `.env` as required for agent-driven testing.

### Connect (redirect + auto resume)
```bash
pnpm start -- connect --chain-id 137
```

The CLI auto-opens a URL, you approve, then it auto-resumes via the local listener.

Do not disable normal redirect behavior for routine tests (`--listen=false`, `--open-url=false`) unless you are intentionally doing a manual fallback flow.

Use minimal command style by default:
- include only required args first
- do not add optional flags unless the task explicitly needs them

## Usage

### Init config
```bash
pnpm start -- init --wallet-url https://v3.sequence-dev.app --origin http://localhost:3000 --access-key <key>
```

### Status
```bash
pnpm start -- status
```

### Disconnect
```bash
pnpm start -- disconnect --keep-sessionless false
```

### Sign message (redirect)
```bash
pnpm start -- sign-message --chain-id 137 --message "hello"
```

### Send transaction (explicit session)
```bash
pnpm start -- send-transaction --chain-id 137 --transactions examples/polygon-native-transfer.json
```

Mainnet behavior for `send-transaction`:
- the CLI auto-checks fee options on mainnet chains
- if fee options are available, it auto-selects an affordable one
- if no options are returned (for example sponsored setup), it proceeds without fee option
- if options exist but none are affordable, it throws an error and requires top-up or explicit `--fee-option`

### Send transaction via wallet (redirect)
```bash
pnpm start -- send-wallet-transaction --chain-id 137 --transaction examples/polygon-native-transfer.json
```

`send-wallet-transaction` accepts a single transaction object or an array.  
If you pass an array, the CLI uses the first item. `@currentWallet` is supported inside the JSON.
Fee option selection is handled by the wallet.

### Manual resume
```bash
pnpm start -- resume --url "<redirect-url>"
```

## Key Files
- `src/index.ts`: CLI entrypoint and command handlers.
- `src/state.ts`: encrypted state manager (AES-256-GCM + scrypt).
- `src/storage.ts`: file-backed `SequenceStorage` + `SequenceSessionStorage`.
- `src/redirect.ts`: redirect URL generation.
- `src/fetch.ts`: polyfills `fetch` + `window.fetch` (required by relayer).
- `src/explicit-session.config.ts`: default explicit session config (typed).
- `src/permissions/*`: helpers + types for building permissions.
- `examples/mint-transaction.json`: example transaction with ABI + `@currentWallet` placeholders.
- `examples/polygon-native-transfer.json`: example Polygon native transfer transaction.

## Default Explicit Session (Type-Safe)
Edit `src/explicit-session.config.ts` to set default explicit session permissions.  
Set to `null` to disable defaults.

Available presets in `src/explicit-session.config.ts`:
- `explicitSessionDefaultsNftArbitrumSepolia` (existing)
- `explicitSessionDefaultsPolygonNativeWithFee` (new, chain `137`)

The active export is:
```ts
export const explicitSessionDefaults = explicitSessionDefaultsPolygonNativeWithFee
```
Switch it to `explicitSessionDefaultsNftArbitrumSepolia` to test Arbitrum Sepolia mint examples instead.

### Fee Option Permissions
If you need fee token permissions:
```ts
includeFeeOptionPermissions: true
```

This will fetch fee tokens and add transfer permissions + value forwarder permission.

## Transactions JSON Features
`send-transaction` accepts JSON with:
- `abi` or `functionSignature`
- `args` (array)
- `@currentWallet` placeholder

Example: `examples/mint-transaction.json`

Run:
```bash
pnpm start -- send-transaction --chain-id 137 --transactions examples/polygon-native-transfer.json
```

`send-wallet-transaction` can accept the same JSON. If you pass an array, the CLI uses the first item.

### Explorer Links
`send-transaction` output includes `explorerUrl` when available.

## Useful Commands
- `reset-pending`: clear stuck redirects.
- `status`: show session info.
- `disconnect --keep-sessionless false`: full wipe.
- `resume --url <redirect-url>`: manual redirect handling.
- `fee-options`, `fee-tokens`: relayer queries.

## Notes for Agents
- This repo currently uses `@0xsequence/dapp-client` `3.0.0-beta.12` as the most recent target.
- CLI forces `TransportMode.REDIRECT`.
- In Codex/Claude Code sandboxed runs, use escalated permissions for redirect-required commands so browser auto-open works.
- Avoid adding mint-specific hardcodes; keep config generic.
- If you change command behavior, update this doc.
