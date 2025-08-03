import { Hono } from "hono";
import { requestSignature } from "@neardefi/shade-agent-js";
import * as bitcoin from "bitcoinjs-lib";
import * as secp256k1 from "@bitcoinerlab/secp256k1";

import Sdk from "../../../chains/sdk/evm/cross-chain-sdk-shims";
import {
  nativeTokenAddress,
  nullAddress,
} from "../../../chains/sdk/evm/constants";
import {
  patchedDomain,
  getOrderHashWithPatch,
} from "../../../chains/sdk/evm/patch";
import { createSrcHtlcScript } from "../../../chains/sdk/btc";
import { UINT_40_MAX, UINT_256_MAX } from "@1inch/byte-utils";
import { config } from "../../../chains/sdk/config";
import { addressToEthAddressFormat } from "../../../chains/sdk/btc";
import IWETHContract from "../../../chains/sdk/evm/contracts/IWETH.json";

import { Btc } from "../utils/bitcoin";
import { Evm } from "../utils/ethereum";

import { utils } from "chainsig.js";
const { toRSV } = utils.cryptography;

const BTC_CHAIN_ID = 99999;
const BTC_RESOLVER_PUBKEY = process.env.NEXT_PUBLIC_BTC_RESOLVER_PUBLIC_KEY!;
const NETWORK = bitcoin.networks.testnet;

const app = new Hono();

app.post("/order", async (c) => {
  try {
    const {
      srcChainId,
      dstChainId,
      amount = 5000,
    }: {
      srcChainId: number;
      dstChainId: number;
      amount?: number;
    } = await c.req.json();

    const contractId = process.env.NEXT_PUBLIC_contractId;

    console.log("🟡 Starting order creation...");
    console.log("🔢 Source chain:", srcChainId);
    console.log("🔢 Destination chain:", dstChainId);
    console.log("💸 Amount:", amount);

    const isEvm = config[srcChainId]?.type === "evm";
    const isBtc = srcChainId === BTC_CHAIN_ID;

    // 1. Derive sender address
    let makerAddress: string;
    if (isEvm) {
      const { address } = await Evm.deriveAddressAndPublicKey(
        contractId,
        "ethereum-1"
      );
      makerAddress = address;
      console.log("🧾 EVM maker address:", makerAddress);
    } else if (isBtc) {
      const { address } = await Btc.deriveAddressAndPublicKey(
        contractId,
        "bitcoin-1"
      );
      makerAddress = address;
      console.log("🧾 BTC maker address:", makerAddress);
    } else {
      throw new Error("❌ Unsupported chain type");
    }

    const timestamp = BigInt(Math.floor(Date.now() / 1000));

    // 2. Overrides (following frontend pattern)
    console.log("⚙️ Applying overrides based on chain types...");

    let escrowFacotryAddress = new Sdk.Address(nullAddress);
    if (isEvm) {
      escrowFacotryAddress = new Sdk.Address(config[srcChainId].escrowFactory);
      console.log("🏗️ Escrow factory:", escrowFacotryAddress.value);
    }

    let makerAsset = new Sdk.Address(nullAddress);
    if (isEvm) {
      makerAsset = new Sdk.Address(config[srcChainId].wrappedNative!);
      console.log("🪙 Maker asset:", makerAsset.value);
    }

    let resolverAddress = new Sdk.Address(nativeTokenAddress);
    if (isEvm) {
      resolverAddress = new Sdk.Address(config[srcChainId].resolver!);
      console.log("🧩 Resolver:", resolverAddress.value);
    }

    let takerAsset = new Sdk.Address(nativeTokenAddress);
    if (config[dstChainId]?.type === "evm") {
      takerAsset = new Sdk.Address(config[dstChainId].wrappedNative!);
      console.log("🎯 Taker asset:", takerAsset.value);
    }

    let receiver = new Sdk.Address(makerAddress);
    if (config[dstChainId]?.type === "btc") {
      receiver = new Sdk.Address(addressToEthAddressFormat(makerAddress));
      console.log("📥 BTC receiver (ETH format):", receiver.value);
    }

    // 3. Deposit + approve logic for EVM
    if (isEvm) {
      console.log("🔧 Performing EVM deposit & approve...");

      const { transaction: depositTx, hashesToSign: depositHashes } =
        await Evm.buildDepositTx(
          config[srcChainId].wrappedNative!,
          IWETHContract.abi,
          "deposit",
          [],
          amount
        );

      const depositSig = await requestSignature({
        path: "ethereum-1",
        payload: depositHashes[0].toString("hex"),
      });

      const depositFinal = Evm.finalizeTransactionSigning({
        transaction: depositTx,
        rsvSignatures: [toRSV(depositSig)],
      });

      const depositHash = await Evm.broadcastTx(depositFinal);
      console.log("✅ Deposit broadcasted:", depositHash);

      const { transaction: approveTx, hashesToSign: approveHashes } =
        await Evm.buildApproveTx(
          config[srcChainId].wrappedNative!,
          IWETHContract.abi,
          "approve",
          [config[srcChainId].limitOrderProtocol, UINT_256_MAX]
        );

      const approveSig = await requestSignature({
        path: "ethereum-1",
        payload: approveHashes[0].toString("hex"),
      });

      const approveFinal = Evm.finalizeTransactionSigning({
        transaction: approveTx,
        rsvSignatures: [toRSV(approveSig)],
      });

      const approveHash = await Evm.broadcastTx(approveFinal);
      console.log("✅ Approve broadcasted:", approveHash);
    }

    // 4. Create Order
    console.log("📦 Constructing order...");
    const hashLock = {
      keccak256: "0x" + "00".repeat(32),
      sha256: Buffer.alloc(32),
    };

    const order = Sdk.CrossChainOrder.new(
      escrowFacotryAddress,
      {
        salt: Sdk.randBigInt(1000n),
        maker: new Sdk.Address(makerAddress),
        makingAmount: BigInt(amount),
        takingAmount: BigInt(amount),
        makerAsset,
        takerAsset,
        receiver,
      },
      {
        hashLock: hashLock.keccak256,
        timeLocks: Sdk.TimeLocks.new({
          srcWithdrawal: 1n,
          srcPublicWithdrawal: 1023n,
          srcCancellation: 1024n,
          srcPublicCancellation: 1225n,
          dstWithdrawal: 1n,
          dstPublicWithdrawal: 511n,
          dstCancellation: 512n,
        }),
        srcChainId,
        dstChainId,
        srcSafetyDeposit: 0n,
        dstSafetyDeposit: 0n,
      },
      {
        auction: new Sdk.AuctionDetails({
          initialRateBump: 0,
          points: [],
          duration: 120n,
          startTime: timestamp,
        }),
        whitelist: [
          {
            address: resolverAddress,
            allowFrom: 0n,
          },
        ],
        resolvingStartTime: 0n,
      },
      {
        nonce: Sdk.randBigInt(UINT_40_MAX),
        allowPartialFills: false,
        allowMultipleFills: false,
      }
    );

    order.inner.fusionExtension.srcChainId = srcChainId;
    order.inner.fusionExtension.dstChainId = dstChainId;

    if (isEvm) {
      order.inner.inner.takerAsset = new Sdk.Address(
        config[srcChainId].trueERC20!
      );
      console.log(
        "✅ Overrode takerAsset to trueERC20:",
        config[srcChainId].trueERC20
      );
    }

    const hash = getOrderHashWithPatch(srcChainId, order, {
      ...patchedDomain,
      verifyingContract: config[srcChainId].limitOrderProtocol!,
    });

    console.log("🔐 Order hash:", hash);

    // 5. Signature
    let signature: string;
    let btcMeta: any = null;

    if (isBtc) {
      console.log("✍️ Signing BTC order...");
      const btcSignRes = await requestSignature({
        path: "bitcoin-1",
        payload: hash.slice(2),
      });

      const rBuf = Buffer.from(btcSignRes.big_r.affine_point, "hex");
      const sBuf = Buffer.from(btcSignRes.s.scalar.padStart(64, "0"), "hex");
      const compactSig = Buffer.concat([rBuf.slice(1), sBuf]);

      const recoveryId = btcSignRes.recovery_id;
      const pubkey = secp256k1.recover(
        Buffer.from(hash.slice(2), "hex"),
        compactSig,
        recoveryId,
        true
      );
      if (!pubkey) throw new Error("BTC public key recovery failed");

      const btcPubKeyBuf = Buffer.from(pubkey);
      const timeLocks = order.inner.fusionExtension.timeLocks;

      const htlcScript = createSrcHtlcScript(
        hash,
        hashLock.sha256,
        timeLocks._srcWithdrawal,
        timeLocks._srcCancellation,
        btcPubKeyBuf,
        Buffer.from(BTC_RESOLVER_PUBKEY, "hex"),
        false
      );

      const p2sh = bitcoin.payments.p2sh({
        redeem: { output: htlcScript, network: NETWORK },
        network: NETWORK,
      });

      console.log("🔑 BTC P2SH:", p2sh.address);

      signature = JSON.stringify({
        txHex: "0x",
        htlcScriptHex: htlcScript.toString("hex"),
        p2shAddress: p2sh.address!,
      });

      btcMeta = {
        btcUserPublicKey: btcPubKeyBuf.toString("hex"),
        p2shAddress: p2sh.address!,
        htlcScript: htlcScript.toString("hex"),
      };
    } else {
      console.log("✍️ Signing EVM order...");
      const ethSignRes = await requestSignature({
        path: "ethereum-1",
        payload: hash.slice(2),
      });

      const r = ethSignRes.big_r.affine_point.slice(2);
      const s = ethSignRes.s.scalar.replace(/^0x/, "").padStart(64, "0");
      const v = ethSignRes.recovery_id + 27;

      signature = `0x${r}${s}${v.toString(16).padStart(2, "0")}`;
      console.log("🖋️ EVM signature:", signature);
    }

    console.log("✅ Order constructed and signed successfully.");
    return c.json({
      success: true,
      srcChainId,
      dstChainId,
      hash,
      hashLock: {
        sha256: hashLock.sha256.toString("hex"),
      },
      order: order.build(),
      extension: order.extension,
      signature,
      makerAddress,
      ...btcMeta,
    });
  } catch (err: any) {
    console.error("❌ Order creation failed:", err);
    return c.json({ success: false, message: err.message }, 500);
  }
});

export default app;
