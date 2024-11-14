export const ChainlinkPriceFeed: {
  [network: string]: {
    [name: string]: {
      feed: string;
      heartbeat: number;
    };
  };
} = {
  ethereum: {
    "USDC-USD": {
      feed: "0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6",
      heartbeat: (86400 * 3) / 2, // 1.5 multiple
    },
    "ETH-USD": {
      feed: "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419",
      heartbeat: 3600 * 3, // 3 multiple
    },
    "stETH-USD": {
      feed: "0xCfE54B5cD566aB89272946F602D76Ea879CAb4a8",
      heartbeat: 3600 * 3, // 3 multiple
    },
  },
};
