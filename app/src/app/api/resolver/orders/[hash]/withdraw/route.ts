import { config } from "@/lib/config";
import { Resolver } from "@/lib/resolver";
import { Wallet } from "@/lib/wallet";
import { JsonRpcProvider } from "ethers";
import { NextRequest, NextResponse } from "next/server";

const privateKey = process.env.ETH_PRIVATE_KEY || "0x";

export async function POST(
  req: NextRequest,
  { params }: { params: { hash: string } }
) {
  const hash = params.hash;
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

    const srcProvider = new JsonRpcProvider(config[srcChainId].url, srcChainId);
    const srcResolverWallet = new Wallet(privateKey, srcProvider);

    const resolver = new Resolver(
      config[srcChainId].resolver,
      config[dstChainId].resolver
    );

    console.log("Withdrawing from destination escrow...");
    await srcResolverWallet.send(
      resolver.withdraw("dst", dstEscrowAddress, secret, dstImmutables)
    );
    console.log("Withdrawal from destination complete.");

    console.log("Withdrawing from source escrow...");
    await srcResolverWallet.send(
      resolver.withdraw("src", srcEscrowAddress, secret, srcImmutables)
    );
    console.log("Withdrawal from source complete.");

    fetch(`${process.env.APP_URL}/relayer/orders/${hash}/withdraw`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Withdraw handler error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
