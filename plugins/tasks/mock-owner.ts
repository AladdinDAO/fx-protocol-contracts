import { ethers, toQuantity, ZeroHash } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types/hre";

import {
  AaveFundingPool__factory,
  OwnershipFacet__factory,
  PoolManager__factory,
  ProxyAdmin__factory,
  ShortPoolManager__factory,
} from "@/types/index.ts";
import { HttpNetworkConfig } from "hardhat/types/config";

interface MockOwnerTaskArguments {
  owner: string;
}

export default async function (args: MockOwnerTaskArguments, hre: HardhatRuntimeEnvironment) {
  const { owner } = args;
  const conn = await hre.network.connect();
  const url = await (conn.networkConfig as HttpNetworkConfig).url.get();
  const rpc = new ethers.JsonRpcProvider(url);
  const admin = "0x26B2ec4E02ebe2F54583af25b647b1D619e67BbF";
  const ProxyAdminInterface = ProxyAdmin__factory.createInterface();
  const AaveFundingPoolInterface = AaveFundingPool__factory.createInterface();
  const PoolManagerInterface = PoolManager__factory.createInterface();
  const ShortPoolManagerInterface = ShortPoolManager__factory.createInterface();
  const OwnershipFacetInterface = OwnershipFacet__factory.createInterface();

  await rpc.send("tenderly_addBalance", [owner, toQuantity(ethers.parseEther("1000"))]);
  await rpc.send("eth_sendTransaction", [
    {
      from: admin,
      to: "0x9b54b7703551d9d0ced177a78367560a8b2edda4",
      data: ProxyAdminInterface.encodeFunctionData("transferOwnership", [owner]),
    },
  ]);
  await rpc.send("eth_sendTransaction", [
    {
      from: admin,
      to: "0x6Ecfa38FeE8a5277B91eFdA204c235814F0122E8",
      data: AaveFundingPoolInterface.encodeFunctionData("grantRole", [ZeroHash, owner]),
    },
  ]);
  await rpc.send("eth_sendTransaction", [
    {
      from: admin,
      to: "0x250893ca4ba5d05626c785e8da758026928fcd24",
      data: PoolManagerInterface.encodeFunctionData("grantRole", [ZeroHash, owner]),
    },
  ]);
  await rpc.send("eth_sendTransaction", [
    {
      from: admin,
      to: "0xaCDc0AB51178d0Ae8F70c1EAd7d3cF5421FDd66D",
      data: ShortPoolManagerInterface.encodeFunctionData("grantRole", [ZeroHash, owner]),
    },
  ]);
  await rpc.send("eth_sendTransaction", [
    {
      from: admin,
      to: "0x33636d49fbefbe798e15e7f356e8dbef543cc708",
      data: OwnershipFacetInterface.encodeFunctionData("transferOwnership", [owner]),
    },
  ]);
}
