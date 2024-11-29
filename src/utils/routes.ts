import assert from "assert";
import { toBigInt } from "ethers";

import { Addresses } from "./address";
import { Action, encodePoolHintV3, PoolTypeV3 } from "./codec";
import { EthereumTokens } from "./tokens";

/* eslint-disable prettier/prettier */
// prettier-ignore
export const PATH_ENCODING: { [name: string]:  bigint } = {
  "USDC/WETH-UniV3500": encodePoolHintV3(Addresses["UniV3_USDC/WETH_500"], PoolTypeV3.UniswapV3, 2, 0, 1, Action.Swap, {fee_num: 500}),
  "USDC/fxUSD-CrvSN193": encodePoolHintV3(Addresses["CRV_SN_USDC/fxUSD_193"], PoolTypeV3.CurveStableSwapNG, 2, 0, 1, Action.Swap),
  "fxUSD/USDC-CrvSN193": encodePoolHintV3(Addresses["CRV_SN_USDC/fxUSD_193"], PoolTypeV3.CurveStableSwapNG, 2, 1, 0, Action.Swap),
  "sfrxETH/frxETH-Frax": encodePoolHintV3(EthereumTokens.sfrxETH.address, PoolTypeV3.ERC4626, 2, 0, 0, Action.Remove),
  "frxETH/WETH-CrvSC15": encodePoolHintV3(Addresses["CRV_SC_WETH/frxETH_15"], PoolTypeV3.CurvePlainPool, 2, 1, 0, Action.Swap),
  "WETH/stETH-Lido": encodePoolHintV3(EthereumTokens.stETH.address, PoolTypeV3.Lido, 2, 0, 0, Action.Add),
  "stETH/wstETH-Lido": encodePoolHintV3(EthereumTokens.wstETH.address, PoolTypeV3.Lido, 2, 0, 0, Action.Add),
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
    fxUSD: encodeMultiPath([PATH_ENCODING["USDC/fxUSD-CrvSN193"]], [100n]),
    wstETH: encodeMultiPath(
      [[PATH_ENCODING["USDC/WETH-UniV3500"], PATH_ENCODING["WETH/stETH-Lido"], PATH_ENCODING["stETH/wstETH-Lido"]]],
      [100n]
    ),
  },
  WETH: {
    wstETH: encodeMultiPath(
      [[PATH_ENCODING["WETH/stETH-Lido"], PATH_ENCODING["stETH/wstETH-Lido"]]],
      [100n]
    ),
  },
  fxUSD: {
    USDC: encodeMultiPath([PATH_ENCODING["fxUSD/USDC-CrvSN193"]], [100n]),
    wstETH: encodeMultiPath(
      [[PATH_ENCODING["fxUSD/USDC-CrvSN193"], PATH_ENCODING["USDC/WETH-UniV3500"], PATH_ENCODING["WETH/stETH-Lido"], PATH_ENCODING["stETH/wstETH-Lido"]]],
      [100n]
    ),
  },
  sfrxETH: {
    wstETH: encodeMultiPath(
      [[PATH_ENCODING["sfrxETH/frxETH-Frax"], PATH_ENCODING["frxETH/WETH-CrvSC15"], PATH_ENCODING["WETH/stETH-Lido"], PATH_ENCODING["stETH/wstETH-Lido"]]],
      [100n]
    ),
  },
  stETH: {
    wstETH: encodeMultiPath([[PATH_ENCODING["stETH/wstETH-Lido"]]], [100n]),
  }
};
/* eslint-enable prettier/prettier */
