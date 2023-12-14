import { URLSearchParams } from 'url'
import { channelsWithEvents } from './discord'
import { chain, logStart, minOfferETH, openseaGet, unixTimestamp } from './util'
import { FixedNumber } from 'ethers'

const {
  OPENSEA_API_TOKEN,
  TOKEN_ADDRESS,
  TWITTER_EVENTS,
  LAST_EVENT_TIMESTAMP,
  QUERY_LIMIT,
} = process.env

let lastEventTimestamp = unixTimestamp(new Date())
if (LAST_EVENT_TIMESTAMP) {
  console.log(`${logStart}Using LAST_EVENT_TIMESTAMP: ${LAST_EVENT_TIMESTAMP}`)
  lastEventTimestamp = parseInt(LAST_EVENT_TIMESTAMP)
}

export const opensea = {
  api: 'https://api.opensea.io/api/v2/',
  collectionURL: () => `https://opensea.io/collection/${collectionSlug}`,
  getEvents: () => `${opensea.api}events/collection/${collectionSlug}`,
  getContract: () => `${opensea.api}chain/${chain}/contract/${TOKEN_ADDRESS}`,
  getAccount: (address: string) => `${opensea.api}accounts/${address}`,
  getNFT: (tokenId: number) =>
    `${opensea.api}chain/${chain}/contract/${TOKEN_ADDRESS}/nfts/${tokenId}`,
  GET_OPTS: {
    method: 'GET',
    headers: { Accept: 'application/json', 'X-API-KEY': OPENSEA_API_TOKEN },
  } as any,
}

export enum EventType {
  order = 'order',
  listing = 'listing',
  offer = 'offer',
  sale = 'sale',
  cancel = 'cancel',
  transfer = 'transfer',
}

const enabledEventTypes = (): string[] => {
  const eventTypes = new Set<string>()
  for (const [_channelId, discordEventTypes] of channelsWithEvents()) {
    for (const eventType of discordEventTypes) {
      eventTypes.add(eventType)
    }
  }
  const twitterEventTypes = TWITTER_EVENTS?.split(',')
  if (twitterEventTypes?.length > 0) {
    for (const eventType of twitterEventTypes) {
      eventTypes.add(eventType)
    }
  }
  if (eventTypes.size === 0) {
    throw new Error(
      'No events enabled. Please specify DISCORD_EVENTS or TWITTER_EVENTS',
    )
  }
  return [...eventTypes]
}

let collectionSlug
const fetchCollectionSlug = async (address: string) => {
  if (collectionSlug) return collectionSlug
  console.log(`Getting collection slug for ${address} on chain ${chain}…`)
  const url = opensea.getContract()
  const result = await openseaGet(url)
  if (!result.collection) {
    throw new Error(`No collection found for ${address} on chain ${chain}`)
  }
  console.log(`Got collection slug: ${result.collection}`)
  collectionSlug = result.collection
  return result.collection
}

export const fetchEvents = async (): Promise<any> => {
  console.log(`${logStart}OpenSea - Fetching events`)
  const slug = await fetchCollectionSlug(TOKEN_ADDRESS)

  const eventTypes = enabledEventTypes()
  const params: any = {
    limit: QUERY_LIMIT ?? 50,
    after: lastEventTimestamp,
  }
  const urlParams = new URLSearchParams(params)
  for (const eventType of eventTypes) {
    urlParams.append('event_type', eventType)
  }

  const url = `${opensea.getEvents()}?${urlParams}`
  const result = await openseaGet(url)

  let events = result.asset_events

  // Reverse so that oldest first
  events = events.reverse

  // Update last seen event
  if (events.length > 0) {
    lastEventTimestamp = events[0].event_timestamp
  }

  // Filter out private listings
  events = events.filter((event) => {
    if (event.order_type === EventType.listing && event.is_private_listing) {
      return false
    }
    return true
  })

  const eventsPreFilter = events.length
  console.log(`${logStart}OpenSea - Fetched events: ${eventsPreFilter}`)

  // Filter out low value offers
  events = events.filter((event) => {
    if (
      event.order_type?.includes('offer') &&
      event.payment.symbol === 'WETH'
    ) {
      const offerValue = FixedNumber.fromValue(
        event.payment.quantity,
        event.payment.decimals,
      )
      return offerValue.gte(minOfferETH)
    }
    return true
  })

  const eventsPostFilter = events.length
  const eventsFiltered = eventsPreFilter - eventsPostFilter
  if (eventsFiltered > 0) {
    console.log(
      `${logStart}OpenSea - Offers under ${minOfferETH} ETH filtered out: ${eventsFiltered}`,
    )
  }

  return events
}
