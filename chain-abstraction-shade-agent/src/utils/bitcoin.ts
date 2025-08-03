import { contracts, chainAdapters } from "chainsig.js";

// Set up a chain signature contract instance
const MPC_CONTRACT = new contracts.ChainSignatureContract({
  networkId: `testnet`,
  contractId: `v1.signer-prod.testnet`,
});

const btcRpcAdapter = new chainAdapters.btc.BTCRpcAdapters.Mempool(
  "https://mempool.space/testnet/api"
);

export const Btc = new chainAdapters.btc.Bitcoin({
  network: "testnet",
  btcRpcAdapter,
  contract: MPC_CONTRACT,
}) as any;
