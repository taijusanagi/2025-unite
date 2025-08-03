import { Hono } from "hono";
import { requestSignature } from "@neardefi/shade-agent-js";
import * as bitcoin from "bitcoinjs-lib";
import * as secp256k1 from "@bitcoinerlab/secp256k1";

import { config } from "../../../chains/sdk/config";
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
import { UINT_40_MAX } from "@1inch/byte-utils";

import { addressToEthAddressFormat } from "../../../chains/sdk/btc";

const BTC_CHAIN_ID = 99999;
const BTC_RESOLVER_PUBKEY = process.env.NEXT_PUBLIC_BTC_RESOLVER_PUBLIC_KEY!;

const NETWORK = bitcoin.networks.testnet;

const app = new Hono();

app.post("/", async (c) => {
  try {
    const body = await c.req.json();
    const {
      makerAddress,
      srcChainId,
      dstChainId,
      btcUserAddress,
      amount = 5000,
    }: {
      makerAddress: string;
      srcChainId: number;
      dstChainId: number;
      btcUserAddress?: string;
      amount?: number;
    } = body;

    const isBtcSource = srcChainId === BTC_CHAIN_ID;
    const timestamp = BigInt(Math.floor(Date.now() / 1000));

    let escrowFacotryAddress = new Sdk.Address(nullAddress);
    if (config[srcChainId]?.type === "evm") {
      escrowFacotryAddress = new Sdk.Address(config[srcChainId].escrowFactory);
    }

    let makerAsset = new Sdk.Address(nullAddress);
    if (config[srcChainId]?.type === "evm") {
      makerAsset = new Sdk.Address(config[srcChainId].wrappedNative!);
    }

    let resolverAddress = new Sdk.Address(nativeTokenAddress);
    if (config[srcChainId]?.type === "evm") {
      resolverAddress = new Sdk.Address(config[srcChainId].resolver!);
    }

    let takerAsset = new Sdk.Address(nativeTokenAddress);
    if (config[dstChainId]?.type === "evm") {
      takerAsset = new Sdk.Address(config[dstChainId].wrappedNative!);
    }

    let receiver;
    if (config[dstChainId]?.type === "btc" && btcUserAddress) {
      receiver = new Sdk.Address(addressToEthAddressFormat(btcUserAddress));
    }

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

    // ⬇️ Override chainId values after creation
    order.inner.fusionExtension.srcChainId = srcChainId;
    order.inner.fusionExtension.dstChainId = dstChainId;

    // ✅ Post-creation override: takerAsset → trueERC20 (as in frontend)
    if (config[srcChainId]?.type === "evm") {
      order.inner.inner.takerAsset = new Sdk.Address(
        config[srcChainId].trueERC20!
      );
    }

    const hash = getOrderHashWithPatch(srcChainId, order, {
      ...patchedDomain,
      verifyingContract:
        config[srcChainId]?.limitOrderProtocol || nativeTokenAddress,
    });

    let signature: string;
    let btcMeta: any = null;

    if (isBtcSource) {
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
      const ethSignRes = await requestSignature({
        path: "ethereum-1",
        payload: hash.slice(2),
      });

      const r = ethSignRes.big_r.affine_point.slice(2);
      const s = ethSignRes.s.scalar.replace(/^0x/, "").padStart(64, "0");
      const v = ethSignRes.recovery_id + 27;

      signature = `0x${r}${s}${v.toString(16).padStart(2, "0")}`;
    }

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
      ...btcMeta,
    });
  } catch (err: any) {
    console.error("❌ Order creation failed:", err);
    return c.json({ success: false, message: err.message }, 500);
  }
});

export default app;
