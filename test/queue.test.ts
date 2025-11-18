import { AsyncQueue } from "../src/utils/queue";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("AsyncQueue", () => {
  describe("Basic Functionality", () => {
    it("processes items in order", async () => {
      const processed: number[] = [];
      const q = new AsyncQueue<number>({
        perItemDelayMs: 1,
        backoffBaseMs: 1,
        backoffMaxMs: 10,
        process: (n) => {
          processed.push(n);
          return Promise.resolve();
        },
        keyFor: (n) => String(n),
        classifyError: () => ({ type: "fatal" }),
      });
      q.enqueue(1);
      q.enqueue(2);
      await sleep(50);
      expect(processed.join(",")).toBe("1,2");
    });

    it("respects per-item delay", async () => {
      const processed: number[] = [];
      const timestamps: number[] = [];
      const DELAY_MS = 100;

      const q = new AsyncQueue<number>({
        perItemDelayMs: DELAY_MS,
        backoffBaseMs: 1,
        backoffMaxMs: 10,
        debug: false,
        process: (n) => {
          processed.push(n);
          timestamps.push(Date.now());
          return Promise.resolve();
        },
        keyFor: (n) => String(n),
        classifyError: () => ({ type: "fatal" }),
      });

      const startTime = Date.now();
      q.enqueue(1);
      q.enqueue(2);
      await sleep(250);

      expect(processed).toEqual([1, 2]);
      // Check that it took at least the delay time to process both items
      const totalTime = Date.now() - startTime;
      expect(totalTime).toBeGreaterThanOrEqual(DELAY_MS * 0.8);
    });

    it("returns correct queue size", () => {
      const q = new AsyncQueue<number>({
        perItemDelayMs: 1,
        backoffBaseMs: 1,
        backoffMaxMs: 10,
        debug: false,
        process: () => Promise.resolve(),
        keyFor: (n) => String(n),
        classifyError: () => ({ type: "fatal" }),
      });

      expect(q.size()).toBe(0);
      q.enqueue(1);
      expect(q.size()).toBe(1);
      q.enqueue(2);
      expect(q.size()).toBe(2);
    });
  });

  describe("Error Handling", () => {
    it("handles fatal errors by dropping items", async () => {
      const processed: number[] = [];
      const errors: unknown[] = [];

      const q = new AsyncQueue<number>({
        perItemDelayMs: 1,
        backoffBaseMs: 1,
        backoffMaxMs: 10,
        process: (n) => {
          if (n === 2) {
            throw new Error("Fatal error");
          }
          processed.push(n);
          return Promise.resolve();
        },
        keyFor: (n) => String(n),
        classifyError: (error) => {
          errors.push(error);
          return { type: "fatal" };
        },
      });

      q.enqueue(1);
      q.enqueue(2); // Will fail
      q.enqueue(3);
      await sleep(50);

      // Items 1 and 3 processed, 2 dropped
      expect(processed).toEqual([1, 3]);
      expect(errors.length).toBe(1);
    });

    it("retries transient errors", async () => {
      const processed: number[] = [];
      const attempts = new Map<number, number>();

      const q = new AsyncQueue<number>({
        perItemDelayMs: 1,
        backoffBaseMs: 5,
        backoffMaxMs: 50,
        process: (n) => {
          const attemptCount = (attempts.get(n) ?? 0) + 1;
          attempts.set(n, attemptCount);

          // Fail first 2 attempts, succeed on 3rd
          if (attemptCount < 3) {
            throw new Error(`Transient error attempt ${attemptCount}`);
          }
          processed.push(n);
          return Promise.resolve();
        },
        keyFor: (n) => String(n),
        classifyError: () => ({ type: "transient" }),
      });

      q.enqueue(42);
      await sleep(200);

      expect(processed).toEqual([42]);
      expect(attempts.get(42)).toBe(3);
    });

    it("handles rate limiting", async () => {
      const processed: number[] = [];
      let rateLimitHit = false;
      const RATE_LIMIT_DELAY = 100;

      const q = new AsyncQueue<number>({
        perItemDelayMs: 1,
        backoffBaseMs: 1,
        backoffMaxMs: 10,
        process: (n) => {
          if (n === 1 && !rateLimitHit) {
            rateLimitHit = true;
            throw new Error("Rate limited");
          }
          processed.push(n);
          return Promise.resolve();
        },
        keyFor: (n) => String(n),
        classifyError: () => {
          if (!rateLimitHit) {
            return { type: "fatal" };
          }
          return {
            type: "rate_limit",
            pauseUntilMs: Date.now() + RATE_LIMIT_DELAY,
          };
        },
      });

      q.enqueue(1);
      q.enqueue(2);
      await sleep(250);

      // Both should eventually process after rate limit
      expect(processed).toContain(1);
      expect(processed).toContain(2);
    });
  });

  describe("Deduplication", () => {
    it("skips already-processed items", async () => {
      const processed: number[] = [];
      const processedKeys = new Set<string>();

      const q = new AsyncQueue<number>({
        perItemDelayMs: 1,
        backoffBaseMs: 1,
        backoffMaxMs: 10,
        debug: false,
        process: (n) => {
          processed.push(n);
          processedKeys.add(String(n));
          return Promise.resolve();
        },
        keyFor: (n) => String(n),
        isAlreadyProcessed: (key) => processedKeys.has(key),
        classifyError: () => ({ type: "fatal" }),
      });

      // Enqueue 1 and 2
      q.enqueue(1);
      q.enqueue(2);
      await sleep(100);

      // Verify they were processed
      expect(processed).toContain(1);
      expect(processed).toContain(2);

      // Try to enqueue them again - should be skipped
      q.enqueue(1); // Should be skipped
      q.enqueue(2); // Should be skipped
      q.enqueue(3); // Should be processed (auto-starts queue)
      await sleep(100);

      // Items 1 and 2 should only be processed once each, 3 should be processed
      expect(processed.filter((n) => n === 1)).toHaveLength(1);
      expect(processed.filter((n) => n === 2)).toHaveLength(1);
      expect(processed).toContain(3);
      expect(processed).toHaveLength(3);
    });
  });

  describe("Callbacks", () => {
    it("calls onProcessed after successful processing", async () => {
      const processed: number[] = [];
      const onProcessedCalls: number[] = [];

      const q = new AsyncQueue<number>({
        perItemDelayMs: 1,
        backoffBaseMs: 1,
        backoffMaxMs: 10,
        process: (n) => {
          processed.push(n);
          return Promise.resolve();
        },
        keyFor: (n) => String(n),
        onProcessed: (n) => {
          onProcessedCalls.push(n);
        },
        classifyError: () => ({ type: "fatal" }),
      });

      q.enqueue(1);
      q.enqueue(2);
      await sleep(50);

      expect(onProcessedCalls).toEqual([1, 2]);
    });

    it("does not call onProcessed for failed items", async () => {
      const processed: number[] = [];
      const onProcessedCalls: number[] = [];

      const q = new AsyncQueue<number>({
        perItemDelayMs: 1,
        backoffBaseMs: 1,
        backoffMaxMs: 10,
        process: (n) => {
          if (n === 2) {
            throw new Error("Fatal error");
          }
          processed.push(n);
          return Promise.resolve();
        },
        keyFor: (n) => String(n),
        onProcessed: (n) => {
          onProcessedCalls.push(n);
        },
        classifyError: () => ({ type: "fatal" }),
      });

      q.enqueue(1);
      q.enqueue(2); // Will fail
      q.enqueue(3);
      await sleep(50);

      expect(onProcessedCalls).toEqual([1, 3]);
      expect(onProcessedCalls).not.toContain(2);
    });
  });
});
