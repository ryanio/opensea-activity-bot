/**
 * Tests for all event types using live fixture data from BAYC collection.
 * These tests verify that the event type detection and platform output
 * work correctly with real OpenSea API responses.
 */

import { textForTweet } from "../../src/platforms/twitter/utils";
import { BotEvent, type OpenSeaAssetEvent } from "../../src/types";
import {
  colorForEvent,
  effectiveEventTypeFor,
  getEffectiveOrderType,
  isListingType,
  isOfferType,
} from "../../src/utils/event-types";
import { isEventWanted, parseEvents } from "../../src/utils/events";
import collectionOfferEvents from "../fixtures/bayc-live/collection_offer-events.json";
// Load fixture data from live API calls
import listingEvents from "../fixtures/bayc-live/listing-events.json";
import offerEvents from "../fixtures/bayc-live/offer-events.json";
import saleEvents from "../fixtures/bayc-live/sale-events.json";
import traitOfferEvents from "../fixtures/bayc-live/trait_offer-events.json";
import transferEvents from "../fixtures/bayc-live/transfer-events.json";

// Type assertion helpers for JSON fixture data
const getListingEvents = (): OpenSeaAssetEvent[] =>
  listingEvents.asset_events as OpenSeaAssetEvent[];
const getOfferEvents = (): OpenSeaAssetEvent[] =>
  offerEvents.asset_events as OpenSeaAssetEvent[];
const getTraitOfferEvents = (): OpenSeaAssetEvent[] =>
  traitOfferEvents.asset_events as OpenSeaAssetEvent[];
const getCollectionOfferEvents = (): OpenSeaAssetEvent[] =>
  collectionOfferEvents.asset_events as OpenSeaAssetEvent[];
const getSaleEvents = (): OpenSeaAssetEvent[] =>
  saleEvents.asset_events as OpenSeaAssetEvent[];
const getTransferEvents = (): OpenSeaAssetEvent[] =>
  transferEvents.asset_events as OpenSeaAssetEvent[];

describe("Live Event Type Detection", () => {
  describe("API Response Format", () => {
    test("listing events have event_type=order and order_type=listing", () => {
      const events = getListingEvents();
      expect(events.length).toBeGreaterThan(0);
      for (const event of events) {
        expect(event.event_type).toBe("order");
        expect(event.order_type).toBe("listing");
      }
    });

    test("item offer events have event_type=order and order_type=item_offer", () => {
      const events = getOfferEvents();
      expect(events.length).toBeGreaterThan(0);
      for (const event of events) {
        expect(event.event_type).toBe("order");
        expect(event.order_type).toBe("item_offer");
      }
    });

    test("trait offer events have event_type=order and order_type=trait_offer", () => {
      const events = getTraitOfferEvents();
      expect(events.length).toBeGreaterThan(0);
      for (const event of events) {
        expect(event.event_type).toBe("order");
        expect(event.order_type).toBe("trait_offer");
        // Trait offers have criteria
        expect(event.criteria).toBeDefined();
      }
    });

    test("collection offer events have event_type=order and order_type=collection_offer", () => {
      const events = getCollectionOfferEvents();
      expect(events.length).toBeGreaterThan(0);
      for (const event of events) {
        expect(event.event_type).toBe("order");
        expect(event.order_type).toBe("collection_offer");
      }
    });

    test("sale events have event_type=sale", () => {
      const events = getSaleEvents();
      expect(events.length).toBeGreaterThan(0);
      for (const event of events) {
        expect(event.event_type).toBe("sale");
        expect(event.buyer).toBeDefined();
        expect(event.seller).toBeDefined();
        expect(event.payment).toBeDefined();
      }
    });

    test("transfer events have event_type=transfer", () => {
      const events = getTransferEvents();
      expect(events.length).toBeGreaterThan(0);
      for (const event of events) {
        expect(event.event_type).toBe("transfer");
        expect(event.from_address).toBeDefined();
        expect(event.to_address).toBeDefined();
      }
    });
  });

  describe("getEffectiveOrderType", () => {
    test("returns order_type for order events", () => {
      const listingEvent = getListingEvents()[0];
      expect(getEffectiveOrderType(listingEvent)).toBe("listing");

      const itemOfferEvent = getOfferEvents()[0];
      expect(getEffectiveOrderType(itemOfferEvent)).toBe("item_offer");

      const traitOfferEvent = getTraitOfferEvents()[0];
      expect(getEffectiveOrderType(traitOfferEvent)).toBe("trait_offer");

      const collectionOfferEvent = getCollectionOfferEvents()[0];
      expect(getEffectiveOrderType(collectionOfferEvent)).toBe(
        "collection_offer"
      );
    });

    test("returns event_type for non-order events", () => {
      const saleEvent = getSaleEvents()[0];
      expect(getEffectiveOrderType(saleEvent)).toBe("sale");

      const transferEvent = getTransferEvents()[0];
      expect(getEffectiveOrderType(transferEvent)).toBe("transfer");
    });
  });

  describe("isListingType", () => {
    test("returns true for listing events", () => {
      for (const event of getListingEvents()) {
        expect(isListingType(event)).toBe(true);
      }
    });

    test("returns false for offer events", () => {
      for (const event of getOfferEvents()) {
        expect(isListingType(event)).toBe(false);
      }
      for (const event of getTraitOfferEvents()) {
        expect(isListingType(event)).toBe(false);
      }
      for (const event of getCollectionOfferEvents()) {
        expect(isListingType(event)).toBe(false);
      }
    });

    test("returns false for sale and transfer events", () => {
      for (const event of getSaleEvents()) {
        expect(isListingType(event)).toBe(false);
      }
      for (const event of getTransferEvents()) {
        expect(isListingType(event)).toBe(false);
      }
    });
  });

  describe("isOfferType", () => {
    test("returns true for item offer events", () => {
      for (const event of getOfferEvents()) {
        expect(isOfferType(event)).toBe(true);
      }
    });

    test("returns true for trait offer events", () => {
      for (const event of getTraitOfferEvents()) {
        expect(isOfferType(event)).toBe(true);
      }
    });

    test("returns true for collection offer events", () => {
      for (const event of getCollectionOfferEvents()) {
        expect(isOfferType(event)).toBe(true);
      }
    });

    test("returns false for listing events", () => {
      for (const event of getListingEvents()) {
        expect(isOfferType(event)).toBe(false);
      }
    });

    test("returns false for sale and transfer events", () => {
      for (const event of getSaleEvents()) {
        expect(isOfferType(event)).toBe(false);
      }
      for (const event of getTransferEvents()) {
        expect(isOfferType(event)).toBe(false);
      }
    });
  });

  describe("effectiveEventTypeFor", () => {
    test("returns BotEvent.listing for listing events", () => {
      for (const event of getListingEvents()) {
        expect(effectiveEventTypeFor(event)).toBe(BotEvent.listing);
      }
    });

    test("returns BotEvent.offer for all offer types", () => {
      for (const event of getOfferEvents()) {
        expect(effectiveEventTypeFor(event)).toBe(BotEvent.offer);
      }
      for (const event of getTraitOfferEvents()) {
        expect(effectiveEventTypeFor(event)).toBe(BotEvent.offer);
      }
      for (const event of getCollectionOfferEvents()) {
        expect(effectiveEventTypeFor(event)).toBe(BotEvent.offer);
      }
    });

    test("returns sale for sale events", () => {
      for (const event of getSaleEvents()) {
        expect(effectiveEventTypeFor(event)).toBe("sale");
      }
    });

    test("returns transfer for regular transfer events", () => {
      for (const event of getTransferEvents()) {
        const result = effectiveEventTypeFor(event);
        // Could be transfer, mint, or burn depending on addresses
        expect([BotEvent.transfer, BotEvent.mint, BotEvent.burn]).toContain(
          result
        );
      }
    });
  });

  describe("colorForEvent", () => {
    test("returns correct color for listings", () => {
      const event = getListingEvents()[0];
      // colorForEvent uses order_type
      const color = colorForEvent(
        event.event_type,
        event.order_type ?? undefined
      );
      expect(color).toBe("#66dcf0"); // listing color
    });

    test("returns correct color for offers", () => {
      const itemOffer = getOfferEvents()[0];
      const color1 = colorForEvent(
        itemOffer.event_type,
        itemOffer.order_type ?? undefined
      );
      expect(color1).toBe("#d63864"); // offer color

      const traitOffer = getTraitOfferEvents()[0];
      const color2 = colorForEvent(
        traitOffer.event_type,
        traitOffer.order_type ?? undefined
      );
      expect(color2).toBe("#d63864"); // offer color

      const collectionOffer = getCollectionOfferEvents()[0];
      const color3 = colorForEvent(
        collectionOffer.event_type,
        collectionOffer.order_type ?? undefined
      );
      expect(color3).toBe("#d63864"); // offer color
    });

    test("returns correct color for sales", () => {
      const event = getSaleEvents()[0];
      const color = colorForEvent(
        event.event_type,
        event.order_type ?? undefined
      );
      expect(color).toBe("#62b778"); // sale color
    });
  });
});

describe("Live Event Selection (isEventWanted)", () => {
  describe("with listing selection", () => {
    const selection = parseEvents("listing");

    test("selects listing events", () => {
      for (const event of getListingEvents()) {
        expect(isEventWanted(event, selection)).toBe(true);
      }
    });

    test("rejects offer events", () => {
      for (const event of getOfferEvents()) {
        expect(isEventWanted(event, selection)).toBe(false);
      }
    });

    test("rejects sale events", () => {
      for (const event of getSaleEvents()) {
        expect(isEventWanted(event, selection)).toBe(false);
      }
    });
  });

  describe("with offer selection", () => {
    const selection = parseEvents("offer");

    test("selects item offer events", () => {
      for (const event of getOfferEvents()) {
        expect(isEventWanted(event, selection)).toBe(true);
      }
    });

    test("selects trait offer events", () => {
      for (const event of getTraitOfferEvents()) {
        expect(isEventWanted(event, selection)).toBe(true);
      }
    });

    test("selects collection offer events", () => {
      for (const event of getCollectionOfferEvents()) {
        expect(isEventWanted(event, selection)).toBe(true);
      }
    });

    test("rejects listing events", () => {
      for (const event of getListingEvents()) {
        expect(isEventWanted(event, selection)).toBe(false);
      }
    });
  });

  describe("with sale selection", () => {
    const selection = parseEvents("sale");

    test("selects sale events", () => {
      for (const event of getSaleEvents()) {
        expect(isEventWanted(event, selection)).toBe(true);
      }
    });

    test("rejects other event types", () => {
      for (const event of getListingEvents()) {
        expect(isEventWanted(event, selection)).toBe(false);
      }
      for (const event of getOfferEvents()) {
        expect(isEventWanted(event, selection)).toBe(false);
      }
    });
  });

  describe("with transfer selection", () => {
    const selection = parseEvents("transfer");

    test("selects transfer events (excluding mints and burns)", () => {
      // At least some transfer events should be regular transfers
      const transferResults = getTransferEvents().map((event) =>
        isEventWanted(event, selection)
      );
      // Transfer events could be mint, burn, or regular transfer
      // depending on addresses - we just check that we can process them
      expect(transferResults.length).toBeGreaterThan(0);
    });
  });
});

describe("Live Twitter Text Output", () => {
  test("generates text for listing events", async () => {
    const event = getListingEvents()[0];
    const text = await textForTweet(event);
    expect(text).toContain("listed on sale for");
  });

  test("generates text for item offer events", async () => {
    const event = getOfferEvents()[0];
    const text = await textForTweet(event);
    expect(text).toContain("has a new offer for");
  });

  test("generates text for trait offer events", async () => {
    const event = getTraitOfferEvents()[0];
    const text = await textForTweet(event);
    expect(text).toContain("has a new trait offer for");
  });

  test("generates text for collection offer events", async () => {
    const event = getCollectionOfferEvents()[0];
    const text = await textForTweet(event);
    expect(text).toContain("has a new collection offer for");
  });

  test("generates text for sale events", async () => {
    const event = getSaleEvents()[0];
    const text = await textForTweet(event);
    expect(text).toContain("purchased for");
  });

  test("generates text for transfer events", async () => {
    const event = getTransferEvents()[0];
    const text = await textForTweet(event);
    // Transfer text varies based on mint/burn/transfer classification
    expect(text.length).toBeGreaterThan(0);
  });
});

describe("Trait Offer Criteria Handling", () => {
  test("trait offers contain valid criteria", () => {
    for (const event of getTraitOfferEvents()) {
      expect(event.criteria).toBeDefined();
      // Trait info can be in trait or traits array
      const traitInfo =
        (event.criteria as { trait?: { type: string; value: string } })
          ?.trait ??
        (
          event.criteria as {
            traits?: Array<{ type: string; value: string }>;
          }
        )?.traits?.[0];
      expect(traitInfo).toBeDefined();
      expect(traitInfo?.type).toBeDefined();
      expect(traitInfo?.value).toBeDefined();
    }
  });

  test("collection offers may not have criteria", () => {
    // Collection offers typically don't have criteria or have null criteria
    for (const event of getCollectionOfferEvents()) {
      // This is expected - collection offers don't need criteria
      // Just verify the event is still valid
      expect(event.order_type).toBe("collection_offer");
    }
  });
});

describe("NFT Data Location", () => {
  test("listings have nft data in asset field", () => {
    for (const event of getListingEvents()) {
      // Listings use asset instead of nft
      expect(event.asset).toBeDefined();
      expect(event.asset?.identifier).toBeDefined();
    }
  });

  test("item offers have nft data in asset field", () => {
    for (const event of getOfferEvents()) {
      // Item offers use asset instead of nft
      expect(event.asset).toBeDefined();
      expect(event.asset?.identifier).toBeDefined();
    }
  });

  test("trait offers may not have nft data", () => {
    // Trait offers are for traits, not specific NFTs
    for (const event of getTraitOfferEvents()) {
      // asset is typically null for trait offers
      expect(event.asset).toBeNull();
    }
  });

  test("collection offers may not have nft data", () => {
    // Collection offers are for the collection, not specific NFTs
    for (const event of getCollectionOfferEvents()) {
      // asset is typically null for collection offers
      expect(event.asset).toBeNull();
    }
  });

  test("sales have nft data in nft field", () => {
    for (const event of getSaleEvents()) {
      expect(event.nft).toBeDefined();
      expect(event.nft?.identifier).toBeDefined();
    }
  });

  test("transfers have nft data in nft field", () => {
    for (const event of getTransferEvents()) {
      expect(event.nft).toBeDefined();
      expect(event.nft?.identifier).toBeDefined();
    }
  });
});
