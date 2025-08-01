import * as sdkNamespace from '@1inch/cross-chain-sdk'

const Sdk: typeof sdkNamespace = (sdkNamespace as any).default ?? sdkNamespace

export default Sdk
