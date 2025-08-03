import { Hono } from "hono";
import { requestSignature } from "@neardefi/shade-agent-js";
import * as bitcoin from "bitcoinjs-lib";
import * as secp256k1 from "@bitcoinerlab/secp256k1";
import { randomBytes } from "crypto";

import Sdk from "../../../chains/sdk/evm/cross-chain-sdk-shims";
import {
  dummySrcChainId,
  dummyDstChainId,
  nullAddress,
} from "../../../chains/sdk/evm/constants";
import {
  patchedDomain,
  getOrderHashWithPatch,
} from "../../../chains/sdk/evm/patch";
import { createSrcHtlcScript } from "../../../chains/sdk/btc";
import {
  UINT_40_MAX,
  UINT_256_MAX,
  uint8ArrayToHex as uint8ArrayToHexForSecret,
} from "@1inch/byte-utils";
import { config } from "../../../chains/sdk/config";
import { addressToEthAddressFormat } from "../../../chains/sdk/btc";
import { Contract, Interface, JsonRpcProvider, getAddress } from "ethers";
import IWETHContract from "../../../chains/sdk/evm/contracts/IWETH.json";

import { Btc } from "../utils/bitcoin";
import { createEvmInstance } from "../utils/ethereum";

import { utils } from "chainsig.js";
const { toRSV, uint8ArrayToHex } = utils.cryptography;

const BTC_RESOLVER_PUBKEY = process.env.NEXT_PUBLIC_BTC_RESOLVER_PUBLIC_KEY!;
const NETWORK = bitcoin.networks.testnet;

const app = new Hono();

app.post("/", async (c) => {
  try {
    const {
      srcChainId,
      dstChainId,
      makerAsset,
      takerAsset,
      amount = 5000,
    }: {
      srcChainId: number;
      dstChainId: number;
      makerAsset: string;
      takerAsset: string;
      amount: number;
    } = await c.req.json();

    const contractId = process.env.NEXT_PUBLIC_contractId;

    console.log("🟡 Starting order creation...");
    console.log("🔢 Source chain:", srcChainId);
    console.log("🔢 Destination chain:", dstChainId);
    console.log("🔢 Maker asset:", makerAsset);
    console.log("🔢 Taker asset:", takerAsset);
    console.log("💸 Amount:", amount);

    const srcEvm = createEvmInstance(srcChainId);

    const { address: evmRawAddress } = await srcEvm.deriveAddressAndPublicKey(
      contractId,
      "ethereum-1"
    );
    const evmAddress = getAddress(evmRawAddress); // checksummed

    const { address: btcAddress, publicKey: btcPubKeyBuf } =
      await Btc.deriveAddressAndPublicKey(contractId, "bitcoin-1");

    const btcAddressInEthFormat = addressToEthAddressFormat(btcAddress);
    const btcUserPublicKey = btcPubKeyBuf.toString("hex");

    // 🧾 Logs
    console.log("🧾 EVM address:", evmAddress);
    console.log("🧾 BTC address:", btcAddress);
    console.log("🧾 BTC as EVM address:", btcAddressInEthFormat);

    // dummy for now
    const takingAmount = amount;

    // 1. Derive sender address
    let makerAddress: string;

    if (config[srcChainId]?.type === "evm") {
      makerAddress = evmAddress;
    } else if (config[srcChainId]?.type === "btc") {
      makerAddress = btcAddressInEthFormat;
    } else {
      throw new Error("❌ Unsupported chain type");
    }

    const timestamp = BigInt(Math.floor(Date.now() / 1000));

    // 2. Overrides (following frontend pattern)
    console.log("⚙️ Applying overrides based on chain types...");

    console.log("config[srcChainId]", config[srcChainId]);
    console.log("config[dstChainId]", config[dstChainId]);

    let escrowFacotryAddress = new Sdk.Address(nullAddress);
    if (config[dstChainId]?.type === "evm") {
      escrowFacotryAddress = new Sdk.Address(config[srcChainId].escrowFactory);
      console.log("🏗️ Escrow factory:", escrowFacotryAddress.val);
    }

    let resolverAddress = new Sdk.Address(nullAddress);
    if (config[dstChainId]?.type === "evm") {
      resolverAddress = new Sdk.Address(config[srcChainId].resolver!);
      console.log("🧩 Resolver:", resolverAddress.val);
    }

    let receiver;
    if (config[dstChainId]?.type === "btc") {
      receiver = new Sdk.Address(btcAddressInEthFormat);
      console.log("📥 BTC receiver (ETH format):", receiver.val);
    }

    // 3. Deposit + approve logic for EVM
    if (config[dstChainId]?.type === "evm") {
      const provider = new JsonRpcProvider(config[srcChainId].rpc);
      console.log("🔧 Performing EVM deposit & approve...");

      const contract = new Contract(
        config[srcChainId].wrappedNative!,
        IWETHContract.abi,
        provider
      );

      // Interface object for encoding
      const iface = new Interface(IWETHContract.abi);

      // STEP 1: Query Balance
      console.log("🧮 Checking token balance...");
      const balance = await contract.balanceOf(makerAddress);
      console.log("💰 Balance:", balance.toString());

      if (balance < amount) {
        console.log("🔄 Balance too low, preparing deposit...");

        // Encode deposit function data
        const data = iface.encodeFunctionData("deposit");

        // Build and sign deposit tx
        const { transaction, hashesToSign } =
          await srcEvm.prepareTransactionForSigning({
            from: makerAddress,
            to: config[srcChainId].wrappedNative!,
            value: amount,
            data,
            gas: 100000n,
          });

        console.log("transaction", transaction);

        const depositSig = await requestSignature({
          path: "ethereum-1",
          payload: uint8ArrayToHex(hashesToSign[0]),
        });

        const signedDepositTx = srcEvm.finalizeTransactionSigning({
          transaction,
          rsvSignatures: [toRSV(depositSig)],
        });

        const { hash: depositHash } = await srcEvm.broadcastTx(signedDepositTx);
        console.log("✅ Deposit TX broadcasted:", depositHash);
        await provider.waitForTransaction(depositHash, 1); // waits for 1 confirmation
        console.log("✅ Deposit TX confirmed:", depositHash);
      }

      // STEP 2: Query Allowance
      console.log("🔍 Checking token allowance...");
      const allowance = await contract.allowance(
        makerAddress,
        config[srcChainId].limitOrderProtocol
      );
      console.log("🔓 Allowance:", allowance.toString());

      if (allowance < UINT_256_MAX) {
        console.log("🔄 Allowance too low, preparing approval...");

        // Encode approve function data
        const data = iface.encodeFunctionData("approve", [
          config[srcChainId].limitOrderProtocol,
          UINT_256_MAX,
        ]);

        // Build and sign approval tx
        const { transaction, hashesToSign } =
          await srcEvm.prepareTransactionForSigning({
            from: makerAddress,
            to: config[srcChainId].wrappedNative!,
            value: 0,
            data,
            gas: 100000n,
          });

        console.log("transaction", transaction);

        const approveSig = await requestSignature({
          path: "ethereum-1",
          payload: uint8ArrayToHex(hashesToSign[0]),
        });

        const signedApproveTx = srcEvm.finalizeTransactionSigning({
          transaction,
          rsvSignatures: [toRSV(approveSig)],
        });

        const { hash: approveHash } = await srcEvm.broadcastTx(signedApproveTx);
        console.log("✅ Approve TX broadcasted:", approveHash);
        await provider.waitForTransaction(approveHash, 1);
        console.log("✅ Approve TX confirmed:", approveHash);
      }
    }

    // 4. Create Order
    console.log("📦 Constructing order...");
    const secret = randomBytes(32);
    console.log("secret", secret);

    const hashLock = {
      keccak256: Sdk.HashLock.forSingleFill(uint8ArrayToHexForSecret(secret)),
      sha256: bitcoin.crypto.sha256(secret),
    };

    console.log("hashLock", hashLock);

    const order = Sdk.CrossChainOrder.new(
      escrowFacotryAddress,
      {
        salt: Sdk.randBigInt(1000n),
        maker: new Sdk.Address(makerAddress),
        makingAmount: BigInt(amount),
        takingAmount: BigInt(takingAmount),
        makerAsset: new Sdk.Address(makerAsset),
        takerAsset: new Sdk.Address(takerAsset),
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
        srcChainId: dummySrcChainId,
        dstChainId: dummyDstChainId,
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

    if (config[dstChainId]?.type === "evm") {
      order.inner.inner.takerAsset = new Sdk.Address(
        config[srcChainId].trueERC20!
      );
      console.log(
        "✅ Overrode takerAsset to trueERC20:",
        config[srcChainId].trueERC20
      );
    }

    console.log("📦 Order constructed:", order);
    const hash = getOrderHashWithPatch(srcChainId, order, {
      ...patchedDomain,
      verifyingContract: config[srcChainId].limitOrderProtocol!,
    });
    console.log("🔐 Order hash:", hash);

    // 5. Signature
    let signature = "";

    if (config[srcChainId].type === "btc") {
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
      secret: secret.toString("hex"),
      hash,
      hashLock: {
        sha256: hashLock.sha256.toString("hex"),
      },
      srcChainId,
      dstChainId,
      order: order.build(),
      extension: order.extension,
      signature,
      btcUserPublicKey,
    });
  } catch (err: any) {
    console.error("❌ Order creation failed:", err);
    return c.json({ success: false, message: err.message }, 500);
  }
});

export default app;
