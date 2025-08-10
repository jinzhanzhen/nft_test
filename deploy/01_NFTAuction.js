const { ethers, upgrades } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  
  console.log("Deploying contracts with account:", deployer.address);
  console.log("Account balance:", (await ethers.provider.getBalance(deployer.address)).toString());

  // 部署ERC721合约
  const NFT721 = await ethers.getContractFactory("NFT721");
  const nft721 = await upgrades.deployProxy(NFT721, [], { initializer: "initialize", kind: "uups"});
  await nft721.waitForDeployment();
  console.log("NFT721 deployed to:", await nft721.getAddress());

  // 部署PriceOracle合约 - 移除decimals参数
  const PriceOracle = await ethers.getContractFactory("PriceOracle");
  const tokens = [
    ethers.ZeroAddress, // 使用ethers.ZeroAddress替代constants.AddressZero
    "0x68194a729C2450ad26072b3D6Ad77C52D44c8c5B", // 替换为WETH地址
  ];
  const aggregators = [
    "0xD4a33860578De61DBAbDc8BFdb98FD742fA7028e",  // WETH/USD 聚合器地址
    "0x0d79df66BE487753B02D015Fb622DED7f0E9798d",  // ETH/USD 聚合器地址
  ];
  const oracle = await PriceOracle.deploy(tokens, aggregators);
  await oracle.waitForDeployment();
  console.log("PriceOracle deployed to:", await oracle.getAddress());

  // 先部署Auction实现合约
  const Auction = await ethers.getContractFactory("Auction");
  const auctionImpl = await Auction.deploy();
  await auctionImpl.waitForDeployment();
  console.log("Auction implementation deployed to:", await auctionImpl.getAddress());

  // 部署AuctionFactory合约
  const AuctionFactory = await ethers.getContractFactory("AuctionFactory");
  const auctionFactory = await upgrades.deployProxy(AuctionFactory, [await auctionImpl.getAddress()], { initializer: "initialize", kind: "uups"});
  await auctionFactory.waitForDeployment();
  console.log("AuctionFactory deployed to:", await auctionFactory.getAddress());

  // 铸造NFT
  await nft721.mint(deployer.address);
  console.log("NFT minted to deployer");

  // 创建拍卖合约
  const tx = await auctionFactory.createAuction(
    await nft721.getAddress(),
    0,
    Math.floor(Date.now() / 1000) + 60,
    Math.floor(Date.now() / 1000) + 300,
    await oracle.getAddress()
  );
  await tx.wait();
  
  const auctionAddr = await auctionFactory.getAuction(0);
  console.log("Auction created at:", auctionAddr);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
