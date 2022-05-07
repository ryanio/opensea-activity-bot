import {
  EventType,
  ItemCancelledEventPayload,
  ItemListedEventPayload,
  ItemMetadataUpdatePayload,
  ItemReceivedBidEventPayload,
  ItemReceivedOfferEventPayload,
  ItemSoldEventPayload,
  ItemTransferredEventPayload,
} from '@opensea/stream-js'
import { Client, Message, MessageEmbed } from 'discord.js'
import { format as timeAgo } from 'timeago.js'
import {
  Event,
  formatAmount,
  formatUSD,
  imageForEvent,
  logStart,
  timeout,
  uppercase,
  username,
} from './util'

const { DISCORD_EVENTS, DISCORD_TOKEN, DEBUG } = process.env

type QueueItem = [channelId: string, message: Message, collectionIndex: number]
const queue: QueueItem[] = []
let queueRunning = false

interface EmbedField {
  name: string
  value: any
  inline?: boolean
}

type ChannelEvents = Array<[channelId: string, eventTypes: EventType[]]>
export const channelsWithEvents = (): ChannelEvents => {
  if (!DISCORD_EVENTS) return []

  const list = []
  for (const channel of DISCORD_EVENTS.split('&')) {
    const channelWithEvents = channel.split('=')
    const channelId = channelWithEvents[0]
    const eventTypes = channelWithEvents[1].split(',')
    list.push([channelId, eventTypes])
  }
  return list
}

const setEmbedForEvent = async (event: Event) => {
  const { event_type, payload } = event
  const { quantity, item } = payload as any

  let title = ''
  const fields: EmbedField[] = []

  if (quantity && quantity > 1) {
    fields.push({
      name: 'Quantity',
      value: quantity,
    })
  }

  switch (event_type) {
    case EventType.ITEM_LISTED: {
      const {
        base_price,
        expiration_date,
        listing_type,
        maker,
        payment_token,
      } = payload as ItemListedEventPayload
      const { symbol, decimals, usd_price } = payment_token
      switch (listing_type) {
        case 'english': {
          title += 'English auction:'
          const price = formatAmount(base_price, decimals, symbol)
          const priceUSD = formatUSD(price, usd_price)
          const inTime = timeAgo(new Date(expiration_date))
          fields.push({
            name: 'Starting Price',
            value: `${price} ($${priceUSD} USD)`,
          })
          fields.push({
            name: 'Ends',
            value: inTime,
          })
          break
        }
        case 'dutch': {
          title += 'Reverse Dutch auction:'
          const price = formatAmount(base_price, decimals, symbol)
          const priceUSD = formatUSD(price, usd_price)
          const inTime = timeAgo(new Date(expiration_date))
          fields.push({
            name: 'Starting Price',
            value: `${price} ($${priceUSD} USD)`,
          })
          fields.push({
            name: 'Ends',
            value: inTime,
          })
          // fields.push({
          //   name: 'Ending Price',
          //   value: `${endPrice} ($${endPriceUSD} USD) ${inTime}`,
          // })
          break
        }
        case 'listing': {
          title += 'Listed for sale:'
          const price = formatAmount(base_price, decimals, symbol)
          const priceUSD = formatUSD(price, usd_price)
          fields.push({
            name: 'Price',
            value: `${price} ($${priceUSD} USD)`,
          })
          const inTime = timeAgo(new Date(expiration_date))
          fields.push({
            name: 'Expires',
            value: inTime,
          })
          break
        }
        default:
          throw new Error(`unknown listing_type: ${listing_type}`)
      }
      fields.push({
        name: 'By',
        value: await username(maker),
      })
      break
    }
    case EventType.ITEM_SOLD: {
      const { sale_price, payment_token, taker } =
        payload as ItemSoldEventPayload
      const { symbol, decimals, usd_price } = payment_token
      title += 'Purchased:'
      const price = formatAmount(sale_price, decimals, symbol)
      const priceUSD = formatUSD(price, usd_price)
      fields.push({
        name: 'Price',
        value: `${price} ($${priceUSD} USD)`,
      })
      fields.push({
        name: 'By',
        value: await username(taker),
      })
      break
    }
    case EventType.ITEM_CANCELLED: {
      const { listing_type } = payload as ItemCancelledEventPayload
      title += `${uppercase(listing_type)}) listing cancelled:`
      // fields.push({
      //   name: 'Price',
      //   value: `${price} ($${priceUSD} USD)`,
      // })
      // fields.push({
      //   name: 'By',
      //   value: await username(owner),
      // })
      break
    }
    case EventType.ITEM_RECEIVED_OFFER: {
      const { base_price, maker, payment_token } =
        payload as ItemReceivedOfferEventPayload
      const { symbol, decimals, usd_price } = payment_token
      title += 'Offer entered:'
      const amount = formatAmount(base_price, decimals, symbol)
      const amountUSD = formatUSD(amount, usd_price)
      fields.push({
        name: 'Amount',
        value: `${amount} ($${amountUSD} USD)`,
      })
      fields.push({
        name: 'By',
        value: await username(maker),
      })
      break
    }
    case EventType.ITEM_RECEIVED_BID: {
      const { base_price, maker, payment_token } =
        payload as ItemReceivedBidEventPayload
      const { symbol, decimals, usd_price } = payment_token
      title += 'Bid entered:'
      const amount = formatAmount(base_price, decimals, symbol)
      const amountUSD = formatUSD(amount, usd_price)
      fields.push({
        name: 'Amount',
        value: `${amount} ($${amountUSD} USD)`,
      })
      fields.push({
        name: 'By',
        value: await username(maker),
      })
      break
    }
    case EventType.ITEM_TRANSFERRED: {
      const { from_account, to_account } =
        payload as ItemTransferredEventPayload
      title += 'Transferred:'
      fields.push({
        name: 'From',
        value: await username(from_account),
      })
      fields.push({
        name: 'To',
        value: await username(to_account),
      })
      break
    }
    case EventType.ITEM_METADATA_UPDATED: {
      const { description, traits } = payload as ItemMetadataUpdatePayload
      title += 'Metadata updated:'
      if (description) {
        fields.push({
          name: 'Description',
          value: description,
        })
      }
      if (traits) {
        for (const trait of traits) {
          fields.push({
            name: trait.trait_type,
            value: trait.value,
          })
        }
      }
      break
    }
    default:
      throw new Error(`unknown event_type: ${event_type}`)
  }

  if (item.metadata.name) {
    title += ` ${item.metadata.name}`
  } else {
    const id = item.nft_id.split(/[\/]+/).pop()
    title += ` #${id}`
  }

  return { title, fields }
}

const colorFor = (eventType: EventType) => {
  switch (eventType) {
    case EventType.ITEM_LISTED:
      return 'AQUA'
    case EventType.ITEM_SOLD:
      return 'GREEN'
    case EventType.ITEM_RECEIVED_OFFER:
      return 'LUMINOUS_VIVID_PINK'
    case EventType.ITEM_RECEIVED_BID:
      return 'YELLOW'
    case EventType.ITEM_CANCELLED:
      return 'FUCHSIA'
    case EventType.ITEM_TRANSFERRED:
      return 'RED'
    case EventType.ITEM_METADATA_UPDATED:
      return 'ORANGE'
    default:
      return 'PURPLE'
  }
}

const embed = async (event: Event) => {
  const { title, fields } = await setEmbedForEvent(event)

  return new MessageEmbed()
    .setColor(colorFor(event.event_type as EventType))
    .setTitle(title)
    .setURL(event.payload.item.permalink)
    .setFields(
      fields.map((f) => {
        f.inline = true
        return f
      })
    )
    .setImage(imageForEvent(event))
}

const messagesForEvent = async (
  event: Event,
  channels: ChannelEvents,
  collectionIndex: number
) => {
  const messages = []
  for (const [channelId, eventTypes] of channels) {
    if (!eventTypes.includes(event.event_type as EventType)) continue
    try {
      const embeds = [await embed(event)]
      const message = { embeds }
      messages.push([channelId, message, collectionIndex])
    } catch (error) {
      console.error(
        `${logStart[collectionIndex]}Discord - Error (embed): ${
          error.message ?? error
        }`
      )
    }
  }
  return messages
}

const login = async (client: Client): Promise<void> => {
  return new Promise<void>((resolve) => {
    client.on('ready', async () => {
      if (DEBUG === 'true')
        console.log(`Discord - Logged in as: ${client?.user?.tag}`)
      resolve()
    })
    client.login(DISCORD_TOKEN)
  })
}

const getChannels = async (
  client: Client,
  channelEvents: ChannelEvents
): Promise<any> => {
  const channels = {}
  let debug = ''
  debug += 'Discord - Selected channels:\n'
  for (const [channelId, events] of channelEvents) {
    const channel = await client.channels.fetch(channelId)
    channels[channelId] = channel
    debug += ` - * #${
      (channel as any).name ?? (channel as any).channelId
    }: ${events.join(', ')}\n`
  }
  if (DEBUG === 'true') console.log(debug)
  return channels
}

export async function messageEvent(event: Event, collectionIndex: number) {
  if (!DISCORD_EVENTS) return

  const channelEvents = channelsWithEvents()
  // Only handle event types specified by DISCORD_EVENTS
  if (
    !channelEvents.some((channelEvent) =>
      channelEvent[1].includes(event.event_type as EventType)
    )
  )
    return

  const messages = await messagesForEvent(event, channelEvents, collectionIndex)
  queue.push(...messages)
  void processQueue()
}

async function processQueue() {
  if (queueRunning) return
  queueRunning = true
  const client = new Client({ intents: [] })
  await login(client)
  const channelEvents = channelsWithEvents()
  const discordChannels = await getChannels(client, channelEvents)
  while (queue.length > 0) {
    const queueItem = queue.shift()
    const [channelId, message, collectionIndex] = queueItem
    const channel = discordChannels[channelId]
    console.log(
      `${logStart[collectionIndex]}Discord - Sending message in #${
        channel.name ?? (channel as any).channelId
      }: ${message.embeds[0].title} `
    )
    try {
      await channel.send(message)
    } catch (error) {
      console.error(
        `${logStart[collectionIndex]}Discord - Error: ${error.message ?? error}`
      )
    }
    await timeout(3000)
  }
  client.destroy()
  queueRunning = false
}
