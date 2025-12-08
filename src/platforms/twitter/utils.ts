import { username } from "../../opensea";
import type {
  OpenSeaAssetEvent,
  OpenSeaEventType,
  OpenSeaOrderType,
  OpenSeaPayment,
} from "../../types";
import {
  classifyTransfer,
  formatAmount,
  formatEditionsText,
} from "../../utils/utils";

const GLYPHBOTS_CONTRACT_ADDRESS = "0xb6c2c2d2999c1b532e089a7ad4cb7f8c91cf5075";

export const wrapTweetText = (text: string): string => {
  let wrapped = text;
  if (process.env.TWITTER_PREPEND_TWEET) {
    wrapped = `${process.env.TWITTER_PREPEND_TWEET} ${wrapped}`;
  }
  if (process.env.TWITTER_APPEND_TWEET) {
    wrapped = `${wrapped} ${process.env.TWITTER_APPEND_TWEET}`;
  }
  return wrapped;
};

export const formatNftName = (
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
  // For regular NFTs, return the name if available, otherwise the identifier
  return nft.name ? `${nft.name} ` : `#${String(nft.identifier)} `;
};

export const formatOrderText = async (
  payment: OpenSeaPayment,
  maker: string,
  order_type: OpenSeaOrderType | string
) => {
  const name = await username(maker);
  const price = formatAmount(
    payment.quantity,
    payment.decimals,
    payment.symbol
  );
  if (order_type === ("listing" satisfies OpenSeaOrderType)) {
    return `listed on sale for ${price} by ${name}`;
  }
  if (
    order_type === ("item_offer" satisfies OpenSeaOrderType) ||
    order_type === "offer" ||
    order_type === "criteria_offer"
  ) {
    return `has a new offer for ${price} by ${name}`;
  }
  if (order_type === ("collection_offer" satisfies OpenSeaOrderType)) {
    return `New collection offer. ${price} by ${name}`;
  }
  if (order_type === ("trait_offer" satisfies OpenSeaOrderType)) {
    return `New trait offer. ${price} by ${name}`;
  }
  return "";
};

export const formatSaleText = async (
  payment: OpenSeaPayment,
  buyer: string
) => {
  const amount = formatAmount(
    payment.quantity,
    payment.decimals,
    payment.symbol
  );
  const name = await username(buyer);
  return `purchased for ${amount} by ${name}`;
};

export const formatTransferText = async (event: OpenSeaAssetEvent) => {
  const kind = classifyTransfer(event);
  const from = event.from_address ?? "";
  const to = event.to_address ?? "";
  if (kind === "mint") {
    const toName = await username(to);
    return `minted by ${toName}`;
  }
  if (kind === "burn") {
    const fromName = await username(from);
    return `burned by ${fromName}`;
  }
  const fromName = await username(from);
  const toName = await username(to);
  return `transferred from ${fromName} to ${toName}`;
};

export const textForOrder = async (params: {
  nft: { name?: string; identifier?: string | number } | undefined;
  payment: OpenSeaPayment;
  maker: string;
  order_type: OpenSeaOrderType | string;
}): Promise<string> => {
  const { nft, payment, maker, order_type } = params;
  let text = "";
  if (nft) {
    text += formatNftName(nft);
  }
  text += await formatOrderText(payment, maker, order_type);
  return text;
};

export const textForSale = async (params: {
  nft: { name?: string; identifier?: string | number } | undefined;
  payment: OpenSeaPayment;
  buyer: string;
}): Promise<string> => {
  const { nft, payment, buyer } = params;
  let text = "";
  if (nft) {
    text += formatNftName(nft);
  }
  text += await formatSaleText(payment, buyer);
  return text;
};

export const textForTransfer = async (
  nft:
    | { name?: string; identifier?: string | number; opensea_url?: string }
    | undefined,
  ev: OpenSeaAssetEvent
): Promise<string> => {
  const kind = classifyTransfer(ev);
  if (kind === "mint" || kind === "burn") {
    // Use formatNftName to get the properly formatted name for special collections like glyphbots
    let name = formatNftName(nft).trim();
    if (kind === "mint") {
      const tokenStandard = (nft as { token_standard?: string } | undefined)
        ?.token_standard;
      name = formatEditionsText(name, tokenStandard, ev.quantity);
    }
    const phrase = await formatTransferText(ev);
    return `${name} ${phrase}`;
  }
  let text = "";
  if (nft) {
    text += formatNftName(nft);
  }
  text += await formatTransferText(ev);
  return text;
};

// Helper sets for event type classification
const ORDER_EVENT_TYPES = new Set<OpenSeaEventType | "order">([
  "order",
  "listing",
  "offer",
  "trait_offer",
  "collection_offer",
]);
const TRANSFER_EVENT_TYPES = new Set(["transfer", "mint"]);

export const textForTweet = async (event: OpenSeaAssetEvent) => {
  const ev = event;
  const { asset, event_type, payment, order_type, maker, buyer } = ev;
  // Handle null asset from trait/collection offers by converting to undefined
  const nft = ev.nft ?? (asset === null ? undefined : asset);
  let text = "";

  // Handle "order" event type - the API returns this for listings and offers
  // The actual type is determined by order_type
  const isListingOrOfferEvent = ORDER_EVENT_TYPES.has(event_type);
  const isTransferOrMintEvent = TRANSFER_EVENT_TYPES.has(event_type);

  if (isListingOrOfferEvent && payment && maker && order_type) {
    text += await textForOrder({ nft, payment, maker, order_type });
  } else if (event_type === "sale" && payment && buyer) {
    text += await textForSale({ nft, payment, buyer });
  } else if (isTransferOrMintEvent) {
    text += await textForTransfer(nft, ev);
  }
  if (nft?.identifier) {
    text += ` ${nft.opensea_url}`;
  }

  return wrapTweetText(text);
};

export const getTransferKind = (event: OpenSeaAssetEvent): string => {
  const kind = classifyTransfer(event);
  if (kind === "burn") {
    return "burn";
  }
  if (kind === "mint") {
    return "mint";
  }
  return "transfer";
};
