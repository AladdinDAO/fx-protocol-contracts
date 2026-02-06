import { Addresses } from "./address.ts";
import { encodeSpotPricePool, encodeSpotPriceSources, SpotPricePoolType } from "./codec.ts";
import { EthereumTokens } from "./tokens.ts";

export const ChainlinkPriceFeed: {
  [network: string]: {
    [name: string]: {
      feed: string;
      scale: bigint;
      heartbeat: number;
    };
  };
} = {
  /*
  ethereum: {
    "USDC-USD": {
      feed: "0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6",
      scale: 10n ** (18n - 8n),
      heartbeat: (86400 * 3) / 2, // 1.5 multiple
    },
    "ETH-USD": {
      feed: "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419",
      scale: 10n ** (18n - 8n),
      heartbeat: 3600 * 3, // 3 multiple
    },
    "stETH-USD": {
      feed: "0xCfE54B5cD566aB89272946F602D76Ea879CAb4a8",
      scale: 10n ** (18n - 8n),
      heartbeat: 3600 * 3, // 3 multiple
    },
    "BTC-USD": {
      feed: "0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c",
      scale: 10n ** (18n - 8n),
      heartbeat: 3600 * 3, // 3 multiple
    },
    "WBTC-BTC": {
      feed: "0xfdFD9C85aD200c506Cf9e21F1FD8dd01932FBB23",
      scale: 10n ** (18n - 8n),
      heartbeat: (86400 * 3) / 2, // 1.5 multiple
    },
  },
  */
  katana: {
    "USDC-USD": {
      feed: "0xbe5CE90e16B9d9d988D64b0E1f6ed46EbAfb9606",
      scale: 10n ** (18n - 8n),
      heartbeat: (86400 * 3) / 2, // 1.5 multiple
    },
    "ETH-USD": {
      feed: "0x7BdBDB772f4a073BadD676A567C6ED82049a8eEE",
      scale: 10n ** (18n - 8n),
      heartbeat: (86400 * 3) / 2, // 1.5 multiple
    },
    "BTC-USD": {
      feed: "0x41DdB7F8F5e1b2bD28193B84C1C36Be698dEd162",
      scale: 10n ** (18n - 8n),
      heartbeat: (86400 * 3) / 2, // 1.5 multiple
    },
    "WBTC-BTC": {
      feed: "0xAd2937e7D25c237856B03319265465C0291b1895",
      scale: 10n ** (18n - 8n),
      heartbeat: (86400 * 3) / 2, // 1.5 multiple
    },
    "weETH-ETH": {
      feed: "0x3Eae75C0a2f9b1038C7c9993C1Da36281E838811",
      scale: 10n ** (18n - 8n),
      heartbeat: (86400 * 3) / 2, // 1.5 multiple
    },
  },
};

/* eslint-disable prettier/prettier */
// prettier-ignore
export const SpotPricePool: { [name: string]: bigint } = {
  // katana
  "ETH/USDC-Sushi500": encodeSpotPricePool(Addresses["SushiV3_USDC/ETH_500"], SpotPricePoolType.UniswapV3, {base_index: 1, base_scale: 0, quote_scale: 12}),
  "WBTC/ETH-Sushi3000": encodeSpotPricePool(Addresses["SushiV3_WBTC/ETH_3000"], SpotPricePoolType.UniswapV3, {base_index: 0, base_scale: 10, quote_scale: 0}),
  "WBTC/USDC-Sushi500": encodeSpotPricePool(Addresses["SushiV3_WBTC/USDC_500"], SpotPricePoolType.UniswapV3, {base_index: 0, base_scale: 10, quote_scale: 12}),
  // ethereum
  /*
  "WBTC/USDC-Crv3C0": encodeSpotPricePool(Addresses["CRV_3C_USDC/WBTC/WETH_0"], SpotPricePoolType.CurveTriCrypto, {base_index: 1, quote_index: 0}),
  "WBTC/USDC-V3Uni3000": encodeSpotPricePool(Addresses["UniV3_WBTC/USDC_3000"], SpotPricePoolType.UniswapV3, {base_index: 0, base_scale: 10, quote_scale: 12}),
  "WBTC/WETH-V3Uni3000": encodeSpotPricePool(Addresses["UniV3_WBTC/WETH_3000"], SpotPricePoolType.UniswapV3, {base_index: 0, base_scale: 10, quote_scale: 0}),
  "WETH/USDC-UniV2": encodeSpotPricePool(Addresses["UniV2_USDC/WETH"], SpotPricePoolType.UniswapV2, {base_index: 1, base_scale: 0, quote_scale: 12}),
  "WETH/USDC-V3Uni500": encodeSpotPricePool(Addresses["UniV3_USDC/WETH_500"], SpotPricePoolType.UniswapV3, {base_index: 1, base_scale: 0, quote_scale: 12}),
  "WETH/USDC-V3Uni3000": encodeSpotPricePool(Addresses["UniV3_USDC/WETH_3000"], SpotPricePoolType.UniswapV3, {base_index: 1, base_scale: 0, quote_scale: 12}),
  "stETH/WETH-BalV2S": encodeSpotPricePool(Addresses["BalV2_S_wstETH/WETH_1474"], SpotPricePoolType.BalancerV2Stable, {base_index: 0, quote_index: 1}),
  "stETH/WETH-CrvB": encodeSpotPricePool(Addresses["CRV_SB_ETH/stETH"], SpotPricePoolType.CurvePlain, {tokens: 2, base_index: 1, quote_index: 0, has_amm_precise: true, scales: [0, 0]}),
  "stETH/WETH-CrvP303": encodeSpotPricePool(Addresses["CRV_SP_ETH/stETH_303"], SpotPricePoolType.CurvePlainWithOracle, {base_index: 1, use_cache: true}),
  "stETH/wstETH-LSD": encodeSpotPricePool(EthereumTokens.wstETH.address, SpotPricePoolType.ETHLSD, {base_is_ETH: true}),
  "wstETH/WETH-V3Uni100": encodeSpotPricePool(Addresses["UniV3_wstETH/WETH_100"], SpotPricePoolType.UniswapV3, {base_index: 0, base_scale: 0, quote_scale: 0}),
  */
};

// prettier-ignore
export const SpotPriceEncodings: { [pair: string]: string } = {
  "WBTC/USDC": encodeSpotPriceSources([
    [SpotPricePool["WBTC/ETH-Sushi3000"], SpotPricePool["ETH/USDC-Sushi500"]],
    [SpotPricePool["WBTC/USDC-Sushi500"]],
  ]),
  "ETH/USDC": encodeSpotPriceSources([
    [SpotPricePool["ETH/USDC-Sushi500"]],
  ]),
}
/* eslint-enable prettier/prettier */
