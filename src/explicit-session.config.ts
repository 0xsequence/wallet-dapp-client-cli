import type { ExplicitSessionDefaults } from './permissions/types.js'
import { createContractPermissions } from './permissions/helpers.js'

const NFT_CONTRACT = '0xD25b37E2fB07f85E9ecA9d40FE3BcF60BA2dc57b'

export const explicitSessionDefaults: ExplicitSessionDefaults | null = {
  includeFeeOptionPermissions: false,
  chainId: 421614,
  expiresInSeconds: 60 * 60 * 24,
  valueLimit: 0n,
  permissions: createContractPermissions({
    address: NFT_CONTRACT,
    functions: [
      {
        functionSignature: 'function safeMint(address to)',
      },
    ],
  }),
}
