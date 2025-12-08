import { URLSearchParams } from "node:url";
import { FixedNumber } from "ethers";
import { channelsWithEvents } from "./platforms/discord/discord";
import type {
  OpenSeaAccount,
  OpenSeaAssetEvent,
  OpenSeaCollection,
  OpenSeaContractResponse,
  OpenSeaEventsResponse,
  OpenSeaNFT,
  OpenSeaNFTResponse,
} from "./types";
import { canonicalEventKeyFor } from "./utils/canonical-events";
import { collectionStore } from "./utils/collection-store";
import { getDefaultEventStateStore } from "./utils/event-state";
import { parseEvents, wantsOpenSeaEventTypes } from "./utils/events";
import { logger } from "./utils/logger";
import { LRUCache } from "./utils/lru-cache";
import { chain, minOfferETH, shortAddr, unixTimestamp } from "./utils/utils";

const {
  OPENSEA_API_TOKEN,
  TOKEN_ADDRESS,
  TWITTER_EVENTS,
  LAST_EVENT_TIMESTAMP,
  OPENSEA_EVENT_LAG_WINDOW,
  OPENSEA_MAX_PAGES,
} = process.env;

const eventStateStore = getDefaultEventStateStore();
let lastEventTimestamp: number | undefined;
let lastEventTimestampSource: EventTimestampSource | undefined;

// Pagination and safety window constants
const SUBSTRING_LENGTH_FOR_CURSOR_LOG = 20;
const DEFAULT_MAX_PAGINATION_PAGES = 100;
const OPENSEA_MAX_LIMIT = 200;
const MAX_PAGINATION_PAGES = Number(
  OPENSEA_MAX_PAGES ?? DEFAULT_MAX_PAGINATION_PAGES
);

const DEFAULT_EVENT_LAG_SAFETY_WINDOW_SECONDS = 120;
const EVENT_LAG_SAFETY_WINDOW_SECONDS = Number(
  OPENSEA_EVENT_LAG_WINDOW ?? DEFAULT_EVENT_LAG_SAFETY_WINDOW_SECONDS
);

type FetchSummaryStatus =
  | "events_processed"
  | "no_events_found"
  | "all_events_filtered"
  | "request_failed"
  | "pagination_failed";

type FetchSummary = {
  status: FetchSummaryStatus;
  fetched: number;
  processed: number;
  deduped: number;
  filteredPrivate: number;
  filteredLowOffers: number;
  pages: number;
  after: number;
  limit: number;
  eventTypes: EventType[];
  oldestTimestamp?: number;
  newestTimestamp?: number;
  nextCursor?: string;
  error?: string;
};

const logFetchSummary = (summary: FetchSummary, durationMs: number) => {
  if (process.env.LOG_LEVEL === "debug") {
    const debugParts = [
      "[FetchSummaryDebug]",
      `status=${summary.status}`,
      `after=${summary.after}`,
      `lag=${EVENT_LAG_SAFETY_WINDOW_SECONDS}s`,
      `limit=${summary.limit}`,
      `types=${summary.eventTypes.join("|")}`,
      `pages=${summary.pages}`,
      `fetched=${summary.fetched}`,
      `processed=${summary.processed}`,
      `deduped=${summary.deduped}`,
      `filteredPrivate=${summary.filteredPrivate}`,
      `filteredLow=${summary.filteredLowOffers}`,
      `durationMs=${durationMs}`,
    ];
    if (summary.oldestTimestamp !== undefined) {
      debugParts.push(`oldestTs=${summary.oldestTimestamp}`);
    }
    if (summary.newestTimestamp !== undefined) {
      debugParts.push(`newestTs=${summary.newestTimestamp}`);
    }
    if (summary.nextCursor) {
      const preview = summary.nextCursor.slice(
        0,
        SUBSTRING_LENGTH_FOR_CURSOR_LOG
      );
      debugParts.push(`nextCursor=${preview}…`);
    }
    if (summary.error) {
      debugParts.push(`error=${summary.error}`);
    }
    logger.debug(debugParts.join(" "));
    return;
  }

  const parts = [
    "[FetchSummary]",
    `status=${summary.status}`,
    `fetched=${summary.fetched}`,
    `processed=${summary.processed}`,
  ];
  if (summary.status === "all_events_filtered") {
    const totalFiltered =
      summary.filteredPrivate + summary.filteredLowOffers + summary.deduped;
    parts.push(`filtered=${totalFiltered}`);
  } else if (summary.status === "events_processed") {
    parts.push(`deduped=${summary.deduped}`);
  }
  if (summary.error) {
    parts.push(`error=${summary.error}`);
  }
  parts.push(`pages=${summary.pages}`, `durationMs=${durationMs}`);
  logger.info(parts.join(" "));
};

export const opensea = {
  api: "https://api.opensea.io/api/v2/",
  collectionURL: () =>
    `https://opensea.io/collection/${collectionStore.getSlug()}`,
  getEvents: () =>
    `${opensea.api}events/collection/${collectionStore.getSlug()}`,
  getContract: () => `${opensea.api}chain/${chain}/contract/${TOKEN_ADDRESS}`,
  getAccount: (address: string) => `${opensea.api}accounts/${address}`,
  getNFT: (tokenId: number) =>
    `${opensea.api}chain/${chain}/contract/${TOKEN_ADDRESS}/nfts/${tokenId}`,
  getCollection: (slug: string) => `${opensea.api}collections/${slug}`,
  GET_OPTS: {
    method: "GET",
    headers: {
      Accept: "application/json",
      "X-API-KEY": OPENSEA_API_TOKEN ?? "",
    } as Record<string, string>,
  } as RequestInit,
};

/**
 * OpenSea utils and helpers
 */
export const openseaGet = async <T = unknown>(
  url: string
): Promise<T | undefined> => {
  try {
    const response = await fetch(url, opensea.GET_OPTS);
    if (!response.ok) {
      logger.error(
        `Fetch Error for ${url} - ${response.status}: ${response.statusText}`,
        process.env.LOG_LEVEL === "debug" ? await response.text() : undefined
      );
      return;
    }
    const result = (await response.json()) as T;
    return result;
  } catch (error) {
    const message =
      typeof (error as { message?: unknown })?.message === "string"
        ? (error as { message: string }).message
        : String(error);
    logger.error(`Fetch Error for ${url}: ${message}`);
  }
};

/**
 * Processes an OpenSea user object and returns, in order:
 * 1. An OpenSea username
 * 2. A short formatted address
 */
const USERNAME_CACHE_CAPACITY = 100;
const usernameCache = new LRUCache<string, string>(USERNAME_CACHE_CAPACITY);
const formatUsername = (name: string, address: string) =>
  name === "" ? shortAddr(address) : name;
export const username = async (address: string) => {
  const cached = usernameCache.get(address);
  if (cached) {
    return formatUsername(cached, address);
  }

  const account = await fetchAccount(address);
  const fetchedName = account?.username ?? "";
  usernameCache.put(address, fetchedName);
  return formatUsername(fetchedName, address);
};

const fetchAccount = async (
  address: string
): Promise<OpenSeaAccount | undefined> => {
  const url = opensea.getAccount(address);
  const result = await openseaGet<OpenSeaAccount>(url);
  return result;
};

/**
 * Fetches fresh NFT metadata from OpenSea API by token ID.
 * Useful for mints where metadata may not be immediately available.
 */
export const fetchNFT = async (
  tokenId: string | number
): Promise<OpenSeaNFT | undefined> => {
  const url = opensea.getNFT(Number(tokenId));
  const result = await openseaGet<OpenSeaNFTResponse>(url);
  return result?.nft;
};

export const EventType = {
  listing: "listing",
  offer: "offer",
  trait_offer: "trait_offer",
  collection_offer: "collection_offer",
  mint: "mint",
  sale: "sale",
  transfer: "transfer",
} as const;
export type EventType = (typeof EventType)[keyof typeof EventType];

const addDiscordDeclaredEventTypes = (set: Set<string>) => {
  for (const [_channelId, discordEventTypes] of channelsWithEvents()) {
    for (const eventType of discordEventTypes) {
      set.add(eventType);
    }
  }
};

const enabledEventTypes = (): string[] => {
  const eventTypes = new Set<string>();
  addDiscordDeclaredEventTypes(eventTypes);

  // Parse TWITTER_EVENTS and map to OpenSea event_type(s)
  const tw = parseEvents(TWITTER_EVENTS);
  const wantedFromTwitter = wantsOpenSeaEventTypes(tw);
  for (const t of wantedFromTwitter) {
    eventTypes.add(t);
  }

  if (eventTypes.size === 0) {
    throw new Error(
      "No events enabled. Please specify DISCORD_EVENTS or TWITTER_EVENTS"
    );
  }
  return [...eventTypes];
};

export const fetchCollectionSlug = async (address: string): Promise<string> => {
  const existing = collectionStore.getSlug();
  if (existing) {
    return existing;
  }
  logger.info(`🔍 Fetching collection metadata for ${address} on ${chain}...`);
  const url = opensea.getContract();
  const result = await openseaGet<OpenSeaContractResponse>(url);
  if (!result?.collection) {
    logger.error(`❌ No collection found for ${address} on chain ${chain}`);
    throw new Error(`No collection found for ${address} on chain ${chain}`);
  }
  logger.info(`✅ Collection identified: ${result.collection}`);
  collectionStore.setSlug(result.collection);
  return result.collection;
};

export const getCollectionSlug = (): string | undefined =>
  collectionStore.getSlug();

/**
 * Fetches collection data from OpenSea API by slug.
 * Uses LRU cache to avoid repeated API calls.
 */
const COLLECTION_CACHE_CAPACITY = 1;
const collectionCache = new LRUCache<string, OpenSeaCollection>(
  COLLECTION_CACHE_CAPACITY
);

export const fetchCollection = async (
  slug: string
): Promise<OpenSeaCollection | undefined> => {
  const cached = collectionCache.get(slug);
  if (cached) {
    return cached;
  }

  const url = opensea.getCollection(slug);
  const result = await openseaGet<OpenSeaCollection>(url);
  if (result) {
    collectionCache.put(slug, result);
  }
  return result;
};

const filterPrivateListings = (
  events: OpenSeaAssetEvent[]
): { filtered: OpenSeaAssetEvent[]; count: number } => {
  const filtered = events.filter((event) => {
    if (event.order_type === EventType.listing && event.is_private_listing) {
      return false;
    }
    return true;
  });
  return { filtered, count: events.length - filtered.length };
};

const filterLowValueOffers = (
  events: OpenSeaAssetEvent[]
): {
  filtered: OpenSeaAssetEvent[];
  count: number;
} => {
  const preFilter = events.length;
  const filtered = events.filter((event) => {
    if (
      event.order_type?.includes("offer") &&
      event.payment?.symbol === "WETH"
    ) {
      const offerValue = FixedNumber.fromValue(
        event.payment.quantity,
        event.payment.decimals
      );
      return offerValue.gte(minOfferETH);
    }
    return true;
  });
  return { filtered, count: preFilter - filtered.length };
};

const updateLastEventTimestamp = (events: OpenSeaAssetEvent[]): void => {
  if (events.length === 0) {
    return;
  }
  const lastEvent = events.at(-1);
  if (!lastEvent) {
    return;
  }
  lastEventTimestamp = lastEvent.event_timestamp + 1;
  // When updating from events, source is still from the original resolution
  // (env, state_file, or new), so we don't change lastEventTimestampSource
};

const timestampFromCursor = (): number | undefined => {
  const cursor = eventStateStore.getCursor();
  if (cursor?.lastTimestamp === null) {
    return;
  }
  if (cursor?.lastTimestamp === undefined) {
    return;
  }
  return cursor.lastTimestamp;
};

const timestampFromEnv = (): number | undefined => {
  if (LAST_EVENT_TIMESTAMP === undefined) {
    return;
  }
  const parsed = Number.parseInt(LAST_EVENT_TIMESTAMP, 10);
  if (Number.isNaN(parsed)) {
    return;
  }
  return parsed;
};

export type EventTimestampSource = "env" | "state_file" | "new";

export type EventTimestampInfo = {
  timestamp: number;
  source: EventTimestampSource;
};

export const resolveLastEventTimestamp =
  async (): Promise<EventTimestampInfo> => {
    // Ensure event state store is loaded before checking cursor
    await eventStateStore.load();

    if (
      lastEventTimestamp !== undefined &&
      lastEventTimestampSource !== undefined
    ) {
      return {
        timestamp: lastEventTimestamp,
        source: lastEventTimestampSource,
      };
    }
    // Check env var first - allows overriding persisted cursor
    const fromEnv = timestampFromEnv();
    if (fromEnv !== undefined) {
      logger.info(
        `[EventTimestamp] Using LAST_EVENT_TIMESTAMP from environment: ${fromEnv}`
      );
      lastEventTimestamp = fromEnv;
      lastEventTimestampSource = "env";
      return { timestamp: fromEnv, source: "env" };
    }
    const fromCursor = timestampFromCursor();
    if (fromCursor !== undefined) {
      logger.debug(
        `[EventTimestamp] Using timestamp from persisted cursor: ${fromCursor}`
      );
      lastEventTimestamp = fromCursor;
      lastEventTimestampSource = "state_file";
      return { timestamp: fromCursor, source: "state_file" };
    }
    // No timestamp available - start from current time
    const now = unixTimestamp(new Date());
    logger.info(
      `[EventTimestamp] No timestamp found, starting from current time: ${now}`
    );
    lastEventTimestamp = now;
    lastEventTimestampSource = "new";
    return { timestamp: now, source: "new" };
  };

const mapToApiEventTypes = (eventTypes: string[]): Set<EventType> => {
  const apiEventTypes = new Set<EventType>();
  for (const eventType of eventTypes) {
    if (eventType === "burn") {
      apiEventTypes.add(EventType.transfer);
    } else {
      apiEventTypes.add(eventType as EventType);
    }
  }
  return apiEventTypes;
};

const buildEventsRequest = async (): Promise<{
  url: string;
  params: { after: number; limit: number; eventTypes: EventType[] };
}> => {
  const timestampInfo = await resolveLastEventTimestamp();
  const effectiveLastTimestamp = timestampInfo.timestamp;

  const eventTypes = enabledEventTypes();
  // Allow a small safety window behind the last seen timestamp so that
  // late-indexed events with older timestamps are still fetched. Rely on the
  // in-memory cache to prevent reprocessing duplicates.
  const afterCursorBase = Math.max(
    0,
    effectiveLastTimestamp - EVENT_LAG_SAFETY_WINDOW_SECONDS
  );
  const limit = OPENSEA_MAX_LIMIT;
  const params: Record<string, string> = {
    limit: limit.toString(),
    after: afterCursorBase.toString(),
  };
  const urlParams = new URLSearchParams(params);
  const apiEventTypes = mapToApiEventTypes(eventTypes);
  for (const apiType of apiEventTypes) {
    urlParams.append("event_type", apiType);
  }
  return {
    url: `${opensea.getEvents()}?${urlParams}`,
    params: {
      after: afterCursorBase,
      limit,
      eventTypes: [...apiEventTypes],
    },
  };
};

type FilterStats = {
  privateFiltered: number;
  lowValueFiltered: number;
  deduped: number;
};

const processEventFilters = (
  events: OpenSeaAssetEvent[]
): {
  events: OpenSeaAssetEvent[];
  stats: FilterStats;
} => {
  let processed = events;
  const stats: FilterStats = {
    privateFiltered: 0,
    lowValueFiltered: 0,
    deduped: 0,
  };

  const { filtered: withoutPrivateListings, count: privateCount } =
    filterPrivateListings(processed);
  processed = withoutPrivateListings;
  stats.privateFiltered = privateCount;

  const { filtered: afterOfferFilter, count: lowValueCount } =
    filterLowValueOffers(processed);
  processed = afterOfferFilter;
  stats.lowValueFiltered = lowValueCount;

  const preDedup = processed.length;
  const deduped: OpenSeaAssetEvent[] = [];
  const newKeys: string[] = [];

  for (const event of processed) {
    const key = canonicalEventKeyFor(event);
    if (eventStateStore.hasKey(key)) {
      logger.debug(
        `[Dedupe] Skipping already-seen event: ${event.event_type} token=${event.nft?.identifier ?? "?"} key=${key}`
      );
      continue;
    }
    deduped.push(event);
    newKeys.push(key);
  }

  if (preDedup > 0 && deduped.length === 0) {
    logger.debug(`[Dedupe] All ${preDedup} events were filtered as duplicates`);
  }

  eventStateStore.markProcessed(newKeys);
  processed = deduped;
  stats.deduped = preDedup - deduped.length;

  return { events: processed, stats };
};

const isEmptyEventsResponse = (result?: OpenSeaEventsResponse): boolean =>
  !result?.asset_events || result.asset_events.length === 0;

type PaginatedEventsResult = {
  events: OpenSeaAssetEvent[];
  fetched: number;
  pages: number;
  nextCursor?: string;
  error?: string;
};

const collectPaginatedEvents = async (
  initialResult: OpenSeaEventsResponse
): Promise<PaginatedEventsResult> => {
  let currentResult: OpenSeaEventsResponse | undefined = initialResult;
  let allEvents = [...initialResult.asset_events];
  let pagesFollowed = 0;
  let lastBatchCount = initialResult.asset_events.length;
  let prevCursor: string | undefined;
  let nextCursor = initialResult.next;
  let totalFetched = initialResult.asset_events.length;

  while (
    currentResult?.next &&
    pagesFollowed < MAX_PAGINATION_PAGES &&
    allEvents.length > 0 &&
    lastBatchCount >= OPENSEA_MAX_LIMIT
  ) {
    if (prevCursor && currentResult.next === prevCursor) {
      logger.debug(
        "Stopping pagination: repeated cursor indicates API bug or end of results"
      );
      break;
    }

    pagesFollowed += 1;
    const nextUrl = `${opensea.getEvents()}?${currentResult.next}`;
    prevCursor = currentResult.next;
    const cursorPreview = currentResult.next.slice(
      0,
      SUBSTRING_LENGTH_FOR_CURSOR_LOG
    );
    logger.debug(
      `Fetching page ${pagesFollowed + 1} (cursor: ${cursorPreview}...)`
    );
    logger.debug(`Next Events URL: ${nextUrl}`);

    currentResult = await openseaGet<OpenSeaEventsResponse>(nextUrl);
    if (!currentResult) {
      return {
        events: allEvents,
        fetched: totalFetched,
        pages: pagesFollowed + 1,
        nextCursor,
        error: "pagination_request_failed",
      };
    }
    if (isEmptyEventsResponse(currentResult)) {
      break;
    }

    const freshEvents = currentResult?.asset_events ?? [];
    allEvents = [...allEvents, ...freshEvents];
    lastBatchCount = freshEvents.length;
    totalFetched += freshEvents.length;
    nextCursor = currentResult?.next;
  }

  const totalPages = pagesFollowed + 1;
  if (pagesFollowed > 0) {
    const pluralSuffix = totalPages > 1 ? "s" : "";
    logger.debug(
      `Pagination summary: ${totalPages} page${pluralSuffix} (${allEvents.length} events)`
    );
  }

  return {
    events: allEvents,
    fetched: totalFetched,
    pages: totalPages,
    nextCursor,
  };
};

export const fetchEvents = async (): Promise<OpenSeaAssetEvent[]> => {
  await eventStateStore.load();
  await resolveLastEventTimestamp();
  await fetchCollectionSlug(TOKEN_ADDRESS ?? "");

  const request = await buildEventsRequest();
  logger.debug(`Events URL: ${request.url}`);
  const summary: FetchSummary = {
    status: "no_events_found",
    fetched: 0,
    processed: 0,
    deduped: 0,
    filteredPrivate: 0,
    filteredLowOffers: 0,
    pages: 0,
    after: request.params.after,
    limit: request.params.limit,
    eventTypes: request.params.eventTypes,
  };
  const startMs = Date.now();
  let finalEvents: OpenSeaAssetEvent[] = [];

  try {
    const result = await openseaGet<OpenSeaEventsResponse>(request.url);

    if (!result) {
      summary.status = "request_failed";
      summary.error = "request_failed";
      return finalEvents;
    }

    if (isEmptyEventsResponse(result)) {
      summary.status = "no_events_found";
      return finalEvents;
    }

    const pagination = await collectPaginatedEvents(result);
    summary.pages = pagination.pages;
    summary.fetched = pagination.fetched;
    summary.nextCursor = pagination.nextCursor;
    if (pagination.error) {
      summary.status = "pagination_failed";
      summary.error = pagination.error;
    }

    const events = pagination.events.reverse();
    summary.oldestTimestamp = events[0]?.event_timestamp;
    summary.newestTimestamp = events.at(-1)?.event_timestamp;
    updateLastEventTimestamp(events);

    const { events: filteredEvents, stats } = processEventFilters(events);
    summary.filteredPrivate = stats.privateFiltered;
    summary.filteredLowOffers = stats.lowValueFiltered;
    summary.deduped = stats.deduped;
    summary.processed = filteredEvents.length;
    if (summary.status !== "pagination_failed") {
      if (filteredEvents.length > 0) {
        summary.status = "events_processed";
      } else if (summary.fetched > 0) {
        summary.status = "all_events_filtered";
      } else {
        summary.status = "no_events_found";
      }
    }
    finalEvents = filteredEvents;

    if (lastEventTimestamp !== undefined) {
      eventStateStore.setCursor({
        source: "opensea-v2",
        next: pagination.nextCursor ?? null,
        lastTimestamp: lastEventTimestamp,
        lastId: null,
      });
    }

    return filteredEvents;
  } finally {
    logFetchSummary(summary, Date.now() - startMs);
    await eventStateStore.flush();
  }
};
