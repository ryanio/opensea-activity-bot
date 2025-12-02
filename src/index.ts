import {
  type EventTimestampSource,
  fetchCollectionSlug,
  fetchEvents,
  resolveLastEventTimestamp,
} from "./opensea";
import { messageEvents } from "./platforms/discord";
import { tweetEvents } from "./platforms/twitter";
import type { OpenSeaAssetEvent } from "./types";
import { getDefaultEventGroupConfig } from "./utils/event-grouping";
import { logger } from "./utils/logger";
import { botInterval, chain, fullTokenAddr, minOfferETH } from "./utils/utils";

const MILLISECONDS_PER_SECOND = 1000;

const logPlatformConfig = (
  twitterEnabled: boolean,
  discordEnabled: boolean
) => {
  logger.info("├─ 🔌 PLATFORMS");
  logger.info("│");
  logger.info(
    `│  🐦 Twitter: ${twitterEnabled ? "✅ ENABLED" : "⭕ DISABLED"}`
  );
  if (twitterEnabled) {
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
    logger.info(
      `│        └─ Settle Time: ${config.settleMs / MILLISECONDS_PER_SECOND}s`
    );
  }
  logger.info("│");
  logger.info(
    `│  💬 Discord: ${discordEnabled ? "✅ ENABLED" : "⭕ DISABLED"}`
  );
  if (discordEnabled) {
    const discordEvents = process.env.DISCORD_EVENTS?.replace(/,/g, ", ") ?? "";
    logger.info(`│     ├─ Events: ${discordEvents}`);
    const config = getDefaultEventGroupConfig("DISCORD");
    logger.info("│     └─ Grouping");
    logger.info(`│        ├─ Min Group Size: ${config.minGroupSize} items`);
    logger.info(
      `│        └─ Settle Time: ${config.settleMs / MILLISECONDS_PER_SECOND}s`
    );
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
  logger.info(`│  📦  Collection Contract: ${fullTokenAddr}`);
  if (collectionSlug) {
    logger.info(`│  🏷️   Collection Slug: ${collectionSlug}`);
  }
  logger.info(`│  ⛓️   Network Chain: ${chain}`);
  logger.info(`│  ⏱️   Poll Interval: ${botInterval}s`);
  if (eventTimestampInfo) {
    logger.info(`│  🕐  Event Timestamp: ${eventTimestampInfo.timestamp}`);
    logger.info(
      `│      └─ Source: ${formatTimestampSource(eventTimestampInfo.source)}`
    );
  }
  logger.info(`│  💰  Min Offer Filter: ${minOfferETH} ETH`);
  logger.info(`│  📝  Log Level: ${process.env.LOG_LEVEL ?? "info"}`);
  logger.info("│");

  const twitterEnabled = Boolean(process.env.TWITTER_EVENTS);
  const discordEnabled = Boolean(process.env.DISCORD_EVENTS);

  logPlatformConfig(twitterEnabled, discordEnabled);

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

  const MS_PER_SECOND = 1000;
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
