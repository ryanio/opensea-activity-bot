// OpenSea link helpers shared by platforms

export const openseaProfileCollectionUrl = (address: string): string => {
  // Note: Twitter currently uses a fixed collection slug in query.
  // We keep parity here intentionally.
  return `https://opensea.io/${address}?collectionSlugs=glyphbots`;
};

export const openseaProfileTransferActivityUrl = (address: string): string => {
  return `https://opensea.io/${address}/activity?activityTypes=transfer`;
};

export const openseaProfileActivityUrl = (
  address: string,
  activityType: string
): string => {
  return `https://opensea.io/${address}/activity?activityTypes=${activityType}`;
};

export const openseaCollectionActivityUrl = (
  collectionUrl: string,
  activityType?: string
): string => {
  const baseUrl = `${collectionUrl}/activity`;
  if (activityType) {
    return `${baseUrl}?eventTypes=${activityType}`;
  }
  return baseUrl;
};
