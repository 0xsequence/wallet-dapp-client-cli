import { type DappClient } from '@0xsequence/dapp-client'
import type { Permission, FeeToken, GetFeeTokensResponse } from '@0xsequence/dapp-client'
import { parseEther, parseUnits, type Address } from 'viem'

import { createContractPermission } from './helpers.js'
import { SEQUENCE_VALUE_FORWARDER } from './constants.js'

type IncludeFeeOptionPermissionsParams = {
  dappClient: DappClient
  chainId: number
  permissions: Permission.Permission[]
}

const ensureValueForwarderPermission = (permissions: Permission.Permission[]): Permission.Permission[] => {
  const hasValueForwarder = permissions.some((permission) => permission.target === SEQUENCE_VALUE_FORWARDER)
  if (hasValueForwarder) return permissions
  return [...permissions, { target: SEQUENCE_VALUE_FORWARDER, rules: [] }]
}

const buildFeeOptionPermissions = (feeTokens: GetFeeTokensResponse): Permission.Permission[] => {
  if (!feeTokens.isFeeRequired || !feeTokens.tokens || feeTokens.tokens.length === 0) return []
  if (!feeTokens.paymentAddress) {
    throw new Error('Fee tokens response missing paymentAddress.')
  }

  return feeTokens.tokens.map((token: FeeToken) =>
    createContractPermission({
      address: token.contractAddress as Address,
      functionSignature: 'function transfer(address to, uint256 value)',
      rules: [
        {
          param: 'value',
          type: 'uint256',
          condition: 'LESS_THAN_OR_EQUAL',
          value: token.decimals === 18 ? parseEther('0.1') : parseUnits('50', token.decimals || 6),
          cumulative: true,
        },
        {
          param: 'to',
          type: 'address',
          condition: 'EQUAL',
          value: feeTokens.paymentAddress as Address,
          cumulative: false,
        },
      ],
    }),
  )
}

export const includeFeeOptionPermissions = async (
  params: IncludeFeeOptionPermissionsParams,
): Promise<Permission.Permission[]> => {
  const basePermissions = ensureValueForwarderPermission([...params.permissions])
  const feeTokens = await params.dappClient.getFeeTokens(params.chainId)
  const feeOptionPermissions = buildFeeOptionPermissions(feeTokens)
  return [...basePermissions, ...feeOptionPermissions]
}
