import { EventGroupAggregator } from "../src/utils/aggregator";

const mk = (tx: string, id: number) => ({
  transaction_hash: tx,
  event_timestamp: id,
  nft: { identifier: id },
});

describe("EventGroupAggregator", () => {
  it("groups by tx and flushes after settleMs with min size", async () => {
    const agg = new EventGroupAggregator({ settleMs: 10, minGroupSize: 3 });
    agg.add([mk("0xabc", 1), mk("0xabc", 2)]);
    let ready = agg.flushReady();
    expect(ready.length).toBe(0);
    const THIRD_ID = 3;
    agg.add([mk("0xabc", THIRD_ID)]);
    const SETTLE_WAIT_MS = 15;
    await new Promise((r) => setTimeout(r, SETTLE_WAIT_MS));
    ready = agg.flushReady();
    expect(ready.length).toBe(1);
    const EXPECT_GROUP_SIZE = 3;
    expect(ready[0].events.length).toBe(EXPECT_GROUP_SIZE);
  });
});
