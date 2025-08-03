import { chainAdapters } from "chainsig.js";
import { createPublicClient, http } from "viem";
import { SIGNET_CONTRACT } from "./signet-contract";

export const ethRpcUrl = "https://sepolia.drpc.org";

// Set up a public client for the Ethereum network
const publicClient = createPublicClient({
  transport: http(ethRpcUrl),
});

// Set up a chain signatures chain adapter for the Ethereum network
export const Evm = new chainAdapters.evm.EVM({
  publicClient,
  contract: SIGNET_CONTRACT,
}) as any;
