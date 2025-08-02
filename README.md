# GattaiSwap

Fusion unleashed. Chains united.

## Base Sepolia

Limit Order Protocol
https://sepolia.basescan.org/address/0xbC4F8be648a7d7783918E80761857403835111fd

Escrow Factory
https://sepolia.basescan.org/address/0x99275358DC3931Bcb10FfDd4DFa6276C38D9a6f0

Resolver
https://sepolia.basescan.org/address/0x88049d50AAE11BAa334b5E86B6B90BaE078f5851

TrueERC20
https://sepolia.basescan.org/address/0x93992AF843537Cf0A07E6638ABbbFB837111C753

## Arbitrum Sepolia

Limit Order Protocol
https://sepolia.arbiscan.io/address/0x3fd6bdD2c7a06159D7762D06316eCac7c173763a

Escrow Factory
https://sepolia.arbiscan.io/address/0x2C5450114e3Efb39fEDc5e9F781AfEfF944aE224

Resolver
https://sepolia.arbiscan.io/address/0x915e0305E320317C9D77187b195a682858A254c0

TrueERC20
https://sepolia.arbiscan.io/address/0xd9daCF5a9b61F951373386216744A9F42710A6A7

## Monad

Limit Order Protocol
https://testnet.monadexplorer.com/address/0x3c63B9da5DA101F36061C9503a06906031D7457c

Escrow Factory
https://testnet.monadexplorer.com/address/0x73e5d195b5cf7eb46de86901ad941986e74921ca

Resolver
https://testnet.monadexplorer.com/address/0xF920618C3CF765cE5570A15665C50b3e3f287352

TrueERC20
https://testnet.monadexplorer.com/address/0xf927004F33f26CaA1763BB21454Ef36AA76e1064

## Etherlink

== Logs ==
LimitOrderProtocol deployed at: 0x64BE4a6b41A5910b56e26c587454cDc023614e92
EscrowFactory deployed at: 0x7c054c1081F747cbC39Aa4899A53378eA66b3Dea
Resolver deployed at: 0xF920618C3CF765cE5570A15665C50b3e3f287352
ERC20True deployed at: 0x436b7B4d6cBe36A8cE531b5C5DAa3Eb369035EF4

## Patch on SDK

- limit-order-sdk/dist/cjs/limit-order/eip712/domain.js
- limit-order-sdk/dist/cjs/constant.js
- cross-chain-sdk/dist/cjs/chain.js
- cross-chain-sdk/dist/cjs/deployment.js

## Memo

```
docker run --name esplora \
  -p 50001:50001 -p 8094:80 \
  --rm -i -t blockstream/esplora \
  bash -c "/srv/explorer/run.sh bitcoin-regtest explorer"
```

```
docker exec -it esplora bash
```

```
alias bitcoin-cli='/srv/explorer/bitcoin/bin/bitcoin-cli -regtest -rpccookiefile=/data/bitcoin/regtest/.cookie'
```

```
bitcoin-cli createwallet mining_address
MINING_ADDRESS=$(bitcoin-cli -rpcwallet=mining_address getnewaddress)
```

```
bitcoin-cli -rpcwallet=mining_address generatetoaddress 101 $MINING_ADDRESS
```

```
bitcoin-cli -rpcwallet=mining_address sendtoaddress bcrt1qvt45lgurdr30xk265nqg9wdkzm8n6kcmcrq4fz 1
bitcoin-cli -rpcwallet=mining_address sendtoaddress bcrt1qc8whyxx6x637j6328weljzw4clgq9sff64d4zc 1
```

### BTC Faucet

https://coinfaucet.eu/en/btc-testnet/
