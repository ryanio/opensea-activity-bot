import { format } from 'timeago.js'
import Twitter from 'twitter-lite'
import { EventType } from './opensea'
import { formatAmount, imageForNFT, logStart, timeout, username } from './util'

const {
  TWITTER_EVENTS,
  TWITTER_CONSUMER_KEY,
  TWITTER_CONSUMER_SECRET,
  TWITTER_ACCESS_TOKEN,
  TWITTER_ACCESS_TOKEN_SECRET,
  TWITTER_PREPEND_TWEET,
  TWITTER_APPEND_TWEET,
} = process.env

const secrets = {
  consumer_key: TWITTER_CONSUMER_KEY,
  consumer_secret: TWITTER_CONSUMER_SECRET,
  access_token_key: TWITTER_ACCESS_TOKEN,
  access_token_secret: TWITTER_ACCESS_TOKEN_SECRET,
}

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
    text += `#${nft.identifier} `
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

export const base64Image = async (imageURL) => {
  return await new Promise(async (resolve) => {
    const response = await fetch(imageURL)
    const blob = await response.blob()
    const reader = new FileReader()
    reader.onload = function (ev: any) {
      const base64Image = ev.target.result
      // Format to satisfy Twitter API
      const formattedBase64Image = base64Image.replace(
        /^data:image\/png;base64,/,
        '',
      )
      resolve(formattedBase64Image)
    }
    reader.readAsDataURL(blob)
  })
}

const tweetEvent = async (client: any, uploadClient: any, event: any) => {
  try {
    // Fetch and upload image
    let mediaUploadResponse
    const image = imageForNFT(event.nft)
    if (image) {
      const media_data = await base64Image(image)
      mediaUploadResponse = await uploadClient.post('media/upload', {
        media_data,
      })
    }

    // Create tweet
    const status = await textForTweet(event)
    const params: any = { status }
    if (mediaUploadResponse) {
      params.media_ids = mediaUploadResponse.media_id_string
    }
    await client.post('statuses/update', params)
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

  const client = new Twitter(secrets)
  const uploadClient = new Twitter({
    subdomain: 'upload',
    ...secrets,
  })

  // only handle event types specified by TWITTER_EVENTS
  const filteredEvents = events.filter((event) =>
    TWITTER_EVENTS.split(',').includes(event.event_type),
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
