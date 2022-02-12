import { ethers } from 'ethers'

export function timeout(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export const unixTimestamp = (date: Date) => Math.floor(date.getTime() / 1000)

/**
 * ENS
 */
const infuraProvider = new ethers.providers.InfuraProvider(
  'mainnet',
  process.env.INFURA_PROJECT_ID ? process.env.INFURA_PROJECT_ID : undefined
)

export const ensName = async (addr: string): Promise<string | undefined> => {
  try {
    const ens = await infuraProvider.lookupAddress(addr)
    return ens
  } catch (error) {
    console.error(`Error from ensName: ${error}`)
  }
}

/**
 * Returns a shortened version of a full ethereum address
 * (e.g. 0x38a16...c7eb3)
 */
export const shortAddr = (addr: string) =>
  addr.slice(0, 7) + '...' + addr.slice(37, 42)

/**
 * OpenSea utils and helpers
 */

/**
 * Processes an OpenSea user object and returns, in order:
 * 1. An OpenSea username
 * 2. An ENS address
 * 3. A short formatted address
 * 4. 'Unknown'
 * */
export const username = async (user) => {
  if (user.user?.username) return user.user.username
  const ens = await ensName(user.address)
  if (ens) return ens
  if (user.address) return shortAddr(user.address)
  return 'Unknown'
}

export const assetUSDValue = (event: any) => {
  const { bid_amount, payment_token } = event
  const { decimals, usd_price } = payment_token
  const price = ethers.utils.formatUnits(bid_amount, decimals)
  return Number(
    ethers.FixedNumber.from(price)
      .mulUnsafe(ethers.FixedNumber.from(usd_price))
      .toUnsafeFloat()
      .toFixed(2)
  )
}

/**
 * Env helpers
 */
export const botInterval = Number(process.env.OPENSEA_BOT_INTERVAL ?? 60)
export const minOfferUSD = Number(process.env.MIN_OFFER_USD ?? 100)
export const shortTokenAddr = shortAddr(process.env.TOKEN_ADDRESS)
export const logStart = `${shortTokenAddr} - `
