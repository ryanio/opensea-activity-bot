// Common constants used across the project

export const GLYPHBOTS_CONTRACT_ADDRESS =
  '0xb6c2c2d2999c1b532e089a7ad4cb7f8c91cf5075';

export const NULL_ADDRESS = '0x0000000000000000000000000000000000000000';
export const DEAD_ADDRESS = '0x000000000000000000000000000000000000dead';
export const NULL_ONE_ADDRESS = '0x0000000000000000000000000000000000000001';

// Event grouping aggregation defaults
export const MIN_GROUP_SIZE = 2;
export const DEFAULT_SETTLE_MS = 15_000;

// Mint event delay to allow OpenSea metadata to populate
export const DEFAULT_MINT_DELAY_SECONDS = 60;
export const MS_PER_SECOND = 1000;
export const getMintDelayMs = (): number =>
  Number(process.env.MINT_DELAY_SECONDS ?? DEFAULT_MINT_DELAY_SECONDS) *
  MS_PER_SECOND;
