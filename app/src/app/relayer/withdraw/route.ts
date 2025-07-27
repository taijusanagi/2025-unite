// app/api/relayer/withdraw/route.ts

import { config } from "@/lib/config";
import { Resolver } from "@/lib/resolver";
import { Wallet } from "@/lib/wallet";
import { JsonRpcProvider } from "ethers";
import { NextRequest, NextResponse } from "next/server";

const privateKey = process.env.PRIVATE_KEY || "0x";

export async function POST(req: NextRequest) {
  try {
    const { srcChainId, dstChainId, dstEscrowAddress, secret, dstImmutables } =
      await req.json();

    if (
      !srcChainId ||
      !dstChainId ||
      !dstEscrowAddress ||
      !secret ||
      !dstImmutables
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

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Withdraw handler error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
