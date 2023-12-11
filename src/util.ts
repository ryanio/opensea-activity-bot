import { BigNumberish, FixedNumber, formatUnits } from 'ethers'
import { opensea } from './opensea'

const { DEBUG, TOKEN_ADDRESS } = process.env

export function timeout(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export const unixTimestamp = (date: Date) => Math.floor(date.getTime() / 1000)

/**
 * Formats string value with commas.
 */
function commify(value: string) {
  const match = value.match(/^(-?)([0-9]*)(\.?)([0-9]*)$/)
  if (!match || (!match[2] && !match[4])) {
    throw new Error(`bad formatted number: ${JSON.stringify(value)}`)
  }

  const neg = match[1]
  const whole = BigInt(match[2] || 0).toLocaleString('en-us')
  const frac = match[4] ? match[4].match(/^(.*?)0*$/)[1] : '0'

  return `${neg}${whole}.${frac}`
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

export const permalink = (tokenId: number) =>
  `https://opensea.io/assets/${chain}/${TOKEN_ADDRESS}/${tokenId}`

const fetchAccount = async (address: string) => {
  try {
    const response = await fetch(opensea.getAccount(address), opensea.GET_OPTS)
    if (!response.ok) {
      console.error(
        `Fetch Error - ${response.status}: ${response.statusText}`,
        DEBUG === 'true'
          ? `DEBUG: ${JSON.stringify(await response.text())}`
          : '',
      )
      return
    }
    const account = await response.json()
    if (!account) {
      return
    }
    return account
  } catch (error) {
    console.error(`Fetch Error: ${error?.message ?? error}`)
  }
}

/**
 * Processes an OpenSea user object and returns, in order:
 * 1. An OpenSea username
 * 2. A short formatted address
 * */
const cachedUsernames: { [key: string]: string } = {}
export const username = async (address: string) => {
  if (address in cachedUsernames) {
    return cachedUsernames[address]
  }
  const account = await fetchAccount(address)
  const username = account?.username
  if (username && username !== '') {
    cachedUsernames[address] = username
    return username
  }
  return shortAddr(address)
}

/**
 * Formats amount, decimals, and symbols to final string output.
 */
export const formatAmount = (
  amount: BigNumberish,
  decimals: number,
  symbol: string,
) => {
  let value = formatUnits(amount.toString(), decimals)
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
    FixedNumber.fromString(price.split(' ')[0])
      .mulUnsafe(FixedNumber.fromString(usdPrice))
      .toUnsafeFloat()
      .toFixed(2),
  )
  // Format to 2 decimal places e.g. $1.3 -> $1.30
  if (value.split('.')[1].length === 1) {
    value = `${value}0`
  }
  return value
}

export const assetUSDValue = (event: any) => {
  const { bid_amount, total_price, payment_token } = event
  const { decimals, usd_price } = payment_token
  const price = formatUnits(bid_amount ?? total_price, decimals)
  return Number(
    FixedNumber.fromString(price)
      .mulUnsafe(FixedNumber.fromString(usd_price))
      .toUnsafeFloat()
      .toFixed(2),
  )
}

export const imageForNFT = (nft: any) => {
  return nft.image_url.replace(/w=(\d)*/, 'w=1000')
}

/**
 * Env helpers
 */
export const botInterval = Number(process.env.OPENSEA_BOT_INTERVAL ?? 60)
export const minOfferUSD = Number(process.env.MIN_OFFER_USD ?? 100)
export const shortTokenAddr = shortAddr(process.env.TOKEN_ADDRESS)
export const logStart = `${shortTokenAddr} - `
export const chain = process.env.CHAIN ?? 'ethereum'
