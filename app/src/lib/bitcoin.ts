import * as bitcoin from "bitcoinjs-lib";
import axios from "axios";
import * as ecc from "tiny-secp256k1";
import { ECPairFactory, ECPairInterface } from "ecpair";

const ECPair = ECPairFactory(ecc);

const network = bitcoin.networks.testnet;

const secret = Buffer.from(
  "c06c1486fc3ebbf5b4ce0b12a6ca10f38f7a738c3de082946112b1fb68d7fe96",
  "hex"
);
const hash = Buffer.from(bitcoin.crypto.sha256(secret));

// Use WIF from environment if provided, else generate new
const privKeyA =
  process.env.BTC_PRIVATE_KEY_1 || ECPair.makeRandom({ network }).toWIF();
const privKeyB =
  process.env.BTC_PRIVATE_KEY_2 || ECPair.makeRandom({ network }).toWIF();

const keyPairA: ECPairInterface = ECPair.fromWIF(privKeyA, network);
const keyPairB: ECPairInterface = ECPair.fromWIF(privKeyB, network);

const pubKeyA = Buffer.from(keyPairA.publicKey);
const pubKeyB = Buffer.from(keyPairB.publicKey);

const lockTime = 2640000; // A block height in the future

const htlcScript = bitcoin.script.compile([
  bitcoin.opcodes.OP_IF,
  bitcoin.opcodes.OP_SHA256,
  hash,
  bitcoin.opcodes.OP_EQUALVERIFY,
  pubKeyB,
  bitcoin.opcodes.OP_CHECKSIG,
  bitcoin.opcodes.OP_ELSE,
  bitcoin.script.number.encode(lockTime),
  bitcoin.opcodes.OP_CHECKLOCKTIMEVERIFY,
  bitcoin.opcodes.OP_DROP,
  pubKeyA,
  bitcoin.opcodes.OP_CHECKSIG,
  bitcoin.opcodes.OP_ENDIF,
]);

const { address: p2shAddress } = bitcoin.payments.p2sh({
  redeem: { output: htlcScript, network },
  network,
});
const senderLegacyAddress = bitcoin.payments.p2pkh({
  pubkey: pubKeyA,
  network,
}).address;
const senderBech32Address = bitcoin.payments.p2wpkh({
  pubkey: pubKeyA,
  network,
}).address;
const receiverLegacyAddress = bitcoin.payments.p2pkh({
  pubkey: pubKeyB,
  network,
}).address;
const receiverBech32Address = bitcoin.payments.p2wpkh({
  pubkey: pubKeyB,
  network,
}).address;

console.log("Sender Address (P2PKH):", senderLegacyAddress);
console.log("Sender Address (Bech32):", senderBech32Address);
console.log("Sender Private Key (WIF):", privKeyA);
console.log("Receiver Address (P2PKH):", receiverLegacyAddress);
console.log("Receiver Address (Bech32):", receiverBech32Address);
console.log("Receiver Private Key (WIF):", privKeyB);
console.log("HTLC P2SH Address:", p2shAddress);

interface UTXO {
  txid: string;
  vout: number;
  value: number;
}

async function getUtxos(address: string): Promise<UTXO[]> {
  const res = await axios.get(
    `https://blockstream.info/testnet/api/address/${address}/utxo`
  );
  return res.data.map((o: any) => ({
    txid: o.txid,
    vout: o.vout,
    value: o.value,
  }));
}

async function getBalance(address: string): Promise<number> {
  const utxos = await getUtxos(address);
  return utxos.reduce((sum: number, utxo: UTXO) => sum + utxo.value, 0) / 1e8;
}

async function broadcastTx(txHex: string): Promise<string> {
  const res = await axios.post(
    "https://blockstream.info/testnet/api/tx",
    txHex,
    {
      headers: { "Content-Type": "text/plain" },
    }
  );
  return res.data;
}

async function sendBtcFromP2PKHtoBech32(): Promise<void> {
  const utxos: UTXO[] = await getUtxos(senderLegacyAddress!);
  if (!utxos.length) {
    console.log("No UTXOs available to send from P2PKH address.");
    return;
  }

  const psbt = new bitcoin.Psbt({ network });
  const totalInput = utxos.reduce((sum, utxo) => sum + utxo.value, 0);
  const fee = 1000; // fixed fee for simplicity
  const amountToSend = totalInput - fee;

  for (const utxo of utxos) {
    const rawTxRes = await axios.get(
      `https://blockstream.info/testnet/api/tx/${utxo.txid}/hex`
    );
    const rawTxHex = rawTxRes.data;
    psbt.addInput({
      hash: utxo.txid,
      index: utxo.vout,
      nonWitnessUtxo: Buffer.from(rawTxHex, "hex"),
    });
  }

  psbt.addOutput({
    address: receiverBech32Address!,
    value: amountToSend,
  });

  utxos.forEach((_, idx) => {
    psbt.signInput(idx, {
      publicKey: Buffer.from(keyPairA.publicKey),
      sign: (hash) => Buffer.from(keyPairA.sign(hash)),
    });
  });

  psbt.finalizeAllInputs();
  const txHex = psbt.extractTransaction().toHex();
  const txid = await broadcastTx(txHex);
  console.log("Broadcasted P2PKH to Bech32 TXID:", txid);
}

// Example usage
async function main() {
  console.log("\nTo fund the HTLC, send tBTC to:", p2shAddress);
  console.log(
    "After funding, fetch the UTXO and construct redeem/refund tx.\n"
  );

  const senderBalance = await getBalance(senderLegacyAddress!);
  const receiverBalance = await getBalance(receiverLegacyAddress!);
  const htlcBalance = await getBalance(p2shAddress!);

  console.log(`Balance (Sender): ${senderBalance} tBTC`);
  console.log(`Balance (Receiver): ${receiverBalance} tBTC`);
  console.log(`Balance (HTLC P2SH): ${htlcBalance} tBTC`);

  await sendBtcFromP2PKHtoBech32();
}

main().catch(console.error);
