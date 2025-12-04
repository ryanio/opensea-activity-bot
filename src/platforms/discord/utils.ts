import {
  AttachmentBuilder,
  type ColorResolvable,
  EmbedBuilder,
} from "discord.js";
import { format } from "timeago.js";
import { EventType, getCollectionSlug, opensea, username } from "../../opensea";
import {
  BotEvent,
  type OpenSeaAssetEvent,
  type OpenSeaEventType,
  type OpenSeaOrderType,
} from "../../types";
import type { AggregatorEvent } from "../../utils/aggregator";
import { MS_PER_SECOND } from "../../utils/constants";
import {
  calculateTotalSpent,
  type GroupedEvent,
  type GroupKind,
  getTopExpensiveEvents,
  groupKindForEvents,
  primaryActorAddressForGroup,
} from "../../utils/event-grouping";
import { colorForEvent, effectiveEventTypeFor } from "../../utils/event-types";
import {
  openseaCollectionActivityUrl,
  openseaProfileActivityUrl,
  openseaProfileCollectionUrl,
} from "../../utils/links";
import { prefixedLogger } from "../../utils/logger";
import {
  classifyTransfer,
  fetchImageBuffer,
  formatAmount,
  formatEditionsText,
  imageForNFT,
} from "../../utils/utils";

const log = prefixedLogger("Discord");

/**
 * Escapes Discord markdown special characters to prevent formatting issues.
 * Characters escaped: _ * ~ ` | >
 */
export const escapeMarkdown = (text: string): string =>
  text.replace(/(?<special>[_*~`|>])/g, "\\$<special>");

export type Field = { name: string; value: string; inline?: true };

const colorFor = (
  eventType: EventType | BotEvent,
  orderType: OpenSeaOrderType | undefined
) => colorForEvent(eventType, orderType);

// ---- Order/Sale/Transfer embed builders ----

export const buildOrderEmbed = async (
  event: AggregatorEvent
): Promise<{ title: string; fields: Field[] }> => {
  const { payment, order_type, expiration_date, maker, criteria } = event as {
    payment: { quantity: string; decimals: number; symbol: string };
    order_type: OpenSeaOrderType | string;
    expiration_date: number;
    maker: string;
    criteria: {
      trait?: { type: string; value: string };
      traits?: Array<{ type: string; value: string }>;
    };
  };
  const fields: Field[] = [];
  let title = "";
  const { quantity, decimals, symbol } = payment ?? {
    quantity: "0",
    decimals: 18,
    symbol: "ETH",
  };
  const inTime = expiration_date
    ? format(new Date(expiration_date * MS_PER_SECOND))
    : "Unknown";
  if (order_type === ("trait_offer" satisfies OpenSeaOrderType)) {
    // Get trait info from criteria - can be in trait or traits array
    const traitInfo = criteria?.trait ?? criteria?.traits?.[0];
    const traitType = traitInfo?.type ?? "Unknown";
    const traitValue = traitInfo?.value ?? "Unknown";
    title += `Trait offer: ${traitType} -> ${traitValue}`;
    const price = formatAmount(quantity, decimals, symbol);
    fields.push({ name: "Price", value: price });
    fields.push({ name: "Expires", value: inTime });
  } else if (
    order_type === ("item_offer" satisfies OpenSeaOrderType) ||
    order_type === "offer" ||
    order_type === "criteria_offer"
  ) {
    title += "Item offer:";
    const price = formatAmount(quantity, decimals, symbol);
    fields.push({ name: "Price", value: price });
    fields.push({ name: "Expires", value: inTime });
  } else if (order_type === ("collection_offer" satisfies OpenSeaOrderType)) {
    title += "Collection offer";
    const price = formatAmount(quantity, decimals, symbol);
    fields.push({ name: "Price", value: price });
    fields.push({ name: "Expires", value: inTime });
  } else {
    // Default to listing
    title += "Listed for sale:";
    const price = formatAmount(quantity, decimals, symbol);
    fields.push({ name: "Price", value: price });
    fields.push({ name: "Expires", value: inTime });
  }
  if (maker) {
    fields.push({ name: "By", value: escapeMarkdown(await username(maker)) });
  }
  return { title, fields };
};

export const buildSaleEmbed = async (
  event: AggregatorEvent
): Promise<{ title: string; fields: Field[] }> => {
  const { payment, buyer } = event as {
    payment: { quantity: string; decimals: number; symbol: string };
    buyer: string;
  };
  const fields: Field[] = [];
  const { quantity, decimals, symbol } = payment;
  const price = formatAmount(quantity, decimals, symbol);
  fields.push({ name: "Price", value: price });
  fields.push({ name: "By", value: escapeMarkdown(await username(buyer)) });
  return { title: "Purchased:", fields };
};

export const buildTransferEmbed = async (
  event: AggregatorEvent
): Promise<{ title: string; fields: Field[] }> => {
  const { from_address, to_address } = event as {
    from_address: string;
    to_address: string;
  };
  const kind = classifyTransfer(event as OpenSeaAssetEvent);
  const fields: Field[] = [];
  if (kind === "mint") {
    // Include editions for ERC1155 mints if quantity > 1
    const openSeaEvent = event as OpenSeaAssetEvent;
    const quantity = openSeaEvent.quantity;
    const tokenStandard =
      (openSeaEvent.nft as { token_standard?: string } | undefined)
        ?.token_standard ??
      (openSeaEvent.asset as { token_standard?: string } | undefined)
        ?.token_standard;

    const toName = escapeMarkdown(await username(to_address));
    const toValue = formatEditionsText(toName, tokenStandard, quantity);
    fields.push({ name: "To", value: toValue });
    return { title: "Minted:", fields };
  }
  if (kind === "burn") {
    fields.push({
      name: "From",
      value: escapeMarkdown(await username(from_address)),
    });
    return { title: "Burned:", fields };
  }
  fields.push({
    name: "From",
    value: escapeMarkdown(await username(from_address)),
  });
  fields.push({
    name: "To",
    value: escapeMarkdown(await username(to_address)),
  });
  return { title: "Transferred:", fields };
};

// ---- Event type classification helpers ----

export const isOrderLikeType = (
  t: unknown,
  orderType?: OpenSeaOrderType | string
): boolean => {
  const s = String(t);
  // Check order_type for "order" events
  if (s === "order" && orderType) {
    return (
      orderType === ("listing" satisfies OpenSeaOrderType) ||
      orderType === ("item_offer" satisfies OpenSeaOrderType) ||
      orderType === ("trait_offer" satisfies OpenSeaOrderType) ||
      orderType === ("collection_offer" satisfies OpenSeaOrderType)
    );
  }
  // Legacy event_type handling
  return (
    s === BotEvent.listing ||
    s === BotEvent.offer ||
    s === ("trait_offer" satisfies OpenSeaEventType) ||
    s === ("collection_offer" satisfies OpenSeaEventType) ||
    s === "listing"
  );
};

export const isTransferLikeType = (t: unknown): boolean => {
  const s = String(t);
  return s === EventType.transfer || s === EventType.mint;
};

// ---- Image/attachment helpers ----

/**
 * Fetches an image and creates a Discord attachment, converting SVGs to PNG.
 * Returns null if the image cannot be fetched or converted.
 */
export const fetchDiscordAttachment = async (
  imageUrl: string,
  filename: string
): Promise<AttachmentBuilder | null> => {
  try {
    const { buffer, mimeType } = await fetchImageBuffer(imageUrl);
    // Determine file extension from mime type
    const ext = mimeType === "image/png" ? "png" : "jpg";
    const attachmentName = `${filename}.${ext}`;
    return new AttachmentBuilder(buffer, { name: attachmentName });
  } catch (error) {
    log.debug(`Failed to fetch image for Discord: ${imageUrl}`, error);
    return null;
  }
};

// Helper to build title and fields based on event type
export const buildTitleAndFields = async (
  event: AggregatorEvent,
  eventType: EventType | string | undefined,
  orderType: string | undefined
): Promise<{ title: string; fields: Field[] }> => {
  if (isOrderLikeType(eventType, orderType)) {
    return await buildOrderEmbed(event);
  }
  if (eventType === EventType.sale) {
    return await buildSaleEmbed(event);
  }
  if (isTransferLikeType(eventType)) {
    return await buildTransferEmbed(event);
  }
  return { title: "", fields: [] };
};

// Helper to set embed image with attachment support
export const setEmbedImage = async (
  embedBuilder: EmbedBuilder,
  nft: {
    image_url?: string;
    identifier?: string | number;
    opensea_url?: string;
  }
): Promise<AttachmentBuilder | null> => {
  const image = imageForNFT(nft);
  if (!image) {
    return null;
  }

  const filename = `nft-${nft.identifier ?? "image"}`;
  const attachment = await fetchDiscordAttachment(image, filename);

  if (attachment) {
    embedBuilder.setImage(`attachment://${attachment.name}`);
  } else {
    // Fallback to URL if fetch fails (won't work for SVG but better than nothing)
    embedBuilder.setImage(image);
  }

  return attachment;
};

export type EmbedResult = {
  embed: EmbedBuilder;
  attachment: AttachmentBuilder | null;
};

export const buildEmbed = async (
  event: AggregatorEvent
): Promise<EmbedResult> => {
  const { event_type, asset, order_type } = event;

  const nft = event.nft ?? asset;
  // Use effective event type to correctly identify burns, mints, etc.
  const effectiveType = effectiveEventTypeFor(event as OpenSeaAssetEvent);
  const { title: baseTitle, fields } = await buildTitleAndFields(
    event,
    event_type,
    order_type
  );
  const title = nft?.name ? `${baseTitle} ${nft.name}` : baseTitle;

  const built = new EmbedBuilder()
    .setColor(
      colorFor(
        effectiveType,
        (order_type as OpenSeaOrderType | undefined) ?? undefined
      ) as ColorResolvable
    )
    .setTitle(title)
    .setFields(
      fields.map((f) => {
        f.inline = true;
        return f;
      })
    );

  let attachment: AttachmentBuilder | null = null;

  if (nft && Object.keys(nft).length > 0) {
    built.setURL(nft.opensea_url ?? null);
    attachment = await setEmbedImage(built, nft);
  } else {
    built.setURL(opensea.collectionURL());
  }

  return { embed: built, attachment };
};

// ---- Group embed helpers ----

// Helper to get title and activity type for group kind
export const getGroupTitleAndActivityType = (
  kind: GroupKind,
  count: number
): { title: string; activityType: string } => {
  const titleMap: Record<GroupKind, string> = {
    burn: `${count} items burned`,
    mint: `${count} items minted`,
    offer: `${count} offers`,
    listing: `${count} listings`,
    purchase: `${count} items purchased`,
  };
  const activityTypeMap: Record<GroupKind, string> = {
    burn: "transfer",
    mint: "mint",
    offer: "offer",
    listing: "listing",
    purchase: "sale",
  };
  return {
    title: titleMap[kind],
    activityType: activityTypeMap[kind],
  };
};

// Helper to get actor label for group kind
export const getActorLabelForKind = (kind: GroupKind): string => {
  const labelMap: Record<GroupKind, string> = {
    burn: "By",
    mint: "Minter",
    offer: "Offerer",
    listing: "Lister",
    purchase: "Buyer",
  };
  return labelMap[kind];
};

// Helper to get the activity URL for a group
export const getActivityUrl = (
  actorAddress: string | undefined,
  kind: GroupKind,
  activityType: string
): string => {
  if (actorAddress) {
    const useCollectionUrl = kind === "mint" || kind === "purchase";
    return useCollectionUrl
      ? openseaProfileCollectionUrl(actorAddress, getCollectionSlug())
      : openseaProfileActivityUrl(actorAddress, activityType);
  }
  return openseaCollectionActivityUrl(opensea.collectionURL(), activityType);
};

// Helper to format a single top item line
export const formatTopItem = (
  item: {
    nft?: { identifier?: string; name?: string; opensea_url?: string };
    price?: string | null;
  },
  index: number
): string => {
  const { nft, price } = item;
  const identifier = nft?.identifier ? `#${nft.identifier}` : "";
  const name = nft?.name || "Unknown";
  const priceText = price ? ` - ${price}` : "";
  const url = nft?.opensea_url;

  return url
    ? `${index + 1}. [${name} ${identifier}](${url})${priceText}`
    : `${index + 1}. ${name} ${identifier}${priceText}`;
};

// Helper to set embed thumbnail with attachment support
export const setEmbedThumbnail = async (
  embedBuilder: EmbedBuilder,
  nft: { image_url?: string; identifier?: string | number }
): Promise<AttachmentBuilder | null> => {
  const image = imageForNFT(nft);
  if (!image) {
    return null;
  }

  const filename = `group-thumb-${nft.identifier ?? "image"}`;
  const attachment = await fetchDiscordAttachment(image, filename);

  if (attachment) {
    embedBuilder.setThumbnail(`attachment://${attachment.name}`);
  } else {
    embedBuilder.setThumbnail(image);
  }

  return attachment;
};

export type GroupEmbedResult = {
  embed: EmbedBuilder;
  attachment: AttachmentBuilder | null;
};

export const buildGroupEmbed = async (
  group: GroupedEvent
): Promise<GroupEmbedResult> => {
  const count = group.events.length;
  const kind = groupKindForEvents(group.events);
  const totalSpent = calculateTotalSpent(group.events);
  const actorAddress = primaryActorAddressForGroup(group.events, kind);
  const { title, activityType } = getGroupTitleAndActivityType(kind, count);

  const fields: Field[] = [];

  if (kind === "purchase" && totalSpent) {
    fields.push({ name: "Total Spent", value: totalSpent, inline: true });
  }

  if (actorAddress) {
    const label = getActorLabelForKind(kind);
    const actorName = escapeMarkdown(await username(actorAddress));
    fields.push({ name: label, value: actorName, inline: true });
  }

  const activityUrl = getActivityUrl(actorAddress, kind, activityType);
  fields.push({
    name: "Activity",
    value: `[View on OpenSea](${activityUrl})`,
    inline: true,
  });

  const TOP_ITEMS_COUNT = 4;
  const topExpensiveItems = getTopExpensiveEvents(
    group.events,
    TOP_ITEMS_COUNT
  );

  if (topExpensiveItems.length > 0) {
    const itemsList = topExpensiveItems.map(formatTopItem).join("\n");
    fields.push({ name: "Top Items", value: itemsList });
  }

  const groupEmbed = new EmbedBuilder()
    .setColor("#62b778")
    .setTitle(title)
    .setFields(fields)
    .setURL(opensea.collectionURL());

  const highestValueItem = topExpensiveItems[0];
  const attachment = highestValueItem?.nft
    ? await setEmbedThumbnail(groupEmbed, highestValueItem.nft)
    : null;

  return { embed: groupEmbed, attachment };
};
