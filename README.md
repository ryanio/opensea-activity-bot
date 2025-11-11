# opensea-activity-bot

![Example Discord messages](./example-discord.png)

A TypeScript bot that automatically shares new OpenSea NFT collection events to Discord and Twitter. Perfect for NFT communities wanting to stay updated on collection activity.

## Features

- 🚀 **Real-time monitoring** of OpenSea events (sales, listings, offers, transfers, mints, burns)
- 🎯 **Multi-platform support** for Discord and Twitter
- ⚙️ **Flexible configuration** with multiple channel/event type combinations
- 📊 **Rich embeds** with NFT images and metadata
- 🛡️ **Type-safe** TypeScript implementation

## Table of Contents

- [Features](#features)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [Environment Variables](#environment-variables)
- [Usage](#usage)
- [Development](#development)
- [Testing](#testing)
- [Deployment](#deployment)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)

## Prerequisites

- Node.js 18+ 
- Yarn package manager
- OpenSea API key ([get one here](https://opensea.io/settings/developer))
- Discord bot token (for Discord integration)
- Twitter API credentials (for Twitter integration)

## Installation

```bash
# Clone the repository
git clone https://github.com/ryanio/opensea-activity-bot.git
cd opensea-activity-bot

# Install dependencies
yarn install

# Build the project
yarn build
```

## Configuration

Create a `.env` file in the root directory with your configuration:

```env
# Required
TOKEN_ADDRESS=0x...
OPENSEA_API_TOKEN=your_opensea_api_key

# Discord (optional)
DISCORD_TOKEN=your_discord_bot_token
DISCORD_EVENTS=channel_id=event_types

# Twitter (optional)  
TWITTER_CONSUMER_KEY=your_consumer_key
TWITTER_CONSUMER_SECRET=your_consumer_secret
TWITTER_ACCESS_TOKEN=your_access_token
TWITTER_ACCESS_TOKEN_SECRET=your_access_token_secret
TWITTER_EVENTS=sale,transfer

# Optional settings
CHAIN=ethereum
OPENSEA_BOT_INTERVAL=60
LOG_LEVEL=info
```

Originally developed for [@dutchtide](https://twitter.com/dutchtide)'s [𝕄𝕚𝕕𝕟𝕚𝕘𝕙𝕥 夏季 𝔹𝕣𝕖𝕖𝕫𝕖](https://opensea.io/collection/midnightbreeze) collection.

> 💡 **Tip**: To run multiple instances of this bot, check out [bot-runner](https://github.com/ryanio/bot-runner). Also see [discord-nft-embed-bot](https://github.com/ryanio/discord-nft-embed-bot) for additional Discord functionality.

## Environment Variables

### Required Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `TOKEN_ADDRESS` | Contract address of the NFT collection | `0x1234...abcd` |
| `OPENSEA_API_TOKEN` | Your OpenSea API key | Get from [OpenSea Account](https://opensea.io/settings/developer) |

### Discord Integration

| Variable | Description | Example |
|----------|-------------|---------|
| `DISCORD_TOKEN` | Discord bot token | Get from [Discord Developer Portal](https://discord.com/developers/applications) |
| `DISCORD_EVENTS` | Channel and event type mapping | `662377002338091020=listing,sale` |

**Discord Setup:**
1. [Create a Discord application](https://discord.com/developers/applications)
2. Create a bot with permissions: `Send Messages` and `Embed Links`
3. [Add bot to your server](https://discordjs.guide/preparations/adding-your-bot-to-servers.html#bot-invite-links)
4. Copy the bot token to `DISCORD_TOKEN`

**DISCORD_EVENTS Format:**
- Single channel: `CHANNEL_ID=event1,event2`
- Multiple channels: `CHANNEL_ID1=event1&CHANNEL_ID2=event2,event3`

### Twitter Integration

| Variable | Description | Example |
|----------|-------------|---------|
| `TWITTER_CONSUMER_KEY` | Twitter API consumer key | Get from [Twitter Developer Platform](https://developer.twitter.com/) |
| `TWITTER_CONSUMER_SECRET` | Twitter API consumer secret | |
| `TWITTER_ACCESS_TOKEN` | Twitter API access token | |
| `TWITTER_ACCESS_TOKEN_SECRET` | Twitter API access token secret | |
| `TWITTER_EVENTS` | Event types to tweet | `sale,transfer` |

**Twitter Setup:**
1. Create an application in the [Twitter Developer Platform](https://developer.twitter.com/)
2. Enable write permissions
3. Generate OAuth1 tokens
4. The bot uses `twitter-api-v2` with v2 API for tweets and v1.1 for media uploads

### Optional Configuration

| Variable | Description | Default | Example |
|----------|-------------|---------|---------|
| `CHAIN` | Blockchain network | `ethereum` | `ethereum`, `polygon`, `arbitrum` |
| `OPENSEA_BOT_INTERVAL` | Polling interval (seconds) | `60` | `30` |
| `MIN_OFFER_ETH` | Minimum offer amount (ETH) | `0` | `0.1` |
| `TWITTER_PREPEND_TWEET` | Text to prepend to tweets | - | `#NFT ` |
| `TWITTER_APPEND_TWEET` | Text to append to tweets | - | ` #OpenSea` |
| `LOG_LEVEL` | Log verbosity | `info` | `debug`, `info`, `warn`, `error` |

#### Event Grouping Configuration

The bot automatically groups multiple events from the same transaction or actor for cleaner posts. These settings control the grouping behavior:

| Variable | Description | Default | Example |
|----------|-------------|---------|---------|
| `TWITTER_EVENT_GROUP_MIN_GROUP_SIZE` | Min events to group together for Twitter | `2` | `5` |
| `TWITTER_EVENT_GROUP_SETTLE_MS` | Time to wait for more events (ms) for Twitter | `60000` | `300000` |
| `DISCORD_EVENT_GROUP_MIN_GROUP_SIZE` | Min events to group together for Discord | `2` | `5` |
| `DISCORD_EVENT_GROUP_SETTLE_MS` | Time to wait for more events (ms) for Discord | `60000` | `300000` |

> **Note**: Event grouping helps consolidate multiple NFT purchases/mints/burns from the same transaction or actor into a single post. For example, if someone buys 10 NFTs in one transaction, it will be posted as "10 purchased by @user for 5 ETH" instead of 10 separate posts. The default 60-second settle time also allows OpenSea metadata to populate for mint events before posting.

### Supported Event Types

| Event Type | Description |
|------------|-------------|
| `sale` | NFT sales |
| `transfer` | NFT transfers |
| `mint` | New mints |
| `listing` | New NFT listings |
| `offer` | New item offers/bids |
| `trait_offer` | New trait offers |
| `collection_offer` | New collection offers |
| `burn` | NFT burns (auto-detected from transfers) |

> **Note**: `burn` events are automatically classified from `transfer` events based on the from/to addresses.

## Usage

```bash
# Start the bot
yarn start

# Development mode (with hot reload)
yarn start:dev
```

## Development

### Setup Development Environment

```bash
# Install dependencies
yarn install

# Run in development mode
yarn start:dev

# Build the project
yarn build

# Format code
yarn format

# Lint code
yarn lint
```

### Project Structure

```
src/
├── index.ts               # Main entry point
├── opensea.ts             # OpenSea API integration
├── types.ts               # TypeScript type definitions
├── platforms/
│   ├── discord.ts         # Discord bot implementation
│   └── twitter.ts         # Twitter integration
└── utils/
    ├── aggregator.ts      # Event aggregation logic
    ├── constants.ts       # Application constants
    ├── event-grouping.ts  # Event grouping utilities
    ├── event-types.ts     # Event type definitions
    ├── events.ts          # Event processing
    ├── links.ts           # URL generation utilities
    ├── logger.ts          # Logging utilities
    ├── lru-cache.ts       # Caching implementation
    ├── queue.ts           # Event queue management
    └── utils.ts           # General utilities
```

## Testing

```bash
# Run all tests
yarn test

# Run tests with coverage
yarn test:coverage

# Run tests in CI mode
yarn test:ci
```

The project uses Jest for testing with comprehensive coverage of:
- OpenSea API integration
- Discord message formatting
- Twitter tweet generation
- Event deduplication
- Cache management
- Utility functions

## Deployment

### Recommended: DigitalOcean

I recommend DigitalOcean over Heroku for improved stability. Heroku servers can restart (cycle) which can lead to duplicate posts since the ephemeral disk is lost.

**DigitalOcean Setup ($5/month Basic Droplet):**

1. Create Ubuntu droplet
2. Install Node.js 22 and Yarn
3. Clone repository and install dependencies
4. Install PM2 for process management
5. Configure environment variables
6. Start with PM2

```bash
# Install PM2 globally
yarn global add pm2

# Start the bot
pm2 start yarn -- start

# Monitor the bot
pm2 list
pm2 logs

# Install log rotation
pm2 install pm2-logrotate

# Auto-start on reboot
pm2 startup
pm2 save
```

### Alternative: Docker

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile
COPY . .
RUN yarn build
CMD ["yarn", "start"]
```

### Environment Variables for Production

Set your environment variables in your deployment platform:

- **DigitalOcean**: Add to `/etc/profile` or use PM2 ecosystem file
- **Docker**: Use `-e` flags or `.env` file
- **Heroku**: Use `heroku config:set` commands

## Troubleshooting

### Common Issues

**Bot not posting messages:**
- Verify Discord bot has `Send Messages` and `Embed Links` permissions
- Check that bot is added to the specified channels
- Ensure `DISCORD_TOKEN` is correct

**Twitter posts failing:**
- Verify all Twitter API credentials are correct
- Check that Twitter app has write permissions
- Ensure OAuth1 tokens are properly generated

**No events detected:**
- Verify `TOKEN_ADDRESS` is correct for your collection
- Check `OPENSEA_API_TOKEN` is valid
- Ensure collection has recent activity

**Duplicate posts:**
- Check that only one instance is running
- Verify cache is working (check logs for cache hits)
- Consider using [`bot-runner`](https://github.com/ryanio/bot-runner) for multiple instances

### Debug Mode

Enable debug logging to troubleshoot issues:

```bash
LOG_LEVEL=debug yarn start
```

### Logs

The bot provides structured logging with different levels:
- `debug`: Detailed information for debugging
- `info`: General information about bot activity
- `warn`: Warning messages for potential issues
- `error`: Error messages for failures

## Contributing

### Development Workflow

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Make your changes
4. Run tests: `yarn test`
5. Format code: `yarn format`
6. Commit changes: `git commit -m 'Add amazing feature'`
7. Push to branch: `git push origin feature/amazing-feature`
8. Open a Pull Request

### Code Standards

- Follow TypeScript best practices
- Write tests for new features
- Use `yarn format` before committing
- Follow the existing code structure
- Add JSDoc comments for public APIs

### Reporting Issues

When reporting issues, please include:
- Node.js version
- Environment variables (without sensitive values)
- Error logs
- Steps to reproduce
- Expected vs actual behavior

---

Support this project by using the DigitalOcean referral badge below:

[![DigitalOcean Referral Badge](https://web-platforms.sfo2.digitaloceanspaces.com/WWW/Badge%203.svg)](https://www.digitalocean.com/?refcode=3f8c76216510&utm_campaign=Referral_Invite&utm_medium=Referral_Program&utm_source=badge)
