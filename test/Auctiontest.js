const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");

async function deployMockAggregator(price) {
  const MockAggregator = await ethers.getContractFactory("MockV3Aggregator");
  return await MockAggregator.deploy(8,price);
}

describe("Auction Flow", () => {
  let deployer, seller, bidder1, bidder2;
  let nft, oracle, factory, auction;
  let ethAggregator;

  beforeEach(async () => {
    [deployer, seller, bidder1, bidder2] = await ethers.getSigners();

    //部署MockAggregator
    const MockV3Aggregator = await ethers.getContractFactory("MockV3Aggregator");
    ethAggregator = await MockV3Aggregator.deploy(8,200000000000);
    await ethAggregator.waitForDeployment();
    
    // 部署NFT
    const ERC721NFT = await ethers.getContractFactory("NFT721");
    nft = await upgrades.deployProxy(ERC721NFT, [], { initializer: "initialize", kind: "uups" });
    await nft.waitForDeployment();
    
    // 铸造NFT给卖家
    await nft.mint(seller.address);
    
    // 部署预言机
    const PriceOracle = await ethers.getContractFactory("PriceOracle");
    oracle = await PriceOracle.deploy([ethers.ZeroAddress], [await ethAggregator.getAddress()]);
    await oracle.waitForDeployment();
    
    // 部署拍卖实现合约
    const Auction = await ethers.getContractFactory("Auction");
    const auctionImpl = await Auction.deploy();
    await auctionImpl.waitForDeployment();
    
    // 部署拍卖工厂
    const AuctionFactory = await ethers.getContractFactory("AuctionFactory");
    factory = await upgrades.deployProxy(AuctionFactory, [await auctionImpl.getAddress()], { 
      initializer: "initialize",
      kind: "uups"
    });
    await factory.waitForDeployment();
    
    // 卖家授权并创建拍卖
    await nft.connect(seller).approve(await factory.getAddress(), 0);
    const startTime = Math.floor(Date.now() / 1000) + 10;
    const endTime = startTime + 86400;
    
    await factory.connect(seller).createAuction(
      await nft.getAddress(), 
      0, 
      startTime,
      endTime,
      await oracle.getAddress()
    );
    
    const auctionAddr = await factory.getAuction(0);
    auction = await ethers.getContractAt("Auction", auctionAddr);

    
  });

  it("should complete auction flow", async () => {
    // 等待拍卖开始
    await ethers.provider.send("evm_increaseTime", [15]);
    await ethers.provider.send("evm_mine");
    
    // 出价1 (ETH)
    const bid1 = ethers.parseEther("1.0");
    await auction.connect(bidder1).bid(bid1, ethers.ZeroAddress, {
      value: bid1
    });
    
    // 时间前进
    await ethers.provider.send("evm_increaseTime", [86400]);
    await ethers.provider.send("evm_mine");
    
    // 结束拍卖
    await auction.connect(seller).endAuction();
    
    // 验证结果
    expect(await nft.ownerOf(0)).to.equal(bidder1.address);

    //打印合约地址
    console.log("nft地址:", await nft.getAddress());
    console.log("oracle地址:", await oracle.getAddress());
    console.log("factory地址:", await factory.getAddress());
    console.log("auction地址:", await auction.getAddress());
  });
});