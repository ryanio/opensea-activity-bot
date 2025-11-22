import type { OpenSeaAssetEvent } from "../types";
import { txHashFor } from "./aggregator";
import { effectiveEventTypeFor } from "./event-types";
import { chain } from "./utils";

export const canonicalEventKeyFor = (event: OpenSeaAssetEvent): string => {
  const nft = event.nft ?? event.asset;
  const tokenId = String(nft?.identifier ?? "");
  const canonicalType = String(effectiveEventTypeFor(event));

  const txHash = txHashFor(event);
  const txHashOrIndex =
    txHash ??
    `nohash:${String(event.order_hash ?? "")}:${tokenId}:${String(
      event.quantity ?? ""
    )}`;

  const contract = (
    nft?.contract ??
    process.env.TOKEN_ADDRESS ??
    ""
  ).toLowerCase();
  const timestamp = event.event_timestamp;

  return [
    chain,
    contract,
    tokenId,
    canonicalType,
    txHashOrIndex,
    String(timestamp),
  ].join("|");
};
