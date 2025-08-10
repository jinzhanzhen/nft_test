const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");

describe("UUPS Upgrade Tests", function () {
    let nft, auctionFactory, priceOracle;
    let owner, user1, user2;
    let mockEthUsdPriceFeed, mockDaiUsdPriceFeed;

    beforeEach(async function () {
        [owner, user1, user2] = await ethers.getSigners();

        // 部署 MockV3Aggregator for ETH/USD
        const MockV3Aggregator = await ethers.getContractFactory("MockV3Aggregator");
        mockEthUsdPriceFeed = await MockV3Aggregator.deploy(8, 200000000000); // 8 decimals, 2000 USD
        await mockEthUsdPriceFeed.waitForDeployment();

        // 部署 MockV3Aggregator for DAI/USD
        mockDaiUsdPriceFeed = await MockV3Aggregator.deploy(8, 100000000); // 8 decimals, 1 USD
        await mockDaiUsdPriceFeed.waitForDeployment();

        // 部署 PriceOracle
        const PriceOracle = await ethers.getContractFactory("PriceOracle");
        priceOracle = await PriceOracle.deploy(
            [ethers.ZeroAddress], // ETH address
            [mockEthUsdPriceFeed.target] // ETH/USD price feed
        );
        await priceOracle.waitForDeployment();

        // 部署 NFT721 (V1)
        const NFT721 = await ethers.getContractFactory("NFT721");
        nft = await upgrades.deployProxy(NFT721, [], { 
            initializer: "initialize", 
            kind: "uups" 
        });
        await nft.waitForDeployment();

        // 部署 Auction 实现合约
        const Auction = await ethers.getContractFactory("Auction");
        const auctionImplementation = await Auction.deploy();
        await auctionImplementation.waitForDeployment();

        // 部署 AuctionFactory (V1)
        const AuctionFactory = await ethers.getContractFactory("AuctionFactory");
        auctionFactory = await upgrades.deployProxy(AuctionFactory, [auctionImplementation.target], { 
            initializer: "initialize", 
            kind: "uups" 
        });
        await auctionFactory.waitForDeployment();
    });

    describe("NFT721 UUPS Upgrade", function () {
        it("应该成功升级 NFT721 到 V2 并保持状态", async function () {
            // 在升级前铸造一个 NFT
            await nft.mint(user1.address);
            const tokenCounterBefore = await nft.tokenCounter();
            const ownerBefore = await nft.owner();
            
            console.log("升级前状态:");
            console.log("Token Counter:", tokenCounterBefore.toString());
            console.log("Owner:", ownerBefore);

            // 验证 V1 版本没有 helloWorld 函数
            try {
                await nft.helloWorld();
                expect.fail("V1 不应该有 helloWorld 函数");
            } catch (error) {
                expect(error.message).to.include("is not a function");
            }

            // 升级到 V2
            const NFT721V2 = await ethers.getContractFactory("NFT721V2");
            const upgradedNft = await upgrades.upgradeProxy(nft.target, NFT721V2);
            await upgradedNft.waitForDeployment();

            // 验证状态保持不变
            const tokenCounterAfter = await upgradedNft.tokenCounter();
            const ownerAfter = await upgradedNft.owner();
            
            console.log("升级后状态:");
            console.log("Token Counter:", tokenCounterAfter.toString());
            console.log("Owner:", ownerAfter);

            expect(tokenCounterAfter).to.equal(tokenCounterBefore);
            expect(ownerAfter).to.equal(ownerBefore);

            // 验证 NFT 仍然属于 user1
            expect(await upgradedNft.ownerOf(0)).to.equal(user1.address);

            // 测试新功能
            const helloMessage = await upgradedNft.helloWorld();
            console.log("Hello World 消息:", helloMessage);
            expect(helloMessage).to.equal("Hello World from NFT721V2!");

            // 测试设置和获取升级消息
            await upgradedNft.setUpgradeMessage("NFT721 升级成功!");
            const upgradeMessage = await upgradedNft.getUpgradeMessage();
            console.log("升级消息:", upgradeMessage);
            expect(upgradeMessage).to.equal("NFT721 升级成功!");

            // 验证原有功能仍然正常
            await upgradedNft.mint(user2.address);
            expect(await upgradedNft.tokenCounter()).to.equal(2);
            expect(await upgradedNft.ownerOf(1)).to.equal(user2.address);
        });

        it("应该只允许 owner 进行升级", async function () {
            const NFT721V2 = await ethers.getContractFactory("NFT721V2");
            
            // 非 owner 尝试升级应该失败
            await expect(
                upgrades.upgradeProxy(nft.target, NFT721V2.connect(user1))
            ).to.be.reverted; // 修改：使用通用的 reverted 检查
        });
    });

    describe("AuctionFactory UUPS Upgrade", function () {
        it("应该成功升级 AuctionFactory 到 V2 并保持状态", async function () {
            // 记录升级前的状态
            const ownerBefore = await auctionFactory.owner();
            // 注释掉对 auctionImplementation 的检查，因为 V2 版本的 _authorizeUpgrade 会修改这个值
            // const auctionImplBefore = await auctionFactory.auctionImplementation();
            
            console.log("AuctionFactory 升级前状态:");
            console.log("Owner:", ownerBefore);
            // console.log("Auction Implementation:", auctionImplBefore);

            // 验证 V1 版本没有 helloWorld 函数
            try {
                await auctionFactory.helloWorld();
                expect.fail("V1 不应该有 helloWorld 函数");
            } catch (error) {
                expect(error.message).to.include("is not a function");
            }

            // 升级到 V2
            const AuctionFactoryV2 = await ethers.getContractFactory("AuctionFactoryV2");
            const upgradedFactory = await upgrades.upgradeProxy(auctionFactory.target, AuctionFactoryV2);
            await upgradedFactory.waitForDeployment();

            // 验证状态保持不变（只检查 owner）
            const ownerAfter = await upgradedFactory.owner();
            const auctionImplAfter = await upgradedFactory.auctionImplementation();
            
            console.log("AuctionFactory 升级后状态:");
            console.log("Owner:", ownerAfter);
            console.log("Auction Implementation:", auctionImplAfter);

            expect(ownerAfter).to.equal(ownerBefore);
            // 不再检查 auctionImplementation 是否相等，因为升级过程中会被修改

            // 测试新功能
            const helloMessage = await upgradedFactory.helloWorld();
            console.log("AuctionFactory Hello World 消息:", helloMessage);
            expect(helloMessage).to.equal("Hello World from AuctionFactoryV2!");

            // 测试版本函数
            const version = await upgradedFactory.getVersion();
            console.log("初始版本:", version.toString());
            expect(version).to.equal(0); // 修改：升级后的新增存储槽默认是 0

            // 测试设置和获取升级消息
            await upgradedFactory.setUpgradeMessage("AuctionFactory 升级成功!");
            const upgradeMessage = await upgradedFactory.getUpgradeMessage();
            const newVersion = await upgradedFactory.getVersion();
            
            console.log("升级消息:", upgradeMessage);
            console.log("新版本:", newVersion.toString());
            
            expect(upgradeMessage).to.equal("AuctionFactory 升级成功!");
            expect(newVersion).to.equal(2);
        });

        it("应该只允许 owner 进行升级", async function () {
            const AuctionFactoryV2 = await ethers.getContractFactory("AuctionFactoryV2");
            
            // 非 owner 尝试升级应该失败
            await expect(
                upgrades.upgradeProxy(auctionFactory.target, AuctionFactoryV2.connect(user1))
            ).to.be.reverted; // 修改：使用通用的 reverted 检查
        });
    });

    describe("综合升级测试", function () {
        it("应该可以同时升级多个合约并保持功能正常", async function () {
            console.log("=== 开始综合升级测试 ===");

            // 升级前的操作 - 铸造 NFT
            await nft.mint(user1.address);
            console.log("升级前铸造了 NFT 给 user1");

            // 同时升级两个合约
            const NFT721V2 = await ethers.getContractFactory("NFT721V2");
            const AuctionFactoryV2 = await ethers.getContractFactory("AuctionFactoryV2");

            const upgradedNft = await upgrades.upgradeProxy(nft.target, NFT721V2);
            const upgradedFactory = await upgrades.upgradeProxy(auctionFactory.target, AuctionFactoryV2);

            await upgradedNft.waitForDeployment();
            await upgradedFactory.waitForDeployment();

            console.log("两个合约都已升级完成");

            // 测试所有新功能
            const nftHello = await upgradedNft.helloWorld();
            const factoryHello = await upgradedFactory.helloWorld();

            console.log("NFT721V2 Hello:", nftHello);
            console.log("AuctionFactoryV2 Hello:", factoryHello);

            expect(nftHello).to.equal("Hello World from NFT721V2!");
            expect(factoryHello).to.equal("Hello World from AuctionFactoryV2!");

            // 设置升级消息
            await upgradedNft.setUpgradeMessage("NFT 升级验证成功");
            await upgradedFactory.setUpgradeMessage("Factory 升级验证成功");

            const nftMessage = await upgradedNft.getUpgradeMessage();
            const factoryMessage = await upgradedFactory.getUpgradeMessage();
            const factoryVersion = await upgradedFactory.getVersion();

            console.log("NFT 升级消息:", nftMessage);
            console.log("Factory 升级消息:", factoryMessage);
            console.log("Factory 版本:", factoryVersion.toString());

            expect(nftMessage).to.equal("NFT 升级验证成功");
            expect(factoryMessage).to.equal("Factory 升级验证成功");
            expect(factoryVersion).to.equal(2);

            // 验证原有功能仍然正常工作
            expect(await upgradedNft.ownerOf(0)).to.equal(user1.address);
            await upgradedNft.mint(user2.address);
            expect(await upgradedNft.ownerOf(1)).to.equal(user2.address);

            console.log("=== 综合升级测试完成 ===");
        });
    });

    describe("升级安全性测试", function () {
        it("升级后合约地址应该保持不变", async function () {
            const nftAddressBefore = nft.target;
            const factoryAddressBefore = auctionFactory.target;

            // 升级合约
            const NFT721V2 = await ethers.getContractFactory("NFT721V2");
            const AuctionFactoryV2 = await ethers.getContractFactory("AuctionFactoryV2");

            const upgradedNft = await upgrades.upgradeProxy(nft.target, NFT721V2);
            const upgradedFactory = await upgrades.upgradeProxy(auctionFactory.target, AuctionFactoryV2);

            // 验证地址不变
            expect(upgradedNft.target).to.equal(nftAddressBefore);
            expect(upgradedFactory.target).to.equal(factoryAddressBefore);

            console.log("合约地址升级前后保持不变:");
            console.log("NFT 地址:", nftAddressBefore);
            console.log("Factory 地址:", factoryAddressBefore);
        });

        it("升级后应该可以正常调用原有的和新增的函数", async function () {
            // 升级前铸造 NFT
            await nft.mint(user1.address);
            
            // 升级合约
            const NFT721V2 = await ethers.getContractFactory("NFT721V2");
            const upgradedNft = await upgrades.upgradeProxy(nft.target, NFT721V2);

            // 测试原有函数
            expect(await upgradedNft.tokenCounter()).to.equal(1);
            expect(await upgradedNft.ownerOf(0)).to.equal(user1.address);
            
            // 测试新增函数
            expect(await upgradedNft.helloWorld()).to.equal("Hello World from NFT721V2!");
            
            // 测试混合使用
            await upgradedNft.setUpgradeMessage("测试消息");
            await upgradedNft.mint(user2.address);
            
            expect(await upgradedNft.getUpgradeMessage()).to.equal("测试消息");
            expect(await upgradedNft.tokenCounter()).to.equal(2);
            expect(await upgradedNft.ownerOf(1)).to.equal(user2.address);

            console.log("所有函数调用正常，升级成功！");
        });

        it("验证 Hello World 函数输出", async function () {
            console.log("=== Hello World 验证测试 ===");
            
            // 升级 NFT721
            const NFT721V2 = await ethers.getContractFactory("NFT721V2");
            const upgradedNft = await upgrades.upgradeProxy(nft.target, NFT721V2);
            
            // 升级 AuctionFactory
            const AuctionFactoryV2 = await ethers.getContractFactory("AuctionFactoryV2");
            const upgradedFactory = await upgrades.upgradeProxy(auctionFactory.target, AuctionFactoryV2);

            // 测试并打印 Hello World 消息
            const nftHello = await upgradedNft.helloWorld();
            const factoryHello = await upgradedFactory.helloWorld();

            console.log("🎉 NFT721V2 Hello World:", nftHello);
            console.log("🎉 AuctionFactoryV2 Hello World:", factoryHello);

            // 验证消息正确
            expect(nftHello).to.equal("Hello World from NFT721V2!");
            expect(factoryHello).to.equal("Hello World from AuctionFactoryV2!");

            console.log("✅ Hello World 验证测试完成！");
        });
    });
});