import axios from 'axios'
import * as bitcoin from 'bitcoinjs-lib'

export const BITCOIN_CLI =
    'docker exec esplora /srv/explorer/bitcoin/bin/bitcoin-cli -regtest -rpccookiefile=/data/bitcoin/regtest/.cookie'

export const API_BASE = 'http://localhost:8094/regtest/api'

interface UTXO {
    txid: string
    vout: number
    value: number
}

export async function getUtxos(address: string): Promise<UTXO[]> {
    const res = await axios.get(`${API_BASE}/address/${address}/utxo`)
    return res.data.map((o: any) => ({
        txid: o.txid,
        vout: o.vout,
        value: o.value
    }))
}

export async function getUtxosFromTxid(txid: string) {
    const tx = await axios.get(`${API_BASE}/tx/${txid}`).then((res) => res.data)

    const utxos: {txid: string; vout: number; value: number; scriptpubkey: string}[] = []

    for (let i = 0; i < tx.vout.length; i++) {
        const outspend = await axios.get(`${API_BASE}/tx/${txid}/outspend/${i}`).then((res) => res.data)

        if (!outspend.spent) {
            utxos.push({
                txid,
                vout: i,
                value: tx.vout[i].value,
                scriptpubkey: tx.vout[i].scriptpubkey
            })
        }
    }

    return utxos
}

export async function getBalance(address: string): Promise<number> {
    const utxos = await getUtxos(address)
    return utxos.reduce((sum: number, utxo: UTXO) => sum + utxo.value, 0)
}

export async function broadcastTx(txHex: string): Promise<string> {
    const res = await axios.post(`${API_BASE}/tx`, txHex, {
        headers: {'Content-Type': 'text/plain'}
    })
    return res.data
}

export async function verifyHTLCScriptHashFromTx(txid: string, htlcScript: Buffer): Promise<void> {
    const scriptHash = bitcoin.crypto.hash160(htlcScript) // HASH160(redeemScript)

    // Fetch raw tx and decode
    const txHex = await axios.get(`${API_BASE}/tx/${txid}/hex`).then((res) => res.data)
    const tx = bitcoin.Transaction.fromHex(txHex)

    // Get expected scriptPubKey from known redeem script
    const expectedOutputScript = bitcoin.script.compile([
        bitcoin.opcodes.OP_HASH160,
        scriptHash,
        bitcoin.opcodes.OP_EQUAL
    ])

    // Check if any output matches
    const match = tx.outs.find((out) => {
        return out.script.equals(expectedOutputScript)
    })

    if (match) {
        console.log('✅ HTLC script hash verified on-chain!')
    } else {
        console.error('❌ HTLC script hash mismatch. Script may not be correct.')
    }
}
