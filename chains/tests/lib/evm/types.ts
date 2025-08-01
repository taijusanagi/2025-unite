import {JsonRpcProvider} from 'ethers'
import {CreateServerReturnType} from 'prool'

export type Chain = {
    node?: CreateServerReturnType | undefined
    provider: JsonRpcProvider
    trueERC20: string
    weth: string
    lop: string
    escrowFactory: string
    resolver: string
}
