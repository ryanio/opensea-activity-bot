import { writeFileSync } from 'fs'
import { resolve } from 'path'
import { URLSearchParams } from 'url'
import { channelsWithEvents } from './discord'
import { assetUSDValue, chain, logStart, minOfferUSD } from './util'

const {
  OPENSEA_API_TOKEN,
  TOKEN_ADDRESS,
  TWITTER_EVENTS,
  DEBUG,
  LAST_EVENT_TIMESTAMP,
  QUERY_LIMIT,
} = process.env

if (LAST_EVENT_TIMESTAMP) {
  console.log(`${logStart}Using LAST_EVENT_TIMESTAMP: ${LAST_EVENT_TIMESTAMP}`)
}

export const opensea = {
  api: 'https://api.opensea.io/api/v2/',
  collectionPermalink: () =>
    `https://opensea.io/collection/${cachedCollectionSlug}`,
  getEvents: () => `${opensea.api}events/collection/${cachedCollectionSlug}`,
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
  order = 'order', // this is deprecated?
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

let cachedCollectionSlug
const fetchCollectionSlug = async (address: string) => {
  if (cachedCollectionSlug) {
    return cachedCollectionSlug
  }
  console.log(`Getting collection slug for ${address} on chain ${chain}…`)
  try {
    const response = await fetch(opensea.getContract(), opensea.GET_OPTS)
    if (!response.ok) {
      console.error(
        `Fetch Error - ${response.status}: ${response.statusText}`,
        DEBUG === 'true'
          ? `DEBUG: ${JSON.stringify(await response.text())}`
          : '',
      )
      return
    }
    const result = await response.json()
    console.log(`Got collection slug: ${result.collection}`)
    cachedCollectionSlug = result.collection
    return cachedCollectionSlug
  } catch (error) {
    console.error(`Fetch Error: ${error?.message ?? error}`)
  }
}

export const fetchEvents = async (): Promise<any> => {
  console.log(`${logStart}OpenSea - Fetching events`)
  const slug = await fetchCollectionSlug(TOKEN_ADDRESS)
  if (!slug) {
    console.error(`${logStart}OpenSea - No collection slug`)
    return
  }
  const eventTypes = enabledEventTypes()
  const params: any = {
    limit: QUERY_LIMIT ?? 50,
  }
  if (LAST_EVENT_TIMESTAMP) {
    params.after = LAST_EVENT_TIMESTAMP
  }
  const urlParams = new URLSearchParams(params)
  for (const eventType of eventTypes) {
    urlParams.append('event_type', eventType)
  }
  const url = `${opensea.getEvents()}?${urlParams}`

  let events: any[]

  try {
    const response = await fetch(url, opensea.GET_OPTS)
    if (!response.ok) {
      console.error(
        `${logStart}OpenSea - Fetch Error - ${response.status}: ${response.statusText}`,
        DEBUG ? `DEBUG: ${JSON.stringify(await response.text())}` : '',
      )
      console.log(JSON.stringify(await response.text()))
      return
    }
    const result = await response.json()
    if (!result || !result.asset_events) {
      console.error(
        `${logStart}OpenSea - Fetch Error (missing asset_events) - Result: ${JSON.stringify(
          result,
        )}`,
      )
      return
    }
    events = result.asset_events
  } catch (error) {
    console.error(
      `${logStart}OpenSea - Fetch Error: ${error?.message ?? error}`,
    )
    return
  }

  // Filter out private listings
  events = events.filter(
    (event) =>
      event.event_type !== EventType.listing ||
      (event.event_type === EventType.listing && !event.is_private),
  )

  const eventsPreFilter = events.length
  console.log(`${logStart}OpenSea - Fetched events: ${eventsPreFilter}`)

  // Filter out low value offers
  events = events.filter((event) =>
    event.event_type == EventType.offer
      ? assetUSDValue(event) >= minOfferUSD
      : true,
  )

  const eventsPostFilter = events.length
  const eventsFiltered = eventsPreFilter - eventsPostFilter
  if (eventsFiltered > 0) {
    console.log(
      `${logStart}Opensea - Offers under $${minOfferUSD} USD filtered out: ${eventsFiltered}`,
    )
  }

  return events
}
