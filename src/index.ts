import { fetchEvents } from './opensea'
import { messageEvents } from './discord'
import { tweetEvents } from './twitter'
import { shortAddr } from './util'

const { DEBUG, TOKEN_ADDRESS } = process.env

export const botInterval = Number(process.env.OPENSEA_BOT_INTERVAL ?? 180)

const shortTokenAddr = shortAddr(TOKEN_ADDRESS)

async function main() {
  const run = async () => {
    const events = await fetchEvents()

    if (!events || events.length === 0) {
      return
    }

    if (DEBUG) {
      console.log(`DEBUG - ${shortTokenAddr} - Events:`)
      console.log(JSON.stringify(events))
    }

    void messageEvents(events)
    void tweetEvents(events)
  }

  run()

  const interval = setInterval(run.bind(this), botInterval * 1000)

  process.on('SIGINT', () => {
    console.log('Caught interrupt signal. Stopping...')
    clearInterval(interval)
    process.exit()
  })
}

main()
