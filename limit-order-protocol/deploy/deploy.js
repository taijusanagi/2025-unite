const hre = require("hardhat");
const { getChainId, network } = hre;

const wethByNetwork = {
    hardhat: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    mainnet: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    "monad-testnet": "0x760afe86e5de5fa0ee542fc7b7b713e1c5425701",
    "base-sepolia": "0x1bdd24840e119dc2602dcc587dd182812427a5cc",
};

module.exports = async ({ getNamedAccounts, deployments }) => {
    console.log("running deploy script");
    console.log("network id ", await getChainId());

    const { deploy } = deployments;
    const { deployer } = await getNamedAccounts();

    const limitOrderProtocol = await deploy("LimitOrderProtocol", {
        from: deployer,
        args: [wethByNetwork[network.name]],
    });

    console.log("LimitOrderProtocol deployed to:", limitOrderProtocol.address);

    // if ((await getChainId()) !== "31337") {
    //     await hre.run("verify:verify", {
    //         address: limitOrderProtocol.address,
    //         constructorArguments: [wethByNetwork[network.name]],
    //     });
    // }
};

module.exports.skip = async () => false;
