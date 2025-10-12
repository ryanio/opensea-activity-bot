import { fetchNFT } from '../opensea';
import type { OpenSeaAssetEvent } from '../types';
import { classifyTransfer } from './utils';

/**
 * Refetches NFT metadata for a single event if it's a mint.
 * Updates the event in place with fresh metadata.
 */
export const refetchMintMetadataForEvent = async (
  event: OpenSeaAssetEvent
): Promise<void> => {
  if (event.event_type !== 'transfer' || classifyTransfer(event) !== 'mint') {
    return;
  }

  const nft = event.nft ?? event.asset;
  if (!nft?.identifier) {
    return;
  }

  try {
    const freshNFT = await fetchNFT(nft.identifier);
    if (freshNFT) {
      if (event.nft) {
        event.nft = freshNFT;
      } else if (event.asset) {
        event.asset = freshNFT;
      }
    }
  } catch {
    // Silent failure - continue with existing data
  }
};

/**
 * Refetches NFT metadata for mint events in a collection.
 * Fresh mints often don't have metadata immediately available.
 * Updates events in place with fresh metadata.
 * @returns Number of mint events that were refetched
 */
export const refetchMintMetadata = async (
  events: OpenSeaAssetEvent[]
): Promise<number> => {
  const mintEvents = events.filter(
    (e) => e.event_type === 'transfer' && classifyTransfer(e) === 'mint'
  );

  if (mintEvents.length === 0) {
    return 0;
  }

  await Promise.all(mintEvents.map(refetchMintMetadataForEvent));
  return mintEvents.length;
};
