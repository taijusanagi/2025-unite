// app/api/resolver/orders/[hash]/process/route.ts

import { NextResponse } from "next/server";
import { JsonRpcProvider } from "ethers";
import * as Sdk from "@1inch/cross-chain-sdk";
import { config } from "@/lib/config";
import { Wallet } from "@sdk/evm/wallet";
import { Resolver } from "@sdk/evm/resolver";
import { EscrowFactory } from "@sdk/evm/escrow-factory";
import { Address } from "@1inch/cross-chain-sdk";

import * as bitcoin from "bitcoinjs-lib";
import { hexToUint8Array } from "@1inch/byte-utils";
import {
  addressToEthAddressFormat,
  BtcProvider,
  publicKeyToAddress,
  walletFromWIF,
} from "@sdk/btc";

const ethPrivateKey = process.env.ETH_PRIVATE_KEY || "0x";
const btcPrivateKey = process.env.BTC_PRIVATE_KEY || "0x";

const network = bitcoin.networks.testnet;

export async function POST(
  _req: Request,
  context: { params: Promise<{ hash: string }> }
) {
  try {
    const { hash } = await context.params;
    if (!hash) {
      return NextResponse.json({ error: "Missing hash" }, { status: 400 });
    }

    const response = await fetch(
      `${process.env.APP_URL}/api/relayer/orders/${hash}`
    );

    if (!response.ok) {
      return NextResponse.json(
        { error: "Order not found in relayer" },
        { status: 404 }
      );
    }

    const {
      hashLock,
      srcChainId,
      dstChainId,
      order: _order,
      extension,
      signature,
      btcUserRecipientKey,
    } = await response.json();
    const order = Sdk.CrossChainOrder.fromDataAndExtension(_order, extension);

    const btcProvider = new BtcProvider(config[99999].rpc);

    const evmResolverContract = new Resolver(
      config[srcChainId].resolver!,
      config[dstChainId].resolver!
    );
    const fillAmount = order.makingAmount;
    const btcResolver = walletFromWIF(btcPrivateKey, bitcoin.networks.testnet);

    let srcImmutables: Sdk.Immutables;
    let complement: Sdk.DstImmutablesComplement;
    let dstImmutables: Sdk.Immutables;
    let srcEscrowAddress: string;
    let dstEscrowAddress: string;
    let dstDeployedAt: bigint;
    let srcDeployHash: string;
    let dstDeployHash: string;

    console.log("Escrow deployment in source chain");
    if (config[srcChainId].type === "btc") {
      console.log("Source chain: BTC");

      srcImmutables = {} as any;
      complement = {} as any;
      dstImmutables = {} as any;
      srcEscrowAddress = "";
      dstEscrowAddress = "";
      srcDeployHash = "";
      dstDeployHash = "";
    } else {
      console.log("Source chain: EVM");
      const srcProvider = new JsonRpcProvider(
        config[srcChainId].rpc,
        srcChainId
      );
      const srcResolverWallet = new Wallet(ethPrivateKey, srcProvider);
      const srcEscrowFactory = new EscrowFactory(
        srcResolverWallet.provider,
        config[srcChainId].escrowFactory!
      );
      console.log("Deploying source escrow contract...");
      const {
        txHash: _srcDeployHash,
        blockHash: srcDeployBlock,
        blockTimestamp: srcDeployedAt,
      } = await srcResolverWallet.send(
        evmResolverContract.deploySrc(
          srcChainId,
          config[srcChainId].limitOrderProtocol!,
          order,
          signature,
          Sdk.TakerTraits.default()
            .setExtension(order.extension)
            .setAmountMode(Sdk.AmountMode.maker)
            .setAmountThreshold(order.takingAmount),
          fillAmount
        )
      );
      srcDeployHash = _srcDeployHash;
      console.log(
        `Source deployed at block hash: ${srcDeployHash}, timestamp: ${srcDeployedAt}`
      );

      console.log("Fetching source deployment event...");
      const srcEvent = await srcEscrowFactory.getSrcDeployEvent(srcDeployBlock);
      console.log("Source deployment event fetched.");
      console.log("Constructing destination escrow immutables...");
      srcImmutables = srcEvent[0];
      complement = srcEvent[1];

      dstImmutables = srcImmutables
        .withComplement(complement)
        .withTaker(new Address(addressToEthAddressFormat(btcResolver.address)));

      console.log("Calculating source escrow address...");
      srcEscrowAddress = new Sdk.EscrowFactory(
        new Address(config[srcChainId].escrowFactory!)
      )
        .getSrcEscrowAddress(
          srcImmutables,
          await srcEscrowFactory.getSourceImpl()
        )
        .toString();
      console.log(`Source escrow address: ${srcEscrowAddress}`);
    }

    console.log("Escrow deployment in destination chain");
    if (config[dstChainId].type === "btc") {
      console.log("Destination chain: BTC");

      const recipientAddress = publicKeyToAddress(
        btcUserRecipientKey,
        bitcoin.networks.testnet
      );
      const ethFormattedRecipientAddress =
        addressToEthAddressFormat(recipientAddress);

      if (order.receiver.toString() !== ethFormattedRecipientAddress) {
        throw new Error(
          `Mismatch: order.receiver ${order.receiver} does not match BTC destination address ${ethFormattedRecipientAddress}`
        );
      }

      const dstTimeLocks = dstImmutables.timeLocks.toDstTimeLocks();
      const htlcScript = bitcoin.script.compile([
        Buffer.from(hexToUint8Array(dstImmutables.hash())),
        bitcoin.opcodes.OP_DROP,
        bitcoin.script.number.encode(Number(dstTimeLocks.privateWithdrawal)),
        bitcoin.opcodes.OP_CHECKLOCKTIMEVERIFY,
        bitcoin.opcodes.OP_DROP,
        bitcoin.opcodes.OP_IF,
        bitcoin.opcodes.OP_SHA256,
        hashLock.sha256,
        bitcoin.opcodes.OP_EQUALVERIFY,
        btcUserRecipientKey, // 👤 Maker can claim with secret
        bitcoin.opcodes.OP_CHECKSIG,
        bitcoin.opcodes.OP_ELSE,
        bitcoin.script.number.encode(Number(dstTimeLocks.privateCancellation)),
        bitcoin.opcodes.OP_CHECKLOCKTIMEVERIFY,
        bitcoin.opcodes.OP_DROP,
        btcResolver.publicKey, // 👤 Taker can refund after timeout
        bitcoin.opcodes.OP_CHECKSIG,
        bitcoin.opcodes.OP_ENDIF,
      ]);

      const p2sh = bitcoin.payments.p2sh({
        redeem: { output: htlcScript, network },
        network,
      });

      console.log("✅ HTLC P2SH Address:", p2sh.address);

      // === Taker (resolver) funds the HTLC ===
      const utxos = await btcProvider.getUtxos(btcResolver.address!);
      if (!utxos.length) {
        console.error("❌ No UTXOs available to fund HTLC.");
        return;
      }

      const amount = Number(order.takingAmount); // Match maker's amount or adjust as needed
      const fee = 1000;
      const totalInput = utxos.reduce((sum, u) => sum + u.value, 0);
      const change = totalInput - amount - fee;

      if (change < 0) {
        console.error("❌ Not enough funds to lock BTC and cover the fee.");
        return;
      }

      const psbt = new bitcoin.Psbt({ network });

      for (const utxo of utxos) {
        psbt.addInput({
          hash: utxo.txid,
          index: utxo.vout,
          witnessUtxo: {
            script: bitcoin.payments.p2wpkh({
              pubkey: btcResolver.publicKey,
              network,
            }).output!,
            value: utxo.value,
          },
        });
      }

      psbt.addOutput({
        script: p2sh.output!,
        value: amount,
      });

      if (change > 0) {
        psbt.addOutput({
          address: btcResolver.address!, // refund to self
          value: change,
        });
      }

      utxos.forEach((_, idx) => {
        psbt.signInput(idx, {
          publicKey: btcResolver.publicKey,
          sign: (hash) => Buffer.from(btcResolver.keyPair.sign(hash)),
        });
      });

      psbt.finalizeAllInputs();

      const txHex = psbt.extractTransaction().toHex();
      const btcDstEscrowHash = await btcProvider.broadcastTx(txHex);

      console.log("✅ Taker has funded HTLC:");
      console.log("🔗 btcDstEscrowHash:", btcDstEscrowHash);

      const { confirmedAt } = await btcProvider.waitForTxConfirmation(
        btcDstEscrowHash
      );

      dstEscrowAddress = btcDstEscrowHash;
      dstDeployedAt = BigInt(confirmedAt);
      dstDeployHash = btcDstEscrowHash;
    } else {
      console.log("Destination chain: EVM");
      const dstProvider = new JsonRpcProvider(
        config[dstChainId].rpc,
        dstChainId
      );
      const dstResolverWallet = new Wallet(ethPrivateKey, dstProvider);
      const dstEscrowFactory = new EscrowFactory(
        dstResolverWallet.provider,
        config[dstChainId].escrowFactory!
      );
      console.log("Deploying destination escrow contract...");
      const { txHash: _dstDeployHash, blockTimestamp: _dstDeployedAt } =
        await dstResolverWallet.send(
          evmResolverContract.deployDst(dstImmutables)
        );
      dstDeployHash = _dstDeployHash;
      dstDeployedAt = _dstDeployedAt;
      console.log(
        `Destination deployed at block hash: ${dstDeployHash}, timestamp: ${dstDeployedAt}`
      );
      console.log("Calculating destination escrow address...");
      dstEscrowAddress = new Sdk.EscrowFactory(
        new Address(config[dstChainId].escrowFactory!)
      )
        .getDstEscrowAddress(
          srcImmutables,
          complement,
          _dstDeployedAt,
          new Address(evmResolverContract.dstAddress),
          await dstEscrowFactory.getDestinationImpl()
        )
        .toString();
      console.log(`Destination escrow address: ${dstEscrowAddress}`);
    }

    fetch(`${process.env.APP_URL}/api/relayer/orders/${hash}/escrow`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        srcEscrowAddress: srcEscrowAddress,
        dstEscrowAddress: dstEscrowAddress,
        srcImmutables: srcImmutables.build(),
        dstImmutables: dstImmutables.withDeployedAt(dstDeployedAt).build(),
        srcDeployHash,
        dstDeployHash,
      }),
    });

    return NextResponse.json({
      success: true,
    });
  } catch (err) {
    console.error("Resolver error:", err);
    return NextResponse.json({ error: "Resolver failed" }, { status: 500 });
  }
}
