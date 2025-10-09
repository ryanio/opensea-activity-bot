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
  logger.info('');
  logger.info('🔌 Platforms:');
  logger.info(`   Twitter: ${twitterEnabled ? '✓ enabled' : '✗ disabled'}`);
  if (twitterEnabled) {
    logger.info(`   └─ Events: ${process.env.TWITTER_EVENTS}`);
    if (process.env.TWITTER_PREPEND_TWEET) {
      logger.info(`   └─ Prepend: "${process.env.TWITTER_PREPEND_TWEET}"`);
    }
    if (process.env.TWITTER_APPEND_TWEET) {
      logger.info(`   └─ Append: "${process.env.TWITTER_APPEND_TWEET}"`);
    }
  }
  logger.info(`   Discord: ${discordEnabled ? '✓ enabled' : '✗ disabled'}`);
  if (discordEnabled) {
    logger.info(`   └─ Events: ${process.env.DISCORD_EVENTS}`);
  }
};

const logSweepConfig = (twitterEnabled: boolean, discordEnabled: boolean) => {
  if (!(twitterEnabled || discordEnabled)) {
    return;
  }
  logger.info('');
  logger.info('🧹 Sweep Aggregation:');
  if (twitterEnabled) {
    const config = getDefaultSweepConfig('TWITTER');
    logger.info(
      `   Twitter: minGroupSize=${config.minGroupSize}, settle=${config.settleMs / MILLISECONDS_PER_SECOND}s`
    );
  }
  if (discordEnabled) {
    const config = getDefaultSweepConfig('DISCORD');
    logger.info(
      `   Discord: minGroupSize=${config.minGroupSize}, settle=${config.settleMs / MILLISECONDS_PER_SECOND}s`
    );
  }
};

const logStartupConfiguration = () => {
  logger.info('🚀 Starting OpenSea Activity Bot');
  logger.info(
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
  );

  logger.info(`📦 Collection: ${shortTokenAddr} (${chain})`);
  logger.info(`⏱️ Poll Interval: ${botInterval}s`);
  logger.info(
    `📊 Query Limit: ${process.env.QUERY_LIMIT ?? DEFAULT_QUERY_LIMIT}`
  );
  logger.info(`💰 Min Offer: ${minOfferETH} ETH`);
  logger.info(`📝 Log Level: ${process.env.LOG_LEVEL ?? 'info'}`);

  const twitterEnabled = Boolean(process.env.TWITTER_EVENTS);
  const discordEnabled = Boolean(process.env.DISCORD_EVENTS);

  logPlatformConfig(twitterEnabled, discordEnabled);
  logSweepConfig(twitterEnabled, discordEnabled);

  logger.info(
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
  );
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
    logger.info('Caught interrupt signal. Stopping...');
    clearInterval(interval);
    process.exit();
  });
}

main();
