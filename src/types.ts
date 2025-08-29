// Shared event selection type for config (do not use TS enum per project rules)

export const BotEvent = {
  listing: 'listing',
  offer: 'offer',
  sale: 'sale',
  transfer: 'transfer',
} as const;

export type BotEvent = (typeof BotEvent)[keyof typeof BotEvent];

export const allBotEvents = [
  BotEvent.listing,
  BotEvent.offer,
  BotEvent.sale,
  BotEvent.transfer,
] as const satisfies readonly BotEvent[];

export const botEventSet: ReadonlySet<string> = new Set(allBotEvents);
