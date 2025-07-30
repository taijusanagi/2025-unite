// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "forge-std/Script.sol";

// Contract imports
import {LimitOrderProtocol} from "@1inch/limit-order-protocol-contract/contracts/LimitOrderProtocol.sol";
import {EscrowFactory} from "cross-chain-swap/EscrowFactory.sol";
import {ERC20True} from "cross-chain-swap/mocks/ERC20True.sol";

import {Resolver} from "../../contracts/evm/src/Resolver.sol";

contract Deploy is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address owner = vm.envAddress("OWNER_ADDRESS");

        // Pick WETH by network name
        string memory name = vm.envString("FOUNDRY_NETWORK");
        address weth;

        if (keccak256(bytes(name)) == keccak256("base-sepolia")) {
            weth = 0x1bdd24840e119dc2602dcc587dd182812427a5cc;
        } else if (keccak256(bytes(name)) == keccak256("arbitrum-sepolia")) {
            weth = 0x2836ae2ea2c013acd38028fd0c77b92cccfa2ee4;
        } else if (keccak256(bytes(name)) == keccak256("monad-testnet")) {
            weth = 0x760afe86e5de5fa0ee542fc7b7b713e1c5425701;
        } else {
            // fallback to mainnet/hardhat default
            weth = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
        }

        vm.startBroadcast(deployerKey);

        // 1. Deploy LimitOrderProtocol
        LimitOrderProtocol lop = new LimitOrderProtocol(weth);
        console.log("LimitOrderProtocol deployed at:", address(lop));

        // 2. Deploy EscrowFactory
        EscrowFactory factory = new EscrowFactory(
            address(lop),
            weth,
            address(0), // zero address
            owner,
            1800,
            1800
        );
        console.log("EscrowFactory deployed at:", address(factory));

        // 3. Deploy Resolver
        Resolver resolver = new Resolver(
            address(factory),
            address(lop),
            owner
        );
        console.log("Resolver deployed at:", address(resolver));

        // 4. Deploy ERC20True
        ERC20True token = new ERC20True();
        console.log("ERC20True deployed at:", address(token));

        vm.stopBroadcast();
    }
}
