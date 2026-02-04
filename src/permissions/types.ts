import type { Permission } from '@0xsequence/dapp-client'
import type { Address } from 'viem'

export type RuleCondition = 'EQUAL' | 'NOT_EQUAL' | 'LESS_THAN_OR_EQUAL' | 'GREATER_THAN_OR_EQUAL'

export type ParameterOperation = (typeof Permission.ParameterOperation)[keyof typeof Permission.ParameterOperation]

export type RuleType =
  | 'address'
  | 'int256'
  | 'int8'
  | 'int16'
  | 'int32'
  | 'int64'
  | 'int128'
  | 'uint256'
  | 'uint8'
  | 'uint16'
  | 'uint32'
  | 'uint64'
  | 'uint128'
  | 'string'
  | 'bool'
  | 'bytes'
  | 'bytesN'

export type Rule = {
  param: string
  type: RuleType
  condition: RuleCondition
  value: string | number | bigint | boolean | Uint8Array
  cumulative?: boolean
}

export type CreateContractPermissionOptions = {
  address: Address | string
  functionSignature?: string
  rules?: Rule[]
  onlyOnce?: boolean
}

export type CreateContractPermissionsOptions = {
  address: Address | string
  functions?: Array<{
    functionSignature: string
    rules?: Rule[]
    onlyOnce?: boolean
  }>
}

export type ExplicitSessionDefaults = {
  includeFeeOptionPermissions?: boolean
  chainId: number
  valueLimit?: bigint
  expiresInSeconds?: number
  permissions: Permission.Permission[]
}
