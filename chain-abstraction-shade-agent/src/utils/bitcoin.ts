import { contracts, chainAdapters } from "chainsig.js";

// Set up a chain signature contract instance
const MPC_CONTRACT = new contracts.ChainSignatureContract({
  networkId: `testnet`,
  contractId: `v1.signer-prod.testnet`,
});

// I use testnet3, so and mempool for testnet 3 fails to get balance
// But I found blockstream works for get address and balanace, so I use it here
const btcRpcAdapter = new chainAdapters.btc.BTCRpcAdapters.Mempool(
  "https://blockstream.info/testnet/api"
);

export const Btc = new chainAdapters.btc.Bitcoin({
  network: "testnet",
  btcRpcAdapter,
  contract: MPC_CONTRACT,
}) as any;
