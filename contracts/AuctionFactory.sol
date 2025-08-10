// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./Auction.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "./PriceOracle.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC721/utils/ERC721HolderUpgradeable.sol";


contract AuctionFactory is UUPSUpgradeable , OwnableUpgradeable,ERC721HolderUpgradeable{
    
    //所有拍卖合约地址
    address[] public allAuctions;

    //存储拍卖合约实现
    address public auctionImplementation;

    function initialize(address _auctionImplementation) public initializer {
        __UUPSUpgradeable_init();
        __Ownable_init(msg.sender);
        auctionImplementation = _auctionImplementation;
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

    //授权升级函数
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        auctionImplementation = newImplementation;
    }
}
