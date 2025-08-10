// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";

/**
 * @title PriceOracle
 * @dev 价格预言机合约，用于获取代币价格并转换为USD
 */
contract PriceOracle { // 定义PriceOracle合约
    // 代币地址 => 价格聚合器 映射关系
    mapping(address => AggregatorV3Interface) public priceFeeds; // 存储不同代币对应的Chainlink价格聚合器接口
    
    /**
     * @dev 初始化价格预言机
     * @param tokens 代币地址数组
     * @param aggregators 对应的价格聚合器地址数组
     */
    constructor(address[] memory tokens, address[] memory aggregators) { // 构造函数，初始化代币-聚合器映射
        require(tokens.length == aggregators.length, "Invalid input"); // 检查代币数组和聚合器数组长度是否一致
        for(uint i=0; i<tokens.length; i++) { // 遍历代币数组
            priceFeeds[tokens[i]] = AggregatorV3Interface(aggregators[i]); // 将代币地址与对应聚合器地址关联
        }
    }

    /**
     * @dev 获取代币价格
     * @param token 代币地址
     * @return 价格（带8位小数）
     */
    function getPrice(address token) public view returns (int) { // 获取指定代币的最新价格
        require(address(priceFeeds[token]) != address(0), "Feed not found"); // 检查该代币是否已设置价格聚合器
        (, int price,,,) = priceFeeds[token].latestRoundData(); // 调用聚合器获取最新价格数据，忽略其他参数
        return price; // 返回价格（Chainlink价格默认带8位小数）
    }

    /**
     * @dev 将代币金额转换为USD
     * @param token 代币地址（0地址表示ETH）
     * @param amount 代币数量
     * @return USD金额
     */
    function convertToUSD(address token, uint amount) external view returns (uint) { // 将代币数量转换为美元价值
        int price = getPrice(token); // 获取代币当前价格
        if(token == address(0)) { // 检查是否为ETH（0地址特殊处理）
            return amount * uint(price) / 1e18; // ETH价格有18位小数，需除以1e18转换为正常单位
        }
        return amount * uint(price) / 1e8; // 其他代币价格默认8位小数，除以1e8得到美元金额
    }
}