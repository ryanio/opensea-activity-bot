import { format } from 'timeago.js'
import { TwitterApi } from 'twitter-api-v2'
import type { TwitterApiReadWrite } from 'twitter-api-v2'
import sharp from 'sharp'
import { EventType } from './opensea'
import { formatAmount, imageForNFT, logStart, timeout, username } from './util'

const {
  TWITTER_EVENTS,
  // OAuth1 tokens
  TWITTER_CONSUMER_KEY,
  TWITTER_CONSUMER_SECRET,
  TWITTER_ACCESS_TOKEN,
  TWITTER_ACCESS_TOKEN_SECRET,
  TWITTER_PREPEND_TWEET,
  TWITTER_APPEND_TWEET,
  TOKEN_ADDRESS,
} = process.env

const textForTweet = async (event: any) => {
  const {
    asset,
    event_type,
    payment,
    from_address,
    to_address,
    order_type,
    maker,
    buyer,
    expiration_date,
  } = event

  let { nft } = event
  if (!nft && asset) {
    nft = asset
  }

  let text = ''

  if (TWITTER_PREPEND_TWEET) {
    text += `${TWITTER_PREPEND_TWEET} `
  }

  if (nft) {
    // Special display for GlyphBots collection (contract 0xb6c2...5075)
    const specialContract =
      TOKEN_ADDRESS?.toLowerCase() ===
      '0xb6c2c2d2999c1b532e089a7ad4cb7f8c91cf5075'

    if (specialContract && nft.name && nft.identifier) {
      // nft.name example: "GlyphBot #211 - Snappy the Playful" → we want "Snappy the Playful #211"
      const nameParts = String(nft.name).split(' - ')
      const suffix = nameParts.length > 1 ? nameParts[1].trim() : undefined
      if (suffix) {
        text += `${suffix} #${nft.identifier} `
      } else {
        text += `#${nft.identifier} `
      }
    } else {
      text += `#${nft.identifier} `
    }
  }

  if (event_type === 'order') {
    const { quantity, decimals, symbol } = payment
    const name = await username(maker)
    const price = formatAmount(quantity, decimals, symbol)
    if (order_type === 'auction') {
      const inTime = format(new Date(expiration_date * 1000))
      text += `auction started for ${price}, ends ${inTime}, by ${name}`
    } else if (order_type === 'listing') {
      text += `listed on sale for ${price} by ${name}`
    } else if (order_type === 'item_offer') {
      text += `has a new offer for ${price} by ${name}`
    } else if (order_type === 'collection_offer') {
      text += `has a new collection offer for ${price} by ${name}`
    } else if (order_type === 'trait_offer') {
      text += `has a new trait offer for ${price} by ${name}`
    }
  } else if (event_type === EventType.sale) {
    const { quantity, decimals, symbol } = payment
    const amount = formatAmount(quantity, decimals, symbol)
    const name = await username(buyer)
    text += `purchased for ${amount} by ${name}`
  } else if (event_type === EventType.transfer) {
    const fromName = await username(from_address)
    const toName = await username(to_address)
    text += `transferred from ${fromName} to ${toName}`
  }

  if (nft.identifier) {
    text += ` ${nft.opensea_url}`
  }

  if (TWITTER_APPEND_TWEET) {
    text += ` ${TWITTER_APPEND_TWEET}`
  }

  return text
}

export const base64Image = async (imageURL: string) => {
  const response = await fetch(imageURL)
  const arrayBuffer = await response.arrayBuffer()
  let buffer: Buffer = Buffer.from(new Uint8Array(arrayBuffer)) as Buffer
  const contentType = response.headers.get('content-type') ?? undefined
  let mimeType = contentType?.split(';')[0] ?? 'image/jpeg'

  // If it's an SVG, convert to PNG for Twitter media API compatibility
  if (mimeType === 'image/svg+xml' || imageURL.toLowerCase().endsWith('.svg')) {
    try {
      buffer = (await sharp(buffer).png().toBuffer()) as Buffer
      mimeType = 'image/png'
    } catch (e) {
      console.error(`${logStart}Twitter - SVG to PNG conversion failed, tweeting without media`)
    }
  }

  return { buffer, mimeType }
}

const tweetEvent = async (
  client: TwitterApi | TwitterApiReadWrite,
  event: any,
) => {
  try {
    // Fetch and upload image
    let mediaId: string | undefined
    const image = imageForNFT(event.nft)
    if (image) {
      try {
        const { buffer, mimeType } = await base64Image(image)
        mediaId = await client.v1.uploadMedia(buffer, { mimeType })
      } catch (uploadError) {
        console.error(`${logStart}Twitter - Media upload failed, tweeting without media:`)
        console.error(uploadError)
      }
    }

    // Create tweet
    const status = await textForTweet(event)
    const tweetParams: any = mediaId
      ? { text: status, media: { media_ids: [mediaId] } }
      : { text: status }
    await client.v2.tweet(tweetParams)
    console.log(
      `${logStart}Twitter - Tweeted (event id: ${event.id}): ${status}`,
    )
  } catch (error) {
    console.error(`${logStart}Twitter - Error:`)
    console.error(error)
  }
}

export const tweetEvents = async (events: any[]) => {
  if (!TWITTER_EVENTS) return

  if (
    !TWITTER_CONSUMER_KEY ||
    !TWITTER_CONSUMER_SECRET ||
    !TWITTER_ACCESS_TOKEN ||
    !TWITTER_ACCESS_TOKEN_SECRET
  ) {
    console.error(
      `${logStart}Twitter - Missing OAuth1 credentials. Require TWITTER_CONSUMER_KEY, TWITTER_CONSUMER_SECRET, TWITTER_ACCESS_TOKEN, TWITTER_ACCESS_TOKEN_SECRET`,
    )
    return
  }

  const client = new TwitterApi({
    appKey: TWITTER_CONSUMER_KEY,
    appSecret: TWITTER_CONSUMER_SECRET,
    accessToken: TWITTER_ACCESS_TOKEN,
    accessSecret: TWITTER_ACCESS_TOKEN_SECRET,
  }).readWrite

  // only handle event types specified by TWITTER_EVENTS
  const filteredEvents = events.filter((event) =>
    TWITTER_EVENTS.split(',').includes(event.event_type),
  )

  console.log(`${logStart}Twitter - Relevant events: ${filteredEvents.length}`)

  if (filteredEvents.length === 0) return

  for (const [index, event] of filteredEvents.entries()) {
    await tweetEvent(client, event)
    // Wait 5s between tweets
    if (filteredEvents[index + 1]) {
      await timeout(3000)
    }
  }
}
