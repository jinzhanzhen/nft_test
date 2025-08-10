const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");

describe("CrossChainAuction Tests", function () {
    let crossChainAuction, nft, priceOracle, linkToken;
    let owner, bidder1, bidder2;
    let mockEthUsdPriceFeed;

    // 模拟的 CCIP 配置
    const MOCK_ROUTER = "0x1234567890123456789012345678901234567890";
    const MOCK_LINK_TOKEN = "0x0987654321098765432109876543210987654321";
    const SEPOLIA_CHAIN_SELECTOR = "16015286601757825753";
    const GOERLI_CHAIN_SELECTOR = "5009297550715157269";

    beforeEach(async function () {
        [owner, bidder1, bidder2] = await ethers.getSigners();

        // 部署 MockV3Aggregator
        const MockV3Aggregator = await ethers.getContractFactory("MockV3Aggregator");
        mockEthUsdPriceFeed = await MockV3Aggregator.deploy(8, 200000000000); // 2000 USD
        await mockEthUsdPriceFeed.waitForDeployment();

        // 部署 PriceOracle
        const PriceOracle = await ethers.getContractFactory("PriceOracle");
        priceOracle = await PriceOracle.deploy(
            [ethers.ZeroAddress],
            [mockEthUsdPriceFeed.target]
        );
        await priceOracle.waitForDeployment();

        // 部署 NFT721
        const NFT721 = await ethers.getContractFactory("NFT721");
        nft = await upgrades.deployProxy(NFT721, [], { 
            initializer: "initialize", 
            kind: "uups" 
        });
        await nft.waitForDeployment();

        // 铸造测试 NFT 并批准转移
        await nft.mint(owner.address);

        // 部署一个真实的 ERC20 代币作为 LINK 代币用于测试
        const MockERC20 = await ethers.getContractFactory("MockERC20");
        linkToken = await MockERC20.deploy(
            "ChainLink Token",
            "LINK",
            18,
            ethers.parseEther("1000000") // 1M LINK
        );
        await linkToken.waitForDeployment();

        // 设置拍卖时间
        const currentTime = Math.floor(Date.now() / 1000);
        const auctionStartTime = currentTime + 10; // 10 seconds from now
        const auctionEndTime = currentTime + 3600; // 1 hour from now

        // 部署跨链拍卖合约
        const CrossChainAuction = await ethers.getContractFactory("CrossChainAuction");
        
        // 先部署合约但不调用初始化函数
        crossChainAuction = await upgrades.deployProxy(
            CrossChainAuction,
            [], // 先不传参数，使用空初始化
            { 
                initializer: false, // 先不调用初始化
                kind: "uups"
            }
        );
        await crossChainAuction.waitForDeployment();

        // 现在批准 NFT 转移
        await nft.approve(crossChainAuction.target, 0);

        // 调用初始化函数
        await crossChainAuction.initialize(
            nft.target,
            0, // tokenId
            auctionStartTime,
            auctionEndTime,
            owner.address,
            priceOracle.target,
            linkToken.target, // 使用真实部署的 ERC20 代币合约地址
            [GOERLI_CHAIN_SELECTOR], // 支持的链
            ["0x1111111111111111111111111111111111111111"], // 模拟的跨链合约地址
            MOCK_ROUTER // CCIP 路由器地址
        );
    });

    describe("基础功能测试", function () {
        it("正确初始化跨链拍卖合约", async function () {
            expect(await crossChainAuction.nftContract()).to.equal(nft.target);
            expect(await crossChainAuction.nftTokenId()).to.equal(0);
            expect(await crossChainAuction.owner()).to.equal(owner.address);
            expect(await crossChainAuction.ended()).to.equal(false);

            // 检查支持的链
            expect(await crossChainAuction.allowedSourceChains(GOERLI_CHAIN_SELECTOR)).to.equal(true);
            expect(await crossChainAuction.crossChainAuctionContracts(GOERLI_CHAIN_SELECTOR))
                .to.equal("0x1111111111111111111111111111111111111111");
        });

        it("正确持有 NFT", async function () {
            expect(await nft.ownerOf(0)).to.equal(crossChainAuction.target);
        });
    });

    describe("本地出价功能", function () {
        it("进行本地 ETH 出价", async function () {
            // 等待拍卖开始
            await new Promise(resolve => setTimeout(resolve, 11000));

            const bidAmount = ethers.parseEther("1");
            
            await expect(
                crossChainAuction.connect(bidder1).bidLocal(bidAmount, ethers.ZeroAddress, { value: bidAmount })
            ).to.emit(crossChainAuction, "LocalBidPlaced")
             .withArgs(bidder1.address, bidAmount, ethers.ZeroAddress);

            // 检查最高出价
            const [isCrossChain, bidder, amount, currency, usdValue] = await crossChainAuction.getCurrentHighestBid();
            expect(isCrossChain).to.equal(false);
            expect(bidder).to.equal(bidder1.address);
            expect(amount).to.equal(bidAmount);
            expect(currency).to.equal(ethers.ZeroAddress);
        });

        it("拒绝低于当前最高价的出价", async function () {
            // 等待拍卖开始
            await new Promise(resolve => setTimeout(resolve, 11000));

            const firstBid = ethers.parseEther("1");
            const secondBid = ethers.parseEther("0.5");

            // 第一次出价
            await crossChainAuction.connect(bidder1).bidLocal(firstBid, ethers.ZeroAddress, { value: firstBid });

            // 第二次出价应该失败
            await expect(
                crossChainAuction.connect(bidder2).bidLocal(secondBid, ethers.ZeroAddress, { value: secondBid })
            ).to.be.revertedWith("Bid not high enough");
        });

        it("正确退还之前的出价", async function () {
            // 等待拍卖开始
            await new Promise(resolve => setTimeout(resolve, 11000));

            const firstBid = ethers.parseEther("1");
            const secondBid = ethers.parseEther("2");

            const bidder1BalanceBefore = await ethers.provider.getBalance(bidder1.address);

            // 第一次出价
            const tx1 = await crossChainAuction.connect(bidder1).bidLocal(firstBid, ethers.ZeroAddress, { value: firstBid });
            const receipt1 = await tx1.wait();
            const gasCost1 = receipt1.gasUsed * receipt1.gasPrice;

            // 第二次出价（更高，由同一用户进行以触发退款）
            const tx2 = await crossChainAuction.connect(bidder1).bidLocal(secondBid, ethers.ZeroAddress, { value: secondBid });
            const receipt2 = await tx2.wait();
            const gasCost2 = receipt2.gasUsed * receipt2.gasPrice;

            // 检查 bidder1 的余额是否正确（应该只扣除第二次出价 + gas 费用）
            const bidder1BalanceAfter = await ethers.provider.getBalance(bidder1.address);
            const expectedBalance = bidder1BalanceBefore - secondBid - gasCost1 - gasCost2;

            expect(bidder1BalanceAfter).to.be.closeTo(expectedBalance, ethers.parseEther("0.01")); // 允许小的误差
        });
    });

    describe("跨链支持功能", function () {
        it("可以添加和移除支持的链", async function () {
            const newChainSelector = "12345678901234567890";
            const newContractAddress = "0x2222222222222222222222222222222222222222";

            // 添加新链
            await crossChainAuction.addSupportedChain(newChainSelector, newContractAddress);
            
            expect(await crossChainAuction.allowedSourceChains(newChainSelector)).to.equal(true);
            expect(await crossChainAuction.crossChainAuctionContracts(newChainSelector)).to.equal(newContractAddress);

            // 移除链
            await crossChainAuction.removeSupportedChain(newChainSelector);
            
            expect(await crossChainAuction.allowedSourceChains(newChainSelector)).to.equal(false);
            expect(await crossChainAuction.crossChainAuctionContracts(newChainSelector)).to.equal(ethers.ZeroAddress);
        });

        it("只允许 owner 管理支持的链", async function () {
            const newChainSelector = "12345678901234567890";
            const newContractAddress = "0x2222222222222222222222222222222222222222";

            await expect(
                crossChainAuction.connect(bidder1).addSupportedChain(newChainSelector, newContractAddress)
            ).to.be.revertedWithCustomError(crossChainAuction, "OwnableUnauthorizedAccount");
        });
    });

    describe("LINK 代币管理", function () {
        it("可以存入和提取 LINK 代币", async function () {
            // 检查初始状态（LINK 余额应该为 0）
            const initialBalance = await crossChainAuction.getBalance(linkToken.target);
            expect(initialBalance).to.equal(0);

            // 向合约转入一些 LINK 代币用于测试
            const transferAmount = ethers.parseEther("100");
            await linkToken.transfer(crossChainAuction.target, transferAmount);

            // 检查合约现在有 LINK 代币
            const balanceAfterTransfer = await crossChainAuction.getBalance(linkToken.target);
            expect(balanceAfterTransfer).to.equal(transferAmount);

            // 提取 LINK
            const ownerBalanceBefore = await linkToken.balanceOf(owner.address);
            await crossChainAuction.withdrawLink();
            const ownerBalanceAfter = await linkToken.balanceOf(owner.address);

            // 验证 LINK 代币已转移给 owner
            expect(ownerBalanceAfter - ownerBalanceBefore).to.equal(transferAmount);
            
            // 验证合约余额现在为 0
            const finalBalance = await crossChainAuction.getBalance(linkToken.target);
            expect(finalBalance).to.equal(0);
        });
    });

    describe("拍卖结束", function () {
        it("可以正确结束拍卖并转移 NFT", async function () {
            // 等待拍卖开始
            await new Promise(resolve => setTimeout(resolve, 11000));

            const bidAmount = ethers.parseEther("1");
            
            // 进行出价
            await crossChainAuction.connect(bidder1).bidLocal(bidAmount, ethers.ZeroAddress, { value: bidAmount });

            // 快进到拍卖结束时间之后
            await ethers.provider.send("evm_increaseTime", [3700]); // 增加时间超过拍卖结束时间
            await ethers.provider.send("evm_mine", []); // 挖掘新区块

            // 结束拍卖
            await crossChainAuction.endAuction();

            // 检查拍卖是否结束
            expect(await crossChainAuction.ended()).to.equal(true);

            // 检查 NFT 是否转移给获胜者
            expect(await nft.ownerOf(0)).to.equal(bidder1.address);
        });

        it("只允许 owner 结束拍卖", async function () {
            // 快进到拍卖结束时间之后
            await ethers.provider.send("evm_increaseTime", [3700]);
            await ethers.provider.send("evm_mine", []);

            await expect(
                crossChainAuction.connect(bidder1).endAuction()
            ).to.be.revertedWithCustomError(crossChainAuction, "OwnableUnauthorizedAccount");
        });
    });

    describe("跨链出价模拟", function () {
        it("可以接收跨链出价", async function () {
            // 等待拍卖开始
            await new Promise(resolve => setTimeout(resolve, 11000));

            const bidAmount = ethers.parseEther("1.5");
            const bidder = bidder1.address;
            const currency = ethers.ZeroAddress;
            const bidTime = Math.floor(Date.now() / 1000);
            const sourceChain = GOERLI_CHAIN_SELECTOR;
            const messageId = ethers.keccak256(ethers.toUtf8Bytes("test_message_id"));

            // 模拟接收跨链出价
            await expect(
                crossChainAuction.receiveCrossChainBid(
                    bidder,
                    bidAmount,
                    currency,
                    bidTime,
                    sourceChain,
                    messageId
                )
            ).to.emit(crossChainAuction, "CrossChainBidReceived")
             .withArgs(bidder, bidAmount, currency, sourceChain);

            // 检查最高出价
            const [isCrossChain, bidderAddr, amount, curr, usdValue] = await crossChainAuction.getCurrentHighestBid();
            expect(isCrossChain).to.equal(true);
            expect(bidderAddr).to.equal(bidder);
            expect(amount).to.equal(bidAmount);
            expect(curr).to.equal(currency);
        });
    });
});