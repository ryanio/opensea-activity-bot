import { type BigNumberish, FixedNumber, formatUnits } from 'ethers';
import sharp from 'sharp';
import type { NFTLike } from './aggregator';
import { logger } from './logger';

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
export const chain = process.env.CHAIN ?? 'ethereum';
export const shortTokenAddr = shortAddr(process.env.TOKEN_ADDRESS ?? '');

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
 * Fetch an image and return a buffer and mimeType.
 * Converts SVGs to PNG for broader compatibility.
 */
export const fetchImageBuffer = async (
  imageURL: string
): Promise<{ buffer: Buffer; mimeType: string }> => {
  const response = await fetch(imageURL);
  const arrayBuffer = await response.arrayBuffer();
  let buffer: Buffer = Buffer.from(new Uint8Array(arrayBuffer)) as Buffer;
  const contentType = response.headers.get('content-type') ?? undefined;
  let mimeType = contentType?.split(';')[0] ?? 'image/jpeg';

  if (mimeType === 'image/svg+xml' || imageURL.toLowerCase().endsWith('.svg')) {
    try {
      // Fix font issues for unicode character rendering
      const svgString = buffer.toString('utf8');

      // Replace the monospace font stack with fonts that definitely support mathematical symbols
      const fixedSvg = svgString.replace(
        /font-family:[^;]+/g,
        'font-family:"DejaVu Sans","Liberation Sans","Noto Sans","Arial Unicode MS",sans-serif'
      );

      buffer = (await sharp(Buffer.from(fixedSvg, 'utf8'))
        .png()
        .toBuffer()) as Buffer;
      mimeType = 'image/png';
    } catch (e) {
      logger.debug('utils: SVG to PNG conversion failed:', e);
      // Keep original SVG buffer and mime type on failure
    }
  }

  return { buffer, mimeType };
};
