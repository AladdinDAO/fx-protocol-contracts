import assert from "assert";
import { toBigInt } from "ethers";

import { Addresses } from "./address";
import { Action, encodePoolHintV3, PoolTypeV3 } from "./codec";
import { EthereumTokens } from "./tokens";

/* eslint-disable prettier/prettier */
// prettier-ignore
export const SWAP_PATH: { [name: string]:  bigint } = {
  "USDC/WETH-UniV3500": encodePoolHintV3(Addresses["UniV3_USDC/WETH_500"], PoolTypeV3.UniswapV3, 2, 0, 1, Action.Swap, {fee_num: 500}),
  "USDC/fxUSD-CrvSN193": encodePoolHintV3(Addresses["CRV_SN_USDC/fxUSD_193"], PoolTypeV3.CurveStableSwapNG, 2, 0, 1, Action.Swap),
  "fxUSD/USDC-CrvSN193": encodePoolHintV3(Addresses["CRV_SN_USDC/fxUSD_193"], PoolTypeV3.CurveStableSwapNG, 2, 1, 0, Action.Swap),
  "sfrxETH/frxETH-Frax": encodePoolHintV3(EthereumTokens.sfrxETH.address, PoolTypeV3.ERC4626, 2, 0, 0, Action.Remove),
  "frxETH/WETH-CrvSC15": encodePoolHintV3(Addresses["CRV_SC_WETH/frxETH_15"], PoolTypeV3.CurvePlainPool, 2, 1, 0, Action.Swap),
  "WETH/USDC-UniV3500": encodePoolHintV3(Addresses["UniV3_USDC/WETH_500"], PoolTypeV3.UniswapV3, 2, 1, 0, Action.Swap, {fee_num: 500}),
  "WETH/stETH-Lido": encodePoolHintV3(EthereumTokens.stETH.address, PoolTypeV3.Lido, 2, 0, 0, Action.Add),
  "stETH/WETH-CrvSB": encodePoolHintV3(Addresses["CRV_SB_ETH/stETH"], PoolTypeV3.CurvePlainPool, 2, 1, 0, Action.Swap),
  "stETH/wstETH-Lido": encodePoolHintV3(EthereumTokens.wstETH.address, PoolTypeV3.Lido, 2, 0, 0, Action.Add),
  "wstETH/stETH-Lido": encodePoolHintV3(EthereumTokens.wstETH.address, PoolTypeV3.Lido, 2, 0, 0, Action.Remove),
};
/* eslint-enable prettier/prettier */

export function encodeMultiPath(
  paths: (bigint | bigint[])[],
  parts: bigint[]
): {
  encoding: bigint;
  routes: bigint[];
} {
  assert(parts.length === paths.length, "mismatch array length");
  const sum = parts.reduce((sum, v) => sum + v, 0n);
  const routes = [];
  let encoding = 0n;
  let offset = 0;
  for (let i = 0; i < parts.length; ++i) {
    if (parts[i] === 0n) continue;
    const ratio = (parts[i] * toBigInt(0xfffff)) / sum;
    let length: bigint;
    if (typeof paths[i] === "bigint") {
      length = 1n;
      routes.push(paths[i] as bigint);
    } else if (typeof paths[i] === "object") {
      length = toBigInt((paths[i] as bigint[]).length);
      routes.push(...(paths[i] as bigint[]));
    } else {
      throw Error("invalid paths");
    }
    encoding |= ((length << 20n) | ratio) << toBigInt(offset * 32);
    offset += 1;
  }
  return { encoding, routes };
}

/* eslint-disable prettier/prettier */
// prettier-ignore
export const MULTI_PATH_CONVERTER_ROUTES: {
  [from: string]: {
    [to: string]: {
      encoding: bigint;
      routes: bigint[];
    };
  };
} = {
  USDC: {
    WETH: encodeMultiPath([SWAP_PATH["USDC/WETH-UniV3500"]], [100n]),
    fxUSD: encodeMultiPath([SWAP_PATH["USDC/fxUSD-CrvSN193"]], [100n]),
    wstETH: encodeMultiPath(
      [[SWAP_PATH["USDC/WETH-UniV3500"], SWAP_PATH["WETH/stETH-Lido"], SWAP_PATH["stETH/wstETH-Lido"]]],
      [100n]
    ),
  },
  WETH: {
    USDC: encodeMultiPath([SWAP_PATH["WETH/USDC-UniV3500"]], [100n]),
    wstETH: encodeMultiPath(
      [[SWAP_PATH["WETH/stETH-Lido"], SWAP_PATH["stETH/wstETH-Lido"]]],
      [100n]
    ),
  },
  fxUSD: {
    USDC: encodeMultiPath([SWAP_PATH["fxUSD/USDC-CrvSN193"]], [100n]),
    WETH: encodeMultiPath([[SWAP_PATH["fxUSD/USDC-CrvSN193"], SWAP_PATH["USDC/WETH-UniV3500"]]], [100n]),
    wstETH: encodeMultiPath(
      [[SWAP_PATH["fxUSD/USDC-CrvSN193"], SWAP_PATH["USDC/WETH-UniV3500"], SWAP_PATH["WETH/stETH-Lido"], SWAP_PATH["stETH/wstETH-Lido"]]],
      [100n]
    ),
  },
  sfrxETH: {
    wstETH: encodeMultiPath(
      [[SWAP_PATH["sfrxETH/frxETH-Frax"], SWAP_PATH["frxETH/WETH-CrvSC15"], SWAP_PATH["WETH/stETH-Lido"], SWAP_PATH["stETH/wstETH-Lido"]]],
      [100n]
    ),
  },
  stETH: {
    wstETH: encodeMultiPath([[SWAP_PATH["stETH/wstETH-Lido"]]], [100n]),
  },
  wstETH: {
    USDC: encodeMultiPath([[SWAP_PATH["wstETH/stETH-Lido"], SWAP_PATH["stETH/WETH-CrvSB"], SWAP_PATH["WETH/USDC-UniV3500"]]], [100n]),
    WETH: encodeMultiPath([[SWAP_PATH["wstETH/stETH-Lido"], SWAP_PATH["stETH/WETH-CrvSB"]]], [100n]),
    fxUSD: encodeMultiPath(
      [[SWAP_PATH["wstETH/stETH-Lido"], SWAP_PATH["stETH/WETH-CrvSB"], SWAP_PATH["WETH/USDC-UniV3500"], SWAP_PATH["USDC/fxUSD-CrvSN193"]]],
      [100n]
    ),
    stETH: encodeMultiPath([SWAP_PATH["wstETH/stETH-Lido"]], [100n])
  },
};
/* eslint-enable prettier/prettier */
