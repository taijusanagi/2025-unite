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

// Use WIF from environment if provided, else generate new
const privKeyA =
  process.env.BTC_PRIVATE_KEY_1 || ECPair.makeRandom({ network }).toWIF();
const privKeyB =
  process.env.BTC_PRIVATE_KEY_2 || ECPair.makeRandom({ network }).toWIF();

const keyPairA: ECPairInterface = ECPair.fromWIF(privKeyA, network);
const keyPairB: ECPairInterface = ECPair.fromWIF(privKeyB, network);

const pubKeyA = Buffer.from(keyPairA.publicKey);
const pubKeyB = Buffer.from(keyPairB.publicKey);

const userLegacyAddress = bitcoin.payments.p2pkh({
  pubkey: pubKeyA,
  network,
}).address;
const userBech32Address = bitcoin.payments.p2wpkh({
  pubkey: pubKeyA,
  network,
}).address;
const resolverLegacyAddress = bitcoin.payments.p2pkh({
  pubkey: pubKeyB,
  network,
}).address;
const resolverBech32Address = bitcoin.payments.p2wpkh({
  pubkey: pubKeyB,
  network,
}).address;

console.log("User Address (P2PKH):", userLegacyAddress);
console.log("User Address (Bech32):", userBech32Address);
console.log("User Private Key (WIF):", privKeyA);
console.log("Resolver Address (P2PKH):", resolverLegacyAddress);
console.log("Resolver Address (Bech32):", resolverBech32Address);
console.log("Resolver Private Key (WIF):", privKeyB);

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
  return utxos.reduce((sum: number, utxo: UTXO) => sum + utxo.value, 0);
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

type AddressType = "p2pkh" | "p2wpkh";

async function sendBitcoin({
  fromWIF,
  toAddress,
  amountSats,
  fromType = "p2pkh",
}: {
  fromWIF: string;
  toAddress: string;
  amountSats: number;
  fromType?: AddressType;
}): Promise<void> {
  const keyPair = ECPair.fromWIF(fromWIF, network);
  const pubkey = Buffer.from(keyPair.publicKey);

  const payment =
    fromType === "p2wpkh"
      ? bitcoin.payments.p2wpkh({ pubkey, network })
      : bitcoin.payments.p2pkh({ pubkey, network });

  const fromAddress = payment.address!;
  const utxos: UTXO[] = await getUtxos(fromAddress);

  if (!utxos.length) {
    console.log("No UTXOs available for", fromAddress);
    return;
  }

  const fee = 1000;
  const totalInput = utxos.reduce((sum, utxo) => sum + utxo.value, 0);

  if (totalInput < amountSats + fee) {
    console.error("Insufficient balance.");
    return;
  }

  const psbt = new bitcoin.Psbt({ network });

  for (const utxo of utxos) {
    const rawTxHex = (
      await axios.get(
        `https://blockstream.info/testnet/api/tx/${utxo.txid}/hex`
      )
    ).data;

    if (fromType === "p2wpkh") {
      const scriptPubKey = bitcoin.payments.p2wpkh({ pubkey, network }).output!;
      psbt.addInput({
        hash: utxo.txid,
        index: utxo.vout,
        witnessUtxo: {
          script: scriptPubKey,
          value: utxo.value,
        },
      });
    } else {
      psbt.addInput({
        hash: utxo.txid,
        index: utxo.vout,
        nonWitnessUtxo: Buffer.from(rawTxHex, "hex"),
      });
    }
  }

  psbt.addOutput({
    address: toAddress,
    value: amountSats,
  });

  const change = totalInput - amountSats - fee;
  if (change > 0) {
    psbt.addOutput({
      address: fromAddress,
      value: change,
    });
  }

  utxos.forEach((_, idx) => {
    psbt.signInput(idx, {
      publicKey: pubkey,
      sign: (hash) => Buffer.from(keyPair.sign(hash)),
    });
  });

  psbt.finalizeAllInputs();
  const txHex = psbt.extractTransaction().toHex();
  const txid = await broadcastTx(txHex);
  console.log("Broadcasted TXID:", txid);
}

async function createMultisigToHTLCpsbt(): Promise<void> {
  const secret = Buffer.from(
    "c06c1486fc3ebbf5b4ce0b12a6ca10f38f7a738c3de082946112b1fb68d7fe96",
    "hex"
  );
  const hash = bitcoin.crypto.sha256(secret);
  const lockTime = 2640000;

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

  const p2sh = bitcoin.payments.p2sh({
    redeem: { output: htlcScript, network },
    network,
  });

  const pubkeys = [pubKeyA, pubKeyB].sort((a, b) => a.compare(b));
  const multisigPayment = bitcoin.payments.p2wsh({
    redeem: bitcoin.payments.p2ms({ m: 2, pubkeys, network }),
    network,
  });

  const fromAddress = multisigPayment.address!;
  const utxos = await getUtxos(fromAddress);
  if (!utxos.length) {
    console.error("No UTXOs in multisig wallet.");
    return;
  }

  const fee = 1000;
  const totalInput = utxos.reduce((sum, utxo) => sum + utxo.value, 0);
  const amountToSend = totalInput - fee;
  if (amountToSend <= 0) {
    console.error("Insufficient balance in multisig.");
    return;
  }

  const psbt = new bitcoin.Psbt({ network });

  for (const utxo of utxos) {
    const rawTxHex = (
      await axios.get(
        `https://blockstream.info/testnet/api/tx/${utxo.txid}/hex`
      )
    ).data;

    psbt.addInput({
      hash: utxo.txid,
      index: utxo.vout,
      witnessUtxo: {
        script: multisigPayment.output!,
        value: utxo.value,
      },
      redeemScript: multisigPayment.redeem!.output,
      witnessScript: multisigPayment.redeem!.output,
    });
  }

  psbt.addOutput({
    script: p2sh.output!,
    value: amountToSend,
  });

  utxos.forEach((_, idx) => {
    psbt.signInput(idx, {
      publicKey: pubKeyA,
      sign: (hash) => Buffer.from(keyPairA.sign(hash)),
    });
  });

  psbt.signInput(0, {
    publicKey: pubKeyB,
    sign: (hash) => Buffer.from(keyPairB.sign(hash)),
  });

  psbt.validateSignaturesOfInput(0, ecc.verify);
  psbt.finalizeAllInputs();

  const txHex = psbt.extractTransaction().toHex();
  const txid = await broadcastTx(txHex);
  console.log("✅ Funded HTLC TXID:", txid);

  // === Step 2: Spend HTLC using secret ===
  const htlcUtxos = await getUtxos(p2sh.address!);
  if (!htlcUtxos.length) {
    console.log("No UTXOs in HTLC.");
    return;
  }

  const htlcUtxo = htlcUtxos[0];
  const spendPsbt = new bitcoin.Psbt({ network });

  const rawTxHex = (
    await axios.get(
      `https://blockstream.info/testnet/api/tx/${htlcUtxo.txid}/hex`
    )
  ).data;

  spendPsbt.addInput({
    hash: htlcUtxo.txid,
    index: htlcUtxo.vout,
    nonWitnessUtxo: Buffer.from(rawTxHex, "hex"),
    redeemScript: htlcScript,
  });

  spendPsbt.addOutput({
    address: resolverBech32Address!,
    value: htlcUtxo.value - 1000,
  });

  spendPsbt.signInput(0, {
    publicKey: pubKeyB,
    sign: (hash) => Buffer.from(keyPairB.sign(hash)),
  });

  spendPsbt.validateSignaturesOfInput(0, ecc.verify);

  // Extract signature to manually construct scriptSig
  const sig = spendPsbt.data.inputs[0].partialSig![0].signature;

  const redeemInput = bitcoin.script.compile([
    sig,
    pubKeyB,
    secret,
    bitcoin.opcodes.OP_TRUE,
    htlcScript,
  ]);

  spendPsbt.finalizeInput(0, () => ({
    finalScriptSig: redeemInput,
    finalScriptWitness: undefined,
  }));

  const finalTxHex = spendPsbt.extractTransaction().toHex();
  const finalTxId = await broadcastTx(finalTxHex);
  console.log("✅ HTLC Redeemed TXID:", finalTxId);
}

// Example usage
async function main() {
  console.log(
    "After funding, fetch the UTXO and construct redeem/refund tx.\n"
  );

  const format = (sats: number) => (sats / 1e8).toFixed(8);

  const userP2PKHBalance = await getBalance(userLegacyAddress!);
  const userP2WPKHBalance = await getBalance(userBech32Address!);
  const resolverP2PKHBalance = await getBalance(resolverLegacyAddress!);
  const resolverP2WPKHBalance = await getBalance(resolverBech32Address!);

  console.log(`Balance (User P2PKH): ${format(userP2PKHBalance)} tBTC`);
  console.log(`Balance (User P2WPKH): ${format(userP2WPKHBalance)} tBTC`);
  console.log(`Balance (Resolver P2PKH): ${format(resolverP2PKHBalance)} tBTC`);
  console.log(
    `Balance (Resolver P2WPKH): ${format(resolverP2WPKHBalance)} tBTC`
  );

  const fee = 100;
  const amountToSend = resolverP2WPKHBalance - fee;

  if (amountToSend <= 0) {
    console.error("Resolver P2WPKH has insufficient balance to cover fee.");
    return;
  }

  //   await sendBitcoin({
  //     fromWIF: privKeyB,
  //     toAddress: userLegacyAddress!,
  //     amountSats: amountToSend,
  //     fromType: "p2wpkh",
  //   });

  //   await sendBtcFromP2PKHtoBech32();
}

main().catch(console.error);
