// app/api/relayer/order/[hash]/status/route.ts
import { NextResponse } from "next/server";
import { connectRedis } from "@/lib/redis";
import redis from "@/lib/redis";

export async function GET(
  _req: Request,
  { params }: { params: { hash: string } }
) {
  try {
    const hash = params.hash;
    if (!hash) {
      return NextResponse.json({ error: "Missing hash" }, { status: 400 });
    }

    await connectRedis();

    const data = await redis.hGet("orders", hash);
    if (!data) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    const parsed = JSON.parse(data);
    const status = parsed.status;

    return NextResponse.json({ hash, status });
  } catch (err) {
    console.error("Error fetching order status:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
