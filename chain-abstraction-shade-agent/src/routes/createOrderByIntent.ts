import { Hono } from "hono";

import { nativeTokenAddress } from "../../../chains/sdk/evm/constants";
import { requestSignature } from "@neardefi/shade-agent-js";

const app = new Hono();

app.get("/", async (c) => {
  try {
    const ethSignRes = await requestSignature({
      path: "ethereum-1",
      payload:
        "ab09b204305ba1b8c546a90fab8098263337098e37011471c0699e784a16ba97",
    });
    console.log("ethSignRes", ethSignRes);

    const btcSignRes = await requestSignature({
      path: "bitcoin-1",
      payload:
        "ab09b204305ba1b8c546a90fab8098263337098e37011471c0699e784a16ba97",
    });
    console.log("btcSignRes", btcSignRes);

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
