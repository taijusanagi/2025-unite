import {execSync} from 'child_process'
import {BITCOIN_CLI, broadcastTx, getUtxos, verifyHTLCScriptHashFromTx} from './lib/btc/utils'
import {jest} from '@jest/globals'

import * as bitcoin from 'bitcoinjs-lib'
import axios from 'axios'
import * as ecc from 'tiny-secp256k1'
import {ECPairFactory, ECPairInterface} from 'ecpair'
import crypto from 'crypto'

jest.setTimeout(1000 * 60)

const network = bitcoin.networks.regtest
const API_BASE = 'http://localhost:8094/regtest/api'

const ECPair = ECPairFactory(ecc)

const userPk = 'cP7YndPTRomiUQEDfm3zFCMpNgBYyPZLJ84LoB4dZ73NzqJSny4n'
const resolverPk = 'cUJ4wz3dLzT8v2ZxKtRpU7qyXZ6E1qur87LGCGMehYTkWHnQTMeD'

const userKeyPair: ECPairInterface = ECPair.fromWIF(userPk, network)
const resolverKeyPair: ECPairInterface = ECPair.fromWIF(resolverPk, network)

const userPubKey = Buffer.from(userKeyPair.publicKey)
const resolverPubKey = Buffer.from(resolverKeyPair.publicKey)

const userAddress = bitcoin.payments.p2wpkh({
    pubkey: userPubKey,
    network
}).address
const resolverAddress = bitcoin.payments.p2wpkh({
    pubkey: resolverPubKey,
    network
}).address

console.log('userAddress', userAddress)
console.log('resolverAddress', resolverAddress)

describe('btc', () => {
    beforeAll(async () => {
        console.log('🚀 Starting Esplora Docker container...')

        execSync(
            `docker run --name esplora -p 50001:50001 -p 8094:80 --rm -d blockstream/esplora bash -c "/srv/explorer/run.sh bitcoin-regtest explorer"`,
            {stdio: 'inherit'}
        )

        console.log('⏳ Waiting for Bitcoin node to be ready...')
        execSync(`sleep 5`)

        console.log('⛏️  Mining and sending funds...')

        execSync(`${BITCOIN_CLI} createwallet mining_address`)

        const miningAddress = execSync(`${BITCOIN_CLI} -rpcwallet=mining_address getnewaddress`).toString().trim()

        execSync(`${BITCOIN_CLI} -rpcwallet=mining_address generatetoaddress 101 ${miningAddress}`)
        execSync(`sleep 5`)

        const testAddresses = [userAddress, resolverAddress]

        testAddresses.forEach((addr) => {
            execSync(`${BITCOIN_CLI} -rpcwallet=mining_address sendtoaddress ${addr} 1`)
        })
        execSync(`${BITCOIN_CLI} -rpcwallet=mining_address generatetoaddress 2 ${miningAddress}`)
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
            // ========================================
            // 1️⃣ PHASE 1: Taker (resolver) creates HTLC and deposits BTC
            // ========================================
            console.log('🔐 Phase 1: Taker locking BTC into HTLC...')

            // NOTE: secret is known to the maker — taker only knows the hash
            const secretHash = bitcoin.crypto.sha256(
                Buffer.from('c06c1486fc3ebbf5b4ce0b12a6ca10f38f7a738c3de082946112b1fb68d7fe96', 'hex')
            )

            const lockTime = 2640000 // Timeout block (taker can refund after this)

            const textBuffer = Buffer.from('hello world', 'utf8')

            const htlcScript = bitcoin.script.compile([
                textBuffer,
                bitcoin.opcodes.OP_DROP,

                bitcoin.opcodes.OP_IF,
                bitcoin.opcodes.OP_SHA256,
                secretHash,
                bitcoin.opcodes.OP_EQUALVERIFY,
                userPubKey, // 👤 Maker can claim with secret
                bitcoin.opcodes.OP_CHECKSIG,
                bitcoin.opcodes.OP_ELSE,
                bitcoin.script.number.encode(lockTime),
                bitcoin.opcodes.OP_CHECKLOCKTIMEVERIFY,
                bitcoin.opcodes.OP_DROP,
                resolverPubKey, // 👤 Taker can refund after timeout
                bitcoin.opcodes.OP_CHECKSIG,
                bitcoin.opcodes.OP_ENDIF
            ])

            const p2sh = bitcoin.payments.p2sh({
                redeem: {output: htlcScript, network},
                network
            })

            console.log('✅ HTLC P2SH Address:', p2sh.address)

            // === Taker (resolver) funds the HTLC ===
            const utxos = await getUtxos(resolverAddress!)
            if (!utxos.length) {
                console.error('❌ No UTXOs available to fund HTLC.')
                return
            }

            const amount = 1000000 // Match maker's amount or adjust as needed
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
                        script: bitcoin.payments.p2wpkh({pubkey: resolverPubKey, network}).output!,
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
                    address: resolverAddress!, // refund to self
                    value: change
                })
            }

            utxos.forEach((_, idx) => {
                psbt.signInput(idx, {
                    publicKey: resolverPubKey,
                    sign: (hash) => Buffer.from(resolverKeyPair.sign(hash))
                })
            })

            psbt.finalizeAllInputs()

            const txHex = psbt.extractTransaction().toHex()
            const txid = await broadcastTx(txHex)

            console.log('✅ Taker has funded HTLC:')
            console.log('🔗 TXID:', txid)

            await verifyHTLCScriptHashFromTx(txid, htlcScript)

            // ========================================
            // 2️⃣ PHASE 2: Maker claims BTC using secret
            // ========================================
            console.log('\n🔓 Phase 2: Maker (user) claims HTLC using secret...')

            const htlcUtxos = await getUtxos(p2sh.address!)
            if (!htlcUtxos.length) {
                console.error('❌ No UTXOs in HTLC address.')
                return
            }

            const htlcUtxo = htlcUtxos[0]
            const spendPsbt = new bitcoin.Psbt({network})

            const rawTxHex = (await axios.get(`${API_BASE}/tx/${htlcUtxo.txid}/hex`)).data

            spendPsbt.addInput({
                hash: htlcUtxo.txid,
                index: htlcUtxo.vout,
                nonWitnessUtxo: Buffer.from(rawTxHex, 'hex'),
                redeemScript: htlcScript
            })

            const redeemFee = 10000
            const redeemValue = htlcUtxo.value - redeemFee

            if (redeemValue <= 0) {
                console.error(`❌ Not enough value to redeem HTLC.`)
                return
            }

            spendPsbt.addOutput({
                address: userAddress!,
                value: redeemValue
            })

            const secret = Buffer.from('c06c1486fc3ebbf5b4ce0b12a6ca10f38f7a738c3de082946112b1fb68d7fe96', 'hex')

            spendPsbt.signInput(0, {
                publicKey: userPubKey,
                sign: (hash) => Buffer.from(userKeyPair.sign(hash))
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
        })
    })

    describe('btc -> evm', () => {
        it('should work', async () => {
            // ========================================
            // 1️⃣ PHASE 1: Maker creates HTLC and fully signs TX
            // ========================================
            console.log('🔐 Phase 1: Maker creating HTLC and signed funding TX...')

            const secret = crypto.randomBytes(32)
            const hash = bitcoin.crypto.sha256(secret)

            const lockTime = 2640000

            const htlcScript = bitcoin.script.compile([
                bitcoin.opcodes.OP_IF,
                bitcoin.opcodes.OP_SHA256,
                hash,
                bitcoin.opcodes.OP_EQUALVERIFY,
                resolverPubKey,
                bitcoin.opcodes.OP_CHECKSIG,
                bitcoin.opcodes.OP_ELSE,
                bitcoin.script.number.encode(lockTime),
                bitcoin.opcodes.OP_CHECKLOCKTIMEVERIFY,
                bitcoin.opcodes.OP_DROP,
                userPubKey,
                bitcoin.opcodes.OP_CHECKSIG,
                bitcoin.opcodes.OP_ENDIF
            ])

            const p2sh = bitcoin.payments.p2sh({
                redeem: {output: htlcScript, network},
                network
            })

            console.log('✅ HTLC P2SH Address:', p2sh.address)

            // 👤 Maker's P2WPKH funding
            const makerPayment = bitcoin.payments.p2wpkh({
                pubkey: userPubKey,
                network
            })

            const fromAddress = makerPayment.address!
            console.log('🔗 Maker Funding Address:', fromAddress)

            const utxos = await getUtxos(fromAddress)
            if (!utxos.length) {
                console.error("❌ No UTXOs found in maker's wallet.")
                return
            }

            const amount = 1000000
            const fee = 10000
            const totalInput = utxos.reduce((sum, utxo) => sum + utxo.value, 0)
            const change = totalInput - amount - fee

            if (change < 0) {
                console.error('❌ Not enough funds to lock 10 sats and cover the fee.')
                return
            }

            const psbt = new bitcoin.Psbt({network})

            if (change > 0) {
                psbt.addOutput({
                    address: fromAddress,
                    value: change
                })
            }

            for (const utxo of utxos) {
                psbt.addInput({
                    hash: utxo.txid,
                    index: utxo.vout,
                    witnessUtxo: {
                        script: makerPayment.output!,
                        value: utxo.value
                    }
                })
            }

            psbt.addOutput({
                script: p2sh.output!,
                value: amount
            })

            utxos.forEach((_, idx) => {
                psbt.signInput(idx, {
                    publicKey: userPubKey,
                    sign: (hash) => Buffer.from(userKeyPair.sign(hash))
                })
            })

            psbt.finalizeAllInputs()

            const txHex = psbt.extractTransaction().toHex()

            // 💾 Save fully signed TX and order details
            const order = {
                txHex,
                htlcScriptHex: htlcScript.toString('hex'),
                p2shAddress: p2sh.address!,
                valueSats: amount,
                lockTime,
                hash: hash.toString('hex'),
                createdAt: new Date().toISOString()
            }

            const orderJson = JSON.stringify(order, null, 2)
            console.log('📦 Maker created and signed order JSON:\n', orderJson)

            // ========================================
            // 2️⃣ PHASE 2: Taker receives order, broadcasts
            // ========================================
            console.log('\n📥 Phase 2: Resolver receives signed TX and broadcasts...')

            const loaded = JSON.parse(orderJson)

            console.log('HTLC address:', loaded.p2shAddress)
            const htlcUtxos2 = await getUtxos(loaded.p2shAddress)
            console.log('Found HTLC UTXOs:', htlcUtxos2)

            const txid = await broadcastTx(loaded.txHex)
            console.log('✅ HTLC Funding TX Broadcasted:', txid)

            await verifyHTLCScriptHashFromTx(txid, htlcScript)

            // ========================================
            // 3️⃣ PHASE 3: Resolver redeems HTLC using secret
            // ========================================
            console.log('\n🔓 Phase 3: Resolver redeems HTLC with secret...')

            const htlcUtxos = await getUtxos(loaded.p2shAddress)
            if (!htlcUtxos.length) {
                console.error('❌ No UTXOs found at HTLC address.')
                return
            }

            const htlcScriptBuffer = Buffer.from(loaded.htlcScriptHex, 'hex')
            const htlcUtxo = htlcUtxos[0]

            const rawTxHex = (await axios.get(`${API_BASE}/tx/${htlcUtxo.txid}/hex`)).data

            const spendPsbt = new bitcoin.Psbt({network})

            spendPsbt.addInput({
                hash: htlcUtxo.txid,
                index: htlcUtxo.vout,
                nonWitnessUtxo: Buffer.from(rawTxHex, 'hex'),
                redeemScript: htlcScriptBuffer
            })

            const redeemFee = 10000
            const redeemValue = htlcUtxo.value - redeemFee

            if (redeemValue <= 0) {
                console.error(`❌ Not enough value to redeem HTLC. UTXO value = ${htlcUtxo.value}, fee = ${redeemFee}`)
                return
            }

            spendPsbt.addOutput({
                address: resolverAddress!,
                value: redeemValue
            })

            // Sign the input. This generates the signature and stores it in the PSBT.
            spendPsbt.signInput(0, {
                publicKey: Buffer.from(resolverKeyPair.publicKey),
                sign: (hash) => Buffer.from(resolverKeyPair.sign(hash))
            })

            // This custom finalizer function assembles the correct scriptSig.
            const htlcRedeemFinalizer = (inputIndex: number, input: any) => {
                const signature = input.partialSig[0].signature

                // This is the "unlocking" script. It provides the data needed
                // to satisfy the OP_IF branch of your HTLC redeem script.
                // It must contain, in order: signature, secret, and OP_TRUE.
                const unlockingScript = bitcoin.script.compile([
                    signature,
                    secret, // The secret must be a Buffer
                    bitcoin.opcodes.OP_TRUE
                ])

                // Use the payments utility to create the final scriptSig, which correctly
                // combines the unlocking data with the redeem script itself.
                const payment = bitcoin.payments.p2sh({
                    redeem: {
                        input: unlockingScript,
                        output: input.redeemScript
                    }
                })

                return {
                    finalScriptSig: payment.input,
                    finalScriptWitness: undefined
                }
            }

            // Finalize the input using our custom logic.
            spendPsbt.finalizeInput(0, htlcRedeemFinalizer)

            // Extract and broadcast the final, valid transaction.
            const finalTxHex = spendPsbt.extractTransaction().toHex()
            const finalTxId = await broadcastTx(finalTxHex)

            console.log('🎉 Resolver has claimed the HTLC!')
            console.log('✅ Final Redeem TXID:', finalTxId)
        })
    })
})
