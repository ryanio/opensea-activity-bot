# opensea-activity-bot

![Example Discord messages](./example-discord.png)

A bot that shares new OpenSea events for a collection to Discord and Twitter.

Designed to handle multiple output configurations, like a Discord activity feed and a Twitter sales feed.

Originally developed for [@dutchtide](https://twitter.com/dutchtide)'s [𝕄𝕚𝕕𝕟𝕚𝕘𝕙𝕥 夏季 𝔹𝕣𝕖𝕖𝕫𝕖](https://opensea.io/collection/midnightbreeze) collection.

An OpenSea API key is needed - create one in your account.

To run multiple instances of this bot at once check out [bot-runner](https://github.com/ryanio/bot-runner). Also check out [discord-nft-embed-bot](https://github.com/ryanio/discord-nft-embed-bot).

## Setup

### Env

Please define the env variables outlined in this section for the repository to work as intended.

**Valid event types**

Valid string values for event types to react on are:

- `listing`
- `offer`
- `sale`
- `transfer`

#### Project-specific

- `CHAIN`
  - Value from [OpenSea Supported Chains](https://docs.opensea.io/reference/supported-chains). Defaults to `ethereum`.
- `TOKEN_ADDRESS`

#### APIs

- `OPENSEA_API_TOKEN`

#### To share on Discord

- `DISCORD_EVENTS`
  - The Discord channel ID with a comma separated list of event types for the bot to send through discord
    - e.g. `662377002338091020=order,sale`
  - For multiple channels separate with an ampersand (&)
    - e.g. `662377002338091020=order&924064011820077076=sale,transfer`
- `DISCORD_TOKEN`
  - To get your `DISCORD_TOKEN`, [create a Discord app](https://discord.com/developers/applications). Create a bot with the permissions: `Send Messages` and `Embed Links`. Then [add your bot to your server](https://discordjs.guide/preparations/adding-your-bot-to-servers.html#bot-invite-links).
  - The `DISCORD_TOKEN` looks like this: `OTE5MzY5ODIyNzEyNzc5NzUz.YBuz2g.x1rGh4zx_XlSNj43oreukvlwsfw`

If your discord bot is not able to post messages ensure it is added to the channels you've specified and it has the permissions to `Send Messages` and `Embed Links`.

#### To tweet

- `TWITTER_EVENTS`
  - Comma separated list of event types for the bot to tweet
  - e.g. `sale,transfer`

Create an application in the [Twitter Developer Platform](https://developer.twitter.com/) and provide:

- `TWITTER_CONSUMER_KEY`
- `TWITTER_CONSUMER_SECRET`
- `TWITTER_ACCESS_TOKEN`
- `TWITTER_ACCESS_TOKEN_SECRET`

Ensure your key is created with "write" permissions, the default key may be "read" only. If that happens you will get an error when trying to tweet; you can regenerate and provide the updated key.

#### Optional

- `OPENSEA_BOT_INTERVAL`
  - Number of seconds interval for the bot to run (default: 60)
- `QUERY_LIMIT`
  - Limit for the OpenSea Events query (default: 50)
- `MIN_OFFER_ETH`
  - Offers or bids less than this amount will be ignored (default: 0)
- `TWITTER_PREPEND_TWEET`
  - Message to add to start of tweet, such as a hashtag
- `TWITTER_APPEND_TWEET`
  - Message to add to end of tweet, such as a hashtag

### Run

`yarn start`

#### Running on a server

I recommend to use DigitalOcean over Heroku for improved stability. Heroku servers can restart (cycle) which can lead to duplicate posts since the ephemeral disk is lost.

My preferred setup is a $5/month Basic Droplet with Ubuntu. Install Node v16 and yarn, clone this repo, cd into it, run `yarn`, install [pm2](https://pm2.keymetrics.io/) with `yarn global add pm2`, set env vars, run `pm2 start yarn -- start`. Monitor with `pm2 list` and `pm2 logs`. Add log rotation module to keep default max 10mb of logs with `pm2 install pm2-logrotate`. To respawn after reboot, set your env vars in `/etc/profile`, then run `pm2 startup` and `pm2 save`.

Support this project by using the referral badge below:

[![DigitalOcean Referral Badge](https://web-platforms.sfo2.digitaloceanspaces.com/WWW/Badge%203.svg)](https://www.digitalocean.com/?refcode=3f8c76216510&utm_campaign=Referral_Invite&utm_medium=Referral_Program&utm_source=badge)
