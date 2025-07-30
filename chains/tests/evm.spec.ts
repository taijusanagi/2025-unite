import 'dotenv/config'
import {expect, jest} from '@jest/globals'

import Sdk from '@1inch/cross-chain-sdk'
import {
    computeAddress,
    JsonRpcProvider,
    MaxUint256,
    parseEther,
    parseUnits,
    randomBytes,
    Wallet as SignerWallet
} from 'ethers'
import {uint8ArrayToHex, UINT_40_MAX} from '@1inch/byte-utils'

import {Wallet} from './lib/evm/wallet'
import {Resolver} from './lib/evm/resolver'
import {EscrowFactory} from './lib/evm/escrow-factory'
import trueERC20Contract from '../dist/contracts/evm/ERC20True.sol/ERC20True.json'
import wethContract from '../dist/contracts/evm/WETH9.sol/WETH9.json'
import lopContract from '../dist/contracts/evm/LimitOrderProtocol.sol/LimitOrderProtocol.json'
import factoryContract from '../dist/contracts/evm/EscrowFactory.sol/EscrowFactory.json'
import resolverContract from '../dist/contracts/evm/Resolver.sol/Resolver.json'
import {deploy, getProvider} from './lib/evm/utils'
import {CreateServerReturnType} from 'prool'
import {getOrderHashWithPatch} from './lib/evm/patch'

const {Address} = Sdk

jest.setTimeout(1000 * 60)

// default addresses
const ownerPk = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
const userPk = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'
const resolverPk = '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a'

// eslint-disable-next-line max-lines-per-function
describe('evm', () => {
    // to pass create order, it should specify supported networks
    const srcChainId = 1
    const dstChainId = 137

    type Chain = {
        node?: CreateServerReturnType | undefined
        provider: JsonRpcProvider
        trueERC20: string
        weth: string
        lop: string
        escrowFactory: string
        resolver: string
    }

    let src: Chain
    let dst: Chain

    let dstOwner: Wallet
    let srcChainUser: Wallet
    let dstChainUser: Wallet
    let srcChainResolver: Wallet
    let dstChainResolver: Wallet

    let srcFactory: EscrowFactory
    let dstFactory: EscrowFactory
    let srcResolverContract: Wallet
    let dstResolverContract: Wallet

    let srcTimestamp: bigint

    async function increaseTime(t: number): Promise<void> {
        await Promise.all([src, dst].map((chain) => chain.provider.send('evm_increaseTime', [t])))
    }

    beforeAll(async () => {
        initChain(dstChainId)
        ;[src, dst] = await Promise.all([initChain(srcChainId), initChain(dstChainId)])

        dstOwner = new Wallet(ownerPk, dst.provider)
        srcChainUser = new Wallet(userPk, src.provider)
        dstChainUser = new Wallet(userPk, dst.provider)
        srcChainResolver = new Wallet(resolverPk, src.provider)
        dstChainResolver = new Wallet(resolverPk, dst.provider)

        srcFactory = new EscrowFactory(src.provider, src.escrowFactory)
        dstFactory = new EscrowFactory(dst.provider, dst.escrowFactory)

        await srcChainUser.deposit(src.weth, parseUnits('0.001', 18))
        await srcChainUser.approveToken(src.weth, src.lop, MaxUint256)

        srcResolverContract = await Wallet.fromAddress(src.resolver, src.provider)
        dstResolverContract = await Wallet.fromAddress(dst.resolver, dst.provider)

        await dstOwner.send({to: dstResolverContract, value: parseUnits('0.01', 18)})
        await dstResolverContract.deposit(src.weth, parseUnits('0.001', 18))

        await dstChainResolver.transfer(dst.resolver, parseEther('0.001'))
        await dstResolverContract.unlimitedApprove(dst.weth, dst.escrowFactory)

        srcTimestamp = BigInt((await src.provider.getBlock('latest'))!.timestamp)
    })

    async function getBalances(
        srcToken: string,
        dstToken: string
    ): Promise<{src: {user: bigint; resolver: bigint}; dst: {user: bigint; resolver: bigint}}> {
        return {
            src: {
                user: await srcChainUser.tokenBalance(srcToken),
                resolver: await srcResolverContract.tokenBalance(srcToken)
            },
            dst: {
                user: await dstChainUser.tokenBalance(dstToken),
                resolver: await dstResolverContract.tokenBalance(dstToken)
            }
        }
    }

    afterAll(async () => {
        src.provider.destroy()
        dst.provider.destroy()
        await Promise.all([src.node?.stop(), dst.node?.stop()])
    })

    // eslint-disable-next-line max-lines-per-function
    describe('evm -> evm', () => {
        it('should work', async () => {
            const initialBalances = await getBalances(src.weth, dst.weth)
            // // User creates order
            const secret = uint8ArrayToHex(randomBytes(32)) // note: use crypto secure random number in real world
            const order = Sdk.CrossChainOrder.new(
                new Address(src.escrowFactory),
                {
                    salt: Sdk.randBigInt(1000n),
                    maker: new Address(await srcChainUser.getAddress()),
                    makingAmount: 10000n,
                    takingAmount: 9999n,
                    makerAsset: new Address(src.weth),
                    takerAsset: new Address(dst.weth)
                },
                {
                    hashLock: Sdk.HashLock.forSingleFill(secret),
                    timeLocks: Sdk.TimeLocks.new({
                        srcWithdrawal: 10n, // 10sec finality lock for test
                        srcPublicWithdrawal: 120n, // 2m for private withdrawal
                        srcCancellation: 121n, // 1sec public withdrawal
                        srcPublicCancellation: 122n, // 1sec private cancellation
                        dstWithdrawal: 10n, // 10sec finality lock for test
                        dstPublicWithdrawal: 100n, // 100sec private withdrawal
                        dstCancellation: 101n // 1sec public withdrawal
                    }),
                    srcChainId,
                    dstChainId,
                    srcSafetyDeposit: 1n,
                    dstSafetyDeposit: 1n
                },
                {
                    auction: new Sdk.AuctionDetails({
                        initialRateBump: 0,
                        points: [],
                        duration: 120n,
                        startTime: srcTimestamp
                    }),
                    whitelist: [
                        {
                            address: new Address(src.resolver),
                            allowFrom: 0n
                        }
                    ],
                    resolvingStartTime: 0n
                },
                {
                    nonce: Sdk.randBigInt(UINT_40_MAX),
                    allowPartialFills: false,
                    allowMultipleFills: false
                }
            )

            // patch
            // @ts-ignore
            order.inner.inner.takerAsset = new Address(src.trueERC20)

            const signature = await srcChainUser.signOrder(srcChainId, order, src.lop)
            const orderHash = getOrderHashWithPatch(srcChainId, order, src.lop)

            // // Resolver fills order
            const resolverContract = new Resolver(src.resolver, dst.resolver)
            console.log(`[${srcChainId}]`, `Filling order ${orderHash}`)
            const fillAmount = order.makingAmount

            const {txHash: orderFillHash, blockHash: srcDeployBlock} = await srcChainResolver.send(
                resolverContract.deploySrc(
                    srcChainId,
                    order,
                    signature,
                    Sdk.TakerTraits.default()
                        .setExtension(order.extension)
                        .setAmountMode(Sdk.AmountMode.maker)
                        .setAmountThreshold(order.takingAmount),
                    fillAmount,
                    order.escrowExtension.hashLockInfo,
                    src.lop
                )
            )
            console.log(`[${srcChainId}]`, `Order ${orderHash} filled for ${fillAmount} in tx ${orderFillHash}`)
            const srcEscrowEvent = await srcFactory.getSrcDeployEvent(srcDeployBlock)
            const dstImmutables = srcEscrowEvent[0]
                .withComplement(srcEscrowEvent[1])
                .withTaker(new Address(resolverContract.dstAddress))
            console.log(`[${dstChainId}]`, `Depositing ${dstImmutables.amount} for order ${orderHash}`)
            const {txHash: dstDepositHash, blockTimestamp: dstDeployedAt} = await dstChainResolver.send(
                resolverContract.deployDst(dstImmutables)
            )
            console.log(`[${dstChainId}]`, `Created dst deposit for order ${orderHash} in tx ${dstDepositHash}`)
            const ESCROW_SRC_IMPLEMENTATION = await srcFactory.getSourceImpl()
            const ESCROW_DST_IMPLEMENTATION = await dstFactory.getDestinationImpl()
            const srcEscrowAddress = new Sdk.EscrowFactory(new Address(src.escrowFactory)).getSrcEscrowAddress(
                srcEscrowEvent[0],
                ESCROW_SRC_IMPLEMENTATION
            )
            const dstEscrowAddress = new Sdk.EscrowFactory(new Address(dst.escrowFactory)).getDstEscrowAddress(
                srcEscrowEvent[0],
                srcEscrowEvent[1],
                dstDeployedAt,
                new Address(resolverContract.dstAddress),
                ESCROW_DST_IMPLEMENTATION
            )
            await increaseTime(11)
            // User shares key after validation of dst escrow deployment
            console.log(`[${dstChainId}]`, `Withdrawing funds for user from ${dstEscrowAddress}`)
            await dstChainResolver.send(
                resolverContract.withdraw('dst', dstEscrowAddress, secret, dstImmutables.withDeployedAt(dstDeployedAt))
            )
            console.log(`[${srcChainId}]`, `Withdrawing funds for resolver from ${srcEscrowAddress}`)
            const {txHash: resolverWithdrawHash} = await srcChainResolver.send(
                resolverContract.withdraw('src', srcEscrowAddress, secret, srcEscrowEvent[0])
            )
            console.log(
                `[${srcChainId}]`,
                `Withdrew funds for resolver from ${srcEscrowAddress} to ${src.resolver} in tx ${resolverWithdrawHash}`
            )
            const resultBalances = await getBalances(src.weth, dst.weth)
            // user transferred funds to resolver on source chain
            expect(initialBalances.src.user - resultBalances.src.user).toBe(order.makingAmount)
            expect(resultBalances.src.resolver - initialBalances.src.resolver).toBe(order.makingAmount)
            // resolver transferred funds to user on destination chain
            expect(resultBalances.dst.user - initialBalances.dst.user).toBe(order.takingAmount)
            expect(initialBalances.dst.resolver - resultBalances.dst.resolver).toBe(order.takingAmount)
        })
    })
})

async function initChain(chainId: number): Promise<{
    node?: CreateServerReturnType
    provider: JsonRpcProvider
    trueERC20: string
    weth: string
    lop: string
    escrowFactory: string
    resolver: string
}> {
    const {node, provider} = await getProvider(chainId)
    const deployer = new SignerWallet(ownerPk, provider)

    // deploy TrueERC20
    const trueERC20 = await deploy(trueERC20Contract, [], deployer)
    console.log(`[${chainId}]`, `TrueERC20 contract deployed to`, trueERC20)

    // deploy WETH
    const weth = await deploy(wethContract, [], deployer)
    console.log(`[${chainId}]`, `WETH contract deployed to`, weth)

    // deploy LOP
    const lop = await deploy(lopContract, [weth], deployer)
    console.log(`[${chainId}]`, `LOP contract deployed to`, lop)

    // deploy EscrowFactory
    const escrowFactory = await deploy(
        factoryContract,
        [
            lop,
            weth, // feeToken,
            Address.fromBigInt(0n).toString(), // accessToken,
            deployer.address, // owner
            60 * 30, // src rescue delay
            60 * 30 // dst rescue delay
        ],
        deployer
    )
    console.log(`[${chainId}]`, `Escrow factory contract deployed to`, escrowFactory)

    // deploy Resolver contract
    const resolver = await deploy(
        resolverContract,
        [
            escrowFactory,
            lop,
            computeAddress(resolverPk) // resolver as owner of contract
        ],
        deployer
    )
    console.log(`[${chainId}]`, `Resolver contract deployed to`, resolver)

    return {node: node, provider, trueERC20, weth, lop, resolver, escrowFactory}
}
