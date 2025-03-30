import { Addresses, BaseAddresses } from "./address";
import { encodeSpotPricePool, encodeSpotPriceSources, SpotPricePoolType } from "./codec";
import { EthereumTokens } from "./tokens";

export const ChainlinkPriceFeed: {
  [network: string]: {
    [name: string]: {
      feed: string;
      scale: bigint;
      heartbeat: number;
    };
  };
} = {
  ethereum: {
    "USDC-USD": {
      feed: "0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6",
      scale: 10n ** (18n - 8n),
      heartbeat: (86400 * 3) / 2 * 10000, // 1.5 multiple
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
  base: {
    "USDC-USD": {
      feed: "0x7e860098F58bBFC8648a4311b374B1D669a2bc6B",
      scale: 10n ** (18n - 8n),
      heartbeat: (86400 * 3) / 2 * 10000, // 1.5 multiple
    },
    "BTC-USD": {
      feed: "0x64c911996D3c6aC71f9b455B1E8E7266BcbD848F",
      scale: 10n ** (18n - 8n),
      heartbeat: 1200 * 3, // 3 multiple
    },
    "ETH-USD": {
      feed: "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70",
      scale: 10n ** (18n - 8n),
      heartbeat: 1200 * 3, // 3 multiple
    },
    "wstETH-ETH": {
      feed: "0x43a5C292A453A3bF3606fa856197f09D7B74251a",
      scale: 10n ** (18n - 18n),
      heartbeat: 86400 * 3 / 2, // 1.5 multiple
    },
    "wstETH-stETH": {
      feed: "0xB88BAc61a4Ca37C43a3725912B1f472c9A5bc061",
      scale: 10n ** (18n - 18n),
      heartbeat: 86400 * 3 / 2, // 1.5 multiple
    },
  },
};

/* eslint-disable prettier/prettier */
// prettier-ignore
export const SpotPricePool: { [name: string]: bigint } = {
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
};

export const BaseSpotPricePool: { [name: string]: bigint } = {
  "WETH/USDC_AeroCL401": encodeSpotPricePool(BaseAddresses["AeroCL_WETH/USDC_401"], SpotPricePoolType.AerodromeCL, {base_index: 0, base_scale: 0, quote_scale: 12}),
  "WETH/USDC_AeroV": encodeSpotPricePool(BaseAddresses["AeroV_WETH/USDC"], SpotPricePoolType.UniswapV2, {base_index: 0, base_scale: 0, quote_scale: 12}),
  "WETH/USDC_V3Uni500": encodeSpotPricePool(BaseAddresses["UniV3_WETH/USDC_500"], SpotPricePoolType.UniswapV3, {base_index: 0, base_scale: 0, quote_scale: 12}),
  "cbBTC/USDC_AeroCL451": encodeSpotPricePool(BaseAddresses["AeroCL_USDC/cbBTC_451"], SpotPricePoolType.AerodromeCL, {base_index: 1, base_scale: 10, quote_scale: 12}),
  "cbBTC/WETH_AeroCL501": encodeSpotPricePool(BaseAddresses["AeroCL_WETH/cbBTC_501"], SpotPricePoolType.AerodromeCL, {base_index: 1, base_scale: 10, quote_scale: 0}),
  "wstETH/WETH_AeroCL100": encodeSpotPricePool(BaseAddresses["AeroCL_WETH/wstETH_100"], SpotPricePoolType.AerodromeCL, {base_index: 1, base_scale: 0, quote_scale: 0}),
};

// prettier-ignore
export const SpotPriceEncodings: { [pair: string]: string } = {
  "WBTC/USDC": encodeSpotPriceSources([
    [SpotPricePool["WBTC/WETH-V3Uni3000"], SpotPricePool["WETH/USDC-V3Uni500"]],
    [SpotPricePool["WBTC/USDC-Crv3C0"]],
    [SpotPricePool["WBTC/USDC-V3Uni3000"]],
  ]),
  "WETH/USDC": encodeSpotPriceSources([
    [SpotPricePool["WETH/USDC-UniV2"]],
    [SpotPricePool["WETH/USDC-V3Uni500"]],
    [SpotPricePool["WETH/USDC-V3Uni3000"]],
  ]),
  "stETH/WETH": encodeSpotPriceSources([
    [SpotPricePool["stETH/wstETH-LSD"], SpotPricePool["wstETH/WETH-V3Uni100"]],
    [SpotPricePool["stETH/WETH-BalV2S"]],
    [SpotPricePool["stETH/WETH-CrvP303"]],
    [SpotPricePool["stETH/WETH-CrvB"]],
  ]),
}

export const BaseSpotPriceEncodings: { [pair: string]: string } = {
  "cbBTC/USDC": encodeSpotPriceSources([
    [BaseSpotPricePool["cbBTC/WETH_AeroCL501"], BaseSpotPricePool["WETH/USDC_AeroCL401"]],
    [BaseSpotPricePool["cbBTC/USDC_AeroCL451"]],
  ]),
  "WETH/USDC": encodeSpotPriceSources([
    [BaseSpotPricePool["WETH/USDC_AeroCL401"]],
    [BaseSpotPricePool["WETH/USDC_AeroV"]],
    [BaseSpotPricePool["WETH/USDC_V3Uni500"]],
  ]),
  "wstETH/ETH": encodeSpotPriceSources([
    [BaseSpotPricePool["wstETH/WETH_AeroCL100"]],
  ]),
}
/* eslint-enable prettier/prettier */
