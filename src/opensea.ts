import {
  EventType,
  ItemListedEventPayload,
  OpenSeaStreamClient,
} from '@opensea/stream-js'
import { WebSocket } from 'ws'
import { messageEvent, channelsWithEvents } from './discord'
import { tweetEvent } from './twitter'
import { Event, itemUSD, logStart, minOfferUSD } from './util'

const { OPENSEA_API_TOKEN, COLLECTIONS, TWITTER_EVENTS, DEBUG } = process.env

export const startClient = () => {
  const client = new OpenSeaStreamClient({
    token: OPENSEA_API_TOKEN,
    connectOptions: {
      transport: WebSocket,
    },
  })

  for (const [index, collection] of COLLECTIONS.split(',').entries()) {
    client.onEvents(collection, enabledEventTypes(), onEvent(index))
  }

  return client
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
  return [...eventTypes] as EventType[]
}

const onEvent = (collectionIndex: number) => {
  return (event: Event) => {
    const { event_type, payload } = event
    // Skip private listings
    if (
      event_type === EventType.ITEM_LISTED &&
      (payload as ItemListedEventPayload).is_private
    ) {
      if (DEBUG === 'true') console.log(`${logStart}Skipping private listing`)
      return
    }
    // Skip low value bids or offers
    if (
      [EventType.ITEM_RECEIVED_OFFER, EventType.ITEM_RECEIVED_BID].includes(
        event_type as EventType
      ) &&
      itemUSD(event) < minOfferUSD
    ) {
      if (DEBUG === 'true')
        console.log(
          `${logStart[collectionIndex]}Skipping ${
            event_type === EventType.ITEM_RECEIVED_OFFER ? 'offer' : 'bid'
          } of $${
            itemUSD(event).toString().split('.')[0]
          } (below $${minOfferUSD} threshold)`
        )
      return
    }

    if (DEBUG === 'true') {
      console.log(`${logStart[collectionIndex]}DEBUG Event:`)
      console.log(JSON.stringify(event))
    }

    void messageEvent(event, collectionIndex)
    void tweetEvent(event, collectionIndex)
  }
}
