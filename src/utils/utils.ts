import { type BigNumberish, FixedNumber, formatUnits } from "ethers";
import sharp from "sharp";
import type { NFTLike } from "./aggregator";
import {
  DEAD_ADDRESS,
  GLYPHBOTS_CONTRACT_ADDRESS,
  MS_PER_SECOND,
  NULL_ADDRESS,
  NULL_ONE_ADDRESS,
} from "./constants";
import { logger } from "./logger";

export function timeout(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const unixTimestamp = (date: Date) =>
  Math.floor(date.getTime() / MS_PER_SECOND);

/**
 * Formats a Unix timestamp as a relative time string (e.g., "2 hours ago")
 */
export const formatTimeAgo = (timestamp: number): string => {
  const now = Date.now();
  const diffMs = now - timestamp * MS_PER_SECOND;
  const diffSeconds = Math.floor(diffMs / MS_PER_SECOND);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffDays > 0) {
    return `${diffDays} day${diffDays === 1 ? "" : "s"} ago`;
  }
  if (diffHours > 0) {
    return `${diffHours} hour${diffHours === 1 ? "" : "s"} ago`;
  }
  if (diffMinutes > 0) {
    return `${diffMinutes} minute${diffMinutes === 1 ? "" : "s"} ago`;
  }
  return "just now";
};

/**
 * Formats a Unix timestamp as a human-readable date (e.g., "Dec 4, 2025, 10:30 AM")
 */
export const formatReadableDate = (timestamp: number): string => {
  const date = new Date(timestamp * MS_PER_SECOND);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
};

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
  process.env.MIN_OFFER_ETH ?? "0"
);
export const chain = process.env.CHAIN ?? "ethereum";
export const fullTokenAddr = process.env.TOKEN_ADDRESS ?? "";
export const shortTokenAddr = shortAddr(fullTokenAddr);

export type TransferKind = "mint" | "burn" | "transfer";

// Regex patterns for formatAmount (moved to top level for performance)
const TRAILING_ZEROS_REGEX = /(\.\d*?)0+$/;
const TRAILING_DOT_REGEX = /\.$/;

export const classifyTransfer = (event: {
  event_type?: string;
  from_address?: string;
  to_address?: string;
}): TransferKind => {
  if (event?.event_type === "mint") {
    return "mint";
  }
  if (event?.event_type !== "transfer") {
    return "transfer";
  }
  const from = (event.from_address ?? "").toLowerCase();
  const to = (event.to_address ?? "").toLowerCase();
  if (from === NULL_ADDRESS) {
    return "mint";
  }
  if (to === NULL_ADDRESS || to === DEAD_ADDRESS || to === NULL_ONE_ADDRESS) {
    return "burn";
  }
  return "transfer";
};

/**
 * Formats amount, decimals, and symbols to final string output.
 * Rounds to MAX_DECIMALS places (instead of truncating).
 * Converts WETH to ETH for display.
 */
export const formatAmount = (
  amount: BigNumberish,
  decimals: number,
  symbol: string
) => {
  const raw = formatUnits(amount, decimals);
  const MAX_DECIMALS = 4;

  // Parse and round to avoid truncation issues
  const parsed = Number.parseFloat(raw);
  const multiplier = 10 ** MAX_DECIMALS;
  const rounded = Math.round(parsed * multiplier) / multiplier;

  // Format the rounded value, removing unnecessary trailing zeros
  let value = rounded.toFixed(MAX_DECIMALS);

  // Remove trailing zeros after decimal point
  value = value
    .replace(TRAILING_ZEROS_REGEX, "$1")
    .replace(TRAILING_DOT_REGEX, "");

  // Convert WETH to ETH for display
  const displaySymbol = symbol === "WETH" ? "ETH" : symbol;

  return `${value} ${displaySymbol}`;
};

const WIDTH_QUERY_PARAM = /w=(\d)*/;
export const imageForNFT = (nft?: NFTLike): string | undefined => {
  const imageUrl = nft?.image_url;
  if (!imageUrl) {
    return;
  }

  // If URL already has w= parameter, replace it
  if (imageUrl.includes("w=")) {
    return imageUrl.replace(WIDTH_QUERY_PARAM, "w=10000");
  }

  // Otherwise, add w=10000 as a query parameter
  const separator = imageUrl.includes("?") ? "&" : "?";
  return `${imageUrl}${separator}w=10000`;
};

// Helper to check if NFT is ERC1155 with multiple editions
export const isERC1155WithMultipleEditions = (
  tokenStandard: string | undefined,
  quantity: number | undefined
): boolean => {
  const isErc1155 = (tokenStandard ?? "").toLowerCase() === "erc1155";
  const editions = Number(quantity ?? 0);
  return isErc1155 && editions > 1;
};

// Helper to format editions text for ERC1155
export const formatEditionsText = (
  name: string,
  tokenStandard: string | undefined,
  quantity: number | undefined
): string => {
  if (isERC1155WithMultipleEditions(tokenStandard, quantity)) {
    const editions = Number(quantity ?? 0);
    return `${name} (${editions} editions)`;
  }
  return name;
};

export const formatNftPrefix = (
  nft: { name?: string; identifier?: string | number } | undefined
): string => {
  if (!nft) {
    return "";
  }
  const specialContract =
    process.env.TOKEN_ADDRESS?.toLowerCase() === GLYPHBOTS_CONTRACT_ADDRESS;
  if (specialContract && nft.name && nft.identifier !== undefined) {
    const nameParts = String(nft.name).split(" - ");
    const suffix = nameParts.length > 1 ? nameParts[1].trim() : undefined;
    const idStr = String(nft.identifier);
    return suffix ? `${suffix} #${idStr} ` : `#${idStr} `;
  }
  return `#${String(nft.identifier)} `;
};

/**
 * Converts SVG buffer to PNG format.
 */
const convertSvgToPng = async (
  buffer: Buffer
): Promise<{ buffer: Buffer; mimeType: string }> => {
  try {
    // Fix font issues for unicode character rendering
    const svgString = buffer.toString("utf8");

    // Replace with browser-realistic monospace fallback that supports unicode
    // Browsers would fall back: SF Mono -> Menlo -> Consolas -> DejaVu Sans Mono -> monospace
    const fixedSvg = svgString.replace(
      /font-family:[^;]+/g,
      'font-family:"SF Mono","Menlo","Consolas","DejaVu Sans Mono","Liberation Mono",monospace'
    );

    const pngBuffer = (await sharp(Buffer.from(fixedSvg, "utf8"))
      .png()
      .toBuffer()) as Buffer;
    return { buffer: pngBuffer, mimeType: "image/png" };
  } catch (e) {
    logger.debug("utils: SVG to PNG conversion failed:", e);
    // Keep original SVG buffer and mime type on failure
    return { buffer, mimeType: "image/svg+xml" };
  }
};

/**
 * Fetch an image and return a buffer and mimeType.
 * Converts SVGs to PNG for compatibility with Twitter API.
 * Requests JPEG format via Accept header to ensure compatible format.
 */
export const fetchImageBuffer = async (
  imageURL: string
): Promise<{ buffer: Buffer; mimeType: string }> => {
  // Request JPEG format to ensure Twitter API compatibility
  const response = await fetch(imageURL, {
    headers: {
      Accept: "image/jpeg",
    },
  });

  // Check if response is successful
  if (!response.ok) {
    throw new Error(
      `Failed to fetch image: ${response.status} ${response.statusText}`
    );
  }

  const arrayBuffer = await response.arrayBuffer();

  // Check if we got any data
  if (arrayBuffer.byteLength === 0) {
    throw new Error("Image fetch returned empty data");
  }

  let buffer: Buffer = Buffer.from(new Uint8Array(arrayBuffer)) as Buffer;
  const contentType = response.headers.get("content-type") ?? undefined;

  // Validate that we got an image content type
  if (contentType && !contentType.startsWith("image/")) {
    throw new Error(`Invalid content type: ${contentType} (expected image/*)`);
  }

  let mimeType = contentType?.split(";")[0] ?? "image/jpeg";

  // Convert SVG to PNG
  if (mimeType === "image/svg+xml" || imageURL.toLowerCase().endsWith(".svg")) {
    const result = await convertSvgToPng(buffer);
    buffer = result.buffer;
    mimeType = result.mimeType;
  }

  return { buffer, mimeType };
};
