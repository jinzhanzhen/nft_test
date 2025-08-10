// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "./PriceOracle.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract Auction is UUPSUpgradeable,OwnableUpgradeable,ERC721Holder{
    //使用SafeERC20库
    using SafeERC20 for IERC20;
    //出价结构体
    struct Bid {
        address bidder; //出价人
        uint256 amount; //出价金额
        uint256 bidTime; //出价时间
        address currency; //出价币种
    }

    address public nftContract; //nft合约地址
    uint256 public nftTokenId; //nft tokenId
    uint256 public auctionStartTime; //auction开始时间
    uint256 public auctionEndTime; //auction结束时间
    bool public ended; //auction是否结束


    Bid public highestBid; //当前最高出价金额
    PriceOracle public oracle; //价格预言机


    mapping(address => Bid) public bids; //出价记录


    //初始化函数
    // 在initialize函数中，修复NFT转移逻辑
    function initialize(
        address _nftContract,
        uint256 _nftTokenId,
        uint256 _auctionStartTime,
        uint256 _auctionEndTime,
        address _owner,
        address _oracle
    ) external initializer {
        __Ownable_init(_owner);
        __UUPSUpgradeable_init();
    
        require(_auctionStartTime < _auctionEndTime, "Auction end time must be greater than start time");
        require(_nftContract != address(0), "NFT contract address must be valid");
        require(_auctionStartTime > block.timestamp, "Start time must be future");
    
        nftContract = _nftContract;
        nftTokenId = _nftTokenId;
        auctionStartTime = _auctionStartTime;
        auctionEndTime = _auctionEndTime;
        oracle = PriceOracle(_oracle);
    
        // 转移NFT到合
        IERC721(nftContract).safeTransferFrom(msg.sender, address(this), nftTokenId);
    }


    //出价函数
    function bid(uint256 _amount,address _currency) external payable {
        require(block.timestamp >= auctionStartTime, "Auction not started");
        require(block.timestamp < auctionEndTime, "Auction ended");
        require(!ended, "Auction ended");
        require(_amount > 0, "Bid amount must be greater than 0");
    

        //处理支付逻辑，检查是eth还是IERC20
        if (_currency == address(0)) {
            require(msg.value == _amount, "Ether value must match bid amount");
        }else {
            IERC20(_currency).safeTransferFrom(msg.sender, address(this), _amount);
        }

        //转换为usd进行比较
        uint256 usdAmount = oracle.convertToUSD(_currency, _amount);
        require(usdAmount > 0, "Bid amount must be greater than 0");

        //
        if (highestBid.bidder != address(0)) {
        uint256 usdHighestBid = oracle.convertToUSD(highestBid.currency, highestBid.amount);
        require(usdHighestBid > 0, "Highest Bid conversion failed ");
        require(usdAmount > usdHighestBid, "Bid amount must be greater than highest bid");
        }
        

        //保留当前最高出价用于退款
        Bid memory previousHighestBid = highestBid;

        //更新最高出价记录
        highestBid = Bid(msg.sender, _amount, block.timestamp, _currency);
        bids[msg.sender] = highestBid;

        //如果之前有出价，退款
        if (previousHighestBid.bidder != address(0)) {
            _refundBid(previousHighestBid);
        }

    }

    //退款函数
    function _refundBid(Bid memory _bid) private {      
        if (_bid.currency == address(0)) {
            //使用call退款
            (bool success,) = _bid.bidder.call{value: _bid.amount}("");
            require(success, "Refund failed");
            // payable(_bid.bidder).transfer(_bid.amount);
        }else {
            IERC20(_bid.currency).safeTransfer(_bid.bidder, _bid.amount);
        }

        //清除出价记录
        delete bids[_bid.bidder];
    }

    //结束auction函数
    function endAuction() external onlyOwner {
        require(block.timestamp >= auctionEndTime, "Auction not ended");
        require(!ended, "Auction ended");
        ended = true;
        
        //判断是否有出价
        if (highestBid.bidder == address(0)) {
            IERC721(nftContract).safeTransferFrom(address(this), owner(), nftTokenId);
            return;
        }

        //转移NFT给最高出价者
        IERC721(nftContract).safeTransferFrom(address(this), highestBid.bidder, nftTokenId);

        //转账资金给卖家
        if (highestBid.currency == address(0)) {
            //使用call转账
            (bool success,) = owner().call{value: highestBid.amount}("");
            require(success, "Transfer failed");
            // payable(owner()).transfer(highestBid.amount);
        }else {
            IERC20(highestBid.currency).safeTransfer(owner(), highestBid.amount);
        }

    }       

    //允许出价者主动取回资金(非最高出价者)
    function withdraw() external{
        require(ended, "Auction not ended");
        require(msg.sender != highestBid.bidder, "Highest bidder cannot withdraw");

        Bid storage userBid = bids[msg.sender];
        require(userBid.amount > 0, "No bid placed");

        uint256 amount = userBid.amount;
        address currency = userBid.currency;
        userBid.amount = 0; //防重入

        if(currency == address(0)){
            //使用call退款
            (bool success,) = msg.sender.call{value: amount}("");
            require(success, "Refund failed");
        }else {
            IERC20(currency).safeTransfer(msg.sender, amount);
        }
    }


    //授权升级函数
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

}