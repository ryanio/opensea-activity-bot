import { messageEvents } from './discord';
import { fetchEvents } from './opensea';
import { tweetEvents } from './twitter';
import { botInterval } from './utils';

const { DEBUG } = process.env;

function main() {
  const run = async () => {
    const events = await fetchEvents();
    if (!events || events.length === 0) {
      return;
    }

    if (DEBUG === 'true') {
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      DEBUG;
    }

    messageEvents(events);
    tweetEvents(events);
  };

  run();

  const MS_PER_SECOND = 1000;
  const interval = setInterval(run.bind(this), botInterval * MS_PER_SECOND);

  process.on('SIGINT', () => {
    clearInterval(interval);
    process.exit();
  });
}

main();
