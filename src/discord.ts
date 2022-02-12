import { Client, MessageEmbed } from 'discord.js'
import { ethers } from 'ethers'
import { format } from 'timeago.js'
import { opensea, EventType } from './opensea'
import { logStart, timeout, username } from './util'

const { DISCORD_EVENTS, DISCORD_TOKEN } = process.env

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

const channelsForEventType = (
  eventType: EventType,
  channelEvents: ChannelEvents,
  discordChannels: any[]
) => {
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
    case EventType.created:
      return '#66dcf0'
    case EventType.successful:
      return '#62b778'
    case EventType.cancelled:
      return '#9537b0'
    case EventType.offer_entered:
      return '#d63864'
    case EventType.bid_entered:
      return '#d63864'
    case EventType.bid_withdrawn:
      return '#9537b0'
    case EventType.transfer:
      return '#5296d5'
    default:
      return '#5296d5'
  }
}

const embed = async (event: any) => {
  const {
    asset,
    event_type,
    payment_token,
    auction_type,
    starting_price,
    ending_price,
    total_price,
    bid_amount,
    created_date,
    duration,
    from_account,
    to_account,
    winner_account,
    seller,
    asset_bundle,
  } = event
  const fields: any[] = []

  let title = ''

  if (event_type === EventType.created) {
    const { symbol, decimals, usd_price } = payment_token
    if (auction_type === 'english') {
      title += 'English auction:'
      const price =
        ethers.utils.formatUnits(starting_price, decimals) + ' ' + symbol
      const priceUSD = ethers.FixedNumber.from(price.split(' ')[0])
        .mulUnsafe(ethers.FixedNumber.from(usd_price))
        .toUnsafeFloat()
        .toFixed(2)
      const inTime = format(
        new Date(new Date(created_date).getTime() + Number(duration) * 1000)
      )
      fields.push({
        name: 'Starting Price',
        value: `${price} ($${priceUSD} USD)`,
      })
      fields.push({
        name: 'Ends',
        value: inTime,
      })
    } else if (auction_type === 'dutch' && starting_price !== ending_price) {
      title += 'Reverse Dutch auction:'
      const price =
        ethers.utils.formatUnits(starting_price, decimals) + ' ' + symbol
      const priceUSD = ethers.FixedNumber.from(price.split(' ')[0])
        .mulUnsafe(ethers.FixedNumber.from(usd_price))
        .toUnsafeFloat()
        .toFixed(2)
      const endPrice =
        ethers.utils.formatUnits(ending_price, decimals) + ' ' + symbol
      const endPriceUSD = ethers.FixedNumber.from(endPrice.split(' ')[0])
        .mulUnsafe(ethers.FixedNumber.from(usd_price))
        .toUnsafeFloat()
        .toFixed(2)
      const inTime = format(
        new Date(new Date(created_date).getTime() + Number(duration) * 1000)
      )
      fields.push({
        name: 'Start Price',
        value: `${price} ($${priceUSD} USD)`,
      })
      fields.push({
        name: 'End Price',
        value: `${endPrice} ($${endPriceUSD} USD) ${inTime}`,
      })
    } else {
      title += 'Listed for sale:'
      const price =
        ethers.utils.formatUnits(starting_price, decimals) + ' ' + symbol
      const priceUSD = ethers.FixedNumber.from(price.split(' ')[0])
        .mulUnsafe(ethers.FixedNumber.from(usd_price))
        .toUnsafeFloat()
        .toFixed(2)
      fields.push({
        name: 'Price',
        value: `${price} ($${priceUSD} USD)`,
      })
      if (duration) {
        const inTime = format(
          new Date(new Date(created_date).getTime() + Number(duration) * 1000)
        )
        fields.push({
          name: 'Expires',
          value: inTime,
        })
      }
    }
    fields.push({
      name: 'By',
      value: await username(from_account ?? seller),
    })
  } else if (event_type === EventType.successful) {
    const { symbol, decimals, usd_price } = payment_token
    title += 'Purchased:'
    const price = ethers.utils.formatUnits(total_price, decimals) + ' ' + symbol
    const priceUSD = ethers.FixedNumber.from(price.split(' ')[0])
      .mulUnsafe(ethers.FixedNumber.from(usd_price))
      .toUnsafeFloat()
      .toFixed(2)
    fields.push({
      name: 'Price',
      value: `${price} ($${priceUSD} USD)`,
    })
    fields.push({
      name: 'By',
      value: await username(winner_account),
    })
  } else if (event_type === EventType.cancelled) {
    const { symbol, decimals, usd_price } = payment_token
    title += 'Listing cancelled:'
    const price =
      ethers.utils.formatUnits(ending_price || starting_price, decimals) +
      ' ' +
      symbol
    const priceUSD = ethers.FixedNumber.from(price.split(' ')[0])
      .mulUnsafe(ethers.FixedNumber.from(usd_price))
      .toUnsafeFloat()
      .toFixed(2)
    fields.push({
      name: 'Price',
      value: `${price} ($${priceUSD} USD)`,
    })
    fields.push({
      name: 'By',
      value: await username(seller),
    })
  } else if (event_type === EventType.offer_entered) {
    const { symbol, decimals, usd_price } = payment_token
    title += 'Offer entered: '
    const amount = ethers.utils.formatUnits(bid_amount, decimals) + ' ' + symbol
    const amountUSD = ethers.FixedNumber.from(amount.split(' ')[0])
      .mulUnsafe(ethers.FixedNumber.from(usd_price))
      .toUnsafeFloat()
      .toFixed(2)
    fields.push({
      name: 'Amount',
      value: `${amount} ($${amountUSD} USD)`,
    })
    fields.push({
      name: 'By',
      value: await username(from_account),
    })
  } else if (event_type === EventType.bid_entered) {
    const { symbol, decimals, usd_price } = payment_token
    title += 'Bid entered: '
    const amount = ethers.utils.formatUnits(bid_amount, decimals) + ' ' + symbol
    const amountUSD = ethers.FixedNumber.from(amount.split(' ')[0])
      .mulUnsafe(ethers.FixedNumber.from(usd_price))
      .toUnsafeFloat()
      .toFixed(2)
    fields.push({
      name: 'Amount',
      value: `${amount} ($${amountUSD} USD)`,
    })
    fields.push({
      name: 'By',
      value: await username(from_account),
    })
  } else if (event_type === EventType.bid_withdrawn) {
    const { symbol, decimals, usd_price } = payment_token
    title += 'Bid withdrawn: '
    const amount = ethers.utils.formatUnits(bid_amount, decimals) + ' ' + symbol
    const amountUSD = ethers.FixedNumber.from(amount.split(' ')[0])
      .mulUnsafe(ethers.FixedNumber.from(usd_price))
      .toUnsafeFloat()
      .toFixed(2)
    fields.push({
      name: 'Amount',
      value: `${amount} ($${amountUSD} USD)`,
    })
    fields.push({
      name: 'By',
      value: await username(from_account),
    })
  } else if (event_type === EventType.transfer) {
    title += 'Transferred:'
    fields.push({
      name: 'From',
      value: await username(from_account),
    })
    fields.push({
      name: 'To',
      value: await username(to_account),
    })
  }

  let url = asset.permalink

  if (asset_bundle) {
    title += ` (bundle)`
    fields.push({
      name: 'Number of items',
      value: asset_bundle.assets.length,
    })
    title += ` ${asset_bundle.name}`
    url = opensea.bundlePermalink(asset_bundle.slug)
  } else {
    let assetName = asset.name
    if (!assetName) {
      if (asset.asset_contract.name) {
        assetName = `${asset.asset_contract.name} `
      }
      assetName += `#${asset.token_id}`
    }
    title += ` ${assetName}`
  }

  return new MessageEmbed()
    .setColor(colorFor(event_type))
    .setTitle(title)
    .setURL(url)
    .setFields(
      fields.map((f) => {
        f.inline = true
        return f
      })
    )
    .setImage(asset.image_original_url)
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
  channelEvents: ChannelEvents
): Promise<any> => {
  const channels = {}
  console.log(`${logStart}Discord - Selected channels:`)
  for (const [channelId, events] of channelEvents) {
    const channel = await client.channels.fetch(channelId)
    channels[channelId] = channel
    console.log(
      `${logStart}Discord - * #${
        (channel as any).name ?? (channel as any).channelId
      }: ${events.join(', ')}`
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
    [...channelEvents.map((c) => c[1])].flat().includes(event.event_type)
  )

  console.log(`${logStart}Discord - Relevant events: ${filteredEvents.length}`)

  if (filteredEvents.length === 0) return

  try {
    await login(client)
    const discordChannels = await getChannels(client, channelEvents)
    const messages = await messagesForEvents(filteredEvents)

    for (const [index, message] of messages.entries()) {
      const { event_type, id } = filteredEvents[index]
      const channels = channelsForEventType(
        event_type,
        channelEvents,
        discordChannels
      )
      console.log(
        `${logStart}Discord - Sending message (event id: ${id}) in ${channels
          .map((c) => '#' + c.name ?? c.channelId)
          .join(', ')}: ${message.embeds[0].title} `
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
