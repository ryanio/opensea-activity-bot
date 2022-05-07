# opensea-activity-bot

![Example Discord messages](./example-discord.png)

A bot that shares new OpenSea events for a collection to Discord and Twitter.

Designed to handle multiple output configurations, like a Discord activity feed and a Twitter sales feed.

Originally developed for [@dutchtide](https://twitter.com/dutchtide)'s [𝕄𝕚𝕕𝕟𝕚𝕘𝕙𝕥 夏季 𝔹𝕣𝕖𝕖𝕫𝕖](https://opensea.io/collection/midnightbreeze) collection, on Twitter at [@mbsalesbot](https://twitter.com/mbsalesbot).

An OpenSea API key is needed - [request one here](https://docs.opensea.io/reference/request-an-api-key).

To run multiple instances of this bot at once check out [bot-runner](https://github.com/ryanio/bot-runner). Also check out [discord-nft-embed-bot](https://github.com/ryanio/discord-nft-embed-bot).

## Setup

### Env

Please define the env variables outlined in this section for the repository to work as intended.

- `COLLECTIONS`
  - Comma-separated list of collection token addresses or slugs
  - Collections will react on all specified event types. To customize events for each collection, run multiple copies of this bot with [bot-runner](https://github.com/ryanio/bot-runner)

**Valid event types**

Valid string values for event types to react on are:

- `item_listed`
- `item_sold`
- `item_received_offer`
- `item_received_bid`
- `item_cancelled`
- `item_transferred`
- `item_metadata_updated`

#### Project-specific

#### APIs

- `OPENSEA_API_TOKEN`
- `INFURA_PROJECT_ID` (for ENS lookup when no username is available)

#### To share on Discord

- `DISCORD_EVENTS`
  - The Discord channel ID with a comma-separated list of event types for the bot to send through discord
    - e.g. `662377002338091020=successful`
  - For multiple channels separate with an ampersand (&)
    - e.g. `662377002338091020=successful,created,cancelled&924064011820077076=bid_entered,bid_withdrawn`
- `DISCORD_TOKEN`
  - To get your `DISCORD_TOKEN`, [create a Discord app](https://discord.com/developers/applications). Create a bot with the permissions: `Send Messages` and `Embed Links`. Then [add your bot to your server](https://discordjs.guide/preparations/adding-your-bot-to-servers.html#bot-invite-links).
  - The `DISCORD_TOKEN` looks like this: `OTE5MzY5ODIyNzEyNzc5NzUz.YBuz2g.x1rGh4zx_XlSNj43oreukvlwsfw`

If your discord bot is not able to post messages ensure it is added to the channels you've specified and it has the permissions to `Send Messages` and `Embed Links`.

#### To tweet

- `TWITTER_EVENTS`
  - Comma separated list of event types for the bot to tweet
  - e.g. `item_sold,item_received_offer`

Create an application in the [Twitter Developer Platform](https://developer.twitter.com/) and provide:

- `TWITTER_CONSUMER_KEY`
- `TWITTER_CONSUMER_SECRET`
- `TWITTER_ACCESS_TOKEN`
- `TWITTER_ACCESS_TOKEN_SECRET`

Ensure your key is created with "write" permissions, the default key may be "read" only. If that happens you will get an error when trying to tweet; you can regenerate and provide the updated key.

#### Optional

- `MIN_OFFER_USD`
  - Offers or bids less than this amount will be ignored (default: 100)
- `TWEET_PREPEND_TWEET`
  - Message to add to start of tweet, such as a hashtag
- `TWEET_APPEND_TWEET`
  - Message to add to end of tweet, such as a hashtag

### Run

`yarn start`

#### Running on a server

My preferred setup is a $5/month Basic Droplet with Ubuntu. Install Node v16 and yarn, clone this repo, cd into it, run `yarn`, install [pm2](https://pm2.keymetrics.io/) with `yarn global add pm2`, set env vars, run `pm2 start yarn -- start`. Monitor with `pm2 list` and `pm2 logs`. Add log rotation module to keep default max 10mb of logs with `pm2 install pm2-logrotate`. To respawn after reboot, set your env vars in `/etc/profile`, then run `pm2 startup` and `pm2 save`.

You can support this repository (and get your first two months free) with the referral badge below:

[![DigitalOcean Referral Badge](https://web-platforms.sfo2.digitaloceanspaces.com/WWW/Badge%203.svg)](https://www.digitalocean.com/?refcode=3f8c76216510&utm_campaign=Referral_Invite&utm_medium=Referral_Program&utm_source=badge)

##### Heroku

A `Procfile` is included for easy use.

Clone this repo, push it to heroku, set up the environment variables above, and spin up a worker with `heroku ps:scale web=0 worker=1`

Then watch the logs with `heroku logs --tail`

## Collections using this bot

Please open a Pull Request to add your bot below! ❤️

<!-- prettier-ignore -->
|Collection|Twitter|Discord|
|----------|-------|-------|
|Midnight Breeze|[@mbsalesbot](https://twitter.com/mbsalesbot)|✅ activity channel|
|Heroes of Evermore|[@herosalesbot](https://twitter.com/herosalesbot)||
