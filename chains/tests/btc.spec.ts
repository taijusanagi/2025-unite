import {execSync} from 'child_process'
import {BITCOIN_CLI, broadcastTx, getUtxos, verifyHTLCScriptHashFromTx} from './lib/btc/utils'
import {expect, jest} from '@jest/globals'
import Sdk from '@1inch/cross-chain-sdk'
import * as bitcoin from 'bitcoinjs-lib'
import axios from 'axios'
import * as ecc from 'tiny-secp256k1'
import {ECPairFactory, ECPairInterface} from 'ecpair'
import {randomBytes} from 'crypto'
import {Chain} from './lib/evm/types'
import {Wallet} from './lib/evm/wallet'
import {EscrowFactory} from './lib/evm/escrow-factory'
import {getBalances as evmGetBalances, increaseTime, initChain} from './lib/evm/utils'
import {getBalance as btcGetBalance} from './lib/btc/utils'
import {evmOwnerPk, evmResolverPk, evmUserPk} from './lib/evm/default-keys'
import {parseUnits} from 'ethers'
import {hexToUint8Array, uint8ArrayToHex, UINT_40_MAX} from '@1inch/byte-utils'
import {Resolver} from './lib/evm/resolver'
import {getOrderHashWithPatch, patchedDomain} from './lib/evm/patch'
import bip68 from 'bip68'

const {Address} = Sdk

jest.setTimeout(1000 * 60)

// default addresses
const btcUserPk = 'cP7YndPTRomiUQEDfm3zFCMpNgBYyPZLJ84LoB4dZ73NzqJSny4n'
const btcResolverPk = 'cUJ4wz3dLzT8v2ZxKtRpU7qyXZ6E1qur87LGCGMehYTkWHnQTMeD'

const nativeTokenAddress = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'
const nullAddress = '0x0000000000000000000000000000000000000000'

describe('btc', () => {
    const network = bitcoin.networks.regtest
    const API_BASE = 'http://localhost:8094/regtest/api'

    const ECPair = ECPairFactory(ecc)

    const btcUserKeyPair: ECPairInterface = ECPair.fromWIF(btcUserPk, network)
    const btcResolverKeyPair: ECPairInterface = ECPair.fromWIF(btcResolverPk, network)

    const btcUserPubKey = Buffer.from(btcUserKeyPair.publicKey)
    const btcResolverPubKey = Buffer.from(btcResolverKeyPair.publicKey)

    const btcUserAddress = bitcoin.payments.p2wpkh({
        pubkey: btcUserPubKey,
        network
    }).address
    const btcResolverAddress = bitcoin.payments.p2wpkh({
        pubkey: btcResolverPubKey,
        network
    }).address

    console.log('btcUserAddress', btcUserAddress)
    console.log('btcResolverAddress', btcResolverAddress)

    const evmChainId = 1
    const dummyBtcChainId = 137 // set dummy value this first
    const btcChainId = 99999 // just random chain id for now

    let evm: Chain

    let evmUser: Wallet
    let evmResolver: Wallet
    let evmFactory: EscrowFactory
    let evmResolverContract: Wallet

    let evmTimestamp: bigint
    let btcTimestamp: bigint
    let btcMiningAddress: string

    beforeAll(async () => {
        console.log('🚀 Set up EVM...')
        ;[evm] = await Promise.all([
            initChain(evmChainId, evmOwnerPk, evmResolverPk),
            initChain(evmChainId, evmOwnerPk, evmResolverPk)
        ])

        evmTimestamp = BigInt((await evm.provider.getBlock('latest'))!.timestamp)

        evmUser = new Wallet(evmUserPk, evm.provider)
        evmResolver = new Wallet(evmResolverPk, evm.provider)

        evmFactory = new EscrowFactory(evm.provider, evm.escrowFactory)

        await evmUser.deposit(evm.weth, parseUnits('0.001', 18))
        await evmUser.unlimitedApprove(evm.weth, evm.lop)

        evmResolverContract = await Wallet.fromAddress(evm.resolver, evm.provider)

        await evmResolver.send({to: evmResolverContract, value: parseUnits('0.01', 18)})
        await evmResolverContract.deposit(evm.weth, parseUnits('0.001', 18))
        await evmResolverContract.unlimitedApprove(evm.weth, evm.escrowFactory)

        console.log('✅ Evm ready.')

        console.log('🚀 Starting Esplora Docker container...')

        btcTimestamp = evmTimestamp
        console.log('btcTimestamp', btcTimestamp)

        execSync(
            `docker run --name esplora -p 50001:50001 -p 8094:80 --rm -d blockstream/esplora bash -c "/srv/explorer/run.sh bitcoin-regtest explorer"`,
            {stdio: 'inherit'}
        )

        console.log('⏳ Waiting for Bitcoin node to be ready...')
        execSync(`sleep 5`)

        console.log('⛏️  Mining and sending funds...')

        execSync(`${BITCOIN_CLI} createwallet mining_address`)

        btcMiningAddress = execSync(`${BITCOIN_CLI} -rpcwallet=mining_address getnewaddress`).toString().trim()

        execSync(`${BITCOIN_CLI} setmocktime ${btcTimestamp}`)
        execSync(`${BITCOIN_CLI} -rpcwallet=mining_address generatetoaddress 101 ${btcMiningAddress}`)
        execSync(`sleep 5`)

        const testAddresses = [btcUserAddress, btcResolverAddress]

        testAddresses.forEach((addr) => {
            execSync(`${BITCOIN_CLI} -rpcwallet=mining_address sendtoaddress ${addr} 1`)
        })
        execSync(`${BITCOIN_CLI} -rpcwallet=mining_address generatetoaddress 2 ${btcMiningAddress}`)
        execSync(`sleep 2`)

        console.log('✅ Bitcoin regtest ready.')
    })

    afterAll(() => {
        try {
            console.log('🧹 Stopping Esplora Docker container...')
            execSync('docker stop esplora', {stdio: 'inherit'})
        } catch (err) {
            console.warn('⚠️ Could not stop esplora container — it may have already stopped.')
        }
    })

    describe('evm -> btc', () => {
        it('should work', async () => {
            const evmInitialBalances = await evmGetBalances([
                {token: evm.weth, user: evmUser, resolver: evmResolverContract}
            ])

            const btcUserInitialBalance = await btcGetBalance(btcUserAddress!) // maker
            const btcResolverInitialBalance = await btcGetBalance(btcResolverAddress!) // taker

            // // User creates order
            const secret = randomBytes(32)

            const hashLock = {
                keccak256: Sdk.HashLock.forSingleFill(uint8ArrayToHex(secret)),
                sha256: bitcoin.crypto.sha256(secret)
            }

            const order = Sdk.CrossChainOrder.new(
                new Address(evm.escrowFactory),
                {
                    salt: Sdk.randBigInt(1000n),
                    maker: new Address(await evmUser.getAddress()),
                    makingAmount: 10000n,
                    takingAmount: 9999n,
                    makerAsset: new Address(evm.weth),
                    takerAsset: new Address(nativeTokenAddress)
                },
                {
                    hashLock: hashLock.keccak256,
                    timeLocks: Sdk.TimeLocks.new({
                        srcWithdrawal: 10n, // 10sec finality lock for test
                        srcPublicWithdrawal: 120n, // 2m for private withdrawal
                        srcCancellation: 121n, // 1sec public withdrawal
                        srcPublicCancellation: 122n, // 1sec private cancellation
                        dstWithdrawal: 10n, // 10sec finality lock for test
                        dstPublicWithdrawal: 100n, // 100sec private withdrawal
                        dstCancellation: 101n // 1sec public withdrawal
                    }),
                    srcChainId: evmChainId,
                    dstChainId: dummyBtcChainId,
                    srcSafetyDeposit: 1n,
                    dstSafetyDeposit: 0n
                },
                {
                    auction: new Sdk.AuctionDetails({
                        initialRateBump: 0,
                        points: [],
                        duration: 120n,
                        startTime: evmTimestamp
                    }),
                    whitelist: [
                        {
                            address: new Address(evm.resolver),
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
            order.inner.inner.takerAsset = new Address(evm.trueERC20)

            const {data} = bitcoin.address.fromBech32(btcUserAddress!)
            // @ts-ignore
            order.inner.inner.receiver = `0x${data.toString('hex')}`
            // @ts-ignore
            order.inner.fusionExtension.dstChainId = btcChainId

            const signature = await evmUser.signOrder(evmChainId, order, evm.lop)

            const orderHash = getOrderHashWithPatch(evmChainId, order, {...patchedDomain, verifyingContract: evm.lop})

            // // Resolver fills order
            const resolverContract = new Resolver(evm.resolver, evm.resolver)
            console.log(`[${evmChainId}]`, `Filling order ${orderHash}`)
            const fillAmount = order.makingAmount

            const {txHash: orderFillHash, blockHash: srcDeployBlock} = await evmResolver.send(
                resolverContract.deploySrc(
                    evmChainId,
                    order,
                    signature,
                    Sdk.TakerTraits.default()
                        .setExtension(order.extension)
                        .setAmountMode(Sdk.AmountMode.maker)
                        .setAmountThreshold(order.takingAmount),
                    fillAmount,
                    order.escrowExtension.hashLockInfo,
                    evm.lop
                )
            )
            console.log(`[${evmChainId}]`, `Order ${orderHash} filled for ${fillAmount} in tx ${orderFillHash}`)

            const srcEscrowEvent = await evmFactory.getSrcDeployEvent(srcDeployBlock)
            const dstImmutables = srcEscrowEvent[0]
                .withComplement(srcEscrowEvent[1])
                .withTaker(new Address(resolverContract.dstAddress))

            const rebuiltAddress = bitcoin.address.toBech32(
                Buffer.from(dstImmutables.maker.toString().slice(2), 'hex'),
                0,
                network.bech32
            )
            expect(rebuiltAddress).toBe(btcUserAddress) // to make sure the btc user address is available on-chain

            // ========================================
            // 1️⃣ PHASE 1: Taker (resolver) creates HTLC and deposits BTC
            // ========================================
            console.log('🔐 Phase 1: Taker locking BTC into HTLC...')

            // NOTE: secret is known to the maker — taker only knows the hash
            const dstTimeLocks = dstImmutables.timeLocks.toDstTimeLocks()
            const htlcScript = bitcoin.script.compile([
                Buffer.from(hexToUint8Array(dstImmutables.hash())),
                bitcoin.opcodes.OP_DROP,
                bitcoin.script.number.encode(Number(dstTimeLocks.privateWithdrawal)),
                bitcoin.opcodes.OP_CHECKLOCKTIMEVERIFY,
                bitcoin.opcodes.OP_DROP,
                bitcoin.opcodes.OP_IF,
                bitcoin.opcodes.OP_SHA256,
                hashLock.sha256,
                bitcoin.opcodes.OP_EQUALVERIFY,
                btcUserPubKey, // 👤 Maker can claim with secret
                bitcoin.opcodes.OP_CHECKSIG,
                bitcoin.opcodes.OP_ELSE,
                bitcoin.script.number.encode(Number(dstTimeLocks.privateCancellation)),
                bitcoin.opcodes.OP_CHECKLOCKTIMEVERIFY,
                bitcoin.opcodes.OP_DROP,
                btcResolverPubKey, // 👤 Taker can refund after timeout
                bitcoin.opcodes.OP_CHECKSIG,
                bitcoin.opcodes.OP_ENDIF
            ])

            const p2sh = bitcoin.payments.p2sh({
                redeem: {output: htlcScript, network},
                network
            })

            console.log('✅ HTLC P2SH Address:', p2sh.address)

            // === Taker (resolver) funds the HTLC ===
            const utxos = await getUtxos(btcResolverAddress!)
            if (!utxos.length) {
                console.error('❌ No UTXOs available to fund HTLC.')
                return
            }

            const amount = Number(order.takingAmount) // Match maker's amount or adjust as needed
            const fee = 10000
            const totalInput = utxos.reduce((sum, u) => sum + u.value, 0)
            const change = totalInput - amount - fee

            if (change < 0) {
                console.error('❌ Not enough funds to lock BTC and cover the fee.')
                return
            }

            const psbt = new bitcoin.Psbt({network})

            for (const utxo of utxos) {
                psbt.addInput({
                    hash: utxo.txid,
                    index: utxo.vout,
                    witnessUtxo: {
                        script: bitcoin.payments.p2wpkh({pubkey: btcResolverPubKey, network}).output!,
                        value: utxo.value
                    }
                })
            }

            psbt.addOutput({
                script: p2sh.output!,
                value: amount
            })

            if (change > 0) {
                psbt.addOutput({
                    address: btcResolverAddress!, // refund to self
                    value: change
                })
            }

            utxos.forEach((_, idx) => {
                psbt.signInput(idx, {
                    publicKey: btcResolverPubKey,
                    sign: (hash) => Buffer.from(btcResolverKeyPair.sign(hash))
                })
            })

            psbt.finalizeAllInputs()

            const txHex = psbt.extractTransaction().toHex()
            const btcDstEscrowHash = await broadcastTx(txHex)

            console.log('✅ Taker has funded HTLC:')
            console.log('🔗 btcDstEscrowHash:', btcDstEscrowHash)

            // relayer side
            // check src escrow
            const ESCROW_SRC_IMPLEMENTATION = await evmFactory.getSourceImpl()
            const evmSrcEscrowAddress = new Sdk.EscrowFactory(new Address(evm.escrowFactory)).getSrcEscrowAddress(
                srcEscrowEvent[0],
                ESCROW_SRC_IMPLEMENTATION
            )

            // check dst escrow
            await verifyHTLCScriptHashFromTx(btcDstEscrowHash, htlcScript)

            // verify src
            await increaseTime([evm], 11)

            // ========================================
            // 2️⃣ PHASE 2: Maker claims BTC using secret
            // ========================================
            console.log('\n🔓 Phase 2: Maker (user) claims HTLC using secret...')

            const spendPsbt = new bitcoin.Psbt({network})

            const rawTxHex = (await axios.get(`${API_BASE}/tx/${btcDstEscrowHash}/hex`)).data
            spendPsbt.setLocktime(Number(dstTimeLocks.privateWithdrawal))
            spendPsbt.addInput({
                hash: btcDstEscrowHash,
                index: 0,
                nonWitnessUtxo: Buffer.from(rawTxHex, 'hex'),
                redeemScript: htlcScript,
                sequence: 0xfffffffe // Enable locktime
            })

            const redeemFee = 1000
            const redeemValue = amount - redeemFee

            if (redeemValue <= 0) {
                console.error(`❌ Not enough value to redeem HTLC.`)
                return
            }

            spendPsbt.addOutput({
                address: btcUserAddress!,
                value: redeemValue
            })

            spendPsbt.signInput(0, {
                publicKey: btcUserPubKey,
                sign: (hash) => Buffer.from(btcUserKeyPair.sign(hash))
            })

            const htlcRedeemFinalizer = (inputIndex: number, input: any) => {
                const signature = input.partialSig[0].signature

                const unlockingScript = bitcoin.script.compile([signature, secret, bitcoin.opcodes.OP_TRUE])

                const payment = bitcoin.payments.p2sh({
                    redeem: {
                        input: unlockingScript,
                        output: htlcScript
                    }
                })

                return {
                    finalScriptSig: payment.input,
                    finalScriptWitness: undefined
                }
            }

            spendPsbt.finalizeInput(0, htlcRedeemFinalizer)

            const finalTxHex = spendPsbt.extractTransaction().toHex()
            const finalTxId = await broadcastTx(finalTxHex)

            console.log('🎉 Maker successfully claimed BTC from HTLC!')
            console.log('✅ Redemption TXID:', finalTxId)

            console.log(`[${evmChainId}]`, `Withdrawing funds for resolver from ${evmSrcEscrowAddress}`)
            const {txHash: resolverWithdrawHash} = await evmResolver.send(
                resolverContract.withdraw('src', evmSrcEscrowAddress, uint8ArrayToHex(secret), srcEscrowEvent[0])
            )

            console.log(
                `[${evmChainId}]`,
                `Withdrew funds for resolver from ${evmSrcEscrowAddress} to ${evm.resolver} in tx ${resolverWithdrawHash}`
            )

            const evmResultBalances = await evmGetBalances([
                {token: evm.weth, user: evmUser, resolver: evmResolverContract}
            ])

            // user transferred funds to resolver on evm chain
            expect(evmInitialBalances[0].user - evmResultBalances[0].user).toBe(order.makingAmount)
            expect(evmResultBalances[0].resolver - evmInitialBalances[0].resolver).toBe(order.makingAmount)

            const btcUserResultBalance = await btcGetBalance(btcUserAddress!) // maker
            const btcResolverResultBalance = await btcGetBalance(btcResolverAddress!) // takerr

            console.log('btcUserInitialBalance', btcUserInitialBalance)
            console.log('btcResolverInitialBalance', btcResolverInitialBalance)

            console.log('btcUserResultBalance', btcUserResultBalance)
            console.log('btcResolverResultBalance', btcResolverResultBalance)

            expect(btcUserResultBalance - btcUserInitialBalance).toBe(redeemValue)
            expect(btcResolverInitialBalance - btcResolverResultBalance).toBe(amount + fee)
        })
    })

    describe('btc -> evm', () => {
        it('should work', async () => {
            // ========================================
            // 1️⃣ PHASE 1: Maker creates HTLC and fully signs TX
            // ========================================
            console.log('🔐 Phase 1: Maker creating HTLC and signed funding TX...')

            const secret = randomBytes(32)

            const hashLock = {
                keccak256: Sdk.HashLock.forSingleFill(uint8ArrayToHex(secret)),
                sha256: bitcoin.crypto.sha256(secret)
            }

            // use sdk to make order object
            const order = Sdk.CrossChainOrder.new(
                new Address(evm.escrowFactory),
                {
                    salt: Sdk.randBigInt(1000n),
                    maker: new Address(nullAddress), // this is dummy now
                    makingAmount: 10000n,
                    takingAmount: 9999n,
                    makerAsset: new Address(evm.trueERC20), // ths is dummy now
                    takerAsset: new Address(evm.weth),
                    receiver: new Address(await evmUser.getAddress())
                },
                {
                    hashLock: hashLock.keccak256,
                    timeLocks: Sdk.TimeLocks.new({
                        srcWithdrawal: 512n, // about 1 blocks, must be 512, 1024...
                        srcPublicWithdrawal: 1023n, // not used
                        srcCancellation: 1024n, // about 2 blocks, must be 512, 1024...
                        srcPublicCancellation: 1025n, // not used
                        dstWithdrawal: 512n, // adjust with btc
                        dstPublicWithdrawal: 522n, // 100sec private withdrawal
                        dstCancellation: 523n // 1sec public withdrawal
                    }),
                    srcChainId: dummyBtcChainId,
                    dstChainId: evmChainId,
                    srcSafetyDeposit: 0n,
                    dstSafetyDeposit: 1n
                },
                {
                    auction: new Sdk.AuctionDetails({
                        initialRateBump: 0,
                        points: [],
                        duration: 120n,
                        startTime: btcTimestamp
                    }),
                    whitelist: [
                        {
                            address: new Address(evm.resolver),
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

            const {data} = bitcoin.address.fromBech32(btcUserAddress!)
            // @ts-ignore
            order.inner.inner.maker = `0x${data.toString('hex')}`
            // @ts-ignore
            order.inner.fusionExtension.srcChainId = btcChainId

            const orderHash = getOrderHashWithPatch(btcChainId, order, {
                name: '',
                version: '',
                verifyingContract: nullAddress
            })
            // @ts-ignore
            const timeLocks = order.inner.fusionExtension.timeLocks

            const htlcScript = bitcoin.script.compile([
                Buffer.from(hexToUint8Array(orderHash)), // include orderhash here to maker sign it
                bitcoin.opcodes.OP_DROP,
                bitcoin.script.number.encode(
                    bip68.encode({seconds: Number(timeLocks._srcWithdrawal), blocks: undefined})
                ),
                bitcoin.opcodes.OP_CHECKSEQUENCEVERIFY,
                bitcoin.opcodes.OP_DROP,
                bitcoin.opcodes.OP_IF,
                bitcoin.opcodes.OP_SHA256,
                hashLock.sha256,
                bitcoin.opcodes.OP_EQUALVERIFY,
                btcResolverPubKey,
                bitcoin.opcodes.OP_CHECKSIG,
                bitcoin.opcodes.OP_ELSE,
                bitcoin.script.number.encode(
                    bip68.encode({seconds: Number(timeLocks._srcCancellation), blocks: undefined})
                ),
                bitcoin.opcodes.OP_CHECKSEQUENCEVERIFY,
                bitcoin.opcodes.OP_DROP,
                btcUserPubKey,
                bitcoin.opcodes.OP_CHECKSIG,
                bitcoin.opcodes.OP_ENDIF
            ])

            const p2sh = bitcoin.payments.p2sh({
                redeem: {output: htlcScript, network},
                network
            })

            console.log('✅ HTLC P2SH Address:', p2sh.address)

            // // 👤 Maker's P2WPKH funding
            // const makerPayment = bitcoin.payments.p2wpkh({
            //     pubkey: btcUserPubKey,
            //     network
            // })

            // const fromAddress = makerPayment.address!
            // console.log('🔗 Maker Funding Address:', fromAddress)

            // const utxos = await getUtxos(fromAddress)
            // if (!utxos.length) {
            //     console.error("❌ No UTXOs found in maker's wallet.")
            //     return
            // }

            // const amount = 1000000
            // const fee = 10000
            // const totalInput = utxos.reduce((sum, utxo) => sum + utxo.value, 0)
            // const change = totalInput - amount - fee

            // if (change < 0) {
            //     console.error('❌ Not enough funds to lock 10 sats and cover the fee.')
            //     return
            // }

            // const psbt = new bitcoin.Psbt({network})

            // if (change > 0) {
            //     psbt.addOutput({
            //         address: fromAddress,
            //         value: change
            //     })
            // }

            // for (const utxo of utxos) {
            //     psbt.addInput({
            //         hash: utxo.txid,
            //         index: utxo.vout,
            //         witnessUtxo: {
            //             script: makerPayment.output!,
            //             value: utxo.value
            //         }
            //     })
            // }

            // psbt.addOutput({
            //     script: p2sh.output!,
            //     value: amount
            // })

            // utxos.forEach((_, idx) => {
            //     psbt.signInput(idx, {
            //         publicKey: btcUserPubKey,
            //         sign: (hash) => Buffer.from(btcUserKeyPair.sign(hash))
            //     })
            // })

            // psbt.finalizeAllInputs()

            // const txHex = psbt.extractTransaction().toHex()

            // // 💾 Save fully signed TX and order details
            // const order = {
            //     txHex,
            //     htlcScriptHex: htlcScript.toString('hex'),
            //     p2shAddress: p2sh.address!,
            //     valueSats: amount,
            //     lockTime,
            //     hash: hash.toString('hex'),
            //     createdAt: new Date().toISOString()
            // }

            // const orderJson = JSON.stringify(order, null, 2)
            // console.log('📦 Maker created and signed order JSON:\n', orderJson)

            // // ========================================
            // // 2️⃣ PHASE 2: Taker receives order, broadcasts
            // // ========================================
            // console.log('\n📥 Phase 2: Resolver receives signed TX and broadcasts...')

            // const loaded = JSON.parse(orderJson)

            // console.log('HTLC address:', loaded.p2shAddress)
            // const htlcUtxos2 = await getUtxos(loaded.p2shAddress)
            // console.log('Found HTLC UTXOs:', htlcUtxos2)

            // const txid = await broadcastTx(loaded.txHex)
            // console.log('✅ HTLC Funding TX Broadcasted:', txid)

            // // const dstImmutables = srcEscrowEvent[0]
            // //     .withComplement(srcEscrowEvent[1])
            // //     .withTaker(new Address(resolverContract.dstAddress))
            // // console.log(`[${evmChainId}]`, `Depositing ${dstImmutables.amount} for order ${orderHash}`)
            // // const {txHash: dstDepositHash, blockTimestamp: dstDeployedAt} = await evmDstResolver.send(
            // //     resolverContract.deployDst(dstImmutables)
            // // )
            // // console.log(`[${dstChainId}]`, `Created dst deposit for order ${orderHash} in tx ${dstDepositHash}`)

            // await verifyHTLCScriptHashFromTx(txid, htlcScript)

            // // ========================================
            // // 3️⃣ PHASE 3: Resolver redeems HTLC using secret
            // // ========================================
            // console.log('\n🔓 Phase 3: Resolver redeems HTLC with secret...')

            // const htlcUtxos = await getUtxos(loaded.p2shAddress)
            // if (!htlcUtxos.length) {
            //     console.error('❌ No UTXOs found at HTLC address.')
            //     return
            // }

            // const htlcScriptBuffer = Buffer.from(loaded.htlcScriptHex, 'hex')
            // const htlcUtxo = htlcUtxos[0]

            // const rawTxHex = (await axios.get(`${API_BASE}/tx/${htlcUtxo.txid}/hex`)).data

            // const spendPsbt = new bitcoin.Psbt({network})

            // spendPsbt.addInput({
            //     hash: htlcUtxo.txid,
            //     index: htlcUtxo.vout,
            //     nonWitnessUtxo: Buffer.from(rawTxHex, 'hex'),
            //     redeemScript: htlcScriptBuffer
            // })

            // const redeemFee = 10000
            // const redeemValue = htlcUtxo.value - redeemFee

            // if (redeemValue <= 0) {
            //     console.error(`❌ Not enough value to redeem HTLC. UTXO value = ${htlcUtxo.value}, fee = ${redeemFee}`)
            //     return
            // }

            // spendPsbt.addOutput({
            //     address: btcResolverAddress!,
            //     value: redeemValue
            // })

            // // Sign the input. This generates the signature and stores it in the PSBT.
            // spendPsbt.signInput(0, {
            //     publicKey: Buffer.from(btcResolverKeyPair.publicKey),
            //     sign: (hash) => Buffer.from(btcResolverKeyPair.sign(hash))
            // })

            // // This custom finalizer function assembles the correct scriptSig.
            // const htlcRedeemFinalizer = (inputIndex: number, input: any) => {
            //     const signature = input.partialSig[0].signature

            //     // This is the "unlocking" script. It provides the data needed
            //     // to satisfy the OP_IF branch of your HTLC redeem script.
            //     // It must contain, in order: signature, secret, and OP_TRUE.
            //     const unlockingScript = bitcoin.script.compile([
            //         signature,
            //         secret, // The secret must be a Buffer
            //         bitcoin.opcodes.OP_TRUE
            //     ])

            //     // Use the payments utility to create the final scriptSig, which correctly
            //     // combines the unlocking data with the redeem script itself.
            //     const payment = bitcoin.payments.p2sh({
            //         redeem: {
            //             input: unlockingScript,
            //             output: input.redeemScript
            //         }
            //     })

            //     return {
            //         finalScriptSig: payment.input,
            //         finalScriptWitness: undefined
            //     }
            // }

            // // Finalize the input using our custom logic.
            // spendPsbt.finalizeInput(0, htlcRedeemFinalizer)

            // // Extract and broadcast the final, valid transaction.
            // const finalTxHex = spendPsbt.extractTransaction().toHex()
            // const finalTxId = await broadcastTx(finalTxHex)

            // console.log('🎉 Resolver has claimed the HTLC!')
            // console.log('✅ Final Redeem TXID:', finalTxId)
        })
    })
})
