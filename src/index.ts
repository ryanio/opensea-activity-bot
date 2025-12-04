import "dotenv/config";
import { Client, Events, type TextBasedChannel } from "discord.js";
import {
  type EventTimestampSource,
  fetchCollectionSlug,
  fetchEvents,
  resolveLastEventTimestamp,
} from "./opensea";
import { channelsWithEvents, messageEvents } from "./platforms/discord/discord";
import { tweetEvents } from "./platforms/twitter/twitter";
import type { OpenSeaAssetEvent } from "./types";
import { MS_PER_SECOND } from "./utils/constants";
import { getDefaultEventGroupConfig } from "./utils/event-grouping";
import { logger } from "./utils/logger";
import {
  botInterval,
  chain,
  formatReadableDate,
  formatTimeAgo,
  fullTokenAddr,
  minOfferETH,
} from "./utils/utils";

const fetchDiscordChannelNames = async (): Promise<Map<string, string>> => {
  const channelNames = new Map<string, string>();

  if (!(process.env.DISCORD_TOKEN && process.env.DISCORD_EVENTS)) {
    return channelNames;
  }

  const client = new Client({ intents: [] });

  try {
    await new Promise<void>((resolve) => {
      client.on(Events.ClientReady, () => resolve());
      client.login(process.env.DISCORD_TOKEN);
    });

    const channelEvents = channelsWithEvents();
    for (const [channelId] of channelEvents) {
      try {
        const channel = await client.channels.fetch(channelId);
        const name = (channel as TextBasedChannel & { name?: string }).name;
        if (name) {
          channelNames.set(channelId, name);
        }
      } catch {
        // Channel might not be accessible
      }
    }
  } catch {
    // Discord connection failed
  } finally {
    client.destroy();
  }

  return channelNames;
};

const logTwitterConfig = () => {
  const twitterEvents = process.env.TWITTER_EVENTS?.replace(/,/g, ", ") ?? "";
  logger.info(`│     ├─ Events: ${twitterEvents}`);
  if (process.env.TWITTER_PREPEND_TWEET) {
    logger.info(`│     ├─ Prepend: "${process.env.TWITTER_PREPEND_TWEET}"`);
  }
  if (process.env.TWITTER_APPEND_TWEET) {
    logger.info(`│     ├─ Append: "${process.env.TWITTER_APPEND_TWEET}"`);
  }
  const config = getDefaultEventGroupConfig("TWITTER");
  const hasPrependOrAppend =
    process.env.TWITTER_PREPEND_TWEET || process.env.TWITTER_APPEND_TWEET;
  logger.info(`│     ${hasPrependOrAppend ? "├─" : "└─"} Grouping`);
  logger.info(`│        ├─ Min Group Size: ${config.minGroupSize} items`);
  logger.info(`│        └─ Settle Time: ${config.settleMs / MS_PER_SECOND}s`);
};

const logDiscordConfig = async () => {
  const channelNames = await fetchDiscordChannelNames();
  const channelEvents = channelsWithEvents();
  const config = getDefaultEventGroupConfig("DISCORD");

  for (const [channelId, events] of channelEvents) {
    const channelName = channelNames.get(channelId);
    const channelDisplay = channelName ? `#${channelName}` : channelId;
    logger.info(`│     ├─ ${channelDisplay} = ${events.join(", ")}`);
  }

  logger.info("│     └─ Grouping");
  logger.info(`│        ├─ Min Group Size: ${config.minGroupSize} items`);
  logger.info(`│        └─ Settle Time: ${config.settleMs / MS_PER_SECOND}s`);
};

const logPlatformConfig = async (
  twitterEnabled: boolean,
  discordEnabled: boolean
) => {
  logger.info("├─ 🔌 PLATFORMS");
  logger.info("│");
  logger.info(
    `│  🐦 Twitter: ${twitterEnabled ? "✅ ENABLED" : "⭕ DISABLED"}`
  );
  if (twitterEnabled) {
    logTwitterConfig();
  }
  logger.info("│");
  logger.info(
    `│  💬 Discord: ${discordEnabled ? "✅ ENABLED" : "⭕ DISABLED"}`
  );
  if (discordEnabled) {
    await logDiscordConfig();
  }
  logger.info("│");
};

const logStartupConfiguration = async () => {
  const asciiArt = `
╔═══════════════════════════════════════════════════════════════════════════╗
║                                                                           ║
║    ██████╗ ██████╗ ███████╗███╗   ██╗███████╗███████╗ █████╗              ║
║   ██╔═══██╗██╔══██╗██╔════╝████╗  ██║██╔════╝██╔════╝██╔══██╗             ║
║   ██║   ██║██████╔╝█████╗  ██╔██╗ ██║███████╗█████╗  ███████║             ║
║   ██║   ██║██╔═══╝ ██╔══╝  ██║╚██╗██║╚════██║██╔══╝  ██╔══██║             ║
║   ╚██████╔╝██║     ███████╗██║ ╚████║███████║███████╗██║  ██║             ║
║    ╚═════╝ ╚═╝     ╚══════╝╚═╝  ╚═══╝╚══════╝╚══════╝╚═╝  ╚═╝             ║
║                                                                           ║
║                Activity Bot - Real-time NFT Tracker                       ║
║                                                                           ║
╚═══════════════════════════════════════════════════════════════════════════╝
`;

  // Use logger.info without timestamp prefix for ASCII art
  for (const line of asciiArt.split("\n")) {
    if (line.trim()) {
      logger.info(line);
    }
  }

  // Fetch collection slug and event timestamp for display
  let collectionSlug: string | undefined;
  let eventTimestampInfo:
    | { timestamp: number; source: EventTimestampSource }
    | undefined;
  try {
    if (process.env.TOKEN_ADDRESS) {
      collectionSlug = await fetchCollectionSlug(process.env.TOKEN_ADDRESS);
    }
    eventTimestampInfo = await resolveLastEventTimestamp();
  } catch (error) {
    logger.debug("Error fetching startup info:", error);
  }

  const formatTimestampSource = (source: EventTimestampSource): string => {
    switch (source) {
      case "env":
        return "environment variable";
      case "state_file":
        return "state file";
      case "new":
        return "new (starting from current time)";
      default:
        return String(source);
    }
  };

  logger.info("");
  logger.info("┌─ 📋 CONFIGURATION");
  logger.info("│");
  logger.info(`│  📦  Contract: ${fullTokenAddr}`);
  if (collectionSlug) {
    logger.info(`│  🏷️   Slug: ${collectionSlug}`);
  }
  logger.info(`│  ⛓️   Chain: ${chain}`);
  logger.info(`│  ⏱️   Poll Interval: ${botInterval}s`);
  if (eventTimestampInfo) {
    const ts = eventTimestampInfo.timestamp;
    logger.info(
      `│  🕐  Last Event: ${formatReadableDate(ts)} (${formatTimeAgo(ts)})`
    );
    logger.info(
      `│      └─ Source: ${formatTimestampSource(eventTimestampInfo.source)}`
    );
  }
  logger.info(`│  💰  Min Offer Filter: ${minOfferETH} ETH`);
  logger.info(`│  📝  Log Level: ${process.env.LOG_LEVEL ?? "info"}`);
  logger.info("│");

  const twitterEnabled = Boolean(process.env.TWITTER_EVENTS);
  const discordEnabled = Boolean(process.env.DISCORD_EVENTS);

  await logPlatformConfig(twitterEnabled, discordEnabled);

  logger.info("└─");
  logger.info("");
};

async function main() {
  const run = async () => {
    const events: OpenSeaAssetEvent[] = await fetchEvents();

    if (events.length > 0) {
      logger.debug("OpenSea API Events:", events);
    }

    // Always call platform handlers even with empty events
    // to flush any pending aggregated groups that have settled
    messageEvents(events);
    tweetEvents(events);
  };

  await logStartupConfiguration();
  run();

  const interval = setInterval(run.bind(this), botInterval * MS_PER_SECOND);

  process.on("SIGINT", () => {
    logger.info("");
    logger.info("⚠️ Interrupt signal received (SIGINT)");
    logger.info("🛑 Shutting down gracefully...");
    clearInterval(interval);
    logger.info("✅ Bot stopped successfully");
    process.exit();
  });
}

main();
