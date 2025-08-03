import { toQuantity, ZeroHash } from "ethers";
import { task } from "hardhat/config";

task("mock-owner", "Mock owner")
  .addParam("owner", "The address of the owner")
  .setAction(async ({ owner }, hre) => {
    const { ethers } = hre;
    const rpc = new ethers.JsonRpcProvider((hre.network.config as any).url);

    const admin = "0x26B2ec4E02ebe2F54583af25b647b1D619e67BbF";
    const ProxyAdmin = await hre.ethers.getContractAt("ProxyAdmin", "0x9b54b7703551d9d0ced177a78367560a8b2edda4");
    const WstETHPool = await hre.ethers.getContractAt("AaveFundingPool", "0x6Ecfa38FeE8a5277B91eFdA204c235814F0122E8");
    const PoolManager = await hre.ethers.getContractAt("PoolManager", "0x250893ca4ba5d05626c785e8da758026928fcd24");
    const ShortPoolManager = await hre.ethers.getContractAt("ShortPoolManager", "0xaCDc0AB51178d0Ae8F70c1EAd7d3cF5421FDd66D");
    const OwnershipFacet = await hre.ethers.getContractAt(
      "OwnershipFacet",
      "0x33636d49fbefbe798e15e7f356e8dbef543cc708"
    );

    await rpc.send("tenderly_addBalance", [owner, toQuantity(ethers.parseEther("1000"))]);
    await rpc.send("eth_sendTransaction", [
      {
        from: admin,
        to: await ProxyAdmin.getAddress(),
        data: ProxyAdmin.interface.encodeFunctionData("transferOwnership", [owner]),
      },
    ]);
    await rpc.send("eth_sendTransaction", [
      {
        from: admin,
        to: await WstETHPool.getAddress(),
        data: WstETHPool.interface.encodeFunctionData("grantRole", [ZeroHash, owner]),
      },
    ]);
    await rpc.send("eth_sendTransaction", [
      {
        from: admin,
        to: await PoolManager.getAddress(),
        data: PoolManager.interface.encodeFunctionData("grantRole", [ZeroHash, owner]),
      },
    ]);
    await rpc.send("eth_sendTransaction", [
      {
        from: admin,
        to: await ShortPoolManager.getAddress(),
        data: ShortPoolManager.interface.encodeFunctionData("grantRole", [ZeroHash, owner]),
      },
    ]);
    await rpc.send("eth_sendTransaction", [
      {
        from: admin,
        to: await OwnershipFacet.getAddress(),
        data: OwnershipFacet.interface.encodeFunctionData("transferOwnership", [owner]),
      },
    ]);

    const MockAggregatorV3Interface = await hre.ethers.getContractFactory("MockAggregatorV3Interface");
    const deployTx = await MockAggregatorV3Interface.getDeployTransaction(8, 100000000n);
    await rpc.send("eth_sendTransaction", [
      {
        from: owner,
        data: deployTx.data,
      },
    ]);
  });
