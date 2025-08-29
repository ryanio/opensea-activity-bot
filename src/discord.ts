import {
  Client,
  EmbedBuilder,
  type MessageCreateOptions,
  type TextBasedChannel,
} from 'discord.js';
import { format } from 'timeago.js';
import type { AggregatorEvent } from './aggregator';
import { logger } from './logger';
import { EventType, opensea } from './opensea';
import { BotEvent } from './types';
import {
  formatAmount,
  imageForNFT,
  logStart,
  timeout,
  username,
} from './utils';

const { DISCORD_EVENTS, DISCORD_TOKEN } = process.env;

type ChannelEvents = [
  channelId: string,
  eventTypes: (EventType | BotEvent)[],
][];
export const channelsWithEvents = (): ChannelEvents => {
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

const channelsForEventType = (
  eventType: EventType,
  orderType: string,
  channelEvents: ChannelEvents,
  discordChannels: Record<string, TextBasedChannel>
) => {
  let effectiveType = eventType;
  if (effectiveType === EventType.order) {
    if (orderType.includes(BotEvent.offer)) {
      effectiveType = BotEvent.offer as unknown as EventType;
    } else {
      effectiveType = BotEvent.listing as unknown as EventType;
    }
  }
  const channels: TextBasedChannel[] = [];
  for (const [channelId, eventTypes] of channelEvents) {
    if (eventTypes.includes(effectiveType)) {
      const channel = discordChannels[channelId];
      channels.push(channel);
    }
  }
  return channels;
};

const colorFor = (eventType: EventType, orderType: string) => {
  if (eventType === EventType.order) {
    if (orderType.includes('offer')) {
      return '#d63864';
    }
    return '#66dcf0';
  }
  if (eventType === EventType.sale) {
    return '#62b778';
  }
  if (eventType === EventType.cancel) {
    return '#9537b0';
  }
  if (eventType === EventType.transfer) {
    return '#5296d5';
  }
  return '#9537b0';
};

type Field = { name: string; value: string; inline?: true };

const buildOrderEmbed = async (
  event: AggregatorEvent
): Promise<{ title: string; fields: Field[] }> => {
  const { payment, order_type, expiration_date, maker, criteria } = event as {
    payment: { quantity: string | number; decimals: number; symbol: string };
    order_type: string;
    expiration_date: number;
    maker: string;
    criteria: { trait: { type: string; value: string } };
  };
  const fields: Field[] = [];
  let title = '';
  const { quantity, decimals, symbol } = payment;
  const MS_PER_SECOND = 1000;
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
    payment: { quantity: string | number; decimals: number; symbol: string };
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
  const fields: Field[] = [];
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
    .setColor(colorFor(event_type as EventType, order_type ?? ''))
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
    client.login(DISCORD_TOKEN);
  });
};

const getChannels = async (
  client: Client,
  channelEvents: ChannelEvents
): Promise<Record<string, TextBasedChannel>> => {
  const channels: Record<string, TextBasedChannel> = {};
  logger.info(`${logStart}Discord - Selected channels:`);
  for (const [channelId, events] of channelEvents) {
    const channel = await client.channels.fetch(channelId);
    channels[channelId] = channel as TextBasedChannel;
    logger.info(
      `${logStart}Discord - * #${
        (channel as unknown as { name?: string; channelId?: string }).name ??
        (channel as unknown as { name?: string; channelId?: string }).channelId
      }: ${events.join(', ')}`
    );
  }
  return channels;
};

export async function messageEvents(events: AggregatorEvent[]) {
  if (!DISCORD_EVENTS) {
    return;
  }

  const client = new Client({ intents: [] });
  const channelEvents = channelsWithEvents();

  // only handle event types specified by DISCORD_EVENTS
  const filteredEvents = events.filter((event) =>
    [...channelEvents.map((c) => c[1])]
      .flat()
      .includes((event as { event_type?: string }).event_type as EventType)
  );

  logger.info(`${logStart}Discord - Relevant events: ${filteredEvents.length}`);

  if (filteredEvents.length === 0) {
    return;
  }

  try {
    await login(client);
    const discordChannels = await getChannels(client, channelEvents);
    const messages = await messagesForEvents(filteredEvents);

    for (const [index, message] of messages.entries()) {
      const { event_type, order_type } = filteredEvents[index] as unknown as {
        event_type: EventType;
        order_type: string;
      };
      const channels = channelsForEventType(
        event_type,
        order_type,
        channelEvents,
        discordChannels
      );
      if (channels.length === 0) {
        continue;
      }
      logger.info(`${logStart}Discord - Sending message`);
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

      for (const channel of channels) {
        if (!isSendableChannel(channel)) {
          continue;
        }
        await channel.send(message);

        // Wait 3s between messages
        if (messages[index + 1]) {
          const INTER_MESSAGE_DELAY_MS = 3000;
          await timeout(INTER_MESSAGE_DELAY_MS);
        }
      }
    }
  } catch (error) {
    logger.error(error);
  }

  client.destroy();
}
