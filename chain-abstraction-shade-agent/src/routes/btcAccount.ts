import { Hono } from "hono";
import { Btc } from "../utils/bitcoin"; // Assuming you have this module

const app = new Hono();

app.get("/", async (c) => {
  const accountId = process.env.NEXT_PUBLIC_contractId; // or rename to BTC-specific variable
  try {
    // Derive Bitcoin address and public key
    const { address: btcAddress } = await Btc.deriveAddressAndPublicKey(
      accountId,
      "bitcoin-1" // Adjust if using a different derivation path
    );

    // Get the balance for the BTC address
    const balance = await Btc.getBalance(btcAddress);

    return c.json({ btcAddress, balance: Number(balance.balance) });
  } catch (error) {
    console.log("Error getting the derived Bitcoin address:", error);
    return c.json({ error: "Failed to get the derived Bitcoin address" }, 500);
  }
});

export default app;
