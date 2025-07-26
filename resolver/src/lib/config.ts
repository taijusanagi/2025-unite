import * as Sdk from "@1inch/cross-chain-sdk";

export const config = {
  chain: {
    source: {
      // chainId: 84532 as any, // Base Sepolia
      chainId: Sdk.NetworkEnum.ETHEREUM,
      // url: "https://sepolia.base.org",
      url: "http://127.0.0.1:8545",
      limitOrderProtocol: "0xbC4F8be648a7d7783918E80761857403835111fd",
      wrappedNative: "0x1bdd24840e119dc2602dcc587dd182812427a5cc",
    },
    destination: {
      // chainId: 10143 as any, // Monad Testnet
      chainId: Sdk.NetworkEnum.BINANCE,
      // url: "https://rpc.ankr.com/monad_testnet",
      url: "http://127.0.0.1:8546",
      limitOrderProtocol: "0x3c63B9da5DA101F36061C9503a06906031D7457c",
      wrappedNative: "0x760afe86e5de5fa0ee542fc7b7b713e1c5425701",
    },
  },
} as const;

export type ChainConfig = (typeof config.chain)["source" | "destination"];
