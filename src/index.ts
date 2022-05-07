import { startClient } from './opensea'

async function main() {
  const client = startClient()

  process.on('SIGINT', () => {
    console.log('Caught interrupt signal. Stopping...')
    client.disconnect()
    process.exit()
  })
}

main()
