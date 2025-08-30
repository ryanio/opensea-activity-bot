import { messageEvents } from './discord';
import { logger } from './logger';
import { fetchEvents } from './opensea';
import { tweetEvents } from './twitter';
import type { OpenSeaAssetEvent } from './types';
import { botInterval } from './utils';

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

  logger.info(`Starting bot. Interval: ${botInterval}s`);
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
