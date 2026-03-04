import type { FeeOption } from '@0xsequence/dapp-client'

export const isNativeFeeOption = (option: FeeOption): boolean => {
  const tokenAddress = option.token.contractAddress?.toLowerCase()
  return !tokenAddress || tokenAddress === '0x0000000000000000000000000000000000000000'
}
