import { fetchEvents } from './opensea'
import { messageEvents } from './discord'
import { tweetEvents } from './twitter'

const { DEBUG } = process.env
const OPENSEA_BOT_INTERVAL = Number(process.env.OPENSEA_BOT_INTERVAL ?? 60)

async function main() {
  const run = async () => {
    const events = await fetchEvents()

    if (!events || events.length === 0) {
      return
    }

    if (DEBUG) {
      console.log('DEBUG - Events:')
      console.log(JSON.stringify(events))
    }

    void messageEvents(events)
    void tweetEvents(events)
  }

  run()

  const interval = setInterval(run.bind(this), OPENSEA_BOT_INTERVAL * 1000)

  process.on('SIGINT', () => {
    console.log('Caught interrupt signal. Stopping...')
    clearInterval(interval)
    process.exit()
  })
}

main()
