// File: app/api/relayer/orders/[hash]/dst-withdraw-params/route.ts

import { NextRequest, NextResponse } from "next/server";
import redis, { connectRedis } from "@/lib/redis";
import { walletFromWIF } from "@sdk/btc";
import * as bitcoin from "bitcoinjs-lib";

const network = bitcoin.networks.testnet;
const btcPrivateKey = process.env.BTC_PRIVATE_KEY || "";
const btcResolver = walletFromWIF(btcPrivateKey, network);

export async function GET(
  _req: NextRequest,
  context: { params: { hash: string } }
) {
  const { hash } = context.params;

  if (!hash) {
    return NextResponse.json({ error: "Missing hash" }, { status: 400 });
  }

  try {
    await connectRedis();

    const raw = await redis.hGet("orders", hash);
    if (!raw) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    const { hashLock, dstChainId, dstEscrowAddress, dstImmutables } =
      JSON.parse(raw);

    if (!hashLock || !dstChainId || !dstEscrowAddress || !dstImmutables) {
      return NextResponse.json(
        { error: "Incomplete order data" },
        { status: 422 }
      );
    }

    return NextResponse.json({
      dstEscrowAddress,
      dstImmutables,
      resolverPublicKey: btcResolver.publicKey, // <- This is the resolver’s pubkey
    });
  } catch (err) {
    console.error("Error in withdraw-btc-param GET:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
