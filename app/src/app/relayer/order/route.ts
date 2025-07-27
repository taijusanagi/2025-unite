// app/api/order/route.ts
import { NextResponse } from "next/server";
import redis, { connectRedis } from "@/lib/redis";

export async function POST(req: Request) {
  try {
    const { hash, order, signature, secret } = await req.json();

    if (!hash || !order || !signature || !secret) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }

    const payload = {
      order,
      signature,
      secret,
    };

    await connectRedis();
    await redis.hSet("orders", hash, JSON.stringify(payload));

    return NextResponse.json({ hash, message: "Stored successfully" });
  } catch (err) {
    console.error("Redis error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
