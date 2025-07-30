import Sdk from '@1inch/cross-chain-sdk'
import {ethers} from 'ethers'

export const patchedGetOrderHash = (chainId: number, order: Sdk.CrossChainOrder, lop: string) => {
    const typedData = order.getTypedData(chainId)
    typedData.domain.name = '1inch Limit Order Protocol'
    typedData.domain.version = '4'
    typedData.domain.verifyingContract = lop
    return ethers.TypedDataEncoder.hash(typedData.domain, {Order: typedData.types.Order}, order.build())
}
