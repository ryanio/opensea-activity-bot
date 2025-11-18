// OpenSea link helpers shared by platforms

export const openseaProfileCollectionUrl = (
  address: string,
  collectionSlug: string
): string =>
  `https://opensea.io/${address}/items?collectionSlugs=${collectionSlug}`;

export const openseaProfileActivityUrl = (
  address: string,
  activityType: string
): string =>
  `https://opensea.io/${address}/activity?activityTypes=${activityType}`;

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
