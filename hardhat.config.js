require("@nomicfoundation/hardhat-toolbox");
require("@openzeppelin/hardhat-upgrades");
require("dotenv").config();

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      }
    }
  },
  networks: {
    sepolia: {
      url: `https://eth-sepolia.g.alchemy.com/v2/${process.env.ALCHEMY_SEPOLIA}`,
      accounts: [process.env.PRIVATE_KEY],
      chainId: 11155111,
    },
    linea: {
      url: `https://linea-sepolia.g.alchemy.com/v2/${process.env.ALCHEMY_LINEA}`,
      accounts: [process.env.PRIVATE_KEY], 
      chainId: 59141,
    },
  },
};
