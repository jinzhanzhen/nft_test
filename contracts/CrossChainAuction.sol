// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@chainlink/contracts/src/v0.8/ccip/interfaces/IRouterClient.sol";
import "@chainlink/contracts/src/v0.8/ccip/libraries/Client.sol";
import "@chainlink/contracts/src/v0.8/shared/interfaces/LinkTokenInterface.sol";
import "./PriceOracle.sol";

// 使用接口声明而不是导入来避免冲突
interface IERC721 {
    function balanceOf(address owner) external view returns (uint256 balance);
    function ownerOf(uint256 tokenId) external view returns (address owner);
    function safeTransferFrom(address from, address to, uint256 tokenId, bytes calldata data) external;
    function safeTransferFrom(address from, address to, uint256 tokenId) external;
    function transferFrom(address from, address to, uint256 tokenId) external;
    function approve(address to, uint256 tokenId) external;
    function getApproved(uint256 tokenId) external view returns (address operator);
    function setApprovalForAll(address operator, bool _approved) external;
    function isApprovedForAll(address owner, address operator) external view returns (bool);
}

interface IERC20 {
    function totalSupply() external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

// 简化的 ERC721 接收者实现
contract ERC721Holder {
    function onERC721Received(address, address, uint256, bytes memory) public virtual returns (bytes4) {
        return this.onERC721Received.selector;
    }
}

// 简化的 SafeERC20 库
library SafeERC20 {
    function safeTransfer(IERC20 token, address to, uint256 value) internal {
        (bool success, bytes memory data) = address(token).call(abi.encodeWithSelector(token.transfer.selector, to, value));
        require(success && (data.length == 0 || abi.decode(data, (bool))), "SafeERC20: transfer failed");
    }

    function safeTransferFrom(IERC20 token, address from, address to, uint256 value) internal {
        (bool success, bytes memory data) = address(token).call(abi.encodeWithSelector(token.transferFrom.selector, from, to, value));
        require(success && (data.length == 0 || abi.decode(data, (bool))), "SafeERC20: transferFrom failed");
    }
}

/// @custom:oz-upgrades-unsafe-allow constructor
contract CrossChainAuction is UUPSUpgradeable, OwnableUpgradeable, ERC721Holder {
    using SafeERC20 for IERC20;

    // 跨链出价结构体
    struct CrossChainBid {
        address bidder;
        uint256 amount;
        uint256 bidTime;
        address currency;
        uint64 sourceChainSelector; // 来源链选择器
        bytes32 messageId; // CCIP 消息 ID
    }

    // 本地出价结构体
    struct LocalBid {
        address bidder;
        uint256 amount;
        uint256 bidTime;
        address currency;
    }

    // CCIP 路由器地址 - 使用状态变量而不是不可变变量
    address public ccipRouter;
    
    address public nftContract;
    uint256 public nftTokenId;
    uint256 public auctionStartTime;
    uint256 public auctionEndTime;
    bool public ended;
    
    CrossChainBid public highestCrossChainBid; // 最高跨链出价
    LocalBid public highestLocalBid; // 最高本地出价
    PriceOracle public oracle;
    LinkTokenInterface public linkToken;

    // 支持的链选择器映射
    mapping(uint64 => bool) public allowedSourceChains;
    mapping(uint64 => address) public crossChainAuctionContracts; // 其他链上的拍卖合约地址
    mapping(address => LocalBid) public localBids; // 存储本地出价
    mapping(bytes32 => CrossChainBid) public crossChainBids; // 存储跨链出价

    // 事件
    event LocalBidPlaced(address indexed bidder, uint256 amount, address currency);
    event CrossChainBidReceived(address indexed bidder, uint256 amount, address currency, uint64 sourceChain);
    event CrossChainBidSent(address indexed bidder, uint256 amount, uint64 targetChain, bytes32 messageId);
    event AuctionEnded(address winner, uint256 amount, string winType);
    event CrossChainMessageReceived(bytes32 indexed messageId, uint64 indexed sourceChain);
    event SupportedChainAdded(uint64 chainSelector, address contractAddress);
    event SupportedChainRemoved(uint64 chainSelector);

    modifier auctionActive() {
        require(block.timestamp >= auctionStartTime, "Auction not started");
        require(block.timestamp <= auctionEndTime && !ended, "Auction ended");
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _nftContract,
        uint256 _nftTokenId,
        uint256 _auctionStartTime,
        uint256 _auctionEndTime,
        address _owner,
        address _oracle,
        address _linkToken,
        uint64[] memory _allowedChains,
        address[] memory _crossChainContracts,
        address _ccipRouter
    ) external initializer {
        __Ownable_init(_owner);
        __UUPSUpgradeable_init();

        nftContract = _nftContract;
        nftTokenId = _nftTokenId;
        auctionStartTime = _auctionStartTime;
        auctionEndTime = _auctionEndTime;
        oracle = PriceOracle(_oracle);
        linkToken = LinkTokenInterface(_linkToken);
        ccipRouter = _ccipRouter;

        require(_allowedChains.length == _crossChainContracts.length, "Arrays length mismatch");
        
        for (uint i = 0; i < _allowedChains.length; i++) {
            allowedSourceChains[_allowedChains[i]] = true;
            crossChainAuctionContracts[_allowedChains[i]] = _crossChainContracts[i];
        }

        // 转移 NFT 到合约
        IERC721(nftContract).safeTransferFrom(msg.sender, address(this), nftTokenId);
    }

    // 本地出价函数
    function bidLocal(uint256 _amount, address _currency) external payable auctionActive {
        require(_amount > 0, "Bid must be greater than 0");

        // 获取 USD 价值用于比较
        uint256 bidValueUSD = oracle.convertToUSD(_currency, _amount);
        uint256 currentHighestUSD = _getHighestBidUSD();
        require(bidValueUSD > currentHighestUSD, "Bid not high enough");

        // 处理资金转移
        if (_currency == address(0)) {
            require(msg.value == _amount, "Ether value must match bid amount");
        } else {
            IERC20(_currency).safeTransferFrom(msg.sender, address(this), _amount);
        }

        // 退还之前的出价
        if (localBids[msg.sender].bidder != address(0)) {
            _refundLocalBid(localBids[msg.sender]);
        }

        // 记录新的出价
        localBids[msg.sender] = LocalBid({
            bidder: msg.sender,
            amount: _amount,
            bidTime: block.timestamp,
            currency: _currency
        });

        // 更新最高本地出价
        if (bidValueUSD > oracle.convertToUSD(highestLocalBid.currency, highestLocalBid.amount)) {
            highestLocalBid = localBids[msg.sender];
        }

        emit LocalBidPlaced(msg.sender, _amount, _currency);
    }

    // 跨链出价函数
    function bidCrossChain(
        uint64 _targetChainSelector,
        uint256 _amount,
        address _currency
    ) external payable auctionActive {
        require(allowedSourceChains[_targetChainSelector], "Chain not supported");
        require(_amount > 0, "Bid must be greater than 0");

        // 处理资金转移
        if (_currency == address(0)) {
            require(msg.value >= _amount, "Insufficient Ether");
        } else {
            IERC20(_currency).safeTransferFrom(msg.sender, address(this), _amount);
        }

        // 构建跨链消息
        Client.EVM2AnyMessage memory message = Client.EVM2AnyMessage({
            receiver: abi.encode(crossChainAuctionContracts[_targetChainSelector]),
            data: abi.encode(msg.sender, _amount, _currency, block.timestamp),
            tokenAmounts: new Client.EVMTokenAmount[](0),
            extraArgs: Client._argsToBytes(Client.EVMExtraArgsV1({gasLimit: 300000})),
            feeToken: address(linkToken)
        });

        // 计算费用
        uint256 fee = IRouterClient(ccipRouter).getFee(_targetChainSelector, message);
        require(linkToken.balanceOf(address(this)) >= fee, "Insufficient LINK");

        // 发送跨链消息
        bytes32 messageId = IRouterClient(ccipRouter).ccipSend(_targetChainSelector, message);

        emit CrossChainBidSent(msg.sender, _amount, _targetChainSelector, messageId);
    }

    // 手动接收跨链消息（用于测试，实际应该通过 CCIP 自动调用）
    function receiveCrossChainBid(
        address bidder,
        uint256 amount,
        address currency,
        uint256 bidTime,
        uint64 sourceChainSelector,
        bytes32 messageId
    ) external {
        require(allowedSourceChains[sourceChainSelector], "Chain not supported");

        // 验证出价
        uint256 bidValueUSD = oracle.convertToUSD(currency, amount);
        uint256 currentHighestUSD = _getHighestBidUSD();
        
        if (bidValueUSD > currentHighestUSD) {
            // 更新最高跨链出价
            highestCrossChainBid = CrossChainBid({
                bidder: bidder,
                amount: amount,
                bidTime: bidTime,
                currency: currency,
                sourceChainSelector: sourceChainSelector,
                messageId: messageId
            });

            crossChainBids[messageId] = highestCrossChainBid;
            
            emit CrossChainBidReceived(bidder, amount, currency, sourceChainSelector);
        }

        emit CrossChainMessageReceived(messageId, sourceChainSelector);
    }

    // 获取当前最高出价的 USD 价值
    function _getHighestBidUSD() internal view returns (uint256) {
        uint256 localHighestUSD = 0;
        uint256 crossChainHighestUSD = 0;

        if (highestLocalBid.bidder != address(0)) {
            localHighestUSD = oracle.convertToUSD(highestLocalBid.currency, highestLocalBid.amount);
        }

        if (highestCrossChainBid.bidder != address(0)) {
            crossChainHighestUSD = oracle.convertToUSD(highestCrossChainBid.currency, highestCrossChainBid.amount);
        }

        return localHighestUSD > crossChainHighestUSD ? localHighestUSD : crossChainHighestUSD;
    }

    // 退还本地出价
    function _refundLocalBid(LocalBid memory _bid) private {
        if (_bid.currency == address(0)) {
            (bool success,) = _bid.bidder.call{value: _bid.amount}("");
            require(success, "Refund failed");
        } else {
            IERC20(_bid.currency).safeTransfer(_bid.bidder, _bid.amount);
        }
        delete localBids[_bid.bidder];
    }

    // 结束拍卖
    function endAuction() external onlyOwner {
        require(block.timestamp > auctionEndTime, "Auction not ended");
        require(!ended, "Auction already ended");
        
        ended = true;

        // 比较本地和跨链出价，确定获胜者
        uint256 localHighestUSD = 0;
        uint256 crossChainHighestUSD = 0;

        if (highestLocalBid.bidder != address(0)) {
            localHighestUSD = oracle.convertToUSD(highestLocalBid.currency, highestLocalBid.amount);
        }

        if (highestCrossChainBid.bidder != address(0)) {
            crossChainHighestUSD = oracle.convertToUSD(highestCrossChainBid.currency, highestCrossChainBid.amount);
        }

        bool crossChainWins = crossChainHighestUSD > localHighestUSD;

        if (crossChainWins && highestCrossChainBid.bidder != address(0)) {
            // 跨链出价获胜，NFT 转给 owner，资金留在合约
            IERC721(nftContract).safeTransferFrom(address(this), owner(), nftTokenId);
            emit AuctionEnded(highestCrossChainBid.bidder, highestCrossChainBid.amount, "crosschain");
        } else if (highestLocalBid.bidder != address(0)) {
            // 本地出价获胜
            IERC721(nftContract).safeTransferFrom(address(this), highestLocalBid.bidder, nftTokenId);
            
            // 转移资金给 owner
            if (highestLocalBid.currency == address(0)) {
                (bool success,) = owner().call{value: highestLocalBid.amount}("");
                require(success, "Transfer failed");
            } else {
                IERC20(highestLocalBid.currency).safeTransfer(owner(), highestLocalBid.amount);
            }
            
            emit AuctionEnded(highestLocalBid.bidder, highestLocalBid.amount, "local");
        } else {
            // 没有出价者，NFT 退还给 owner
            IERC721(nftContract).safeTransferFrom(address(this), owner(), nftTokenId);
            emit AuctionEnded(address(0), 0, "no_bids");
        }
    }

    // 添加支持的链
    function addSupportedChain(uint64 _chainSelector, address _contractAddress) external onlyOwner {
        allowedSourceChains[_chainSelector] = true;
        crossChainAuctionContracts[_chainSelector] = _contractAddress;
        emit SupportedChainAdded(_chainSelector, _contractAddress);
    }

    // 移除支持的链
    function removeSupportedChain(uint64 _chainSelector) external onlyOwner {
        allowedSourceChains[_chainSelector] = false;
        crossChainAuctionContracts[_chainSelector] = address(0);
        emit SupportedChainRemoved(_chainSelector);
    }

    // 提取资金（用于跨链拍卖结算）
    function withdraw(address _currency, uint256 _amount) external onlyOwner {
        require(ended, "Auction not ended");
        
        if (_currency == address(0)) {
            (bool success,) = owner().call{value: _amount}("");
            require(success, "Withdrawal failed");
        } else {
            IERC20(_currency).safeTransfer(owner(), _amount);
        }
    }

    // 提取 LINK 代币
    function withdrawLink() external onlyOwner {
        uint256 balance = linkToken.balanceOf(address(this));
        if (balance > 0) {
            linkToken.transfer(owner(), balance);
        }
    }

    // 获取当前最高出价信息
    function getCurrentHighestBid() external view returns (
        bool isCrossChain,
        address bidder,
        uint256 amount,
        address currency,
        uint256 usdValue
    ) {
        uint256 localHighestUSD = 0;
        uint256 crossChainHighestUSD = 0;

        if (highestLocalBid.bidder != address(0)) {
            localHighestUSD = oracle.convertToUSD(highestLocalBid.currency, highestLocalBid.amount);
        }

        if (highestCrossChainBid.bidder != address(0)) {
            crossChainHighestUSD = oracle.convertToUSD(highestCrossChainBid.currency, highestCrossChainBid.amount);
        }

        if (crossChainHighestUSD > localHighestUSD) {
            return (
                true,
                highestCrossChainBid.bidder,
                highestCrossChainBid.amount,
                highestCrossChainBid.currency,
                crossChainHighestUSD
            );
        } else if (localHighestUSD > 0) {
            return (
                false,
                highestLocalBid.bidder,
                highestLocalBid.amount,
                highestLocalBid.currency,
                localHighestUSD
            );
        } else {
            return (false, address(0), 0, address(0), 0);
        }
    }

    // 升级授权
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    // 获取合约余额
    function getBalance(address _currency) external view returns (uint256) {
        if (_currency == address(0)) {
            return address(this).balance;
        } else {
            return IERC20(_currency).balanceOf(address(this));
        }
    }

    // 紧急暂停功能
    function emergencyPause() external onlyOwner {
        ended = true;
    }
}