import { URLSearchParams } from 'url'
import fetch from 'node-fetch'
import { format } from 'timeago.js'
import { botInterval } from './index'
import { channelsWithEvents } from './discord'
import { assetUSDValue, shortAddr, unixTimestamp } from './util'

const { OPENSEA_API_TOKEN, TOKEN_ADDRESS, TWITTER_EVENTS } = process.env

const shortTokenAddr = shortAddr(TOKEN_ADDRESS)

export const opensea = {
  events: 'https://api.opensea.io/api/v1/events',
  bundlePermalink: (slug) => `https://opensea.io/bundles/${slug}`,
  GET_OPTS: {
    method: 'GET',
    headers: { Accept: 'application/json', 'X-API-KEY': OPENSEA_API_TOKEN },
  } as any,
  /**
   * Limit of fetched results per query
   */
  GET_LIMIT: 45,
  /**
   * Max pages to gather when fetching events.
   * Warning, adding to this number may drastically increase
   * the number of OpenSea queries from your API key depending
   * on the popularity of the collection.
   */
  MAX_PAGES: 3,
}

export enum EventType {
  created = 'created',
  successful = 'successful',
  cancelled = 'cancelled',
  offer_entered = 'offer_entered',
  bid_entered = 'bid_entered',
  bid_withdrawn = 'bid_withdrawn',
  transfer = 'transfer',
}

const enabledEventTypes = () => {
  const eventTypes = new Set()
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
      'No events enabled. Please specify DISCORD_EVENTS or TWITTER_EVENTS'
    )
  }
  return [...eventTypes]
}

export const fetchEvents = async (): Promise<any> => {
  const since = unixTimestamp(new Date()) - botInterval
  const ago = format(new Date(since * 1000))
  console.log(`OpenSea - ${shortTokenAddr} - Fetching events from ${ago}`)

  const eventTypes = enabledEventTypes()
  const params: any = {
    asset_contract_address: TOKEN_ADDRESS,
    occurred_after: since,
    limit: opensea.GET_LIMIT,
  }

  // OpenSea only allows filtering for one event at a time so
  // we'll only filter by an event if there's only one type specified
  if (eventTypes.length === 1) {
    params.event_type = eventTypes[0]
  }

  const url = `${opensea.events}?${new URLSearchParams(params)}`
  let events: any[]

  try {
    const response = await fetch(url, opensea.GET_OPTS)
    const result = await response.json()
    if (!result || !result.asset_events) {
      console.error(
        `OpenSea - ${shortTokenAddr} - Fetch Error (missing asset_events): ${JSON.stringify(
          result
        )}`
      )
      return
    }
    events = result.asset_events
  } catch (error) {
    console.error(
      `OpenSea - ${TOKEN_ADDRESS} - Fetch Error: ${JSON.stringify(error)}`
    )
    return
  }

  if (events.length === opensea.GET_LIMIT) {
    // Add paginated results
    let moreEvents = events
    while (
      moreEvents &&
      moreEvents.length > 0 &&
      moreEvents.length === opensea.GET_LIMIT &&
      events.length / opensea.GET_LIMIT < opensea.MAX_PAGES
    ) {
      const response = await fetch(
        `${url}&offset=${events.length}`,
        opensea.GET_OPTS
      )
      const result = await response.json()
      moreEvents = result.asset_events
      if (moreEvents?.length > 0) {
        events = events.concat(moreEvents)
      }
    }
  }

  // Filter out private listings
  events = events.filter(
    (event) =>
      event.event_type !== EventType.created ||
      (event.event_type === EventType.created && !event.is_private)
  )

  const eventsPreFilter = events?.length ?? 0
  console.log(
    `OpenSea - ${shortTokenAddr} - Fetched events: ${eventsPreFilter}`
  )

  // Filter out low value offers (under $100 USD)
  events = events.filter((event) =>
    [
      EventType.offer_entered,
      EventType.bid_entered,
      EventType.bid_withdrawn,
    ].includes(event.event_type)
      ? Number(assetUSDValue(event)) > 100
      : true
  )

  const eventsPostFilter = events?.length ?? 0
  const eventsFiltered = eventsPreFilter - eventsPostFilter
  if (eventsFiltered > 0) {
    console.log(
      `Opensea - ${shortTokenAddr} - Offers under $100 USD filtered out: ${eventsFiltered}`
    )
  }

  return events.reverse()
}
