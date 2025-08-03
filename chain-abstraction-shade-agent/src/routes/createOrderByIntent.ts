import { Hono } from "hono";

import { nativeTokenAddress } from "../../../chains/sdk/evm/constants";

const app = new Hono();

app.get("/", async (c) => {
  try {
    return c.json({
      success: true,
      nativeTokenAddress,
    });
  } catch (error) {
    console.log("Error creating order by intent:", error);
    return c.json({ error: "Failed to create order by intent " + error }, 500);
  }
});

export default app;
