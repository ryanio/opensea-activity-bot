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
import { File, FileReader } from 'file-api'
import { format as timeAgo } from 'timeago.js'
import fetch from 'node-fetch'
import Twitter from 'twitter-lite'
import {
  Event,
  formatAmount,
  formatUSD,
  imageForEvent,
  logStart,
  username,
} from './util'

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

const tweetForEvent = async (event: Event) => {
  const { event_type, payload } = event
  const { item, quantity } = payload as any
  const { nft_id, permalink } = item

  let text = ''

  if (TWITTER_PREPEND_TWEET) {
    text += `${TWITTER_PREPEND_TWEET} `
  }

  const id = nft_id.split(/[\/]+/).pop()
  text += `#${id} `

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
      const name = await username(maker)
      switch (listing_type) {
        case 'english': {
          const price = formatAmount(base_price, decimals, symbol)
          const priceUSD = formatUSD(price, usd_price)
          const inTime = timeAgo(new Date(expiration_date))
          text += `English auction started for ${price} ($${priceUSD} USD), ends ${inTime}, by ${name}`
          break
        }
        case 'dutch': {
          const price = formatAmount(base_price, decimals, symbol)
          const priceUSD = formatUSD(price, usd_price)
          const inTime = timeAgo(new Date(expiration_date))
          text += `Reverse Dutch auction started for ${price} ($${priceUSD} USD) ends ${inTime} by ${name}`
          // ends at ${endPrice} ($${endPriceUSD} USD) ${inTime}
          break
        }
        case 'listing': {
          const price = formatAmount(base_price, decimals, symbol)
          const priceUSD = formatUSD(price, usd_price)
          const inTime = timeAgo(new Date(expiration_date))
          text += `listed on sale for ${price} ($${priceUSD} USD) for ${inTime} by ${name}`
          break
        }
        default:
          throw new Error(`unknown event_type: ${event_type}`)
      }
    }
    case EventType.ITEM_SOLD: {
      const { sale_price, payment_token, taker } =
        payload as ItemSoldEventPayload
      const { symbol, decimals, usd_price } = payment_token
      const amount = formatAmount(sale_price, decimals, symbol)
      const amountUSD = formatUSD(amount, usd_price)
      const name = await username(taker)
      text += `purchased for ${amount} ($${amountUSD} USD) by ${name}`
      break
    }
    case EventType.ITEM_CANCELLED: {
      const { listing_type } = payload as ItemCancelledEventPayload
      text += `${listing_type} listing cancelled`
      // for ${price} ($${priceUSD} USD) by ${name}
      break
    }
    case EventType.ITEM_RECEIVED_OFFER: {
      const { base_price, maker, payment_token } =
        payload as ItemReceivedOfferEventPayload
      const { symbol, decimals, usd_price } = payment_token
      const amount = formatAmount(base_price, decimals, symbol)
      const amountUSD = formatUSD(amount, usd_price)
      const name = await username(maker)
      text += `offer entered for ${amount} ($${amountUSD} USD) by ${name}`
      break
    }
    case EventType.ITEM_RECEIVED_BID: {
      const { base_price, maker, payment_token } =
        payload as ItemReceivedBidEventPayload
      const { symbol, decimals, usd_price } = payment_token
      const amount = formatAmount(base_price, decimals, symbol)
      const amountUSD = formatUSD(amount, usd_price)
      const name = await username(maker)
      text += `bid entered for ${amount} ($${amountUSD} USD) by ${name}`
      break
    }
    case EventType.ITEM_TRANSFERRED: {
      const { from_account, to_account } =
        payload as ItemTransferredEventPayload
      const fromName = await username(from_account)
      const toName = await username(to_account)
      text += `transferred from ${fromName} to ${toName}`
      break
    }
    case EventType.ITEM_METADATA_UPDATED: {
      const {} = payload as ItemMetadataUpdatePayload
      text += `metadata updated`
      break
    }
    default:
      throw new Error(`unknown event_type: ${event_type}`)
  }

  if (quantity && quantity > 1) {
    text += ` (quantity: ${quantity})`
  }

  text += ` ${permalink}`

  if (TWITTER_APPEND_TWEET) {
    text += ` ${TWITTER_APPEND_TWEET}`
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

const tweet = async (
  client: Twitter,
  uploadClient: Twitter,
  event: Event,
  collectionIndex: number
) => {
  try {
    // Fetch and upload image
    const media_data = await base64Image(
      imageForEvent(event),
      event.payload.item.nft_id
    )
    const mediaUploadResponse = await uploadClient.post('media/upload', {
      media_data,
    })

    // Create tweet
    const status = await tweetForEvent(event)
    await client.post('statuses/update', {
      status,
      media_ids: mediaUploadResponse.media_id_string,
    })
    console.log(`${logStart[collectionIndex]}Twitter - Tweeted: ${status}`)
  } catch (error) {
    console.error(`${logStart[collectionIndex]}Twitter - Error:`)
    console.error(error)
  }
}

export const tweetEvent = async (event: Event, collectionIndex: number) => {
  if (
    !TWITTER_EVENTS ||
    !TWITTER_EVENTS.split(',').includes(event.event_type)
  ) {
    return
  }

  const client = new Twitter(secrets)
  const uploadClient = new Twitter({
    subdomain: 'upload',
    ...secrets,
  })

  tweet(client, uploadClient, event, collectionIndex)
}
