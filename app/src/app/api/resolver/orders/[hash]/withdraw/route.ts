import { config } from "@/lib/config";
import { Resolver } from "@sdk/evm//resolver";
import { Wallet } from "@sdk/evm//wallet";
import { JsonRpcProvider } from "ethers";
import { NextRequest, NextResponse } from "next/server";
import * as bitcoin from "bitcoinjs-lib";
import { BtcProvider, walletFromWIF } from "@sdk/btc";

const privateKey = process.env.ETH_PRIVATE_KEY || "0x";
const btcPrivateKey = process.env.BTC_PRIVATE_KEY || "0x";

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
      btcUserPublicKey,
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

    let srcWithdrawHash = "";
    let dstWithdrawHash = "";

    console.log("Withdraw in destination chain");
    if (config[srcChainId].type === "btc") {
      console.log("Destination chain: BTC");
      console.log("BTC chaim must be done by user, skip...");
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
