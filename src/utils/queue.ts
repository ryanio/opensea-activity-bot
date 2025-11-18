import { logger } from "./logger";

// Local timeout to avoid cross-module deps in tests
const timeout = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

export type QueueErrorClassification =
  | { type: "rate_limit"; pauseUntilMs: number }
  | { type: "transient" }
  | { type: "fatal" };

export type WorkItem<T> = { item: T; attempts: number };

export type AsyncQueueOptions<T> = {
  perItemDelayMs: number;
  backoffBaseMs: number;
  backoffMaxMs: number;
  debug?: boolean;
  process: (item: T) => Promise<void>;
  keyFor: (item: T) => string;
  isAlreadyProcessed?: (key: string, item: T) => boolean;
  onProcessed?: (item: T) => void;
  classifyError: (error: unknown) => QueueErrorClassification;
};

export class AsyncQueue<T> {
  private readonly options: AsyncQueueOptions<T>;
  private readonly list: WorkItem<T>[] = [];
  private isProcessing = false;
  private pauseUntilMs = 0;

  constructor(options: AsyncQueueOptions<T>) {
    this.options = options;
  }

  enqueue(item: T) {
    this.list.push({ item, attempts: 0 });

    // Auto-start the queue if it's idle
    if (!this.isProcessing) {
      this.start();
    }
  }

  size(): number {
    return this.list.length;
  }

  start() {
    if (!this.isProcessing) {
      if (this.options.debug) {
        logger.debug(
          `[Queue] Starting queue processing (${this.list.length} items)`
        );
      }
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      this.processLoop().catch((err) => {
        logger.error("[Queue] Uncaught error in processLoop:", err);
      });
    } else if (this.options.debug) {
      logger.debug("[Queue] Queue already processing, skipping start()");
    }
  }

  private jitter(ms: number) {
    const JITTER_FACTOR = 0.2;
    const delta = Math.floor(ms * JITTER_FACTOR);
    return ms + Math.floor(Math.random() * (2 * delta + 1)) - delta;
  }

  private calcBackoffMs(attempts: number) {
    const { backoffBaseMs, backoffMaxMs } = this.options;
    const exp = backoffBaseMs * 2 ** Math.max(0, attempts - 1);
    return Math.min(this.jitter(exp), backoffMaxMs);
  }

  private async processLoop() {
    if (this.isProcessing) {
      if (this.options.debug) {
        logger.debug("[Queue] processLoop called but already processing");
      }
      return;
    }
    this.isProcessing = true;
    try {
      await this.processQueueItems();
      if (this.options.debug) {
        logger.debug("[Queue] Finished processing all items");
      }
    } finally {
      this.isProcessing = false;
    }
  }

  private async processQueueItems() {
    // eslint-disable-next-line no-constant-condition
    while (this.list.length > 0) {
      const now = Date.now();
      await this.pauseIfNeeded(now);

      const next = this.list[0];
      const key = this.options.keyFor(next.item);

      if (this.handleSkipIfProcessed(key, next.item)) {
        continue;
      }

      const processed = await this.tryProcessNext(next);
      if (!processed) {
        // tryProcessNext decides whether to retry or drop
        continue;
      }

      this.handleSuccessfulProcess(key, next.item);
    }
  }

  private handleSkipIfProcessed(key: string, item: T): boolean {
    if (this.shouldSkipProcessed(key, item)) {
      if (this.options.debug) {
        logger.debug(`[Queue] Skipping already-processed item: ${key}`);
      }
      this.list.shift();
      return true;
    }
    return false;
  }

  private async handleSuccessfulProcess(key: string, item: T) {
    if (this.options.debug) {
      logger.debug(`[Queue] Successfully processed item: ${key}`);
    }
    this.list.shift();
    this.options.onProcessed?.(item);
    if (this.list.length > 0) {
      await timeout(this.options.perItemDelayMs);
    }
  }

  private async pauseIfNeeded(now: number) {
    if (this.pauseUntilMs > now) {
      const waitMs = this.pauseUntilMs - now;
      await timeout(waitMs);
      this.pauseUntilMs = 0;
    }
  }

  private shouldSkipProcessed(key: string, item: T): boolean {
    return this.options.isAlreadyProcessed?.(key, item) === true;
  }

  private async tryProcessNext(next: WorkItem<T>): Promise<boolean> {
    try {
      await this.options.process(next.item);
      return true;
    } catch (error: unknown) {
      const classification = this.options.classifyError(error);
      if (classification.type === "rate_limit") {
        const waitMs = Math.max(
          classification.pauseUntilMs - Date.now(),
          this.options.backoffBaseMs
        );
        this.pauseUntilMs = Date.now() + waitMs;
        if (this.options.debug) {
          logger.debug(`[Queue] Rate limited, pausing for ${waitMs}ms`);
        }
        return false; // retry same item after pause
      }
      if (classification.type === "transient") {
        next.attempts += 1;
        const waitMs = this.calcBackoffMs(next.attempts);
        if (this.options.debug) {
          logger.debug(
            `[Queue] Transient error (attempt ${next.attempts}), backing off for ${waitMs}ms:`,
            error
          );
        }
        await timeout(waitMs);
        return false; // retry same item after backoff
      }
      // fatal
      logger.error("[Queue] Fatal error processing item, dropping:", error);
      this.list.shift();
      return false;
    }
  }
}
