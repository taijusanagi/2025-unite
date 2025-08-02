import { config } from "@/lib/config";
import { Resolver } from "@sdk/evm//resolver";
import { Wallet } from "@sdk/evm//wallet";
import { JsonRpcProvider } from "ethers";
import { NextRequest, NextResponse } from "next/server";
import * as bitcoin from "bitcoinjs-lib";
import {
  BtcProvider,
  createDstHtlcScript,
  publicKeyToAddress,
  walletFromWIF,
} from "@sdk/btc";
import Sdk from "@sdk/evm/cross-chain-sdk-shims";

const privateKey = process.env.ETH_PRIVATE_KEY || "0x";
const btcPrivateKey = process.env.BTC_PRIVATE_KEY || "0x";

const network = bitcoin.networks.testnet;

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ hash: string }> }
) {
  const { hash } = await context.params;
  if (!hash) {
    return NextResponse.json({ error: "Missing hash" }, { status: 400 });
  }
  try {
    const {
      hashLock,
      srcChainId,
      dstChainId,
      srcEscrowAddress,
      dstEscrowAddress,
      srcImmutables,
      dstImmutables,
      btcRecipientPublicKey,
      secret,
    } = await req.json();

    if (
      !hashLock ||
      !srcChainId ||
      !dstChainId ||
      !srcEscrowAddress ||
      !dstEscrowAddress ||
      !srcImmutables ||
      !dstImmutables ||
      !secret
    ) {
      return NextResponse.json(
        { error: "Missing required parameters" },
        { status: 400 }
      );
    }

    const btcProvider = new BtcProvider(config[99999].rpc);
    const btcResolver = walletFromWIF(btcPrivateKey, bitcoin.networks.testnet);

    const resolver = new Resolver(
      config[srcChainId].resolver!,
      config[dstChainId].resolver!
    );

    let srcWithdrawHash: string;
    let dstWithdrawHash: string;

    console.log("Withdraw in destination chain");
    if (config[srcChainId].type === "btc") {
      console.log("Destination chain: BTC");

      if (!btcRecipientPublicKey) {
        return NextResponse.json(
          { error: "Missing required parameters" },
          { status: 400 }
        );
      }

      console.log("dstImmutables", dstImmutables);

      const spendPsbt = new bitcoin.Psbt({ network });
      const rawTxHex = await await btcProvider.getRawTransactionHex(
        dstEscrowAddress
      );
      const dstTimeLocks = Sdk.TimeLocks.fromBigInt(
        BigInt(dstImmutables.timelocks)
      ).toDstTimeLocks();

      const htlcScript = createDstHtlcScript(
        hash,
        hashLock.sha256,
        dstTimeLocks.privateWithdrawal,
        dstTimeLocks.privateCancellation,
        btcRecipientPublicKey,
        btcResolver.publicKey
      );

      spendPsbt.setLocktime(dstTimeLocks.privateWithdrawal);
      spendPsbt.addInput({
        hash: dstEscrowAddress,
        index: 0,
        nonWitnessUtxo: Buffer.from(rawTxHex, "hex"),
        redeemScript: htlcScript,
        sequence: 0xfffffffe,
      });

      const redeemFee = 1000;
      const redeemValue = dstImmutables.amount - redeemFee;

      if (redeemValue <= 0) {
        console.error(`❌ Not enough value to redeem HTLC.`);
        return;
      }

      const btcUserRecipientAddress = publicKeyToAddress(
        btcRecipientPublicKey,
        network
      );

      spendPsbt.addOutput({
        address: btcUserRecipientAddress!,
        value: redeemValue,
      });

      spendPsbt.signInput(0, {
        publicKey: btcRecipientPublicKey,
        sign: (hash) => Buffer.from(btcUser.keyPair.sign(hash)),
      });

      const htlcRedeemFinalizer = (inputIndex: number, input: any) => {
        const signature = input.partialSig[0].signature;

        const unlockingScript = bitcoin.script.compile([
          signature,
          secret,
          bitcoin.opcodes.OP_TRUE,
        ]);

        const payment = bitcoin.payments.p2sh({
          redeem: {
            input: unlockingScript,
            output: htlcScript,
          },
        });

        return {
          finalScriptSig: payment.input,
          finalScriptWitness: undefined,
        };
      };

      spendPsbt.finalizeInput(0, htlcRedeemFinalizer);

      const finalTxHex = spendPsbt.extractTransaction().toHex();
      const finalTxId = await btcProvider.broadcastTx(finalTxHex);

      console.log("🎉 Maker successfully claimed BTC from HTLC!");
      console.log("✅ Redemption TXID:", finalTxId);

      dstWithdrawHash = finalTxId;
    } else {
      console.log("Destination chain: ETH");
      console.log("Withdrawing from destination escrow...");
      const dstProvider = new JsonRpcProvider(
        config[dstChainId].rpc,
        dstChainId
      );
      const dstResolverWallet = new Wallet(privateKey, dstProvider);
      const { txHash: _dstWithdrawHash } = await dstResolverWallet.send(
        resolver.withdraw("dst", dstEscrowAddress, secret, dstImmutables)
      );
      dstWithdrawHash = _dstWithdrawHash;
      console.log("Withdrawal from destination complete.");
    }

    console.log("Withdraw in source chain");
    if (config[srcChainId].type === "btc") {
      console.log("Source chain: BTC");
      srcWithdrawHash = "";
    } else {
      console.log("Source chain: ETH");
      console.log("Withdrawing from source escrow...");
      const srcProvider = new JsonRpcProvider(
        config[srcChainId].rpc,
        srcChainId
      );
      const srcResolverWallet = new Wallet(privateKey, srcProvider);
      const { txHash: _srcWithdrawHash } = await srcResolverWallet.send(
        resolver.withdraw("src", srcEscrowAddress, secret, srcImmutables)
      );
      srcWithdrawHash = _srcWithdrawHash;
      console.log("Withdrawal from source complete.");
    }

    fetch(`${process.env.APP_URL}/api/relayer/orders/${hash}/withdraw`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        srcWithdrawHash,
        dstWithdrawHash,
      }),
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Withdraw handler error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
