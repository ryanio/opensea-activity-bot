import { BigNumberish, FixedNumber, formatUnits } from 'ethers'
import { opensea } from './opensea'
import { LRUCache } from './lruCache'

const { DEBUG } = process.env

export function timeout(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export const unixTimestamp = (date: Date) => Math.floor(date.getTime() / 1000)

/**
 * Returns a shortened version of a full ethereum address
 * (e.g. 0x38a16…c7eb3)
 */
export const shortAddr = (addr: string) =>
  addr.slice(0, 7) + '…' + addr.slice(37, 42)

/**
 * Env helpers
 */
export const botInterval = Number(process.env.OPENSEA_BOT_INTERVAL ?? 60)
export const minOfferETH = FixedNumber.fromString(
  process.env.MIN_OFFER_ETH ?? '0',
)
export const shortTokenAddr = shortAddr(process.env.TOKEN_ADDRESS)
export const logStart = `${shortTokenAddr} - `
export const chain = process.env.CHAIN ?? 'ethereum'

/**
 * OpenSea utils and helpers
 */
export const openseaGet = async (url: string) => {
  try {
    const response = await fetch(url, opensea.GET_OPTS)
    if (!response.ok) {
      console.error(
        `Fetch Error for ${url} - ${response.status}: ${response.statusText}`,
        DEBUG === 'true'
          ? `DEBUG: ${JSON.stringify(await response.text())}`
          : '',
      )
      return
    }
    const result = await response.json()
    return result
  } catch (error) {
    console.error(`Fetch Error for ${url}: ${error?.message ?? error}`)
  }
}

/**
 * Processes an OpenSea user object and returns, in order:
 * 1. An OpenSea username
 * 2. A short formatted address
 * */
const usernameCache = new LRUCache<string, string>(100)
const usernameFormat = (username: string, address: string) =>
  username == '' ? shortAddr(address) : username
export const username = async (address: string) => {
  const cached = usernameCache.get(address)
  if (cached) return usernameFormat(cached, address)

  const account = await fetchAccount(address)
  const username = account?.username ?? ''
  usernameCache.put(address, username)
  return usernameFormat(username, address)
}

const fetchAccount = async (address: string) => {
  const url = opensea.getAccount(address)
  const result = await openseaGet(url)
  return result
}

/**
 * Formats amount, decimals, and symbols to final string output.
 */
export const formatAmount = (
  amount: BigNumberish,
  decimals: number,
  symbol: string,
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

export const imageForNFT = (nft: any): string | undefined => {
  return nft.image_url?.replace(/w=(\d)*/, 'w=1000')
}

