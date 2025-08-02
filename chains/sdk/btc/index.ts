import * as bitcoin from 'bitcoinjs-lib'
import * as ecc from 'tiny-secp256k1'
import {ECPairFactory, ECPairInterface} from 'ecpair'
import axios, {AxiosInstance} from 'axios'
import {hexToUint8Array} from '@1inch/byte-utils'
const ECPair = ECPairFactory(ecc)

export type BtcWallet = {
    keyPair: ECPairInterface
    publicKey: Buffer
    address: string
}

export function addressToEthAddressFormat(btcAddress: string): string {
    const {data} = bitcoin.address.fromBech32(btcAddress)
    return `0x${data.toString('hex')}`
}

export function publicKeyToAddress(publicKey: Buffer | string, network: bitcoin.Network): string {
    const pubkeyBuffer = typeof publicKey === 'string' ? Buffer.from(publicKey, 'hex') : publicKey

    return bitcoin.payments.p2wpkh({pubkey: pubkeyBuffer, network}).address!
}

export function walletFromWIF(
    wif: string,
    network: bitcoin.Network
): {
    keyPair: ECPairInterface
    publicKey: Buffer
    address: string
} {
    const keyPair = ECPair.fromWIF(wif, network)
    const publicKey = Buffer.from(keyPair.publicKey)
    const address = publicKeyToAddress(publicKey, network)
    return {
        keyPair,
        publicKey,
        address
    }
}

interface UTXO {
    txid: string
    vout: number
    value: number
}

export class BtcProvider {
    private api: AxiosInstance
    private network: string

    constructor(apiBase: string, network: string = 'mainnet') {
        this.network = network
        this.api = axios.create({
            baseURL: apiBase,
            timeout: 10000
        })
    }

    private delay(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms))
    }

    async getUtxos(address: string): Promise<UTXO[]> {
        const res = await this.api.get(`/address/${address}/utxo`)
        return res.data.map((o: any) => ({
            txid: o.txid,
            vout: o.vout,
            value: o.value
        }))
    }

    async getBalance(address: string): Promise<number> {
        const utxos = await this.getUtxos(address)
        return utxos.reduce((sum, utxo) => sum + utxo.value, 0)
    }

    async broadcastTx(txHex: string): Promise<string> {
        const res = await this.api.post('/tx', txHex, {
            headers: {'Content-Type': 'text/plain'}
        })
        return res.data
    }

    async waitForTxConfirmation(
        txid: string,
        timeoutMs = 300_000
    ): Promise<{confirmedAt: string; blockHeight: number}> {
        const start = Date.now()

        while (Date.now() - start < timeoutMs) {
            try {
                const txData = await this.api.get(`/tx/${txid}`).then((res) => res.data)
                const status = txData.status

                if (status && status.confirmed) {
                    const confirmedAt = status.block_time
                    const blockHeight = status.block_height

                    console.log(`✅ TX ${txid} confirmed in block ${blockHeight} at ${confirmedAt}`)
                    return {confirmedAt, blockHeight}
                }

                console.log(`⏳ Waiting for TX ${txid} confirmation...`)
            } catch (err: any) {
                console.warn(`⚠️ Error fetching TX ${txid}:`, err.message)
            }

            await this.delay(5000)
        }

        throw new Error(`❌ Transaction ${txid} not confirmed within ${timeoutMs / 1000} seconds.`)
    }

    async waitForUtxo(address: string, timeoutMs = 10000): Promise<UTXO[]> {
        const start = Date.now()
        while (Date.now() - start < timeoutMs) {
            const utxos = await this.getUtxos(address)
            if (utxos.length > 0) return utxos
            await this.delay(1000)
        }
        throw new Error(`UTXOs not found for ${address} after ${timeoutMs}ms`)
    }

    async getUtxosFromTxid(txid: string): Promise<UTXO[]> {
        const tx = await this.api.get(`/tx/${txid}`).then((res) => res.data)

        const utxos: UTXO[] = []

        for (let i = 0; i < tx.vout.length; i++) {
            const outspend = await this.api.get(`/tx/${txid}/outspend/${i}`).then((res) => res.data)

            if (!outspend.spent) {
                utxos.push({
                    txid,
                    vout: i,
                    value: tx.vout[i].value
                })
            }
        }

        return utxos
    }

    async getRawTransactionHex(txid: string): Promise<string> {
        const res = await this.api.get(`/tx/${txid}/hex`)
        return res.data
    }

    async verifyHTLCScriptHashFromTx(txid: string, htlcScript: Buffer): Promise<void> {
        const scriptHash = bitcoin.crypto.hash160(htlcScript)

        const txHex = await this.api.get(`/tx/${txid}/hex`).then((res) => res.data)
        const tx = bitcoin.Transaction.fromHex(txHex)

        const expectedOutputScript = bitcoin.script.compile([
            bitcoin.opcodes.OP_HASH160,
            scriptHash,
            bitcoin.opcodes.OP_EQUAL
        ])

        const match = tx.outs.find((out) => out.script.equals(expectedOutputScript))

        if (match) {
            console.log('✅ HTLC script hash verified on-chain!')
        } else {
            console.error('❌ HTLC script hash mismatch. Script may not be correct.')
        }
    }
}
export function createDstHtlcScript(
    orderHashHex: string,
    hashLockSha256: Buffer,
    privateWithdrawal: number | bigint,
    privateCancellation: number | bigint,
    btcUserPublicKey: Buffer,
    btcResolverPublicKey: Buffer
): Buffer {
    return bitcoin.script.compile([
        Buffer.from(hexToUint8Array(orderHashHex)),
        bitcoin.opcodes.OP_DROP,
        bitcoin.script.number.encode(Number(privateWithdrawal)),
        bitcoin.opcodes.OP_CHECKLOCKTIMEVERIFY,
        bitcoin.opcodes.OP_DROP,
        bitcoin.opcodes.OP_IF,
        bitcoin.opcodes.OP_SHA256,
        hashLockSha256,
        bitcoin.opcodes.OP_EQUALVERIFY,
        btcUserPublicKey,
        bitcoin.opcodes.OP_CHECKSIG,
        bitcoin.opcodes.OP_ELSE,
        bitcoin.script.number.encode(Number(privateCancellation)),
        bitcoin.opcodes.OP_CHECKLOCKTIMEVERIFY,
        bitcoin.opcodes.OP_DROP,
        btcResolverPublicKey,
        bitcoin.opcodes.OP_CHECKSIG,
        bitcoin.opcodes.OP_ENDIF
    ])
}

const dstHtlcRedeemFinalizer = (inputIndex: number, input: any) => {
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
