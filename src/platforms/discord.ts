import {
  Client,
  type ColorResolvable,
  EmbedBuilder,
  type MessageCreateOptions,
  type TextBasedChannel,
} from 'discord.js';
import { format } from 'timeago.js';
import { EventType, opensea, username } from '../opensea';
import { BotEvent, type OpenSeaAssetEvent } from '../types';
import type { AggregatorEvent } from '../utils/aggregator';
import { getMintDelayMs, MS_PER_SECOND } from '../utils/constants';
import {
  calculateTotalSpent,
  EventGroupManager,
  type GroupedEvent,
  getDefaultEventGroupConfig,
  getTopExpensiveEvents,
  groupKindForEvents,
  primaryActorAddressForGroup,
} from '../utils/event-grouping';
import { effectiveEventTypeFor } from '../utils/event-types';
import {
  openseaCollectionActivityUrl,
  openseaProfileTransferActivityUrl,
} from '../utils/links';
import { prefixedLogger } from '../utils/logger';
import {
  classifyTransfer,
  formatAmount,
  imageForNFT,
  timeout,
} from '../utils/utils';

const log = prefixedLogger('Discord');

// Initialize event group manager for Discord
const groupConfig = getDefaultEventGroupConfig('DISCORD');
const groupManager = new EventGroupManager(groupConfig);

type ChannelEvents = [
  channelId: string,
  eventTypes: (EventType | BotEvent)[],
][];
export const channelsWithEvents = (): ChannelEvents => {
  const DISCORD_EVENTS = process.env.DISCORD_EVENTS;
  if (!DISCORD_EVENTS) {
    return [];
  }

  const list: ChannelEvents = [];
  for (const channel of DISCORD_EVENTS.split('&')) {
    const channelWithEvents = channel.split('=');
    const channelId = channelWithEvents[0];
    const eventTypes = channelWithEvents[1].split(',');
    if (
      eventTypes.includes(BotEvent.listing) ||
      eventTypes.includes(BotEvent.offer)
    ) {
      // Workaround
      eventTypes.push(EventType.order);
    }
    list.push([channelId, eventTypes as unknown as (EventType | BotEvent)[]]);
  }

  return list;
};

// Use shared effective event type util
const effectiveTypeForEvent = effectiveEventTypeFor;

const channelsForEventType = (
  event: OpenSeaAssetEvent,
  channelEvents: ChannelEvents,
  discordChannels: Record<string, TextBasedChannel>
) => {
  const effectiveType = effectiveTypeForEvent(event);
  const channels: TextBasedChannel[] = [];
  for (const [channelId, eventTypes] of channelEvents) {
    if (eventTypes.includes(effectiveType)) {
      const channel = discordChannels[channelId];
      channels.push(channel);
    }
  }
  return channels;
};

import { colorForEvent } from '../utils/event-types';

const colorFor = (eventType: EventType | BotEvent, orderType: string) =>
  colorForEvent(eventType, orderType);

type Field = { name: string; value: string; inline?: true };

const buildOrderEmbed = async (
  event: AggregatorEvent
): Promise<{ title: string; fields: Field[] }> => {
  const { payment, order_type, expiration_date, maker, criteria } = event as {
    payment: { quantity: string; decimals: number; symbol: string };
    order_type: string;
    expiration_date: number;
    maker: string;
    criteria: { trait: { type: string; value: string } };
  };
  const fields: Field[] = [];
  let title = '';
  const { quantity, decimals, symbol } = payment;
  const inTime = format(new Date(expiration_date * MS_PER_SECOND));
  if (order_type === 'auction') {
    title += 'Auction:';
    const price = formatAmount(quantity, decimals, symbol);
    fields.push({ name: 'Starting Price', value: price });
    fields.push({ name: 'Ends', value: inTime });
  } else if (order_type === 'trait_offer') {
    const traitType = criteria.trait.type;
    const traitValue = criteria.trait.value;
    title += `Trait offer: ${traitType} -> ${traitValue}`;
    const price = formatAmount(quantity, decimals, symbol);
    fields.push({ name: 'Price', value: price });
    fields.push({ name: 'Expires', value: inTime });
  } else if (order_type === 'item_offer') {
    title += 'Item offer:';
    const price = formatAmount(quantity, decimals, symbol);
    fields.push({ name: 'Price', value: price });
    fields.push({ name: 'Expires', value: inTime });
  } else if (order_type === 'collection_offer') {
    title += 'Collection offer';
    const price = formatAmount(quantity, decimals, symbol);
    fields.push({ name: 'Price', value: price });
    fields.push({ name: 'Expires', value: inTime });
  } else {
    title += 'Listed for sale:';
    const price = formatAmount(quantity, decimals, symbol);
    fields.push({ name: 'Price', value: price });
    fields.push({ name: 'Expires', value: inTime });
  }
  fields.push({ name: 'By', value: await username(maker) });
  return { title, fields };
};

const buildSaleEmbed = async (
  event: AggregatorEvent
): Promise<{ title: string; fields: Field[] }> => {
  const { payment, buyer } = event as {
    payment: { quantity: string; decimals: number; symbol: string };
    buyer: string;
  };
  const fields: Field[] = [];
  const { quantity, decimals, symbol } = payment;
  const price = formatAmount(quantity, decimals, symbol);
  fields.push({ name: 'Price', value: price });
  fields.push({ name: 'By', value: await username(buyer) });
  return { title: 'Purchased:', fields };
};

const buildTransferEmbed = async (
  event: AggregatorEvent
): Promise<{ title: string; fields: Field[] }> => {
  const { from_address, to_address } = event as {
    from_address: string;
    to_address: string;
  };
  const kind = ((): 'mint' | 'burn' | 'transfer' => {
    const type = effectiveTypeForEvent(
      event as unknown as OpenSeaAssetEvent
    ) as unknown as string;
    if (type === BotEvent.mint) {
      return 'mint';
    }
    if (type === BotEvent.burn) {
      return 'burn';
    }
    return 'transfer';
  })();
  const fields: Field[] = [];
  if (kind === 'mint') {
    // Include editions for ERC1155 mints if quantity > 1
    const editions = Number(
      (event as unknown as { quantity?: number })?.quantity ?? 0
    );
    const tokenStandard =
      (
        event as unknown as {
          nft?: { token_standard?: string };
          asset?: { token_standard?: string };
        }
      )?.nft?.token_standard ??
      (event as unknown as { asset?: { token_standard?: string } })?.asset
        ?.token_standard;
    const isErc1155 = (tokenStandard ?? '').toLowerCase() === 'erc1155';

    const toName = await username(to_address);
    const toValue =
      isErc1155 && editions > 1 ? `${toName} (${editions} editions)` : toName;
    fields.push({ name: 'To', value: toValue });
    return { title: 'Minted:', fields };
  }
  if (kind === 'burn') {
    fields.push({ name: 'From', value: await username(from_address) });
    return { title: 'Burned:', fields };
  }
  fields.push({ name: 'From', value: await username(from_address) });
  fields.push({ name: 'To', value: await username(to_address) });
  return { title: 'Transferred:', fields };
};

const embed = async (event: AggregatorEvent) => {
  const { event_type, asset, order_type } = event as unknown as {
    event_type?: EventType | string;
    asset?: { opensea_url?: string; name?: string };
    order_type?: string;
  };

  let { nft } = event;
  if (!nft && asset) {
    nft = asset;
  }
  let fields: Field[] = [];
  let title = '';
  if (event_type === EventType.order) {
    ({ title, fields } = await buildOrderEmbed(event));
  } else if (event_type === EventType.sale) {
    ({ title, fields } = await buildSaleEmbed(event));
  } else if (event_type === EventType.transfer) {
    ({ title, fields } = await buildTransferEmbed(event));
  }

  if (nft?.name) {
    title += ` ${nft.name}`;
  }

  const built = new EmbedBuilder()
    .setColor(
      colorFor(
        event_type as EventType,
        order_type ?? ''
      ) as unknown as ColorResolvable
    )
    .setTitle(title)
    .setFields(
      fields.map((f) => {
        f.inline = true;
        return f;
      })
    );

  if (nft && Object.keys(nft).length > 0) {
    built.setURL(nft.opensea_url ?? null);
    const image = imageForNFT(nft);
    if (image) {
      built.setImage(image ?? null);
    }
  } else {
    built.setURL(opensea.collectionURL());
  }

  return built;
};

const buildGroupEmbed = async (group: GroupedEvent): Promise<EmbedBuilder> => {
  const count = group.events.length;
  const kind = groupKindForEvents(group.events);
  const totalSpent = calculateTotalSpent(group.events);

  // Deduce primary actor
  const actorAddress = primaryActorAddressForGroup(group.events, kind);

  let title = '';
  if (kind === 'burn') {
    title = `${count} items burned`;
  } else if (kind === 'mint') {
    title = `${count} items minted`;
  } else {
    title = `${count} items purchased`;
  }
  const fields: Field[] = [];

  if (kind === 'purchase' && totalSpent) {
    fields.push({ name: 'Total Spent', value: totalSpent, inline: true });
  }

  if (actorAddress) {
    const label = kind === 'burn' ? 'By' : 'Buyer';
    const actorName = await username(actorAddress);
    fields.push({ name: label, value: actorName, inline: true });
  }

  if (actorAddress) {
    const url = openseaProfileTransferActivityUrl(actorAddress);
    fields.push({
      name: 'Activity',
      value: `[View on OpenSea](${url})`,
      inline: true,
    });
  } else {
    const url = openseaCollectionActivityUrl(opensea.collectionURL());
    fields.push({
      name: 'Activity',
      value: `[View on OpenSea](${url})`,
      inline: true,
    });
  }

  // Add top 4 most expensive items
  const TOP_ITEMS_COUNT = 4;
  const topExpensiveItems = getTopExpensiveEvents(
    group.events,
    TOP_ITEMS_COUNT
  );
  if (topExpensiveItems.length > 0) {
    const itemsList = topExpensiveItems
      .map((item, index) => {
        const { nft, price } = item;
        const identifier = nft?.identifier ? `#${nft.identifier}` : '';
        const name = nft?.name || 'Unknown';
        const priceText = price ? ` - ${price}` : '';
        const url = nft?.opensea_url;

        if (url) {
          return `${index + 1}. [${name} ${identifier}](${url})${priceText}`;
        }
        return `${index + 1}. ${name} ${identifier}${priceText}`;
      })
      .join('\n');

    fields.push({
      name: 'Top Items',
      value: itemsList,
    });
  }

  const groupEmbed = new EmbedBuilder()
    .setColor('#62b778') // Green color for event groups
    .setTitle(title)
    .setFields(fields)
    .setURL(opensea.collectionURL());

  // Add thumbnail from highest value NFT
  const highestValueItem = topExpensiveItems[0];
  if (highestValueItem?.nft) {
    const image = imageForNFT(highestValueItem.nft);
    if (image) {
      groupEmbed.setThumbnail(image);
    }
  }

  return groupEmbed;
};

const messagesForEvents = async (
  events: AggregatorEvent[]
): Promise<MessageCreateOptions[]> => {
  const messages: MessageCreateOptions[] = [];
  for (const event of events) {
    const embeds = [await embed(event)];
    const message: MessageCreateOptions = { embeds };
    messages.push(message);
  }
  return messages;
};

const login = (client: Client): Promise<void> => {
  return new Promise<void>((resolve) => {
    client.on('ready', () => {
      resolve();
    });
    client.login(process.env.DISCORD_TOKEN);
  });
};

const getChannels = async (
  client: Client,
  channelEvents: ChannelEvents
): Promise<Record<string, TextBasedChannel>> => {
  const channels: Record<string, TextBasedChannel> = {};
  log.info('✅ Discord bot connected successfully');
  log.info('📡 Active channels:');
  for (const [channelId, events] of channelEvents) {
    const channel = await client.channels.fetch(channelId);
    channels[channelId] = channel as TextBasedChannel;
    const channelName =
      (channel as unknown as { name?: string; channelId?: string }).name ??
      (channel as unknown as { name?: string; channelId?: string }).channelId;
    log.info(`   • #${channelName}`);
    log.info(`     └─ Events: ${events.join(', ')}`);
  }
  return channels;
};

const processGroupMessages = async (
  readyGroups: Array<{ tx: string; events: OpenSeaAssetEvent[] }>,
  discordChannels: Record<string, TextBasedChannel>,
  isSendableChannel: (ch: TextBasedChannel) => ch is TextBasedChannel & {
    send: (options: MessageCreateOptions) => Promise<unknown>;
  }
) => {
  for (const readyGroup of readyGroups) {
    const group: GroupedEvent = {
      kind: 'group',
      txHash: readyGroup.tx,
      events: readyGroup.events,
    };
    const groupEmbed = await buildGroupEmbed(group);
    const message: MessageCreateOptions = { embeds: [groupEmbed] };

    // Send group to all configured channels (groups are notable events)
    const allChannels = Object.values(discordChannels);

    for (const channel of allChannels) {
      if (!isSendableChannel(channel)) {
        continue;
      }
      await channel.send(message);
      log.info(`🧹 Sent group notification: ${group.events.length} items`);
    }

    // Mark group as processed
    groupManager.markGroupProcessed(group);

    // Wait between group messages
    const INTER_MESSAGE_DELAY_MS = 3000;
    await timeout(INTER_MESSAGE_DELAY_MS);
  }
};

const processIndividualMessages = async (
  processableEvents: OpenSeaAssetEvent[],
  channelEvents: ChannelEvents,
  discordChannels: Record<string, TextBasedChannel>,
  isSendableChannel: (ch: TextBasedChannel) => ch is TextBasedChannel & {
    send: (options: MessageCreateOptions) => Promise<unknown>;
  }
) => {
  const messages = await messagesForEvents(
    processableEvents as AggregatorEvent[]
  );

  for (const [index, message] of messages.entries()) {
    const event = processableEvents[index];
    const channels = channelsForEventType(
      event,
      channelEvents,
      discordChannels
    );
    if (channels.length === 0) {
      continue;
    }

    log.info('💬 Sending event notification');

    for (const channel of channels) {
      if (!isSendableChannel(channel)) {
        continue;
      }
      await channel.send(message);
    }

    // Mark individual event as processed
    groupManager.markProcessed(event);

    // Wait between messages
    if (messages[index + 1]) {
      const INTER_MESSAGE_DELAY_MS = 3000;
      await timeout(INTER_MESSAGE_DELAY_MS);
    }
  }
};

export async function messageEvents(events: AggregatorEvent[]) {
  if (!process.env.DISCORD_EVENTS) {
    return;
  }

  const client = new Client({ intents: [] });
  const channelEvents = channelsWithEvents();

  // Convert to OpenSeaAssetEvent for better typing
  const openSeaEvents = events as OpenSeaAssetEvent[];

  // Only handle event types specified by DISCORD_EVENTS, using effective type mapping
  const wantedTypes = new Set(
    [...channelEvents.map((c) => c[1])].flat() as (EventType | BotEvent)[]
  );
  const filteredEvents = openSeaEvents.filter((event) =>
    wantedTypes.has(effectiveTypeForEvent(event))
  );

  if (filteredEvents.length > 0) {
    log.info(
      `📊 Found ${filteredEvents.length} relevant event${filteredEvents.length === 1 ? '' : 's'} for Discord`
    );
  }

  if (filteredEvents.length === 0) {
    return;
  }

  // Add events to event group aggregator
  groupManager.addEvents(filteredEvents);

  // Get ready groups
  const readyGroups = groupManager.getReadyGroups();

  // Filter out events that are part of pending groups or already processed
  const { processableEvents, skippedDupes, skippedPending } =
    groupManager.filterProcessableEvents(filteredEvents);

  log.debug(
    `Processing: groups=${readyGroups.length} singles=${processableEvents.length} ` +
      `skippedDupes=${skippedDupes} skippedPending=${skippedPending}`
  );

  const isSendableChannel = (
    ch: TextBasedChannel
  ): ch is TextBasedChannel & {
    send: (options: MessageCreateOptions) => Promise<unknown>;
  } => {
    const maybe = ch as unknown as {
      send?: (options: MessageCreateOptions) => Promise<unknown>;
    };
    return typeof maybe.send === 'function';
  };

  // Separate mint groups and events for delayed processing
  const { mintGroups, nonMintGroups, mintEvents, nonMintEvents } =
    separateMintEvents(readyGroups, processableEvents);

  try {
    await login(client);
    const discordChannels = await getChannels(client, channelEvents);

    // Process non-mint group messages first
    await processGroupMessages(
      nonMintGroups,
      discordChannels,
      isSendableChannel
    );

    // Process non-mint individual events
    await processIndividualMessages(
      nonMintEvents,
      channelEvents,
      discordChannels,
      isSendableChannel
    );
  } catch (error) {
    log.error(error);
  }

  client.destroy();

  // Schedule delayed processing for mint events
  if (mintGroups.length > 0 || mintEvents.length > 0) {
    const mintDelayMs = getMintDelayMs();
    const totalMintCount = mintGroups.length + mintEvents.length;
    log.info(
      `Delaying ${totalMintCount} mint event(s)/group(s) by ${mintDelayMs / MS_PER_SECOND}s for metadata population`
    );

    setTimeout(() => {
      // Process delayed mint events in a new Discord client session
      processMintEvents(mintGroups, mintEvents, channelEvents).catch((error) =>
        log.error('Error processing delayed mint events:', error)
      );
    }, mintDelayMs);
  }
}

const separateMintEvents = (
  readyGroups: Array<{ tx: string; events: OpenSeaAssetEvent[] }>,
  processableEvents: OpenSeaAssetEvent[]
): {
  mintGroups: Array<{ tx: string; events: OpenSeaAssetEvent[] }>;
  nonMintGroups: Array<{ tx: string; events: OpenSeaAssetEvent[] }>;
  mintEvents: OpenSeaAssetEvent[];
  nonMintEvents: OpenSeaAssetEvent[];
} => {
  const mintDelayMs = getMintDelayMs();
  const mintGroups: Array<{ tx: string; events: OpenSeaAssetEvent[] }> = [];
  const nonMintGroups: Array<{ tx: string; events: OpenSeaAssetEvent[] }> = [];

  for (const group of readyGroups) {
    const groupKind = groupKindForEvents(group.events);
    if (groupKind === 'mint' && mintDelayMs > 0) {
      mintGroups.push(group);
    } else {
      nonMintGroups.push(group);
    }
  }

  const mintEvents: OpenSeaAssetEvent[] = [];
  const nonMintEvents: OpenSeaAssetEvent[] = [];

  for (const event of processableEvents) {
    const isMint =
      event.event_type === 'transfer' && classifyTransfer(event) === 'mint';
    if (isMint && mintDelayMs > 0) {
      mintEvents.push(event);
    } else {
      nonMintEvents.push(event);
    }
  }

  return { mintGroups, nonMintGroups, mintEvents, nonMintEvents };
};

const processMintEvents = async (
  mintGroups: Array<{ tx: string; events: OpenSeaAssetEvent[] }>,
  mintEvents: OpenSeaAssetEvent[],
  channelEvents: ChannelEvents
) => {
  const client = new Client({ intents: [] });

  const isSendableChannel = (
    ch: TextBasedChannel
  ): ch is TextBasedChannel & {
    send: (options: MessageCreateOptions) => Promise<unknown>;
  } => {
    const maybe = ch as unknown as {
      send?: (options: MessageCreateOptions) => Promise<unknown>;
    };
    return typeof maybe.send === 'function';
  };

  try {
    await login(client);
    const discordChannels = await getChannels(client, channelEvents);

    // Process mint groups
    await processGroupMessages(mintGroups, discordChannels, isSendableChannel);

    // Process individual mint events
    await processIndividualMessages(
      mintEvents,
      channelEvents,
      discordChannels,
      isSendableChannel
    );
  } catch (error) {
    log.error('Error in processMintEvents:', error);
  }

  client.destroy();
};
