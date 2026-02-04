import { Utils } from '@0xsequence/dapp-client'
import { Bytes, Hex } from 'ox'
import type { Address } from 'viem'

import { PARAMETER_OPERATIONS } from './constants.js'
import type {
  CreateContractPermissionOptions,
  CreateContractPermissionsOptions,
  ParameterOperation,
  RuleCondition,
} from './types.js'

type PermissionType = import('@0xsequence/dapp-client').Permission.Permission

const toBytes = (value: string | number | bigint | boolean | Uint8Array): Bytes.Bytes => {
  if (value instanceof Uint8Array) return value
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed.startsWith('0x')) {
      return Bytes.fromHex(trimmed as Hex.Hex)
    }
    return Bytes.fromString(trimmed)
  }
  if (typeof value === 'number' || typeof value === 'bigint') {
    return Bytes.fromNumber(BigInt(value))
  }
  return Bytes.fromString(String(value))
}

const toBigIntValue = (value: string | number | bigint | boolean | Uint8Array): bigint => {
  if (value instanceof Uint8Array) {
    throw new Error('Expected numeric value, received bytes.')
  }
  return BigInt(value as string | number | bigint | boolean)
}

const toBooleanValue = (value: string | number | bigint | boolean | Uint8Array): boolean => {
  if (typeof value !== 'boolean') {
    throw new Error('Expected boolean value.')
  }
  return value
}

const operationMap: { [key in RuleCondition]: ParameterOperation } = {
  EQUAL: PARAMETER_OPERATIONS.EQUAL,
  NOT_EQUAL: PARAMETER_OPERATIONS.NOT_EQUAL,
  LESS_THAN_OR_EQUAL: PARAMETER_OPERATIONS.LESS_THAN_OR_EQUAL,
  GREATER_THAN_OR_EQUAL: PARAMETER_OPERATIONS.GREATER_THAN_OR_EQUAL,
}

/**
 * Creates a permission for a single smart contract function.
 *
 * This helper function generates a permission object for a specific contract function,
 * This is useful when you want to build permissions for individual contracts functions separately.
 *
 * @param options The configuration ({@link CreateContractPermissionOptions}) for the single contract permission.
 * @returns A Permission ({@link Permission}) for the function on the contract.
 *
 * @note If no functions are provided, the dApp can call any function on the contract for the user.
 *
 * @example
 *
 * import { createContractPermission } from './permissions/helpers.js'
 * import { parseUnits } from 'viem'
 *
 * // Allow dApp to transfer up to 1 USDC to any address until the session expires.
 * const permission = createContractPermission({
 *   address: '0x...',
 *   functionSignature: 'function transfer(address to, uint256 value)',
 *   rules: [
 *     {
 *       param: 'value',
 *       type: 'uint256',
 *       condition: 'LESS_THAN_OR_EQUAL',
 *       value: parseUnits('1', 6),
 *       cumulative: true,
 *     },
 *   ],
 * })
 */
function createContractPermission(options: CreateContractPermissionOptions): PermissionType {
  if (!options.address) {
    throw new Error('createContractPermission: Contract address is required.')
  }

  // if no functions are provided, dapp can call any function on the contract
  if (!options.functionSignature) {
    const builder = Utils.PermissionBuilder.for(options.address as Address).allowAll()
    return builder.build()
  }

  let builder = Utils.PermissionBuilder.for(options.address as Address)
  builder = builder.forFunction(options.functionSignature)

  if (options.onlyOnce === true) {
    builder = builder.onlyOnce()
  }

  if (options.rules) {
    for (const rule of options.rules) {
      const isCumulative = rule.cumulative !== false
      const operation = operationMap[rule.condition]

      // Use a switch statement to call the correct type-specific builder method.
      switch (rule.type) {
        case 'address':
          builder = builder.withAddressParam(rule.param, rule.value as Address, operation, isCumulative)
          break
        case 'int256':
          builder = builder.withIntNParam(rule.param, toBigIntValue(rule.value), 256, operation, isCumulative)
          break
        case 'int8':
          builder = builder.withIntNParam(rule.param, toBigIntValue(rule.value), 8, operation, isCumulative)
          break
        case 'int16':
          builder = builder.withIntNParam(rule.param, toBigIntValue(rule.value), 16, operation, isCumulative)
          break
        case 'int32':
          builder = builder.withIntNParam(rule.param, toBigIntValue(rule.value), 32, operation, isCumulative)
          break
        case 'int64':
          builder = builder.withIntNParam(rule.param, toBigIntValue(rule.value), 64, operation, isCumulative)
          break
        case 'int128':
          builder = builder.withIntNParam(rule.param, toBigIntValue(rule.value), 128, operation, isCumulative)
          break
        case 'uint256':
          builder = builder.withUintNParam(rule.param, toBigIntValue(rule.value), 256, operation, isCumulative)
          break
        case 'uint8':
          builder = builder.withUintNParam(rule.param, toBigIntValue(rule.value), 8, operation, isCumulative)
          break
        case 'uint16':
          builder = builder.withUintNParam(rule.param, toBigIntValue(rule.value), 16, operation, isCumulative)
          break
        case 'uint32':
          builder = builder.withUintNParam(rule.param, toBigIntValue(rule.value), 32, operation, isCumulative)
          break
        case 'uint64':
          builder = builder.withUintNParam(rule.param, toBigIntValue(rule.value), 64, operation, isCumulative)
          break
        case 'uint128':
          builder = builder.withUintNParam(rule.param, toBigIntValue(rule.value), 128, operation, isCumulative)
          break
        case 'string':
          builder = builder.withStringParam(rule.param, rule.value as string)
          break
        case 'bool':
          builder = builder.withBoolParam(rule.param, toBooleanValue(rule.value), operation)
          break
        case 'bytes':
          builder = builder.withBytesParam(rule.param, toBytes(rule.value))
          break
        case 'bytesN':
          builder = builder.withBytesNParam(rule.param, toBytes(rule.value))
          break
        default:
          throw new Error(`createContractPermission: Unsupported parameter type "${rule.type}".`)
      }
    }
  }

  // Build and add this function's Permission object
  return builder.build()
}

/**
 * Creates contract permissions for multiple smart contract functions.
 *
 * This helper function generates permission objects that define what functions a dApp can call
 * on a specific smart contract, with optional parameter constraints and spending limits.
 *
 * @param options The configuration ({@link CreateContractPermissionsOptions}) for multiple contract permissions.
 * @returns An array of Permissions ({@link Permission}).
 *
 * @note If no functions are provided, the dApp can call any function on the contract for the user.
 */
function createContractPermissions(options: CreateContractPermissionsOptions): PermissionType[] {
  if (!options.address) {
    throw new Error('createContractPermissions: Contract address is required.')
  }

  const allPermissions: PermissionType[] = []

  // if no functions are provided, dapp can call any function on the contract
  if (!options.functions || options.functions.length === 0) {
    const permission = createContractPermission({
      address: options.address,
    })
    allPermissions.push(permission)
  }

  // For each function in this contract, create a separate Permission object
  for (const func of options.functions || []) {
    if (!func.functionSignature) {
      throw new Error('createContractPermissions: `signature` is required for each function permission.')
    }

    // Use createContractPermission for each individual function
    const permission = createContractPermission({
      address: options.address,
      functionSignature: func.functionSignature,
      rules: func.rules,
      onlyOnce: func.onlyOnce,
    })

    allPermissions.push(permission)
  }

  return allPermissions
}

export { createContractPermission, createContractPermissions }
