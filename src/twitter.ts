import { File, FileReader } from 'file-api'
import { format } from 'timeago.js'
import fetch from 'node-fetch'
import Twitter from 'twitter-lite'
import { opensea, EventType } from './opensea'
import {
  formatAmount,
  formatUSD,
  imageForAsset,
  logStart,
  timeout,
  username,
} from './util'

const {
  TWITTER_EVENTS,
  TWITTER_CONSUMER_KEY,
  TWITTER_CONSUMER_SECRET,
  TWITTER_ACCESS_TOKEN,
  TWITTER_ACCESS_TOKEN_SECRET,
} = process.env

const secrets = {
  consumer_key: TWITTER_CONSUMER_KEY,
  consumer_secret: TWITTER_CONSUMER_SECRET,
  access_token_key: TWITTER_ACCESS_TOKEN,
  access_token_secret: TWITTER_ACCESS_TOKEN_SECRET,
}

const textForTweet = async (event: any) => {
  const permalink = event.asset.permalink

  const {
    asset,
    payment_token,
    event_type,
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

  let text = `#${asset.token_id} `

  if (asset_bundle) {
    text = `${asset_bundle.name} `
  }

  if (event_type === EventType.created) {
    const { symbol, decimals, usd_price } = payment_token
    const name = await username(from_account ?? seller)
    if (auction_type === 'english') {
      const price = formatAmount(starting_price, decimals, symbol)
      const priceUSD = formatUSD(price, usd_price)
      const inTime = format(
        new Date(new Date(created_date).getTime() + Number(duration))
      )
      text += `English auction started for ${price} ($${priceUSD} USD), ends ${inTime}, by ${name}`
      // Opening Price, Ends in
    } else if (auction_type === 'dutch') {
      const price = formatAmount(starting_price, decimals, symbol)
      const priceUSD = formatUSD(price, usd_price)
      const endPrice = formatAmount(ending_price, decimals, symbol)
      const endPriceUSD = formatUSD(endPrice, usd_price)
      const inTime = format(
        new Date(new Date(created_date).getTime() + Number(duration) * 1000)
      )
      text += `Reverse Dutch auction started for ${price} ($${priceUSD} USD), ends ${inTime} at ${endPrice} ($${endPriceUSD} USD), by ${name}`
      // Start Price, End Price (in x time)
    } else if (auction_type === null) {
      const price = formatAmount(starting_price, decimals, symbol)
      const priceUSD = formatUSD(price, usd_price)
      const inTime = format(
        new Date(new Date(created_date).getTime() + Number(duration) * 1000)
      )
      text += `listed on sale for ${price} ($${priceUSD} USD) for ${inTime} by ${name}`
      // Price
    }
  } else if (event_type === EventType.successful) {
    const { symbol, decimals, usd_price } = payment_token
    const amount = formatAmount(total_price, decimals, symbol)
    const amountUSD = formatUSD(amount, usd_price)
    const name = await username(winner_account)
    text += `purchased for ${amount} ($${amountUSD} USD) by ${name}`
  } else if (event_type === EventType.cancelled) {
    const { symbol, decimals, usd_price } = payment_token
    const price = formatAmount(total_price, decimals, symbol)
    const priceUSD = formatUSD(price, usd_price)
    const name = await username(seller)
    text += `listing cancelled for ${price} ($${priceUSD} USD) by ${name}`
  } else if (event_type === EventType.offer_entered) {
    const { symbol, decimals, usd_price } = payment_token
    const amount = formatAmount(bid_amount, decimals, symbol)
    const amountUSD = formatUSD(amount, usd_price)
    const name = await username(from_account)
    text += `offer entered for ${amount} ($${amountUSD} USD) by ${name}`
  } else if (event_type === EventType.bid_entered) {
    const { symbol, decimals, usd_price } = payment_token
    const amount = formatAmount(bid_amount, decimals, symbol)
    const amountUSD = formatUSD(amount, usd_price)
    const name = await username(from_account)
    text += `bid entered for ${amount} ($${amountUSD} USD) by ${name}`
  } else if (event_type === EventType.bid_withdrawn) {
    const { symbol, decimals, usd_price } = payment_token
    const amount = formatAmount(total_price, decimals, symbol)
    const amountUSD = formatUSD(amount, usd_price)
    const name = await username(from_account)
    text += `bid withdrawn for ${amount} ($${amountUSD} USD) by ${name}`
  } else if (event_type === EventType.transfer) {
    const fromName = await username(from_account)
    const toName = await username(to_account)
    text += `transferred from ${fromName} to ${toName}`
  }

  if (asset_bundle) {
    text += ` (${asset_bundle.assets.length} items)`
    text += ` ${opensea.bundlePermalink(asset_bundle.slug)}`
  } else {
    text += ` ${permalink}`
  }

  return text
}

export const base64Image = async (imageURL, tokenId) => {
  return await new Promise(async (resolve) => {
    const response = await fetch(imageURL)
    const blob = await response.blob()
    const reader = new FileReader()
    reader.onload = function (ev: any) {
      const base64Image = ev.target.result
      // Format to satisfy Twitter API
      const formattedBase64Image = base64Image.replace(
        /^data:image\/png;base64,/,
        ''
      )
      resolve(formattedBase64Image)
    }
    reader.readAsDataURL(
      new File({
        name: `${tokenId}.png`,
        type: 'image/png',
        buffer: Buffer.from(await (blob as any).arrayBuffer()),
      })
    )
  })
}

const tweetEvent = async (client: any, uploadClient: any, event: any) => {
  try {
    // Fetch and upload image
    const media_data = await base64Image(
      imageForAsset(event.asset),
      event.asset.token_id
    )
    const mediaUploadResponse = await uploadClient.post('media/upload', {
      media_data,
    })

    // Create tweet
    const status = await textForTweet(event)
    await client.post('statuses/update', {
      status,
      media_ids: mediaUploadResponse.media_id_string,
    })
    console.log(
      `${logStart}Twitter - Tweeted (event id: ${event.id}): ${status}`
    )
  } catch (error) {
    console.error(`${logStart}Twitter - Error:`)
    console.error(error)
  }
}

export const tweetEvents = async (events: any[]) => {
  if (!TWITTER_EVENTS) return

  const client = new Twitter(secrets)
  const uploadClient = new Twitter({
    subdomain: 'upload',
    ...secrets,
  })

  // only handle event types specified by TWITTER_EVENTS
  const filteredEvents = events.filter((event) =>
    TWITTER_EVENTS.split(',').includes(event.event_type)
  )

  console.log(`${logStart}Twitter - Relevant events: ${filteredEvents.length}`)

  if (filteredEvents.length === 0) return

  for (const [index, event] of filteredEvents.entries()) {
    await tweetEvent(client, uploadClient, event)
    // Wait 5s between tweets
    if (filteredEvents[index + 1]) {
      await timeout(3000)
    }
  }
}
