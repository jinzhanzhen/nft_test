// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts-upgradeable/token/ERC721/ERC721Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

contract NFT721V2 is ERC721Upgradeable, UUPSUpgradeable, OwnableUpgradeable {
    uint256 public tokenCounter;
    
    // 新增的验证变量
    string public upgradeMessage;
    
    //初始化
    function initialize() initializer public {
        __ERC721_init("NFT721", "NFT");
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        tokenCounter = 0;
    }

    //铸造
    function mint(address to) external  onlyOwner {
        _mint(to, tokenCounter);
        tokenCounter++;
    }

    // 新增的验证函数
    function helloWorld() external pure returns (string memory) {
        return "Hello World from NFT721V2!";
    }

    // 新增的设置升级消息函数
    function setUpgradeMessage(string memory _message) external onlyOwner {
        upgradeMessage = _message;
    }

    // 新增的获取升级消息函数
    function getUpgradeMessage() external view returns (string memory) {
        return upgradeMessage;
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}