import type { ExplicitSessionDefaults } from './permissions/types.js'
import { createContractPermissions } from './permissions/helpers.js'
import { parseEther } from 'viem'

const NFT_CONTRACT = '0xD25b37E2fB07f85E9ecA9d40FE3BcF60BA2dc57b'
const POLYGON_NATIVE_TEST_RECIPIENT = '0x08FFc248A190E700421C0aFB4135768406dCebfF'

export const explicitSessionDefaultsNftArbitrumSepolia: ExplicitSessionDefaults = {
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

export const explicitSessionDefaultsPolygonNativeWithFee: ExplicitSessionDefaults = {
  includeFeeOptionPermissions: true,
  chainId: 137,
  expiresInSeconds: 60 * 60 * 24,
  valueLimit: parseEther('10'),
  permissions: createContractPermissions({
    address: POLYGON_NATIVE_TEST_RECIPIENT,
    // Allow calls/value to the fixed recipient; fee-related permissions are appended automatically.
    functions: [],
  }),
}

// Switch this export to choose which preset the CLI uses by default, or set to null to disable defaults.
export const explicitSessionDefaults: ExplicitSessionDefaults | null = explicitSessionDefaultsPolygonNativeWithFee
