// OpenSea link helpers shared by platforms

export const openseaProfileCollectionUrl = (address: string): string => {
  // Note: Twitter currently uses a fixed collection slug in query.
  // We keep parity here intentionally.
  return `https://opensea.io/${address}?collectionSlugs=glyphbots`;
};

export const openseaProfileTransferActivityUrl = (address: string): string => {
  return `https://opensea.io/${address}/activity?activityTypes=transfer`;
};

export const openseaCollectionActivityUrl = (collectionUrl: string): string => {
  return `${collectionUrl}/activity`;
};
