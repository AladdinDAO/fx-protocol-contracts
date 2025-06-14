import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { BFXN } from "@/types/index";

describe("bFXN", function () {
  let bFXN: BFXN;
  let minter: SignerWithAddress;
  let user: SignerWithAddress;

  const TOKEN_NAME = "bFXN";
  const TOKEN_SYMBOL = "bFXN";
  const INITIAL_AMOUNT = ethers.parseEther("1000");

  beforeEach(async function () {
    [minter, user] = await ethers.getSigners();

    const bFXNFactory = await ethers.getContractFactory("bFXN");
    bFXN = (await bFXNFactory.deploy(minter.address)) as BFXN;
    await bFXN.waitForDeployment();
  });

  describe("Initialization", function () {
    it("should initialize with correct name and symbol", async function () {
      await bFXN.initialize(TOKEN_NAME, TOKEN_SYMBOL);

      expect(await bFXN.name()).to.equal(TOKEN_NAME);
      expect(await bFXN.symbol()).to.equal(TOKEN_SYMBOL);
    });

    it("should set correct minter address", async function () {
      expect(await bFXN.minter()).to.equal(minter.address);
    });
  });

  describe("Minting", function () {
    beforeEach(async function () {
      await bFXN.initialize(TOKEN_NAME, TOKEN_SYMBOL);
    });

    it("should allow minter to mint tokens", async function () {
      await bFXN.connect(minter).mint(user.address, INITIAL_AMOUNT);
      expect(await bFXN.balanceOf(user.address)).to.equal(INITIAL_AMOUNT);
      expect(await bFXN.totalSupply()).to.equal(INITIAL_AMOUNT);

      await bFXN.connect(minter).mint(minter.address, INITIAL_AMOUNT);
      expect(await bFXN.balanceOf(minter.address)).to.equal(INITIAL_AMOUNT);
      expect(await bFXN.totalSupply()).to.equal(INITIAL_AMOUNT * 2n);
    });

    it("should revert when non-minter tries to mint", async function () {
      await expect(bFXN.connect(user).mint(user.address, INITIAL_AMOUNT)).to.be.revertedWithCustomError(
        bFXN,
        "ErrorNotMinter"
      );
    });
  });
});
