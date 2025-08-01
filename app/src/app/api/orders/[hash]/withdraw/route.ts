// app/api/relayer/order/[hash]/escrow/route.ts
import { NextResponse } from "next/server";
import { connectRedis } from "@/lib/redis";
import redis from "@/lib/redis";

export async function POST({ params }: { params: { hash: string } }) {
  try {
    const hash = params.hash;
    if (!hash) {
      return NextResponse.json({ error: "Missing hash" }, { status: 400 });
    }

    await connectRedis();

    const existing = await redis.hGet("orders", hash);
    if (!existing) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    const order = JSON.parse(existing);

    const updated = {
      ...order,
      status: "withdraw_completed",
    };

    await redis.hSet("orders", hash, JSON.stringify(updated));

    return NextResponse.json({ status: true });
  } catch (err) {
    console.error("Error updating order escrow:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
