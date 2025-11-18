// Common constants used across the project

export const GLYPHBOTS_CONTRACT_ADDRESS =
  "0xb6c2c2d2999c1b532e089a7ad4cb7f8c91cf5075";

export const NULL_ADDRESS = "0x0000000000000000000000000000000000000000";
export const DEAD_ADDRESS = "0x000000000000000000000000000000000000dead";
export const NULL_ONE_ADDRESS = "0x0000000000000000000000000000000000000001";

// Event grouping aggregation defaults
// Default settle time is 60s to allow OpenSea metadata to populate for mint events
export const MIN_GROUP_SIZE = 2;
export const DEFAULT_SETTLE_MS = 60_000;

// Milliseconds per second (for utility conversions)
export const MS_PER_SECOND = 1000;
