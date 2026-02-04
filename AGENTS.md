# Agent Guide (Codex / Claude / etc.)

This repo is a standalone CLI wrapper around `@0xsequence/dapp-client` (v3.0.0-beta.12). It runs in **redirect mode** and prints redirect URLs instead of opening a browser. State is encrypted at rest and persisted on disk.

## Quick Start

```bash
pnpm install
pnpm run build
pnpm start -- --help
```

### Required config
Update `.env` (local only) or export env vars:

```
WALLET_URL=https://v3.sequence-dev.app
PROJECT_ACCESS_KEY=...
ORIGIN=http://localhost:3000
REDIRECT_PATH=/
DAPP_CLIENT_CLI_PASSPHRASE=...
```

### Connect (redirect + auto resume)
```bash
pnpm start -- reset-pending
pnpm start -- --listen connect --chain-id 421614
```

The CLI prints a URL, you open it, approve, then it auto-resumes via the local listener.

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
pnpm start -- --listen sign-message --chain-id 421614 --message "hello"
```

### Send transaction (explicit session)
```bash
pnpm start -- send-transaction --chain-id 421614 --transactions examples/mint-transaction.json
```

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

## Default Explicit Session (Type-Safe)
Edit `src/explicit-session.config.ts` to set default explicit session permissions.  
Set to `null` to disable defaults.

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
pnpm start -- send-transaction --chain-id 421614 --transactions examples/mint-transaction.json
```

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
- Avoid adding mint-specific hardcodes; keep config generic.
- If you change command behavior, update this doc.
