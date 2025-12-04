import { jest } from "@jest/globals";
import type { OpenSeaAssetEvent } from "../../src/types";
import {
  DEAD_ADDRESS,
  minimalNFT,
  quickBurnEvent,
  quickERC1155MintEvent,
  quickMintEvent,
  quickTransferEvent,
  TEST_ADDRESS_1,
  TEST_ADDRESS_2,
  TEST_BURNER,
} from "../fixtures";

// Minimal env
process.env.TOKEN_ADDRESS = "0x0000000000000000000000000000000000000000";

// stub username to a fixed label for deterministic assertions
jest.mock("../../src/opensea", () => ({
  EventType: {
    listing: "listing",
    offer: "offer",
    trait_offer: "trait_offer",
    collection_offer: "collection_offer",
    mint: "mint",
    sale: "sale",
    transfer: "transfer",
  },
  opensea: { collectionURL: () => "" },
  username: jest.fn(async (addr: string) => `addr:${addr.slice(0, 6)}`),
}));

import { EventType } from "../../src/opensea";

describe("twitter text generation", () => {
  test('mint text includes name and "minted by"', async () => {
    const mod = await import("../../src/platforms/twitter/utils");
    const e: OpenSeaAssetEvent = {
      ...quickMintEvent("1", "0xaaaaaa0000000000000000000000000000000000"),
      nft: minimalNFT("1", { name: "Foo" }),
    } as OpenSeaAssetEvent;
    const text = await mod.textForTweet(e);
    expect(text).toContain("Foo minted by addr:0xaaaa");
  });

  test("erc1155 mint includes editions count when quantity > 1", async () => {
    const mod = await import("../../src/platforms/twitter/utils");
    const e: OpenSeaAssetEvent = {
      ...quickERC1155MintEvent(
        "10",
        "0xeeeeee0000000000000000000000000000000000",
        3
      ),
      nft: minimalNFT("10", { name: "Editions", token_standard: "erc1155" }),
    } as OpenSeaAssetEvent;
    const text = await mod.textForTweet(e);
    expect(text).toContain("(3 editions)");
  });

  test('burn text includes name and "burned by"', async () => {
    const mod = await import("../../src/platforms/twitter/utils");
    const e: OpenSeaAssetEvent = {
      ...quickBurnEvent("2", TEST_BURNER),
      nft: minimalNFT("2", { name: "Bar" }),
    } as OpenSeaAssetEvent;
    const text = await mod.textForTweet(e);
    expect(text).toContain("Bar burned by addr:0xbbbb");
  });

  test("burn text uses formatted name for glyphbots", async () => {
    // Set the TOKEN_ADDRESS to glyphbots contract
    const originalTokenAddress = process.env.TOKEN_ADDRESS;
    process.env.TOKEN_ADDRESS = "0xb6c2c2d2999c1b532e089a7ad4cb7f8c91cf5075";

    // Re-import module to pick up new env var
    jest.resetModules();
    const mod = await import("../../src/platforms/twitter/utils");
    const e: OpenSeaAssetEvent = {
      event_type: EventType.transfer,
      event_timestamp: 1,
      chain: "ethereum",
      quantity: 1,
      nft: minimalNFT("9573", {
        name: "GlyphBot #9573 - Twisty the Wise",
        opensea_url:
          "https://opensea.io/assets/ethereum/0xb6c2c2d2999c1b532e089a7ad4cb7f8c91cf5075/9573",
      }),
      from_address: TEST_BURNER,
      to_address: DEAD_ADDRESS,
    } as OpenSeaAssetEvent;
    const text = await mod.textForTweet(e);
    // Should use formatted name "Twisty the Wise #9573" instead of full name
    expect(text).toContain("Twisty the Wise #9573 burned by addr:0xbbbb");
    expect(text).not.toContain("GlyphBot #9573 - Twisty the Wise");

    // Restore original TOKEN_ADDRESS
    process.env.TOKEN_ADDRESS = originalTokenAddress;
  });

  test("transfer text includes from/to usernames", async () => {
    const mod = await import("../../src/platforms/twitter/utils");
    const e = quickTransferEvent("3", TEST_ADDRESS_1, TEST_ADDRESS_2);
    const text = await mod.textForTweet(e);
    expect(text).toContain("transferred from addr:0x1111 to addr:0x2222");
  });
});
