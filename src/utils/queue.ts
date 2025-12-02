import { logger } from "./logger";

// Local timeout to avoid cross-module deps in tests
const timeout = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

// Creates a timeout promise with cleanup capability to prevent timer leaks
const createTimeoutRace = <T>(
  promise: Promise<T>,
  ms: number,
  message: string
): Promise<T> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(message));
    }, ms);
    // Use unref() to prevent the timer from keeping the process alive
    if (typeof timer.unref === "function") {
      timer.unref();
    }
    promise
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((error: unknown) => {
        clearTimeout(timer);
        reject(error);
      });
  });

// Default timeout for queue item processing (2 minutes)
const DEFAULT_PROCESSING_TIMEOUT_MS = 120_000;

export type QueueErrorClassification =
  | { type: "rate_limit"; pauseUntilMs: number }
  | { type: "transient" }
  | { type: "fatal" };

export type WorkItem<T> = { item: T; attempts: number };

export type AsyncQueueOptions<T> = {
  perItemDelayMs: number;
  backoffBaseMs: number;
  backoffMaxMs: number;
  processingTimeoutMs?: number;
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

      await this.handleSuccessfulProcess(key, next.item);
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

  private getProcessingTimeoutMs(): number {
    return this.options.processingTimeoutMs ?? DEFAULT_PROCESSING_TIMEOUT_MS;
  }

  private async tryProcessNext(next: WorkItem<T>): Promise<boolean> {
    const key = this.options.keyFor(next.item);
    const timeoutMs = this.getProcessingTimeoutMs();

    logger.info(`[Queue] Processing item: ${key}`);
    const startTime = Date.now();

    try {
      // Race between the actual processing and a timeout (with proper cleanup)
      await createTimeoutRace(
        this.options.process(next.item),
        timeoutMs,
        `Processing timed out after ${timeoutMs}ms for item: ${key}`
      );
      const durationMs = Date.now() - startTime;
      logger.info(`[Queue] Completed item: ${key} (${durationMs}ms)`);
      return true;
    } catch (error: unknown) {
      const durationMs = Date.now() - startTime;
      const isTimeout =
        error instanceof Error && error.message.includes("timed out");

      if (isTimeout) {
        logger.error(
          `[Queue] Processing timeout after ${durationMs}ms for item: ${key}`
        );
        // Treat timeouts as transient errors - allow retry with backoff
        next.attempts += 1;
        const waitMs = this.calcBackoffMs(next.attempts);
        logger.warn(
          `[Queue] Will retry after ${waitMs}ms (attempt ${next.attempts})`
        );
        await timeout(waitMs);
        return false;
      }

      const classification = this.options.classifyError(error);
      if (classification.type === "rate_limit") {
        const waitMs = Math.max(
          classification.pauseUntilMs - Date.now(),
          this.options.backoffBaseMs
        );
        this.pauseUntilMs = Date.now() + waitMs;
        logger.warn(`[Queue] Rate limited, pausing for ${waitMs}ms`);
        return false; // retry same item after pause
      }
      if (classification.type === "transient") {
        next.attempts += 1;
        const waitMs = this.calcBackoffMs(next.attempts);
        logger.warn(
          `[Queue] Transient error (attempt ${next.attempts}), backing off for ${waitMs}ms`
        );
        if (this.options.debug) {
          logger.debug("[Queue] Error details:", error);
        }
        await timeout(waitMs);
        return false; // retry same item after backoff
      }
      // fatal
      logger.error(
        `[Queue] Fatal error processing item (${durationMs}ms), dropping:`,
        error
      );
      this.list.shift();
      return false;
    }
  }
}
