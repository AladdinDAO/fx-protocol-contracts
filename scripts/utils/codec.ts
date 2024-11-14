export function encodeChainlinkPriceFeed(feed: string, scale: bigint, heartbeat: number): bigint {
  return (BigInt(feed) << 96n) | (scale << 32n) | BigInt(heartbeat);
}
