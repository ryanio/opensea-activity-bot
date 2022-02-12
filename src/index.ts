import { fetchEvents } from './opensea'
import { messageEvents } from './discord'
import { tweetEvents } from './twitter'
import { botInterval, logStart } from './util'

const { DEBUG } = process.env

async function main() {
  const run = async () => {
    const events = await fetchEvents()
    if (!events || events.length === 0) return

    if (DEBUG) {
      console.log(`${logStart}Opensea - DEBUG - Events:`)
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
