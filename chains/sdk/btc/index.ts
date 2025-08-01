import * as bitcoin from 'bitcoinjs-lib'
import * as ecc from 'tiny-secp256k1'
import {ECPairFactory, ECPairInterface} from 'ecpair'

const ECPair = ECPairFactory(ecc)

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

    const address = bitcoin.payments.p2wpkh({
        pubkey: publicKey,
        network
    }).address!

    return {
        keyPair,
        publicKey,
        address
    }
}
