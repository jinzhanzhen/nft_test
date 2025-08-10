const { ethers, upgrades } = require("hardhat");

// CCIP 配置 - Testnet
const CCIP_CONFIG = {
    sepolia: {
        router: "0x0BF3dE8c5D3e8A2B34D2BEeB17ABfCeBaf363A59",
        linkToken: "0x779877A7B0D9E8603169DdbD7836e478b4624789", 
        chainSelector: "16015286601757825753"
    },
    linea: {
        router: "0xB443690e1c86a8f7a5c6d2a4af30ba01dbBd5618", // 更完整的地址
        linkToken: "0xF64E1c8d4159d5DCaaD882BdEdf10C5E7b4F1E15", // 更完整的地址
        chainSelector: "5719461335882077547"
    }
};

async function main() {
    const [deployer] = await ethers.getSigners();
    
    console.log("部署跨链拍卖合约，部署者:", deployer.address);
    console.log("账户余额:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)));

    const networkName = hre.network.name;
    console.log("当前网络:", networkName);
    
    if (!CCIP_CONFIG[networkName]) {
        throw new Error(`不支持的网络: ${networkName}。支持的网络: ${Object.keys(CCIP_CONFIG).join(', ')}`);
    }

    const config = CCIP_CONFIG[networkName];
    
    // 部署 MockV3Aggregator for ETH/USD
    const MockV3Aggregator = await ethers.getContractFactory("MockV3Aggregator");
    const mockEthUsdPriceFeed = await MockV3Aggregator.deploy(8, 200000000000); // 8 decimals, 2000 USD
    await mockEthUsdPriceFeed.waitForDeployment();
    console.log("MockV3Aggregator (ETH/USD) 部署到:", mockEthUsdPriceFeed.target);

    // 部署 PriceOracle
    const PriceOracle = await ethers.getContractFactory("PriceOracle");
    const priceOracle = await PriceOracle.deploy(
        [ethers.ZeroAddress], // ETH address
        [mockEthUsdPriceFeed.target] // ETH/USD price feed
    );
    await priceOracle.waitForDeployment();
    console.log("PriceOracle 部署到:", priceOracle.target);

    // 部署 NFT721
    const NFT721 = await ethers.getContractFactory("NFT721"); 
    const nft = await upgrades.deployProxy(NFT721, [], { 
        initializer: "initialize", 
        kind: "uups" 
    });
    await nft.waitForDeployment();
    console.log("NFT721 部署到:", nft.target);

    // 铸造一个测试 NFT
    await nft.mint(deployer.address);
    console.log("已为部署者铸造 NFT tokenId: 0");

    // 准备跨链配置
    let allowedChains = [];
    let crossChainContracts = [];
    
    if (networkName === "sepolia") {
        allowedChains = [CCIP_CONFIG.linea.chainSelector];
        crossChainContracts = ["0x0000000000000000000000000000000000000000"]; // 临时地址，部署后需要更新
    } else if (networkName === "linea") {
        allowedChains = [CCIP_CONFIG.sepolia.chainSelector];
        crossChainContracts = ["0x0000000000000000000000000000000000000000"]; // 临时地址，部署后需要更新
    }

    // 部署跨链拍卖合约
    const CrossChainAuction = await ethers.getContractFactory("CrossChainAuction");
    
    // 首先部署实现合约
    const crossChainAuctionImpl = await CrossChainAuction.deploy(config.router);
    await crossChainAuctionImpl.waitForDeployment();
    console.log("CrossChainAuction 实现合约部署到:", crossChainAuctionImpl.target);

    // 设置拍卖时间（从现在开始 1 分钟后开始，持续 1 小时）
    const auctionStartTime = Math.floor(Date.now() / 1000) + 60; // 60 seconds from now
    const auctionEndTime = auctionStartTime + 3600; // 1 hour duration

    // 使用代理部署
    const crossChainAuction = await upgrades.deployProxy(
        CrossChainAuction,
        [
            nft.target, // NFT 合约地址
            0, // NFT tokenId
            auctionStartTime,
            auctionEndTime,
            deployer.address, // owner
            priceOracle.target, // oracle
            config.linkToken, // LINK token
            allowedChains, // 支持的链选择器
            crossChainContracts // 跨链合约地址（临时）
        ],
        { 
            initializer: "initialize",
            kind: "uups",
            constructorArgs: [config.router]
        }
    );
    await crossChainAuction.waitForDeployment();
    console.log("CrossChainAuction 代理合约部署到:", crossChainAuction.target);

    // 将 NFT 批准给拍卖合约
    await nft.approve(crossChainAuction.target, 0);
    console.log("已批准 NFT tokenId 0 给拍卖合约");

    console.log("\n=== 部署摘要 ===");
    console.log("网络:", networkName);
    console.log("CCIP Router:", config.router);
    console.log("LINK Token:", config.linkToken);
    console.log("Chain Selector:", config.chainSelector);
    console.log("NFT721:", nft.target);
    console.log("PriceOracle:", priceOracle.target);
    console.log("CrossChainAuction:", crossChainAuction.target);
    console.log("拍卖开始时间:", new Date(auctionStartTime * 1000).toLocaleString());
    console.log("拍卖结束时间:", new Date(auctionEndTime * 1000).toLocaleString());

    console.log("\n=== 下一步 ===");
    if (networkName === "sepolia") {
        console.log("1. 在 Linea Sepolia 部署相同的合约:");
        console.log("   npx hardhat run deploy/02_CrossChainAuction.js --network linea");
    } else if (networkName === "linea") {
        console.log("1. 在 Ethereum Sepolia 部署相同的合约:");
        console.log("   npx hardhat run deploy/02_CrossChainAuction.js --network sepolia");
    }
    console.log("2. 使用 addSupportedChain 函数添加对方链的合约地址");
    console.log("3. 向合约转入 LINK 代币用于支付 CCIP 费用");
    console.log("4. 开始测试跨链拍卖功能");

    return {
        nft: nft.target,
        priceOracle: priceOracle.target,
        crossChainAuction: crossChainAuction.target,
        chainSelector: config.chainSelector
    };
}

if (require.main === module) {
    main().catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });
}

module.exports = main;