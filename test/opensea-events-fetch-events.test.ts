import type { OpenSeaAssetEvent } from "../src/types";

jest.mock("../src/utils/logger", () => {
  const base = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  return {
    logger: base,
    prefixedLogger: () => base,
  };
});

describe("fetchEvents (OpenSea)", () => {
  const ORIGINAL_ENV = { ...process.env };
  type MockedLogger = {
    debug: jest.Mock;
    info: jest.Mock;
    warn: jest.Mock;
    error: jest.Mock;
  };
  let loggerMock: MockedLogger;

  beforeEach(() => {
    jest.resetModules();
    loggerMock = jest.requireMock("../src/utils/logger").logger as MockedLogger;
    process.env = { ...ORIGINAL_ENV };
    process.env.LOG_LEVEL = "error";
    process.env.TOKEN_ADDRESS = "0xTestToken";
    process.env.CHAIN = "ethereum";
    process.env.LAST_EVENT_TIMESTAMP = "0";
    process.env.OPENSEA_API_TOKEN = "test";
    process.env.TWITTER_EVENTS = "sale";

    (global.fetch as unknown as jest.Mock) = jest.fn();
    loggerMock.info.mockReset();
    loggerMock.debug.mockReset();
    loggerMock.warn.mockReset();
    loggerMock.error.mockReset();
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  const setupFetchMockForLagWindow = (eventsDb: OpenSeaAssetEvent[]) => {
    (global.fetch as unknown as jest.Mock).mockImplementation((url: string) => {
      if (url.includes("/chain/") && url.includes("/contract/")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ collection: "test-collection" }),
        } as Response);
      }

      if (url.includes("/events/collection/")) {
        const parsed = new URL(url);
        const after = Number(parsed.searchParams.get("after") ?? "0");
        const limit = Number(parsed.searchParams.get("limit") ?? "200");

        const filtered = eventsDb
          .filter((e) => e.event_timestamp > after)
          .sort((a, b) => b.event_timestamp - a.event_timestamp);

        const page = filtered.slice(0, limit);

        return Promise.resolve({
          ok: true,
          json: async () => ({
            asset_events: page,
          }),
        } as Response);
      }

      return Promise.reject(new Error(`Unexpected fetch URL in test: ${url}`));
    });
  };

  it("uses lag safety window so late events with older timestamps are not missed", async () => {
    process.env.OPENSEA_EVENT_LAG_WINDOW = "120";

    const firstEvent: OpenSeaAssetEvent = {
      event_type: "sale",
      event_timestamp: 1000,
      chain: "ethereum",
      quantity: 1,
      nft: {
        identifier: "1",
        collection: "glyphbots",
        contract: "0xTestToken",
        token_standard: "erc721",
        name: "Test NFT #1",
        description: "",
        image_url: "",
        display_image_url: "",
        display_animation_url: null,
        metadata_url: null,
        opensea_url: "",
        updated_at: "",
        is_disabled: false,
        is_nsfw: false,
      },
      payment: {
        quantity: "1000000000000000000",
        token_address: "0x0000000000000000000000000000000000000000",
        decimals: 18,
        symbol: "ETH",
      },
      transaction: "0xfirst",
    };

    const baseNft = firstEvent.nft as NonNullable<OpenSeaAssetEvent["nft"]>;
    const lateEvent: OpenSeaAssetEvent = {
      ...firstEvent,
      event_timestamp: 950,
      nft: {
        ...baseNft,
        identifier: "2",
        name: "Test NFT #2",
      },
      transaction: "0xlate",
    };

    let eventsDb: OpenSeaAssetEvent[] = [firstEvent];
    setupFetchMockForLagWindow(eventsDb);

    const { fetchEvents } = await import("../src/opensea");

    const firstFetch = await fetchEvents();
    expect(firstFetch).toHaveLength(1);
    expect(firstFetch[0].event_timestamp).toBe(1000);

    eventsDb = [firstEvent, lateEvent];
    setupFetchMockForLagWindow(eventsDb);

    const secondFetch = await fetchEvents();
    const timestamps = secondFetch.map((e) => e.event_timestamp);
    expect(timestamps).toEqual([950]);
  });

  it("includes multiple distinct sales in the same second with different tx hashes", async () => {
    process.env.OPENSEA_EVENT_LAG_WINDOW = "0";

    const baseEvent: OpenSeaAssetEvent = {
      event_type: "sale",
      event_timestamp: 2000,
      chain: "ethereum",
      quantity: 1,
      nft: {
        identifier: "10",
        collection: "glyphbots",
        contract: "0xTestToken",
        token_standard: "erc721",
        name: "Test NFT #10",
        description: "",
        image_url: "",
        display_image_url: "",
        display_animation_url: null,
        metadata_url: null,
        opensea_url: "",
        updated_at: "",
        is_disabled: false,
        is_nsfw: false,
      },
      payment: {
        quantity: "1000000000000000000",
        token_address: "0x0000000000000000000000000000000000000000",
        decimals: 18,
        symbol: "ETH",
      },
      transaction: "0xbase",
    };

    const saleA: OpenSeaAssetEvent = {
      ...baseEvent,
      transaction: "0xsaleA",
    };

    const saleB: OpenSeaAssetEvent = {
      ...baseEvent,
      transaction: "0xsaleB",
    };

    const eventsDb: OpenSeaAssetEvent[] = [saleA, saleB];
    setupFetchMockForLagWindow(eventsDb);

    const { fetchEvents } = await import("../src/opensea");

    const events = await fetchEvents();
    expect(events).toHaveLength(2);
    const txs = events.map((e) => e.transaction);
    expect(txs).toContain("0xsaleA");
    expect(txs).toContain("0xsaleB");
  });

  it("requests transfer events when mint tracking is enabled", async () => {
    process.env.TWITTER_EVENTS = "mint";
    const baseMint: OpenSeaAssetEvent = {
      event_type: "transfer",
      event_timestamp: 3000,
      chain: "ethereum",
      quantity: 1,
      nft: {
        identifier: "77",
        collection: "glyphbots",
        contract: "0xTestToken",
        token_standard: "erc1155",
        name: "Minted NFT",
        description: "",
        image_url: "",
        display_image_url: "",
        display_animation_url: null,
        metadata_url: null,
        opensea_url: "",
        updated_at: "",
        is_disabled: false,
        is_nsfw: false,
      },
      payment: undefined,
      transaction: "0xmintTx",
      from_address: "0x0000000000000000000000000000000000000000",
      to_address: "0xabc",
    };

    setupFetchMockForLagWindow([baseMint]);
    const { fetchEvents } = await import("../src/opensea");
    await fetchEvents();

    const fetchCalls = (global.fetch as unknown as jest.Mock).mock.calls;
    const eventsCall = fetchCalls.find(
      ([url]) => typeof url === "string" && url.includes("/events/collection/")
    ) as [string];
    expect(eventsCall).toBeDefined();
    expect(eventsCall[0]).toContain("event_type=mint");
    expect(eventsCall[0]).toContain("event_type=transfer");
  });

  it("logs fetch summary stats showing deduped events when no new data arrives", async () => {
    const baseEvent: OpenSeaAssetEvent = {
      event_type: "sale",
      event_timestamp: 4000,
      chain: "ethereum",
      quantity: 1,
      nft: {
        identifier: "99",
        collection: "glyphbots",
        contract: "0xTestToken",
        token_standard: "erc721",
        name: "Test NFT #99",
        description: "",
        image_url: "",
        display_image_url: "",
        display_animation_url: null,
        metadata_url: null,
        opensea_url: "",
        updated_at: "",
        is_disabled: false,
        is_nsfw: false,
      },
      payment: {
        quantity: "5000000000000000",
        token_address: "0x0000000000000000000000000000000000000000",
        decimals: 18,
        symbol: "ETH",
      },
      transaction: "0xrepeat",
    };

    setupFetchMockForLagWindow([baseEvent]);
    const { fetchEvents } = await import("../src/opensea");
    await fetchEvents();
    loggerMock.info.mockClear();

    setupFetchMockForLagWindow([baseEvent]);
    await fetchEvents();

    const infoMessages = loggerMock.info.mock.calls.map((args) =>
      args.filter((arg): arg is string => typeof arg === "string").join(" ")
    );
    const summaryLog = infoMessages.find((msg) =>
      msg.includes("[FetchSummary]")
    );

    expect(summaryLog).toBeDefined();
    expect(summaryLog).toContain("status=all_events_filtered");
    expect(summaryLog).toContain("filtered=1");
    expect(summaryLog).toContain("processed=0");
  });
});
