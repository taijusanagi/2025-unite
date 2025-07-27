// app/api/order/[hash]/route.ts
import { NextResponse } from "next/server";
import redis, { connectRedis } from "@/lib/redis";

export async function GET(
  _: Request,
  { params }: { params: { hash: string } }
) {
  try {
    await connectRedis();

    if (params.hash === "all") {
      const all = await redis.hGetAll("orders");
      const parsed = Object.entries(all).map(([hash, json]) => {
        const { ...rest } = JSON.parse(json);
        return { hash, ...rest };
      });
      return NextResponse.json(parsed);
    }

    const data = await redis.hGet("orders", params.hash);
    if (!data) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const { ...rest } = JSON.parse(data);
    return NextResponse.json({ hash: params.hash, ...rest });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
