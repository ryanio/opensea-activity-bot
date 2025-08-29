import { type BigNumberish, FixedNumber, formatUnits } from 'ethers';
import sharp from 'sharp';
import type { NFTLike } from './aggregator';
import { logger } from './logger';
import { LRUCache } from './lru-cache';
import { opensea } from './opensea';

const { DEBUG } = process.env;

export function timeout(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const SECONDS_PER_MS = 1000;
export const unixTimestamp = (date: Date) =>
  Math.floor(date.getTime() / SECONDS_PER_MS);

/**
 * Returns a shortened version of a full ethereum address
 * (e.g. 0x38a16…c7eb3)
 */
const ADDR_PREFIX_LEN = 7;
const ADDR_SUFFIX_START = 37;
const ADDR_SUFFIX_END = 42;
export const shortAddr = (addr: string) =>
  `${addr.slice(0, ADDR_PREFIX_LEN)}…${addr.slice(ADDR_SUFFIX_START, ADDR_SUFFIX_END)}`;

/**
 * Env helpers
 */
export const botInterval = Number(process.env.OPENSEA_BOT_INTERVAL ?? 60);
export const minOfferETH = FixedNumber.fromString(
  process.env.MIN_OFFER_ETH ?? '0'
);
export const shortTokenAddr = shortAddr(process.env.TOKEN_ADDRESS ?? '');
export const logStart = `${shortTokenAddr} - `;
export const chain = process.env.CHAIN ?? 'ethereum';

/**
 * OpenSea utils and helpers
 */
export const openseaGet = async (url: string) => {
  try {
    const response = await fetch(url, opensea.GET_OPTS);
    if (!response.ok) {
      logger.error(
        `Fetch Error for ${url} - ${response.status}: ${response.statusText}`,
        DEBUG === 'true' ? await response.text() : undefined
      );
      return;
    }
    const result = await response.json();
    return result;
  } catch (error) {
    const message =
      typeof (error as { message?: unknown })?.message === 'string'
        ? (error as { message: string }).message
        : String(error);
    logger.error(`Fetch Error for ${url}: ${message}`);
  }
};

/**
 * Processes an OpenSea user object and returns, in order:
 * 1. An OpenSea username
 * 2. A short formatted address
 */
const USERNAME_CACHE_CAPACITY = 100;
const usernameCache = new LRUCache<string, string>(USERNAME_CACHE_CAPACITY);
const formatUsername = (name: string, address: string) =>
  name === '' ? shortAddr(address) : name;
export const username = async (address: string) => {
  const cached = usernameCache.get(address);
  if (cached) {
    return formatUsername(cached, address);
  }

  const account = await fetchAccount(address);
  const fetchedName = account?.username ?? '';
  usernameCache.put(address, fetchedName);
  return formatUsername(fetchedName, address);
};

const fetchAccount = async (address: string) => {
  const url = opensea.getAccount(address);
  const result = await openseaGet(url);
  return result;
};

/**
 * Formats amount, decimals, and symbols to final string output.
 */
export const formatAmount = (
  amount: BigNumberish,
  decimals: number,
  symbol: string
) => {
  let value = formatUnits(amount, decimals);
  const split = value.split('.');
  const MAX_DECIMALS = 4;
  if (split[1].length > MAX_DECIMALS) {
    // Trim to 4 decimals max
    value = `${split[0]}.${split[1].slice(0, MAX_DECIMALS + 1)}`;
  } else if (split[1] === '0') {
    // If whole number remove '.0'
    value = split[0];
  }
  return `${value} ${symbol}`;
};

const WIDTH_QUERY_PARAM = /w=(\d)*/;
export const imageForNFT = (nft?: NFTLike): string | undefined => {
  return nft?.image_url?.replace(WIDTH_QUERY_PARAM, 'w=1000');
};

/**
 * Returns a transaction hash for an event, if present.
 */
// Aggregator moved to aggregator.ts

/**
 * Fetch an image and return a buffer and mimeType.
 * Converts SVGs to PNG for broader compatibility.
 */
export const base64Image = async (
  imageURL: string
): Promise<{ buffer: Buffer; mimeType: string }> => {
  const response = await fetch(imageURL);
  const arrayBuffer = await response.arrayBuffer();
  let buffer: Buffer = Buffer.from(new Uint8Array(arrayBuffer)) as Buffer;
  const contentType = response.headers.get('content-type') ?? undefined;
  let mimeType = contentType?.split(';')[0] ?? 'image/jpeg';

  if (mimeType === 'image/svg+xml' || imageURL.toLowerCase().endsWith('.svg')) {
    try {
      buffer = (await sharp(buffer).png().toBuffer()) as Buffer;
      mimeType = 'image/png';
    } catch (_e) {
      if (DEBUG === 'true') {
        logger.warn(`${logStart}Utils - SVG to PNG conversion failed`);
      }
    }
  }

  return { buffer, mimeType };
};
