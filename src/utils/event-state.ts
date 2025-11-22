import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";
import { logger } from "./logger";

const DEFAULT_DEDUPE_WINDOW_MINUTES = 60;
const SECONDS_PER_MINUTE = 60;

export type EventCursor = {
  source: string;
  next: string | null;
  lastTimestamp: number | null;
  lastId: string | null;
};

export type Watermark = {
  maxProcessedTimestamp: number;
  windowSeconds: number;
  keys: string[];
};

type PersistedState = {
  cursor: EventCursor | null;
  watermark: Watermark;
};

const parseTimestampFromKey = (key: string): number | undefined => {
  const parts = key.split("|");
  const last = parts.at(-1);
  if (!last) {
    return;
  }
  const value = Number.parseInt(last, 10);
  if (Number.isNaN(value)) {
    return;
  }
  return value;
};

class EventStateStore {
  private readonly filePath: string;
  private readonly enablePersistence: boolean;
  private readonly windowSeconds: number;

  private loaded = false;
  private dirty = false;

  private cursor: EventCursor | null = null;
  private maxProcessedTimestamp = 0;
  private readonly keyTimestamps = new Map<string, number>();
  private readonly seenKeys = new Set<string>();

  constructor(options: {
    filePath: string;
    windowSeconds: number;
    enablePersistence: boolean;
  }) {
    this.filePath = options.filePath;
    this.windowSeconds = options.windowSeconds;
    this.enablePersistence = options.enablePersistence;
  }

  async load(): Promise<void> {
    if (this.loaded) {
      return;
    }
    this.loaded = true;

    if (!this.enablePersistence) {
      return;
    }

    await this.loadFromDisk();
  }

  private async loadFromDisk(): Promise<void> {
    try {
      const content = await this.readStateFile();
      if (!content) {
        return;
      }
      const parsed = JSON.parse(content) as Partial<PersistedState>;
      this.applyParsedState(parsed);
    } catch (error) {
      const maybeErr = error as { code?: string };
      if (maybeErr.code === "ENOENT") {
        // Fresh start – no persisted state yet.
        return;
      }
      logger.error("[EventState] Failed to load state:", error);
    }
  }

  private async readStateFile(): Promise<string | undefined> {
    const dir = dirname(this.filePath);
    await fs.mkdir(dir, { recursive: true });
    const content = await fs.readFile(this.filePath, "utf8");
    return content;
  }

  private applyParsedState(parsed: Partial<PersistedState>): void {
    if (parsed.cursor) {
      this.applyCursorState(parsed.cursor);
    }
    if (parsed.watermark) {
      this.applyWatermarkState(parsed.watermark);
    }
  }

  private applyCursorState(cursor: EventCursor): void {
    this.cursor = {
      source: cursor.source ?? "opensea-v2",
      next: cursor.next ?? null,
      lastTimestamp:
        cursor.lastTimestamp === null
          ? null
          : Number(cursor.lastTimestamp ?? 0),
      lastId: cursor.lastId ?? null,
    };
  }

  private applyWatermarkState(watermark: Watermark): void {
    if (!Array.isArray(watermark.keys)) {
      return;
    }
    this.maxProcessedTimestamp = Number(watermark.maxProcessedTimestamp ?? 0);
    for (const key of watermark.keys) {
      const ts = parseTimestampFromKey(key);
      if (ts === undefined) {
        // Still track the key for dedupe even if we cannot parse a timestamp
        this.seenKeys.add(key);
        continue;
      }
      this.keyTimestamps.set(key, ts);
      this.seenKeys.add(key);
      if (ts > this.maxProcessedTimestamp) {
        this.maxProcessedTimestamp = ts;
      }
    }
    this.pruneKeys();
  }

  getCursor(): EventCursor | null {
    return this.cursor;
  }

  setCursor(cursor: EventCursor): void {
    this.cursor = cursor;
    this.dirty = true;
  }

  hasKey(key: string): boolean {
    return this.seenKeys.has(key);
  }

  markProcessed(keys: string[]): void {
    if (keys.length === 0) {
      return;
    }

    for (const key of keys) {
      if (this.seenKeys.has(key)) {
        continue;
      }
      this.seenKeys.add(key);
      const ts = parseTimestampFromKey(key);
      if (ts === undefined) {
        continue;
      }
      this.keyTimestamps.set(key, ts);
      if (ts > this.maxProcessedTimestamp) {
        this.maxProcessedTimestamp = ts;
      }
    }

    this.pruneKeys();
    this.dirty = true;
  }

  private pruneKeys(): void {
    if (this.maxProcessedTimestamp === 0) {
      return;
    }
    const cutoff = this.maxProcessedTimestamp - this.windowSeconds;
    for (const [key, ts] of this.keyTimestamps.entries()) {
      if (ts < cutoff) {
        this.keyTimestamps.delete(key);
        this.seenKeys.delete(key);
      }
    }
  }

  async flush(): Promise<void> {
    if (!(this.enablePersistence && this.dirty)) {
      return;
    }

    const watermark: Watermark = {
      maxProcessedTimestamp: this.maxProcessedTimestamp,
      windowSeconds: this.windowSeconds,
      keys: Array.from(this.keyTimestamps.keys()),
    };

    const state: PersistedState = {
      cursor: this.cursor,
      watermark,
    };

    try {
      const dir = dirname(this.filePath);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(this.filePath, JSON.stringify(state), "utf8");
      this.dirty = false;
    } catch (error) {
      logger.error("[EventState] Failed to persist state:", error);
    }
  }
}

let defaultStore: EventStateStore | undefined;

export const getDefaultEventStateStore = (): EventStateStore => {
  if (defaultStore) {
    return defaultStore;
  }

  const minutes = Number(
    process.env.EVENT_DEDUPE_WINDOW_MINUTES ?? DEFAULT_DEDUPE_WINDOW_MINUTES
  );
  const windowSeconds =
    Number.isNaN(minutes) || minutes <= 0
      ? DEFAULT_DEDUPE_WINDOW_MINUTES * SECONDS_PER_MINUTE
      : minutes * SECONDS_PER_MINUTE;

  const rootDir = process.cwd();
  const stateDir = process.env.EVENT_STATE_DIR ?? ".state";
  const filePath = join(rootDir, stateDir, "opensea-events-state.json");

  const enablePersistence = process.env.NODE_ENV !== "test";

  defaultStore = new EventStateStore({
    filePath,
    windowSeconds,
    enablePersistence,
  });
  return defaultStore;
};
