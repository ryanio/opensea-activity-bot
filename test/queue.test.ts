import { AsyncQueue } from '../src/queue';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('AsyncQueue', () => {
  it('processes items in order', async () => {
    const processed: number[] = [];
    const q = new AsyncQueue<number>({
      perItemDelayMs: 1,
      backoffBaseMs: 1,
      backoffMaxMs: 10,
      debug: false,
      process: (n) => {
        processed.push(n);
        return Promise.resolve();
      },
      keyFor: (n) => String(n),
      classifyError: () => ({ type: 'fatal' }),
    });
    q.enqueue(1);
    q.enqueue(2);
    q.start();
    const TEST_WAIT_MS = 20;
    await sleep(TEST_WAIT_MS);
    expect(processed.join(',')).toBe('1,2');
  });
});
