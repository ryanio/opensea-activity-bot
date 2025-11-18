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
    expect(colorForEvent("listing" as unknown as EventType, "")).toBe(
      "#66dcf0"
    );
    expect(colorForEvent("offer" as unknown as EventType, "")).toBe("#d63864");
    expect(colorForEvent(EventType.sale, "")).toBe("#62b778");
    expect(colorForEvent(EventType.transfer, "")).toBe("#5296d5");
    expect(colorForEvent(BotEvent.mint as unknown as EventType, "")).toBe(
      "#2ecc71"
    );
    expect(colorForEvent(BotEvent.burn as unknown as EventType, "")).toBe(
      "#e74c3c"
    );
  });
});
