import * as bitcoin from "bitcoinjs-lib";
import axios from "axios";
import * as ecc from "tiny-secp256k1";
import { ECPairFactory } from "ecpair";

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

const keyPairA = ECPair.fromWIF(privKeyA, network);
const keyPairB = ECPair.fromWIF(privKeyB, network);

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

console.log(
  "Sender Address:",
  bitcoin.payments.p2pkh({ pubkey: pubKeyA, network }).address
);
console.log("Sender Private Key (WIF):", privKeyA);
console.log(
  "Receiver Address:",
  bitcoin.payments.p2pkh({ pubkey: pubKeyB, network }).address
);
console.log("Receiver Private Key (WIF):", privKeyB);
console.log("HTLC P2SH Address:", p2shAddress);

// Sample functions to get UTXOs and broadcast transactions
async function getUtxos(address: string) {
  const res = await axios.get(
    `https://mempool.space/testnet/api/address/${address}/utxo`
  );
  return res.data;
}

async function broadcastTx(txHex: string) {
  const res = await axios.post("https://mempool.space/testnet/api/tx", txHex, {
    headers: { "Content-Type": "text/plain" },
  });
  return res.data;
}

// Example usage
async function main() {
  console.log("\nTo fund the HTLC, send tBTC to:", p2shAddress);
  console.log("After funding, fetch the UTXO and construct redeem/refund tx.");

  // To continue: implement UTXO fetching and redeem/refund transactions
  // const utxos = await getUtxos(p2shAddress);
  // build & sign transaction using bitcoinjs-lib
}

main().catch(console.error);
