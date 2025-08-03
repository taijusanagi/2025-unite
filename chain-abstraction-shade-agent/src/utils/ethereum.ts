import { contracts, chainAdapters } from "chainsig.js";
import { createPublicClient, http } from "viem";

export const ethRpcUrl = "https://sepolia.drpc.org";

// Set up a chain signature contract instance
const MPC_CONTRACT = new contracts.ChainSignatureContract({
  networkId: `testnet`,
  contractId: `v1.signer-prod.testnet`,
});

// Set up a public client for the Ethereum network
const publicClient = createPublicClient({
  transport: http(ethRpcUrl),
});

// Set up a chain signatures chain adapter for the Ethereum network
export const Evm = new chainAdapters.evm.EVM({
  publicClient,
  contract: MPC_CONTRACT,
}) as any;
