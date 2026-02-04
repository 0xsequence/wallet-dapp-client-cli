# dapp-client-cli plan

## Goal
Create a standalone CLI wrapper around `@0xsequence/dapp-client` (v3.0.0-beta.12) with full functionality, operating in redirect mode and printing the redirect URL instead of opening a browser. The CLI should persist state securely across runs (encrypted at rest), support resume/redirect handling, and expose the full DappClient surface area via commands.

## Assumptions
- This repo is standalone at `/Users/tarikan/Development/0xsequence/dapp-client-cli`.
- CLI uses Node.js + TypeScript + ESM.
- State storage must be secure: encrypted on disk using a passphrase and strict file permissions.
- Redirect flows are two-step: command prints a URL, user completes the flow in browser, then `resume` is called with the final redirect URL.

## High-level architecture
- **State encryption**: AES-256-GCM with scrypt key derivation. Store encrypted JSON state at `~/.sequence/dapp-client-cli/state.enc` (or configurable path). Use 0600 permissions.
- **Storage adapters**: File-backed `SequenceStorage` and `SequenceSessionStorage` implementations that read/write through the encrypted state manager.
- **Config**: CLI config stored in encrypted state (wallet URL, origin, access key, endpoints).
- **Transport mode**: Force `TransportMode.REDIRECT` to avoid browser-only popup transport. Use `handleRedirectResponse(url)` for resume.

## Commands (draft)
- `init`: store config (walletUrl, origin, access key, optional nodes/relayer/keymachine URLs, redirectPath)
- `connect`: request new session (implicit and/or explicit). Prints redirect URL.
- `resume --url <redirect-url>`: process redirect response; finalize session.
- `status`: show current session details (wallet address, login method, sessions count).
- `disconnect [--keep-sessionless]`: clear sessions.
- `upgrade-sessionless`: convert sessionless connection to sessions (if present).
- `add-explicit-session`: request explicit session permissions.
- `modify-explicit-session`: modify permissions for an explicit session.
- `sign-message`: request wallet signature via redirect (prints URL).
- `sign-typed-data`: same for typed data.
- `send-wallet-transaction`: send transaction via wallet UI.
- `send-transaction`: direct relayer send if explicit session exists (no redirect).
- `fee-options`, `fee-tokens`: query relayer/fee options.
- `has-permission`: local permission check for current sessions.
- `restore-sessionless`: restore cached sessionless snapshot.

## Security details
- Encrypted state file includes config + storage + sessionStorage.
- Passphrase required via env var (`DAPP_CLIENT_CLI_PASSPHRASE`) or prompt.
- Ensure no sensitive output (private keys, raw storage) unless `--debug`.

## Implementation steps
1. Scaffold project (`package.json`, `tsconfig.json`, `.gitignore`).
2. Implement encrypted state manager.
3. Implement file-backed storage adapters.
4. Build a small redirect URL helper by calling `DappTransport.getRequestRedirectUrl` (or replicate its algorithm) and set pending request context in storage.
5. CLI command handlers using `yargs`, wrapping `DappClient`.
6. Wire resume flow to `dappClient.handleRedirectResponse(url)`.
7. Add minimal output formatting and examples.

## Open questions to resolve during implementation
- Exact location of state file (default `~/.sequence/dapp-client-cli/state.enc`?)
- Passphrase prompting vs env-only.
- Whether to implement manual redirect URL generation using DappTransport or by reusing internal helper.
