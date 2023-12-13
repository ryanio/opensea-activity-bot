import { Client, EmbedBuilder } from 'discord.js'
import { format } from 'timeago.js'
import { EventType, opensea } from './opensea'
import { formatAmount, imageForNFT, logStart, timeout, username } from './util'

const { DISCORD_EVENTS, DISCORD_TOKEN } = process.env

type ChannelEvents = Array<[channelId: string, eventTypes: EventType[]]>
export const channelsWithEvents = (): ChannelEvents => {
  if (!DISCORD_EVENTS) return []

  const list = []
  for (const channel of DISCORD_EVENTS.split('&')) {
    const channelWithEvents = channel.split('=')
    const channelId = channelWithEvents[0]
    const eventTypes = channelWithEvents[1].split(',')
    if (
      eventTypes.includes(EventType.listing) ||
      eventTypes.includes(EventType.offer)
    ) {
      // Workaround
      eventTypes.push(EventType.order)
    }
    list.push([channelId, eventTypes])
  }

  return list
}

const channelsForEventType = (
  eventType: EventType,
  orderType: string,
  channelEvents: ChannelEvents,
  discordChannels: any[],
) => {
  if (eventType === EventType.order) {
    if (orderType.includes('offer')) {
      eventType = EventType.offer
    } else {
      eventType = EventType.listing
    }
  }
  const channels = []
  for (const [channelId, eventTypes] of channelEvents) {
    if (eventTypes.includes(eventType)) {
      const channel = discordChannels[channelId]
      channels.push(channel)
    }
  }
  return channels
}

const colorFor = (eventType: EventType) => {
  switch (eventType) {
    case EventType.listing:
      return '#66dcf0'
    case EventType.offer:
      return '#d63864'
    case EventType.sale:
      return '#62b778'
    case EventType.cancel:
      return '#9537b0'
    case EventType.transfer:
      return '#5296d5'
    default:
      return '#9537b0'
  }
}

const embed = async (event: any) => {
  const {
    event_type,
    payment,
    from_address,
    to_address,
    asset,
    order_type,
    expiration_date,
    maker,
    buyer,
    criteria,
  } = event

  let { nft } = event
  if (!nft && asset) {
    nft = asset
  }
  const fields: any[] = []

  let title = ''

  if (event_type === EventType.order) {
    const { quantity, decimals, symbol } = payment
    const inTime = format(new Date(expiration_date * 1000))
    if (order_type === 'auction') {
      title += 'Auction:'
      const price = formatAmount(quantity, decimals, symbol)
      fields.push({
        name: 'Starting Price',
        value: price,
      })
      fields.push({
        name: 'Ends',
        value: inTime,
      })
    } else if (order_type === 'trait_offer') {
      const traitType = criteria.trait.type
      const traitValue = criteria.trait.value
      title += `Trait offer: ${traitType} -> ${traitValue}`
      const price = formatAmount(quantity, decimals, symbol)
      fields.push({
        name: 'Price',
        value: price,
      })
      fields.push({
        name: 'Expires',
        value: inTime,
      })
    } else if (order_type === 'item_offer') {
      title += 'Item offer:'
      const price = formatAmount(quantity, decimals, symbol)
      fields.push({
        name: 'Price',
        value: price,
      })
      fields.push({
        name: 'Expires',
        value: inTime,
      })
    } else if (order_type === 'collection_offer') {
      title += 'Collection offer'
      const price = formatAmount(quantity, decimals, symbol)
      fields.push({
        name: 'Price',
        value: price,
      })
      fields.push({
        name: 'Expires',
        value: inTime,
      })
    } else {
      title += 'Listed for sale:'
      const price = formatAmount(quantity, decimals, symbol)
      fields.push({
        name: 'Price',
        value: price,
      })
      fields.push({
        name: 'Expires',
        value: inTime,
      })
    }
    fields.push({
      name: 'By',
      value: await username(maker),
    })
  } else if (event_type === EventType.sale) {
    const { quantity, decimals, symbol } = payment
    title += 'Purchased:'
    const price = formatAmount(quantity, decimals, symbol)
    fields.push({
      name: 'Price',
      value: price,
    })
    fields.push({
      name: 'By',
      value: await username(buyer),
    })
  } else if (event_type === EventType.transfer) {
    title += 'Transferred:'
    fields.push({
      name: 'From',
      value: await username(from_address),
    })
    fields.push({
      name: 'To',
      value: await username(to_address),
    })
  }

  if (nft?.name) {
    title += ` ${nft.name}`
  }

  const embed = new EmbedBuilder()
    .setColor(colorFor(event_type))
    .setTitle(title)
    .setFields(
      fields.map((f) => {
        f.inline = true
        return f
      }),
    )

  if (Object.keys(nft).length > 0) {
    embed.setURL(nft.opensea_url)
    const image = imageForNFT(nft)
    if (image) {
      embed.setImage(imageForNFT(nft))
    }
  } else {
    embed.setURL(opensea.collectionPermalink())
  }

  return embed
}

const messagesForEvents = async (events: any[]) => {
  const messages = []
  for (const event of events) {
    const embeds = [await embed(event)]
    const message = { embeds }
    messages.push(message)
  }
  return messages
}

const login = async (client: Client): Promise<void> => {
  return new Promise<void>((resolve) => {
    client.on('ready', async () => {
      console.log(`${logStart}Discord - Logged in as: ${client?.user?.tag}`)
      resolve()
    })
    client.login(DISCORD_TOKEN)
  })
}

const getChannels = async (
  client: Client,
  channelEvents: ChannelEvents,
): Promise<any> => {
  const channels = {}
  console.log(`${logStart}Discord - Selected channels:`)
  for (const [channelId, events] of channelEvents) {
    const channel = await client.channels.fetch(channelId)
    channels[channelId] = channel
    console.log(
      `${logStart}Discord - * #${
        (channel as any).name ?? (channel as any).channelId
      }: ${events.join(', ')}`,
    )
  }
  return channels
}

export async function messageEvents(events: any[]) {
  if (!DISCORD_EVENTS) return

  const client = new Client({ intents: [] })
  const channelEvents = channelsWithEvents()

  // only handle event types specified by DISCORD_EVENTS
  const filteredEvents = events.filter((event) =>
    [...channelEvents.map((c) => c[1])].flat().includes(event.event_type),
  )

  console.log(`${logStart}Discord - Relevant events: ${filteredEvents.length}`)

  if (filteredEvents.length === 0) return

  try {
    await login(client)
    const discordChannels = await getChannels(client, channelEvents)
    const messages = await messagesForEvents(filteredEvents)

    for (const [index, message] of messages.entries()) {
      const { event_type, order_type } = filteredEvents[index]
      const channels = channelsForEventType(
        event_type,
        order_type,
        channelEvents,
        discordChannels,
      )
      console.log(
        `${logStart}Discord - Sending message in ${channels
          .map((c) => '#' + c.name ?? c.channelId)
          .join(', ')}: ${message.embeds[0].data.title} `,
      )
      for (const channel of channels) {
        await channel.send(message)

        // Wait 3s between messages
        if (messages[index + 1]) {
          await timeout(3000)
        }
      }
    }
  } catch (error) {
    console.error(error)
  }

  client.destroy()
}
