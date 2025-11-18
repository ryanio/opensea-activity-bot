import {
  DEAD_ADDRESS,
  NULL_ADDRESS,
  NULL_ONE_ADDRESS,
} from "../../src/utils/constants";
import { classifyTransfer } from "../../src/utils/utils";

describe("classifyTransfer", () => {
  test("returns mint when from is NULL_ADDRESS", () => {
    const kind = classifyTransfer({
      event_type: "transfer",
      from_address: NULL_ADDRESS,
      to_address: "0x123",
    });
    expect(kind).toBe("mint");
  });

  test("returns burn when to is NULL_ADDRESS", () => {
    const kind = classifyTransfer({
      event_type: "transfer",
      from_address: "0xabc",
      to_address: NULL_ADDRESS,
    });
    expect(kind).toBe("burn");
  });

  test("returns burn when to is DEAD_ADDRESS", () => {
    const kind = classifyTransfer({
      event_type: "transfer",
      from_address: "0xabc",
      to_address: DEAD_ADDRESS,
    });
    expect(kind).toBe("burn");
  });

  test("returns burn when to is NULL_ONE_ADDRESS", () => {
    const kind = classifyTransfer({
      event_type: "transfer",
      from_address: "0xabc",
      to_address: NULL_ONE_ADDRESS,
    });
    expect(kind).toBe("burn");
  });

  test("case-insensitive addresses", () => {
    const kind = classifyTransfer({
      event_type: "transfer",
      from_address: NULL_ADDRESS.toUpperCase(),
      to_address: "0x123",
    });
    expect(kind).toBe("mint");
  });

  test("defaults to transfer when not mint/burn or missing fields", () => {
    expect(classifyTransfer({ event_type: "transfer" })).toBe("transfer");
    expect(
      classifyTransfer({
        event_type: "transfer",
        from_address: "0x1",
        to_address: "0x2",
      })
    ).toBe("transfer");
    // Non-transfer event types should not classify
    expect(
      classifyTransfer({ event_type: "sale", from_address: NULL_ADDRESS })
    ).toBe("transfer");
  });
});
