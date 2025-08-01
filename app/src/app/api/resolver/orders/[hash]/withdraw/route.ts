import { config } from "@/lib/config";
import { Resolver } from "@sdk/evm//resolver";
import { Wallet } from "@sdk/evm//wallet";
import { JsonRpcProvider } from "ethers";
import { NextRequest, NextResponse } from "next/server";

const privateKey = process.env.ETH_PRIVATE_KEY || "0x";

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
      srcChainId,
      dstChainId,
      srcEscrowAddress,
      dstEscrowAddress,
      srcImmutables,
      dstImmutables,
      secret,
    } = await req.json();

    if (
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

    const srcProvider = new JsonRpcProvider(config[srcChainId].rpc, srcChainId);
    const srcResolverWallet = new Wallet(privateKey, srcProvider);

    const resolver = new Resolver(
      config[srcChainId].resolver,
      config[dstChainId].resolver
    );

    console.log("Withdrawing from destination escrow...");
    const { txHash: srcWithdrawHash } = await srcResolverWallet.send(
      resolver.withdraw("dst", dstEscrowAddress, secret, dstImmutables)
    );
    console.log("Withdrawal from destination complete.");

    console.log("Withdrawing from source escrow...");
    const { txHash: dstWithdrawHash } = await srcResolverWallet.send(
      resolver.withdraw("src", srcEscrowAddress, secret, srcImmutables)
    );
    console.log("Withdrawal from source complete.");

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
