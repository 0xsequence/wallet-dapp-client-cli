# dapp-client-cli

A standalone CLI wrapper around `@0xsequence/dapp-client` (v3.0.0-beta.12).  
The CLI uses **redirect mode** and prints redirect URLs instead of opening a browser. State is encrypted at rest and persisted on disk.

## Install

```bash
pnpm install
pnpm run build
```

## Configuration

Create a local `.env` (or export env vars):

```
WALLET_URL=https://v3.sequence-dev.app
PROJECT_ACCESS_KEY=...
ORIGIN=http://localhost:3000
REDIRECT_PATH=/
DAPP_CLIENT_CLI_PASSPHRASE=...
```

Notes:
- `ORIGIN + REDIRECT_PATH` must be a reachable HTTP URL for redirect flows.
- The CLI uses the passphrase to encrypt state at `~/.sequence/dapp-client-cli/state.enc`.

## Quick Start

```bash
pnpm start -- connect --chain-id 421614
```

By default the CLI starts a local listener. You will see a URL printed; open it in a browser and approve. The CLI will auto‑resume and print the result.

To disable the listener:
```bash
pnpm start -- --no-listen connect --chain-id 421614
```

## Commands

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
pnpm start -- sign-message --chain-id 421614 --message "hello"
```

### Send transaction (explicit session)
```bash
pnpm start -- send-transaction --chain-id 421614 --transactions examples/mint-transaction.json
```

### Send transaction via wallet (redirect)
```bash
pnpm start -- send-wallet-transaction --chain-id 421614 --transaction examples/mint-transaction.json
```

`send-wallet-transaction` accepts a single transaction object or an array.  
If you pass an array, the CLI uses the first item. `@currentWallet` is supported inside the JSON.

### Resume (manual)
```bash
pnpm start -- resume --url "<redirect-url>"
```

## Explicit Session Defaults (Type‑Safe)

Edit `src/explicit-session.config.ts` to configure default explicit session permissions.  
Set it to `null` to disable defaults.

If you need fee token permissions, set:
```ts
includeFeeOptionPermissions: true
```

## Transactions JSON

`send-transaction` supports:
- `abi` or `functionSignature`
- `args` (array)
- `@currentWallet` — a special token you can use in any `args` field. The CLI replaces it with the active wallet address before encoding the call.

`send-wallet-transaction` can accept the same JSON. If you pass an array, the CLI uses the first item.

Example in `examples/mint-transaction.json`:

```json
[
  {
    "to": "0xD25b37E2fB07f85E9ecA9d40FE3BcF60BA2dc57b",
    "abi": "function safeMint(address to)",
    "args": ["@currentWallet"],
    "value": "0"
  }
]
```

## Output

`send-transaction` prints the transaction hash plus an explorer URL when available:

```json
{
  "txHash": "0x...",
  "explorerUrl": "https://..."
}
```

## Notes

- CLI forces `TransportMode.REDIRECT`.
- macOS OS‑level notifications are triggered when a redirect needs user action.
  - Disable with `DAPP_CLIENT_CLI_NO_OS_NOTIFY=1`.
