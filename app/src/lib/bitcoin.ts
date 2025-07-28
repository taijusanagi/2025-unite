import * as bitcoin from "bitcoinjs-lib";
import axios from "axios";
import * as ecc from "tiny-secp256k1";
import { ECPairFactory, ECPairInterface } from "ecpair";

type AddressType = "p2pkh" | "p2wpkh";

const ECPair = ECPairFactory(ecc);

const network = bitcoin.networks.testnet;

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

async function waitForConfirmation(
  txid: string,
  maxTries = 30,
  intervalMs = 10000
): Promise<void> {
  console.log(`⏳ Waiting for confirmation of TX: ${txid}...`);
  let tries = 0;

  while (tries < maxTries) {
    try {
      const res = await axios.get(
        `https://blockstream.info/testnet/api/tx/${txid}/status`
      );
      const status = res.data;

      if (status.confirmed) {
        console.log(
          `✅ Transaction ${txid} confirmed in block ${status.block_height}`
        );
        return;
      } else {
        console.log(`🔄 Not confirmed yet (try ${tries + 1}/${maxTries})`);
      }
    } catch (e) {
      const err = e as Error;
      console.error("Error checking tx status:", err.message);
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    tries++;
  }

  throw new Error(
    `❌ Transaction ${txid} not confirmed after ${maxTries} attempts.`
  );
}

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

async function processWhenTakerAssetIsBTC(): Promise<void> {
  // ========================================
  // 1️⃣ PHASE 1: Taker (resolver) creates HTLC and deposits BTC
  // ========================================
  console.log("🔐 Phase 1: Taker locking BTC into HTLC...");

  // NOTE: secret is known to the maker — taker only knows the hash
  const secretHash = bitcoin.crypto.sha256(
    Buffer.from(
      "c06c1486fc3ebbf5b4ce0b12a6ca10f38f7a738c3de082946112b1fb68d7fe96",
      "hex"
    )
  );

  const lockTime = 2640000; // Timeout block (taker can refund after this)

  const htlcScript = bitcoin.script.compile([
    bitcoin.opcodes.OP_IF,
    bitcoin.opcodes.OP_SHA256,
    secretHash,
    bitcoin.opcodes.OP_EQUALVERIFY,
    pubKeyA, // 👤 Maker can claim with secret
    bitcoin.opcodes.OP_CHECKSIG,
    bitcoin.opcodes.OP_ELSE,
    bitcoin.script.number.encode(lockTime),
    bitcoin.opcodes.OP_CHECKLOCKTIMEVERIFY,
    bitcoin.opcodes.OP_DROP,
    pubKeyB, // 👤 Taker can refund after timeout
    bitcoin.opcodes.OP_CHECKSIG,
    bitcoin.opcodes.OP_ENDIF,
  ]);

  const p2sh = bitcoin.payments.p2sh({
    redeem: { output: htlcScript, network },
    network,
  });

  console.log("✅ HTLC P2SH Address:", p2sh.address);

  // === Taker (resolver) funds the HTLC ===
  const utxos = await getUtxos(resolverLegacyAddress!);
  if (!utxos.length) {
    console.error("❌ No UTXOs available to fund HTLC.");
    return;
  }

  const fee = 1000;
  const totalInput = utxos.reduce((sum, u) => sum + u.value, 0);
  const amountToSend = totalInput - fee;

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
      nonWitnessUtxo: Buffer.from(rawTxHex, "hex"),
    });
  }

  psbt.addOutput({
    script: p2sh.output!,
    value: amountToSend,
  });

  utxos.forEach((_, idx) => {
    psbt.signInput(idx, {
      publicKey: pubKeyB,
      sign: (hash) => Buffer.from(keyPairB.sign(hash)),
    });
  });

  psbt.validateSignaturesOfAllInputs(ecc.verify);
  psbt.finalizeAllInputs();

  const txHex = psbt.extractTransaction().toHex();
  const txid = await broadcastTx(txHex);

  console.log("✅ Taker has funded HTLC:");
  console.log("🔗 TXID:", txid);

  // ========================================
  // 2️⃣ PHASE 2: Maker claims BTC using secret
  // ========================================
  console.log("\n🔓 Phase 2: Maker (user) claims HTLC using secret...");

  const htlcUtxos = await getUtxos(p2sh.address!);
  if (!htlcUtxos.length) {
    console.error("❌ No UTXOs in HTLC address.");
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
    address: userBech32Address!,
    value: htlcUtxo.value - 1000,
  });

  const secret = Buffer.from(
    "c06c1486fc3ebbf5b4ce0b12a6ca10f38f7a738c3de082946112b1fb68d7fe96",
    "hex"
  );

  spendPsbt.signInput(0, {
    publicKey: pubKeyA,
    sign: (hash) => Buffer.from(keyPairA.sign(hash)),
  });

  spendPsbt.validateSignaturesOfInput(0, ecc.verify);

  const sig = spendPsbt.data.inputs[0].partialSig![0].signature;

  const redeemInput = bitcoin.script.compile([
    sig,
    pubKeyA,
    secret,
    bitcoin.opcodes.OP_TRUE, // chooses IF branch (hash + pubKeyA)
    htlcScript,
  ]);

  spendPsbt.finalizeInput(0, () => ({
    finalScriptSig: redeemInput,
    finalScriptWitness: undefined,
  }));

  const finalTxHex = spendPsbt.extractTransaction().toHex();
  const finalTxId = await broadcastTx(finalTxHex);

  console.log("🎉 Maker successfully claimed BTC from HTLC!");
  console.log("✅ Redemption TXID:", finalTxId);
}

async function processWhenMakerAssetIsBTC(): Promise<void> {
  // ========================================
  // 1️⃣ PHASE 1: Maker creates HTLC order (with partial PSBT)
  // ========================================
  console.log("🔐 Phase 1: Maker creating HTLC script and order...");

  // Secret and hash (maker holds the secret, resolver will learn it later)
  const secret = Buffer.from(
    "c06c1486fc3ebbf5b4ce0b12a6ca10f38f7a738c3de082946112b1fb68d7fe96",
    "hex"
  );
  const hash = bitcoin.crypto.sha256(secret);

  const lockTime = 2640000; // Timeout block height

  const htlcScript = bitcoin.script.compile([
    bitcoin.opcodes.OP_IF,
    bitcoin.opcodes.OP_SHA256,
    hash,
    bitcoin.opcodes.OP_EQUALVERIFY,
    pubKeyB, // Resolver can redeem with secret
    bitcoin.opcodes.OP_CHECKSIG,
    bitcoin.opcodes.OP_ELSE,
    bitcoin.script.number.encode(lockTime),
    bitcoin.opcodes.OP_CHECKLOCKTIMEVERIFY,
    bitcoin.opcodes.OP_DROP,
    pubKeyA, // Maker can refund after timeout
    bitcoin.opcodes.OP_CHECKSIG,
    bitcoin.opcodes.OP_ENDIF,
  ]);

  const p2sh = bitcoin.payments.p2sh({
    redeem: { output: htlcScript, network },
    network,
  });

  console.log("✅ HTLC P2SH Address:", p2sh.address);

  // ========================================
  // 🧩 Multisig funding setup (maker + resolver must co-sign)
  // ========================================
  const pubkeys = [pubKeyA, pubKeyB].sort((a, b) => a.compare(b));
  const multisigPayment = bitcoin.payments.p2wsh({
    redeem: bitcoin.payments.p2ms({ m: 2, pubkeys, network }),
    network,
  });

  const fromAddress = multisigPayment.address!;
  console.log("🔗 Multisig Funding Address:", fromAddress);

  const utxos = await getUtxos(fromAddress);
  if (!utxos.length) {
    console.error("❌ No UTXOs found in multisig wallet.");
    return;
  }

  const fee = 1000;
  const totalInput = utxos.reduce((sum, utxo) => sum + utxo.value, 0);
  const amountToSend = totalInput - fee;

  if (amountToSend <= 0) {
    console.error("❌ Not enough funds in multisig wallet.");
    return;
  }

  const psbt = new bitcoin.Psbt({ network });

  for (const utxo of utxos) {
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

  // Maker signs PSBT (partial)
  utxos.forEach((_, idx) => {
    psbt.signInput(idx, {
      publicKey: pubKeyA,
      sign: (hash) => Buffer.from(keyPairA.sign(hash)),
    });
  });

  // ========================================
  // 💾 Save order (PSBT) as JSON to simulate order submission
  // ========================================
  console.log("\n📦 Maker saving unsigned order as JSON...");

  const order = {
    psbtBase64: psbt.toBase64(),
    htlcScriptHex: htlcScript.toString("hex"),
    p2shAddress: p2sh.address!,
    valueSats: amountToSend,
    lockTime,
    hash: hash.toString("hex"),
    createdAt: new Date().toISOString(),
  };

  const orderJson = JSON.stringify(order, null, 2);
  console.log("📝 Saved Order JSON:\n", orderJson);

  // ========================================
  // 2️⃣ PHASE 2: Taker receives order, signs and broadcasts
  // ========================================
  console.log("\n📥 Phase 2: Resolver loads order, signs and broadcasts...");

  const loaded = JSON.parse(orderJson);
  const loadedPsbt = bitcoin.Psbt.fromBase64(loaded.psbtBase64, { network });

  loadedPsbt.signInput(0, {
    publicKey: pubKeyB,
    sign: (hash) => Buffer.from(keyPairB.sign(hash)),
  });

  loadedPsbt.validateSignaturesOfInput(0, ecc.verify);
  loadedPsbt.finalizeAllInputs();

  const txHex = loadedPsbt.extractTransaction().toHex();
  const txid = await broadcastTx(txHex);
  console.log("✅ HTLC Funding TX Broadcasted:", txid);

  // ========================================
  // 3️⃣ PHASE 3: Taker redeems HTLC with secret
  // ========================================
  console.log("\n🔓 Phase 3: Resolver redeems HTLC using secret...");

  const htlcUtxos = await getUtxos(p2sh.address!);
  if (!htlcUtxos.length) {
    console.error("❌ No HTLC UTXOs available.");
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

  console.log("🎉 Resolver has claimed HTLC using secret!");
  console.log("✅ Final Redeem TXID:", finalTxId);
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
