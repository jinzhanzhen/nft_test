// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./Auction.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "./PriceOracle.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC721/utils/ERC721HolderUpgradeable.sol";

contract AuctionFactoryV2 is UUPSUpgradeable, OwnableUpgradeable, ERC721HolderUpgradeable {
    
    //所有拍卖合约地址
    address[] public allAuctions;

    //存储拍卖合约实现
    address public auctionImplementation;
    
    // 新增的验证变量
    string public upgradeMessage;
    uint256 public upgradeVersion;

    function initialize(address _auctionImplementation) public initializer {
        __UUPSUpgradeable_init();
        __Ownable_init(msg.sender);
        auctionImplementation = _auctionImplementation;
        upgradeVersion = 1; // 初始版本
    }

    function createAuction(
        address _nftContract, //nft合约地址
        uint256 _nftTokenId,  //nft token id
        uint256 _auctionStartTime,
        uint256 _auctionEndTime,
        address _priceOracle
    ) external {

        //授权工厂合约转移NFT
        IERC721(_nftContract).safeTransferFrom(msg.sender, address(this), _nftTokenId);

        Auction auction = new Auction();

        //授权拍卖合约调用NFT合约
        IERC721(_nftContract).approve(address(auction), _nftTokenId);

        //初始化拍卖合约
        auction.initialize(
            _nftContract,
             _nftTokenId,
              _auctionStartTime,
              _auctionEndTime,
              msg.sender,
              _priceOracle
              );

        allAuctions.push(address(auction));
    }

    function getAuction(uint256 index) public view returns(address){
        return allAuctions[index];
    }

    //升级
    function upgradeAuctionImplementation(address _newImplementation) public onlyOwner {
        auctionImplementation = _newImplementation;
    }

    // 新增的验证函数
    function helloWorld() external pure returns (string memory) {
        return "Hello World from AuctionFactoryV2!";
    }

    // 新增的设置升级消息函数
    function setUpgradeMessage(string memory _message) external onlyOwner {
        upgradeMessage = _message;
        upgradeVersion = 2; // 升级到版本2
    }

    // 新增的获取升级消息函数
    function getUpgradeMessage() external view returns (string memory) {
        return upgradeMessage;
    }

    // 新增的获取版本函数
    function getVersion() external view returns (uint256) {
        return upgradeVersion;
    }

    //授权升级函数 - 修复：不应该修改 auctionImplementation
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        // 这里只是授权升级，不修改 auctionImplementation
        // auctionImplementation 只应该通过 upgradeAuctionImplementation 函数修改
    }
}