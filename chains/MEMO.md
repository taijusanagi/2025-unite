## Deploy Script

### Base Sepolia

```
forge create contracts/lib/cross-chain-swap/contracts/EscrowFactory.sol:EscrowFactory -r "https://sepolia.base.org" --broadcast --private-key <PRIVATE_KEY> --constructor-args 0xbC4F8be648a7d7783918E80761857403835111fd 0x1bdd24840e119dc2602dcc587dd182812427a5cc 0x0000000000000000000000000000000000000000 0xc0797BD75cD3F34ee1CD046f03d9c85B36C2Fd01 1800 1800
```

```
forge verify-contract 0x99275358DC3931Bcb10FfDd4DFa6276C38D9a6f0 contracts/lib/cross-chain-swap/contracts/EscrowFactory.sol:EscrowFactory --chain 84532 --watch --constructor-args $(cast abi-encode "constructor(address,address,address,address,uint32,uint32)" 0xbC4F8be648a7d7783918E80761857403835111fd 0x1bdd24840e119dc2602dcc587dd182812427a5cc 0x0000000000000000000000000000000000000000 0xc0797BD75cD3F34ee1CD046f03d9c85B36C2Fd01 1800 1800)
```

```
forge create contracts/src/Resolver.sol:Resolver -r "https://sepolia.base.org" --broadcast --private-key <PRIVATE_KEY> --constructor-args 0x99275358DC3931Bcb10FfDd4DFa6276C38D9a6f0 0xbC4F8be648a7d7783918E80761857403835111fd 0xc0797BD75cD3F34ee1CD046f03d9c85B36C2Fd01
```

```
forge verify-contract 0x88049d50AAE11BAa334b5E86B6B90BaE078f5851 contracts/src/Resolver.sol:Resolver --chain 84532 --watch --constructor-args $(cast abi-encode "constructor(address,address,address)" 0x99275358DC3931Bcb10FfDd4DFa6276C38D9a6f0 0xbC4F8be648a7d7783918E80761857403835111fd 0xc0797BD75cD3F34ee1CD046f03d9c85B36C2Fd01)
```

```
forge create contracts/src/ERC20True.sol:ERC20True -r "https://sepolia.base.org" --broadcast --private-key <PRIVATE_KEY>
```

```
forge verify-contract 0x93992AF843537Cf0A07E6638ABbbFB837111C753 contracts/src/ERC20True.sol:ERC20True --chain 84532 --watch
```

### Arbitrum Sepolia

```
forge create contracts/lib/cross-chain-swap/contracts/EscrowFactory.sol:EscrowFactory -r "https://arbitrum-sepolia.api.onfinality.io/public" --broadcast --private-key <PRIVATE_KEY> --constructor-args 0x3fd6bdD2c7a06159D7762D06316eCac7c173763a 0x2836ae2ea2c013acd38028fd0c77b92cccfa2ee4 0x0000000000000000000000000000000000000000 0xc0797BD75cD3F34ee1CD046f03d9c85B36C2Fd01 1800 1800
```

```
forge verify-contract 0x2C5450114e3Efb39fEDc5e9F781AfEfF944aE224 contracts/lib/cross-chain-swap/contracts/EscrowFactory.sol:EscrowFactory --chain 421614 --watch --constructor-args $(cast abi-encode "constructor(address,address,address,address,uint32,uint32)" 0x3fd6bdD2c7a06159D7762D06316eCac7c173763a 0x2836ae2ea2c013acd38028fd0c77b92cccfa2ee4 0x0000000000000000000000000000000000000000 0xc0797BD75cD3F34ee1CD046f03d9c85B36C2Fd01 1800 1800)
```

```
forge create contracts/src/Resolver.sol:Resolver -r "https://arbitrum-sepolia.api.onfinality.io/public" --broadcast --private-key <PRIVATE_KEY> --constructor-args 0x2C5450114e3Efb39fEDc5e9F781AfEfF944aE224 0x3fd6bdD2c7a06159D7762D06316eCac7c173763a 0xc0797BD75cD3F34ee1CD046f03d9c85B36C2Fd01
```

```
forge verify-contract 0x915e0305E320317C9D77187b195a682858A254c0 contracts/src/Resolver.sol:Resolver --chain 421614 --watch --constructor-args $(cast abi-encode "constructor(address,address,address)" 0x2C5450114e3Efb39fEDc5e9F781AfEfF944aE224 0x3fd6bdD2c7a06159D7762D06316eCac7c173763a 0xc0797BD75cD3F34ee1CD046f03d9c85B36C2Fd01)
```

```
forge create contracts/src/ERC20True.sol:ERC20True -r "https://arbitrum-sepolia.api.onfinality.io/public" --broadcast --private-key <PRIVATE_KEY>
```

```
forge verify-contract 0xd9daCF5a9b61F951373386216744A9F42710A6A7 contracts/src/ERC20True.sol:ERC20True --chain 421614 --watch
```

### Monad Testnet

```
forge create contracts/lib/cross-chain-swap/contracts/EscrowFactory.sol:EscrowFactory -r "https://rpc.ankr.com/monad_testnet" --broadcast --private-key <PRIVATE_KEY> --constructor-args 0x3c63B9da5DA101F36061C9503a06906031D7457c 0x760afe86e5de5fa0ee542fc7b7b713e1c5425701 0x0000000000000000000000000000000000000000 0xc0797BD75cD3F34ee1CD046f03d9c85B36C2Fd01 1800 1800
```

This does not work...

```
forge verify-contract 0x73E5D195B5cf7EB46DE86901AD941986E74921CA contracts/lib/cross-chain-swap/contracts/EscrowFactory.sol:EscrowFactory --chain 10143 --watch --verifier sourcify --verifier-url "https://sourcify-api-monad.blockvision.org" --constructor-args $(cast abi-encode "constructor(address,address,address,address,uint32,uint32)" 0x3c63B9da5DA101F36061C9503a06906031D7457c 0x760afe86e5de5fa0ee542fc7b7b713e1c5425701 0x0000000000000000000000000000000000000000 0xc0797BD75cD3F34ee1CD046f03d9c85B36C2Fd01 1800 1800)
```

```
forge create contracts/src/Resolver.sol:Resolver -r "https://rpc.ankr.com/monad_testnet" --broadcast --private-key <PRIVATE_KEY> --constructor-args 0x73e5d195b5cf7eb46de86901ad941986e74921ca 0x3c63B9da5DA101F36061C9503a06906031D7457c 0xc0797BD75cD3F34ee1CD046f03d9c85B36C2Fd01
```

```
forge create contracts/src/ERC20True.sol:ERC20True -r "https://rpc.ankr.com/monad_testnet" --broadcast --private-key <PRIVATE_KEY>
```
