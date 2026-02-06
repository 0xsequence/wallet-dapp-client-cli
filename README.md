# dapp-client-cli

A standalone CLI wrapper around `@0xsequence/dapp-client` (v3.0.0-beta.12).  
The CLI uses **redirect mode** and auto-opens redirect URLs in your browser by default. It prints a short redirect summary by default (full URL is optional). State is encrypted at rest and persisted on disk.

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
pnpm start -- connect --chain-id 137
```

By default the CLI starts a local listener and auto-opens the redirect URL in your browser. It prints a short redirect summary (instead of the full payload URL). Approve in wallet, then the CLI auto‑resumes and prints the result.

To disable the listener:
```bash
pnpm start -- --no-listen connect --chain-id 137
```

To disable automatic URL opening:
```bash
pnpm start -- --no-open-url connect --chain-id 137
```

To print the full redirect URL:
```bash
pnpm start -- --show-redirect-url connect --chain-id 137
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
pnpm start -- sign-message --chain-id 137 --message "hello"
```

### Send transaction (explicit session)
```bash
pnpm start -- send-transaction --chain-id 137 --transactions examples/polygon-native-transfer.json
```

Interactively select a fee option:
```bash
pnpm start -- send-transaction --chain-id 137 --transactions examples/polygon-native-transfer.json --pick-fee-option
```

### Send transaction via wallet (redirect)
```bash
pnpm start -- send-wallet-transaction --chain-id 137 --transaction examples/polygon-native-transfer.json
```

`send-wallet-transaction` accepts a single transaction object or an array.  
If you pass an array, the CLI uses the first item. `@currentWallet` is supported inside the JSON.
Fee option selection is handled by the wallet.

### Resume (manual)
```bash
pnpm start -- resume --url "<redirect-url>"
```

## Explicit Session Defaults (Type‑Safe)

Edit `src/explicit-session.config.ts` to configure default explicit session permissions.  
Set it to `null` to disable defaults.

Available presets in `src/explicit-session.config.ts`:
- `explicitSessionDefaultsNftArbitrumSepolia` (existing)
- `explicitSessionDefaultsPolygonNativeWithFee` (new, chain `137`)

The active export is:
```ts
export const explicitSessionDefaults = explicitSessionDefaultsPolygonNativeWithFee
```
Switch it to `explicitSessionDefaultsNftArbitrumSepolia` to test Arbitrum Sepolia mint examples instead.

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

Polygon native transfer example (for `explicitSessionDefaultsPolygonNativeWithFee`) is in `examples/polygon-native-transfer.json`.

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
