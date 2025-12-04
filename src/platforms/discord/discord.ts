import {
  Client,
  Events,
  type MessageCreateOptions,
  type TextBasedChannel,
} from "discord.js";
import type { EventType } from "../../opensea";
import type { BotEvent, OpenSeaAssetEvent } from "../../types";
import type { AggregatorEvent } from "../../utils/aggregator";
import {
  EventGroupManager,
  type GroupedEvent,
  getDefaultEventGroupConfig,
  processEventsWithAggregator,
} from "../../utils/event-grouping";
import { effectiveEventTypeFor } from "../../utils/event-types";
import { prefixedLogger } from "../../utils/logger";
import { refetchMintMetadata } from "../../utils/metadata";
import { timeout } from "../../utils/utils";
import { buildEmbed, buildGroupEmbed } from "./utils";

const log = prefixedLogger("Discord");

// Initialize event group manager for Discord
const groupConfig = getDefaultEventGroupConfig("DISCORD");
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
  for (const channel of DISCORD_EVENTS.split("&")) {
    const channelWithEvents = channel.split("=");
    const channelId = channelWithEvents[0];
    const eventTypes = channelWithEvents[1].split(",") as (
      | EventType
      | BotEvent
    )[];
    list.push([channelId, eventTypes]);
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

const messagesForEvents = async (
  events: AggregatorEvent[]
): Promise<MessageCreateOptions[]> => {
  const messages: MessageCreateOptions[] = [];
  for (const event of events) {
    const { embed: builtEmbed, attachment } = await buildEmbed(event);
    const message: MessageCreateOptions = {
      embeds: [builtEmbed],
      files: attachment ? [attachment] : [],
    };
    messages.push(message);
  }
  return messages;
};

const login = (client: Client): Promise<void> =>
  new Promise<void>((resolve) => {
    client.on(Events.ClientReady, () => {
      resolve();
    });
    client.login(process.env.DISCORD_TOKEN);
  });

// Helper to get channel name using proper type guards
const getChannelName = (channel: TextBasedChannel): string => {
  // Guild channels have names, DMs don't
  if ("name" in channel && channel.name) {
    return channel.name;
  }
  return channel.id;
};

const getChannels = async (
  client: Client,
  channelEvents: ChannelEvents
): Promise<Record<string, TextBasedChannel>> => {
  const channels: Record<string, TextBasedChannel> = {};
  log.info("✅ Discord bot connected successfully");
  log.info("📡 Active channels:");
  for (const [channelId, events] of channelEvents) {
    const channel = await client.channels.fetch(channelId);
    if (!channel?.isTextBased()) {
      log.warn(`Channel ${channelId} is not a text channel, skipping`);
      continue;
    }
    channels[channelId] = channel;
    const channelName = getChannelName(channel);
    log.info(`   • #${channelName}`);
    log.info(`     └─ Events: ${events.join(", ")}`);
  }
  return channels;
};

const processGroupMessages = async (
  readyGroups: Array<{ tx: string; events: OpenSeaAssetEvent[] }>,
  discordChannels: Record<string, TextBasedChannel>
) => {
  for (const readyGroup of readyGroups) {
    // Refetch metadata for any mint events before processing
    const refetchCount = await refetchMintMetadata(readyGroup.events);
    if (refetchCount > 0) {
      log.info(
        `Refetched metadata for ${refetchCount} mint event${refetchCount === 1 ? "" : "s"}`
      );
    }

    const group: GroupedEvent = {
      kind: "group",
      txHash: readyGroup.tx,
      events: readyGroup.events,
    };
    const { embed: groupEmbed, attachment } = await buildGroupEmbed(group);
    const message: MessageCreateOptions = {
      embeds: [groupEmbed],
      files: attachment ? [attachment] : [],
    };

    // Send group to all configured channels (groups are notable events)
    const allChannels = Object.values(discordChannels);

    for (const channel of allChannels) {
      if (!channel.isSendable()) {
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
  discordChannels: Record<string, TextBasedChannel>
) => {
  // Refetch metadata for any mint events before creating messages
  const refetchCount = await refetchMintMetadata(processableEvents);
  if (refetchCount > 0) {
    log.info(
      `Refetched metadata for ${refetchCount} mint event${refetchCount === 1 ? "" : "s"}`
    );
  }

  const messages = await messagesForEvents(processableEvents);

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

    log.info("💬 Sending event notification");

    for (const channel of channels) {
      if (!channel.isSendable()) {
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
      `📊 Found ${filteredEvents.length} relevant event${filteredEvents.length === 1 ? "" : "s"} for Discord`
    );
  }

  // Use shared aggregator processing logic
  const { readyGroups, processableEvents, skippedDupes, skippedPending } =
    processEventsWithAggregator(groupManager, filteredEvents);

  log.debug(
    `Processing: groups=${readyGroups.length} singles=${processableEvents.length} ` +
      `skippedDupes=${skippedDupes} skippedPending=${skippedPending}`
  );

  // Return early if there's nothing to process
  if (readyGroups.length === 0 && processableEvents.length === 0) {
    return;
  }

  try {
    await login(client);
    const discordChannels = await getChannels(client, channelEvents);

    // Process all group messages
    await processGroupMessages(readyGroups, discordChannels);

    // Process all individual events
    await processIndividualMessages(
      processableEvents,
      channelEvents,
      discordChannels
    );
  } catch (error) {
    log.error(error);
  }

  client.destroy();
}
