type ChainConfig = {
  type: "evm" | "btc";
  name: string;
  symbol: "WETH" | "WMON" | "WXTZ" | "BTC";
  unit: "wei" | "satoshi";
  trueERC20?: string;
  wrappedNative?: string;
  limitOrderProtocol?: string;
  escrowFactory?: string;
  resolver?: string;
  rpc: string;
  explorer: string;
};

export const config: Record<number, ChainConfig> = {
  84532: {
    type: "evm",
    name: "Base Sepolia",
    symbol: "WETH",
    unit: "wei",
    trueERC20: "0x93992AF843537Cf0A07E6638ABbbFB837111C753",
    wrappedNative: "0x1bdd24840e119dc2602dcc587dd182812427a5cc",
    limitOrderProtocol: "0xbC4F8be648a7d7783918E80761857403835111fd",
    escrowFactory: "0x99275358DC3931Bcb10FfDd4DFa6276C38D9a6f0",
    resolver: "0x88049d50AAE11BAa334b5E86B6B90BaE078f5851",
    rpc: "https://sepolia.base.org",
    explorer: "https://sepolia.basescan.org",
  },
  10143: {
    type: "evm",
    name: "Monad Testnet",
    symbol: "WMON",
    unit: "wei",
    trueERC20: "0xf927004F33f26CaA1763BB21454Ef36AA76e1064",
    wrappedNative: "0x760afe86e5de5fa0ee542fc7b7b713e1c5425701",
    limitOrderProtocol: "0x3c63B9da5DA101F36061C9503a06906031D7457c",
    escrowFactory: "0x73e5d195b5cf7eb46de86901ad941986e74921ca",
    resolver: "0xF920618C3CF765cE5570A15665C50b3e3f287352",
    rpc: "https://rpc.ankr.com/monad_testnet",
    explorer: "https://testnet.monadexplorer.com",
  },
  128123: {
    type: "evm",
    name: "Etherlink Testnet",
    symbol: "WXTZ",
    unit: "wei",
    wrappedNative: "0xc9B53AB2679f573e480d01e0f49e2B5CFB7a3EAb",
    rpc: "https://node.ghostnet.etherlink.com",
    explorer: "https://testnet.explorer.etherlink.com",
  },
  99999: {
    type: "btc",
    name: "Bitcoin Testnet3",
    symbol: "BTC",
    unit: "satoshi",
    rpc: "https://blockstream.info/testnet/api",
    explorer: "https://blockstream.info/testnet",
  },
};
