import { BigNumberish, toBigInt } from "ethers";
import { network } from "hardhat";

export async function forkNetworkAndUnlockAccounts(jsonRpcUrl: string, blockNumber: number, accounts: string[]) {
  await network.provider.request({
    method: "hardhat_reset",
    params: [
      {
        forking: {
          jsonRpcUrl,
          blockNumber,
        },
      },
    ],
  });
  for (const address of accounts) {
    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [address],
    });
  }
}

export async function unlockAccounts(accounts: string[]) {
  for (const address of accounts) {
    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [address],
    });
  }
}

export async function mockETHBalance(account: string, amount: BigNumberish) {
  await network.provider.send("hardhat_setBalance", [account, "0x" + toBigInt(amount).toString(16)]);
}
