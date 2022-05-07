import { BaseStreamMessage, Payload } from '@opensea/stream-js'
import { FixedNumber, providers, utils } from 'ethers'

export interface Event extends BaseStreamMessage<Payload> {}

const { commify, formatUnits } = utils

export function timeout(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export const unixTimestamp = (date: Date) => Math.floor(date.getTime() / 1000)

/**
 * ENS
 */
const infuraProvider = new providers.InfuraProvider(
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
 * (e.g. 0x38a16…c7eb3)
 */
export const shortAddr = (addr: string) =>
  addr.slice(0, 7) + '…' + addr.slice(37, 42)

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

/**
 * Formats amount, decimals, and symbols to final string output.
 */
export const formatAmount = (
  amount: string,
  decimals: number,
  symbol: string
) => {
  let value = formatUnits(amount, decimals)
  const split = value.split('.')
  if (split[1].length > 4) {
    // Trim to 4 decimals max
    value = `${split[0]}.${split[1].slice(0, 5)}`
  } else if (split[1] === '0') {
    // If whole number remove '.0'
    value = split[0]
  }
  return `${value} ${symbol}`
}

/**
 * Formats price and usdPrice to final string output.
 */
export const formatUSD = (price: string, usdPrice: string) => {
  let value = commify(
    FixedNumber.from(price.split(' ')[0])
      .mulUnsafe(FixedNumber.from(usdPrice))
      .toUnsafeFloat()
      .toFixed(2)
  )
  // Format to 2 decimal places e.g. $1.3 -> $1.30
  if (value.split('.')[1].length === 1) {
    value = `${value}0`
  }
  return value
}

/**
 * Returns item's price in USD
 */
export const itemUSD = (event: Event) => {
  const { base_price, payment_token } = event.payload as any
  const { decimals, usd_price } = payment_token
  const price = formatUnits(base_price, decimals)
  return Number(
    FixedNumber.from(price)
      .mulUnsafe(FixedNumber.from(usd_price))
      .toUnsafeFloat()
      .toFixed(2)
  )
}

export const imageForEvent = (event: Event) => {
  const { image_url } = event.payload.item.metadata
  if (!image_url) return ''
  // Format ipfs:// urls to https://ipfs.io/ipfs/
  if (image_url.slice(0, 7) === 'ipfs://') {
    const hash = image_url.slice(7)
    return `https://ipfs.io/ipfs/${hash}`
  }
  return image_url
}

/**
 * Helpers
 */
export const minOfferUSD = Number(process.env.MIN_OFFER_USD ?? 100)
export const shortTokenAddrs = process.env.COLLECTIONS.split(',').map((c) =>
  c.slice(2) === '0x' ? shortAddr(process.env.TOKEN_ADDRESS) : c.slice(0, 13)
)
export const logStart = shortTokenAddrs.map((a) => `${a} - `)
export const uppercase = (s: string) =>
  s ? s[0].toUpperCase() + s.slice(1) : ''
