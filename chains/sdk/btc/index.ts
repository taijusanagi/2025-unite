import * as bitcoin from 'bitcoinjs-lib'
import * as ecc from 'tiny-secp256k1'
import {ECPairFactory, ECPairInterface} from 'ecpair'

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
