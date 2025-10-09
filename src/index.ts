import { fetchEvents } from './opensea';
import { messageEvents } from './platforms/discord';
import { tweetEvents } from './platforms/twitter';
import type { OpenSeaAssetEvent } from './types';
import { logger } from './utils/logger';
import { getDefaultSweepConfig } from './utils/sweep';
import { botInterval, chain, minOfferETH, shortTokenAddr } from './utils/utils';

const DEFAULT_QUERY_LIMIT = 50;
const MILLISECONDS_PER_SECOND = 1000;

const logPlatformConfig = (
  twitterEnabled: boolean,
  discordEnabled: boolean
) => {
  logger.info(
    '├─ 🔌 PLATFORMS ──────────────────────────────────────────────────────┤'
  );
  logger.info('│');
  logger.info(
    `│  🐦 Twitter: ${twitterEnabled ? '✅ ENABLED' : '⭕ DISABLED'}`
  );
  if (twitterEnabled) {
    logger.info(`│     ├─ Events: ${process.env.TWITTER_EVENTS}`);
    if (process.env.TWITTER_PREPEND_TWEET) {
      logger.info(`│     ├─ Prepend: "${process.env.TWITTER_PREPEND_TWEET}"`);
    }
    if (process.env.TWITTER_APPEND_TWEET) {
      logger.info(`│     └─ Append: "${process.env.TWITTER_APPEND_TWEET}"`);
    }
  }
  logger.info('│');
  logger.info(
    `│  💬 Discord: ${discordEnabled ? '✅ ENABLED' : '⭕ DISABLED'}`
  );
  if (discordEnabled) {
    logger.info(`│     └─ Events: ${process.env.DISCORD_EVENTS}`);
  }
  logger.info('│');
};

const logSweepConfig = (twitterEnabled: boolean, discordEnabled: boolean) => {
  if (!(twitterEnabled || discordEnabled)) {
    return;
  }
  logger.info(
    '├─ 🧹 SWEEP AGGREGATION ──────────────────────────────────────────────┤'
  );
  logger.info('│');
  if (twitterEnabled) {
    const config = getDefaultSweepConfig('TWITTER');
    logger.info('│  🐦 Twitter Sweeps:');
    logger.info(`│     ├─ Min Group Size: ${config.minGroupSize} items`);
    logger.info(
      `│     └─ Settle Time: ${config.settleMs / MILLISECONDS_PER_SECOND}s`
    );
    logger.info('│');
  }
  if (discordEnabled) {
    const config = getDefaultSweepConfig('DISCORD');
    logger.info('│  💬 Discord Sweeps:');
    logger.info(`│     ├─ Min Group Size: ${config.minGroupSize} items`);
    logger.info(
      `│     └─ Settle Time: ${config.settleMs / MILLISECONDS_PER_SECOND}s`
    );
    logger.info('│');
  }
};

const logStartupConfiguration = () => {
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
║                     Activity Bot - Real-time NFT Tracker                  ║
║                                                                           ║
╚═══════════════════════════════════════════════════════════════════════════╝
`;

  // Use logger.info without timestamp prefix for ASCII art
  for (const line of asciiArt.split('\n')) {
    if (line.trim()) {
      logger.info(line);
    }
  }

  logger.info('');
  logger.info(
    '┌─ 📋 CONFIGURATION ──────────────────────────────────────────────────┐'
  );
  logger.info('│');
  logger.info(`│  📦  Collection Contract: ${shortTokenAddr}`);
  logger.info(`│  ⛓️   Network Chain: ${chain}`);
  logger.info(`│  ⏱️   Poll Interval: ${botInterval}s`);
  logger.info(
    `│  📊  Query Limit: ${process.env.QUERY_LIMIT ?? DEFAULT_QUERY_LIMIT} events per fetch`
  );
  logger.info(`│  💰  Min Offer Filter: ${minOfferETH} ETH`);
  logger.info(`│  📝  Log Level: ${process.env.LOG_LEVEL ?? 'info'}`);
  logger.info('│');

  const twitterEnabled = Boolean(process.env.TWITTER_EVENTS);
  const discordEnabled = Boolean(process.env.DISCORD_EVENTS);

  logPlatformConfig(twitterEnabled, discordEnabled);
  logSweepConfig(twitterEnabled, discordEnabled);

  logger.info(
    '└─────────────────────────────────────────────────────────────────────┘'
  );
  logger.info('');
  logger.info('🚀 Bot initialization starting...');
  logger.info('');
};

function main() {
  const run = async () => {
    const events: OpenSeaAssetEvent[] = await fetchEvents();
    if (!events || events.length === 0) {
      return;
    }

    logger.debug('OpenSea API Events:', events);

    messageEvents(events);
    tweetEvents(events);
  };

  logStartupConfiguration();
  run();

  const MS_PER_SECOND = 1000;
  const interval = setInterval(run.bind(this), botInterval * MS_PER_SECOND);

  process.on('SIGINT', () => {
    logger.info('');
    logger.info('⚠️  Interrupt signal received (SIGINT)');
    logger.info('🛑 Shutting down gracefully...');
    clearInterval(interval);
    logger.info('✅ Bot stopped successfully');
    process.exit();
  });
}

main();
