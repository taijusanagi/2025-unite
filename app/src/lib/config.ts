export const config: Record<
  number,
  {
    wrappedNative: string;
    limitOrderProtocol: string;
    escrowFactory: string;
    resolver: string;
    url: string;
  }
> = {
  84532: {
    wrappedNative: "0x1bdd24840e119dc2602dcc587dd182812427a5cc",
    limitOrderProtocol: "0xbC4F8be648a7d7783918E80761857403835111fd",
    escrowFactory: "0x99275358DC3931Bcb10FfDd4DFa6276C38D9a6f0",
    resolver: "0x88049d50AAE11BAa334b5E86B6B90BaE078f5851",
    url: "https://sepolia.base.org",
  },
  10143: {
    wrappedNative: "0x760afe86e5de5fa0ee542fc7b7b713e1c5425701",
    limitOrderProtocol: "0x3c63B9da5DA101F36061C9503a06906031D7457c",
    escrowFactory: "0x73e5d195b5cf7eb46de86901ad941986e74921ca",
    resolver: "0xF920618C3CF765cE5570A15665C50b3e3f287352",
    url: "https://rpc.ankr.com/monad_testnet",
  },
};
