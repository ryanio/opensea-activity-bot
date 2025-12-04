import { jest } from "@jest/globals";
import {
  clearChannelsMap,
  createChannelsMap,
  createDiscordMock,
  createOpenSeaMock,
  createTwitterMock,
  createUtilsMock,
  getTweetCalls,
  type MockChannel,
  quickMintEvent,
  quickSaleEvent,
  setupAllPlatformEnv,
  TEST_ADDRESS_1,
  TEST_ADDRESS_2,
} from "../fixtures";

// Basic env required for platform initialization
setupAllPlatformEnv();

const channelsMap: Record<string, MockChannel> = createChannelsMap();

// Minimal Discord.js mock for routing verification
jest.mock("discord.js", () => createDiscordMock(channelsMap));

// Stub utils to avoid real timeouts/network image fetches
jest.mock("../../src/utils/utils", () => createUtilsMock());

// Shared OpenSea mock used by both platforms
jest.mock("../../src/opensea", () => createOpenSeaMock());

// Stable Twitter client mock
jest.mock("twitter-api-v2", () => createTwitterMock());

describe("platform event selection independence", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.resetModules();
    jest.clearAllMocks();
    clearChannelsMap(channelsMap);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("allows Discord and Twitter to listen to different event types independently", async () => {
    // Discord listens only for mints; Twitter listens only for sales
    process.env.DISCORD_EVENTS = "d1=mint";
    process.env.TWITTER_EVENTS = "sale";
    process.env.TWITTER_QUEUE_DELAY_MS = "0";
    process.env.TWITTER_EVENT_GROUP_SETTLE_MS = "60000";
    process.env.TWITTER_EVENT_GROUP_MIN_GROUP_SIZE = "2";

    const baseTimestamp = 1_000_000_000;

    const mintEvent = quickMintEvent("1", TEST_ADDRESS_1, baseTimestamp);
    const saleEvent = quickSaleEvent("2", TEST_ADDRESS_2, baseTimestamp + 1);

    const { messageEvents } = await import(
      "../../src/platforms/discord/discord"
    );
    const { tweetEvents } = await import("../../src/platforms/twitter/twitter");

    const events = [mintEvent, saleEvent];

    // Twitter processes only the sale event
    tweetEvents(events);
    // Discord processes only the mint event
    await messageEvents(events);

    await jest.runAllTimersAsync();

    const tweetCalls = getTweetCalls();

    // Only the sale should be tweeted
    expect(tweetCalls.length).toBe(1);
    expect(tweetCalls[0].text.toLowerCase()).toContain("purchased");

    // Only the mint should be sent to Discord
    expect(channelsMap.d1.send).toHaveBeenCalledTimes(1);
  });
});
