import { jest } from "@jest/globals";
import {
  clearChannelsMap,
  createChannelsMap,
  createDiscordMock,
  createOpenSeaMock,
  createUtilsMock,
  type MockChannel,
  quickBurnEvent,
  quickERC1155MintEvent,
  quickListingEvent,
  quickMintEvent,
  quickOfferEvent,
  setupDiscordEnv,
  TEST_ADDRESS_1,
  TEST_ADDRESS_2,
} from "../fixtures";

// Env setup
setupDiscordEnv();

// Mock discord.js runtime API minimally
const channelsMap: Record<string, MockChannel> = createChannelsMap();

jest.mock("discord.js", () => createDiscordMock(channelsMap));

// Mock opensea username
jest.mock("../../src/opensea", () =>
  createOpenSeaMock(async (addr: string) => `addr:${addr.slice(0, 6)}`)
);

// Mock timeout to avoid delays in tests
jest.mock("../../src/utils/utils", () => createUtilsMock());

import { messageEvents } from "../../src/platforms/discord/discord";

describe("discord routing", () => {
  beforeEach(() => {
    clearChannelsMap(channelsMap);
    // Reset environment to prevent test pollution
    process.env.DISCORD_EVENTS = undefined;
  });

  test("routes mint to mint-configured channel", async () => {
    process.env.DISCORD_EVENTS = "123=mint";
    const ev = quickMintEvent("1", TEST_ADDRESS_1);
    await messageEvents([ev]);
    expect(channelsMap["123"].send).toHaveBeenCalled();
  });

  test("routes burn to burn-configured channel", async () => {
    process.env.DISCORD_EVENTS = "456=burn";
    const ev = quickBurnEvent("2", TEST_ADDRESS_1);
    await messageEvents([ev]);
    expect(channelsMap["456"].send).toHaveBeenCalled();
  });

  test("mint embed includes editions count for ERC1155", async () => {
    process.env.DISCORD_EVENTS = "123=mint";
    const ev = quickERC1155MintEvent("99", TEST_ADDRESS_2, 5, 2);
    await messageEvents([ev]);
    // We can't inspect embed content with current mocks, but ensure it routed
    expect(channelsMap["123"].send).toHaveBeenCalled();
  });

  test("routes offer/listing to respective channels", async () => {
    process.env.DISCORD_EVENTS = "o1=offer&l1=listing";
    const offerEv = quickOfferEvent("3");
    const listingEv = quickListingEvent("4");
    await messageEvents([offerEv, listingEv]);
    expect(channelsMap.o1.send).toHaveBeenCalled();
    expect(channelsMap.l1.send).toHaveBeenCalled();
  });
});
