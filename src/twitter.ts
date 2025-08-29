import { format } from "timeago.js";
import { TwitterApi } from "twitter-api-v2";
import type { TwitterApiReadWrite } from "twitter-api-v2";
import sharp from "sharp";
import { EventType, opensea } from "./opensea";
import {
	formatAmount,
	imageForNFT,
	logStart,
	timeout,
	username,
} from "./utils";
import { LRUCache } from "./lruCache";

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
} = process.env;

// In-memory dedupe for tweeted events
const tweetedEventsCache = new LRUCache<string, boolean>(2000);

// Queue + backoff config
const PER_TWEET_DELAY_MS = Number(process.env.TWITTER_QUEUE_DELAY_MS ?? 3000);
const BACKOFF_BASE_MS = Number(process.env.TWITTER_BACKOFF_BASE_MS ?? 15000);
const BACKOFF_MAX_MS = Number(
	process.env.TWITTER_BACKOFF_MAX_MS ?? 15 * 60 * 1000,
);

type TweetQueueItem = { event: any; attempts: number };
const tweetQueue: TweetQueueItem[] = [];
let isProcessing = false;
let pauseUntilMs = 0;
let twitterClient:
	| (TwitterApi & TwitterApiReadWrite)
	| TwitterApiReadWrite
	| undefined;
let dailyLimitActive = false;
let dailyLimitSnapshotKeys: string[] | undefined;

const jitter = (ms: number) => {
	const delta = Math.floor(ms * 0.2);
	return ms + Math.floor(Math.random() * (2 * delta + 1)) - delta;
};

const calcBackoffMs = (attempts: number) => {
	const exp = BACKOFF_BASE_MS * Math.pow(2, Math.max(0, attempts - 1));
	return Math.min(jitter(exp), BACKOFF_MAX_MS);
};

const keyForQueueItem = (item: TweetQueueItem): string => {
	if (item?.event?.kind === "sweep") {
		const tx =
			item?.event?.txHash ?? txHashFor(item?.event?.events?.[0]) ?? "unknown";
		return `sweep:${tx}`;
	}
	return eventKeyFor(item.event);
};

const markDeduped = (item: TweetQueueItem) => {
	if (item?.event?.kind === "sweep" && Array.isArray(item?.event?.events)) {
		for (const e of item.event.events) {
			const key = eventKeyFor(e);
			tweetedEventsCache.put(key, true);
		}
		return;
	}
	const key = eventKeyFor(item.event);
	tweetedEventsCache.put(key, true);
};

const eventKeyFor = (event: any): string => {
	const ts = String(event?.event_timestamp ?? "");
	const nft = event?.nft ?? event?.asset ?? {};
	const tokenId = String(nft?.identifier ?? nft?.token_id ?? "");
	return `${ts}|${tokenId}`;
};

const txHashFor = (event: any): string | undefined => {
	return (
		event?.transaction?.hash ||
		event?.transaction_hash ||
		event?.tx_hash ||
		event?.hash ||
		undefined
	);
};

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
	} = event;

	let { nft } = event;
	if (!nft && asset) {
		nft = asset;
	}

	let text = "";

	if (TWITTER_PREPEND_TWEET) {
		text += `${TWITTER_PREPEND_TWEET} `;
	}

	if (nft) {
		// Special display for GlyphBots collection (contract 0xb6c2...5075)
		const specialContract =
			TOKEN_ADDRESS?.toLowerCase() ===
			"0xb6c2c2d2999c1b532e089a7ad4cb7f8c91cf5075";

		if (specialContract && nft.name && nft.identifier) {
			// nft.name example: "GlyphBot #211 - Snappy the Playful" → we want "Snappy the Playful #211"
			const nameParts = String(nft.name).split(" - ");
			const suffix = nameParts.length > 1 ? nameParts[1].trim() : undefined;
			if (suffix) {
				text += `${suffix} #${nft.identifier} `;
			} else {
				text += `#${nft.identifier} `;
			}
		} else {
			text += `#${nft.identifier} `;
		}
	}

	if (event_type === "order") {
		const { quantity, decimals, symbol } = payment;
		const name = await username(maker);
		const price = formatAmount(quantity, decimals, symbol);
		if (order_type === "auction") {
			const inTime = format(new Date(expiration_date * 1000));
			text += `auction started for ${price}, ends ${inTime}, by ${name}`;
		} else if (order_type === "listing") {
			text += `listed on sale for ${price} by ${name}`;
		} else if (order_type === "item_offer") {
			text += `has a new offer for ${price} by ${name}`;
		} else if (order_type === "collection_offer") {
			text += `has a new collection offer for ${price} by ${name}`;
		} else if (order_type === "trait_offer") {
			text += `has a new trait offer for ${price} by ${name}`;
		}
	} else if (event_type === EventType.sale) {
		const { quantity, decimals, symbol } = payment;
		const amount = formatAmount(quantity, decimals, symbol);
		const name = await username(buyer);
		text += `purchased for ${amount} by ${name}`;
	} else if (event_type === EventType.transfer) {
		const fromName = await username(from_address);
		const toName = await username(to_address);
		text += `transferred from ${fromName} to ${toName}`;
	}

	if (nft.identifier) {
		text += ` ${nft.opensea_url}`;
	}

	if (TWITTER_APPEND_TWEET) {
		text += ` ${TWITTER_APPEND_TWEET}`;
	}

	return text;
};

export const base64Image = async (imageURL: string) => {
	const response = await fetch(imageURL);
	const arrayBuffer = await response.arrayBuffer();
	let buffer: Buffer = Buffer.from(new Uint8Array(arrayBuffer)) as Buffer;
	const contentType = response.headers.get("content-type") ?? undefined;
	let mimeType = contentType?.split(";")[0] ?? "image/jpeg";

	// If it's an SVG, convert to PNG for Twitter media API compatibility
	if (mimeType === "image/svg+xml" || imageURL.toLowerCase().endsWith(".svg")) {
		try {
			buffer = (await sharp(buffer).png().toBuffer()) as Buffer;
			mimeType = "image/png";
		} catch (e) {
			console.error(
				`${logStart}Twitter - SVG to PNG conversion failed, tweeting without media`,
			);
		}
	}

	return { buffer, mimeType };
};

const tweetEvent = async (
	client: TwitterApi | TwitterApiReadWrite,
	event: any,
) => {
	// Sweep group handling
	if (event?.kind === "sweep" && Array.isArray(event?.events)) {
		const group: any[] = event.events;
		const count = group.length;
		const images: string[] = [];
		for (const e of group) {
			const url = imageForNFT(e.nft ?? e.asset);
			if (url) images.push(url);
			if (images.length >= 4) break;
		}

		const media_ids: string[] = [];
		for (const imageUrl of images) {
			try {
				const { buffer, mimeType } = await base64Image(imageUrl);
				const id = await client.v1.uploadMedia(buffer, { mimeType });
				media_ids.push(id);
			} catch (uploadError) {
				console.error(
					`${logStart}Twitter - Sweep media upload failed; continuing:`,
				);
				console.error(uploadError);
			}
		}

		let text = "";
		if (TWITTER_PREPEND_TWEET) text += `${TWITTER_PREPEND_TWEET} `;
		text += `${count} purchased`;
		const activityUrl = `${opensea.collectionURL()}/activity`;
		text += ` ${activityUrl}`;
		if (TWITTER_APPEND_TWEET) text += ` ${TWITTER_APPEND_TWEET}`;

		const params: any =
			media_ids.length > 0 ? { text, media: { media_ids } } : { text };
		await client.v2.tweet(params);
		for (const e of group) {
			const key = eventKeyFor(e);
			tweetedEventsCache.put(key, true);
		}
		console.log(`${logStart}Twitter - Sweep tweeted: ${count} items`);
		return;
	}

	// Single-event handling
	let mediaId: string | undefined;
	const image = imageForNFT(event.nft);
	if (image) {
		try {
			const { buffer, mimeType } = await base64Image(image);
			mediaId = await client.v1.uploadMedia(buffer, { mimeType });
		} catch (uploadError) {
			console.error(
				`${logStart}Twitter - Media upload failed, tweeting without media:`,
			);
			console.error(uploadError);
		}
	}

	const status = await textForTweet(event);
	const tweetParams: any = mediaId
		? { text: status, media: { media_ids: [mediaId] } }
		: { text: status };
	await client.v2.tweet(tweetParams);
	const key = eventKeyFor(event);
	console.log(`${logStart}Twitter - Tweeted (event key: ${key}): ${status}`);
	tweetedEventsCache.put(key, true);
};

const processQueue = async (client: TwitterApi | TwitterApiReadWrite) => {
	if (isProcessing) return;
	isProcessing = true;
	try {
		// eslint-disable-next-line no-constant-condition
		while (tweetQueue.length > 0) {
			const now = Date.now();
			if (pauseUntilMs > now) {
				const waitMs = pauseUntilMs - now;
				console.log(
					`${logStart}Twitter - Paused until reset. Waiting ${Math.ceil(waitMs / 1000)}s…`,
				);
				await timeout(waitMs);
				pauseUntilMs = 0;
				if (dailyLimitActive) {
					const maxAfterReset = 5;
					const snapshot =
						dailyLimitSnapshotKeys ?? tweetQueue.map((i) => keyForQueueItem(i));
					const keepKeys = new Set(snapshot.slice(-maxAfterReset));
					const originalLen = tweetQueue.length;
					const newQueue: TweetQueueItem[] = [];
					let dropped = 0;
					for (const item of tweetQueue) {
						const key = keyForQueueItem(item);
						const wasInSnapshot = snapshot.includes(key);
						if (wasInSnapshot && !keepKeys.has(key)) {
							// Drop from processing but mark deduped
							markDeduped(item);
							dropped += 1;
							continue;
						}
						newQueue.push(item);
					}
					tweetQueue.length = 0;
					for (const item of newQueue) tweetQueue.push(item);
					console.log(
						`${logStart}Twitter - Daily limit reset. Keeping ${Math.min(snapshot.length, maxAfterReset)} from snapshot, dropped ${dropped}, queue now ${tweetQueue.length}/${originalLen}.`,
					);
					dailyLimitSnapshotKeys = undefined;
					dailyLimitActive = false;
				}
			}

			const item = tweetQueue[0];
			const key = eventKeyFor(item.event);
			if (tweetedEventsCache.get(key)) {
				console.log(
					`${logStart}Twitter - Skipping duplicate (event key: ${key})`,
				);
				tweetQueue.shift();
				continue;
			}

			try {
				await tweetEvent(client, item.event);
				tweetQueue.shift();
				if (tweetQueue.length > 0) {
					await timeout(PER_TWEET_DELAY_MS);
				}
			} catch (error: any) {
				const errCode = error?.code;
				const rateLimit = error?.rateLimit;
				if (errCode === 429) {
					const dayRemaining = rateLimit?.day?.remaining;
					const dayReset = rateLimit?.day?.reset;
					if (dayRemaining === 0 && typeof dayReset === "number") {
						const targetMs = dayReset * 1000;
						const waitMs = Math.max(targetMs - Date.now(), BACKOFF_BASE_MS);
						pauseUntilMs = Date.now() + waitMs;
						dailyLimitActive = true;
						// Snapshot keys to identify which items were queued at the time limit was hit
						dailyLimitSnapshotKeys = tweetQueue.map((i) => keyForQueueItem(i));
						console.error(
							`${logStart}Twitter - Daily limit reached. Pausing for ${Math.ceil(waitMs / 1000)}s (until ${new Date(pauseUntilMs).toISOString()}).`,
						);
						// do not shift; retry same item after pause
						continue;
					}
					item.attempts += 1;
					const waitMs = calcBackoffMs(item.attempts);
					console.error(
						`${logStart}Twitter - 429. Backing off ${Math.ceil(waitMs / 1000)}s (attempt ${item.attempts}).`,
					);
					await timeout(waitMs);
					continue;
				}

				// 5xx or transient
				const status = error?.data?.status ?? error?.status;
				if (status >= 500 || status === 0 || error?.name === "FetchError") {
					item.attempts += 1;
					const waitMs = calcBackoffMs(item.attempts);
					console.error(
						`${logStart}Twitter - Server/transient error. Backing off ${Math.ceil(waitMs / 1000)}s (attempt ${item.attempts}).`,
					);
					await timeout(waitMs);
					continue;
				}

				// Unrecoverable client error: drop
				console.error(
					`${logStart}Twitter - Unrecoverable error, dropping event:`,
				);
				console.error(error);
				tweetQueue.shift();
			}
		}
	} finally {
		isProcessing = false;
	}
};

export const tweetEvents = async (events: any[]) => {
	if (!TWITTER_EVENTS) return;

	if (
		!TWITTER_CONSUMER_KEY ||
		!TWITTER_CONSUMER_SECRET ||
		!TWITTER_ACCESS_TOKEN ||
		!TWITTER_ACCESS_TOKEN_SECRET
	) {
		console.error(
			`${logStart}Twitter - Missing OAuth1 credentials. Require TWITTER_CONSUMER_KEY, TWITTER_CONSUMER_SECRET, TWITTER_ACCESS_TOKEN, TWITTER_ACCESS_TOKEN_SECRET`,
		);
		return;
	}

	if (!twitterClient) {
		twitterClient = new TwitterApi({
			appKey: TWITTER_CONSUMER_KEY,
			appSecret: TWITTER_CONSUMER_SECRET,
			accessToken: TWITTER_ACCESS_TOKEN,
			accessSecret: TWITTER_ACCESS_TOKEN_SECRET,
		}).readWrite;
	}

	// only handle event types specified by TWITTER_EVENTS
	const filteredEvents = events.filter((event) =>
		TWITTER_EVENTS.split(",").includes(event.event_type),
	);

	console.log(`${logStart}Twitter - Relevant events: ${filteredEvents.length}`);

	if (filteredEvents.length === 0) return;

	// Group by transaction hash for sweeps
	const hashToEvents = new Map<string, any[]>();
	for (const event of filteredEvents) {
		const tx = txHashFor(event);
		if (!tx) continue;
		if (!hashToEvents.has(tx)) hashToEvents.set(tx, []);
		hashToEvents.get(tx)!.push(event);
	}

	const groupedHashes = new Set<string>();
	for (const [hash, evts] of hashToEvents.entries()) {
		if (evts.length > 4) {
			groupedHashes.add(hash);
			// Enqueue one sweep item
			tweetQueue.push({
				event: { kind: "sweep", txHash: hash, events: evts },
				attempts: 0,
			});
		}
	}

	// Enqueue remaining individual events
	for (const event of filteredEvents) {
		const key = eventKeyFor(event);
		if (tweetedEventsCache.get(key)) {
			console.log(
				`${logStart}Twitter - Skipping duplicate (event key: ${key})`,
			);
			continue;
		}
		const tx = txHashFor(event);
		if (tx && groupedHashes.has(tx)) continue; // covered by sweep tweet
		tweetQueue.push({ event, attempts: 0 });
	}

	// Fire and forget
	void processQueue(twitterClient);
};
