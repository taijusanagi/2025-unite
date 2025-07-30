import {ContractFactory, JsonRpcProvider} from 'ethers'
import {createServer, CreateServerReturnType} from 'prool'
import {anvil} from 'prool/instances'
import {Wallet as SignerWallet} from 'ethers'
import assert from 'node:assert'

export async function getProvider(
    chainId: number
): Promise<{node?: CreateServerReturnType; provider: JsonRpcProvider}> {
    const node = createServer({
        instance: anvil({chainId}),
        limit: 1
    })
    await node.start()

    const address = node.address()
    assert(address)

    const provider = new JsonRpcProvider(`http://[${address.address}]:${address.port}/1`, chainId, {
        cacheTimeout: -1,
        staticNetwork: true
    })

    return {
        provider,
        node
    }
}

/**
 * Deploy contract and return its address
 */
export async function deploy(
    json: {abi: any; bytecode: any},
    params: unknown[],
    deployer: SignerWallet
): Promise<string> {
    const deployed = await new ContractFactory(json.abi, json.bytecode, deployer).deploy(...params)
    await deployed.waitForDeployment()
    return await deployed.getAddress()
}
