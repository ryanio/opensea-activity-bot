import { EventType } from "../../src/opensea";
import { BotEvent, type OpenSeaAssetEvent } from "../../src/types";
import {
  colorForEvent,
  effectiveEventTypeFor,
} from "../../src/utils/event-types";

describe("effectiveEventTypeFor", () => {
  const base: Partial<OpenSeaAssetEvent> = {
    event_type: "listing",
    event_timestamp: 1,
    chain: "ethereum",
    quantity: 1,
  };

  test("listing remains listing", () => {
    const ev = { ...base } as OpenSeaAssetEvent;
    expect(effectiveEventTypeFor(ev)).toBe(BotEvent.listing);
  });

  test("offer remains offer", () => {
    const ev = { ...base, event_type: "offer" } as OpenSeaAssetEvent;
    expect(effectiveEventTypeFor(ev)).toBe(BotEvent.offer);
  });

  test("transfer remains transfer when normal", () => {
    const ev = {
      event_type: "transfer",
      event_timestamp: 1,
      chain: "ethereum",
      quantity: 1,
      from_address: "0x1",
      to_address: "0x2",
    } as OpenSeaAssetEvent;
    expect(effectiveEventTypeFor(ev)).toBe(EventType.transfer);
  });
});

describe("colorForEvent", () => {
  test("returns expected colors", () => {
    expect(colorForEvent(BotEvent.listing, undefined)).toBe("#66dcf0");
    expect(colorForEvent(BotEvent.offer, undefined)).toBe("#d63864");
    expect(colorForEvent(EventType.sale, undefined)).toBe("#62b778");
    expect(colorForEvent(EventType.transfer, undefined)).toBe("#5296d5");
    expect(colorForEvent(BotEvent.mint, undefined)).toBe("#2ecc71");
    expect(colorForEvent(BotEvent.burn, undefined)).toBe("#e74c3c");
  });
});
