import { Hono } from "hono";
import { agentAccountId, agent } from "@neardefi/shade-agent-js";
import { Btc } from "../utils/bitcoin";
import { Evm } from "../utils/ethereum";

const app = new Hono();

app.get("/", async (c) => {
  const contractId = process.env.NEXT_PUBLIC_contractId;
  console.log("Contract ID:", contractId);

  try {
    // Agent account
    console.log("Fetching agent account ID...");
    const { accountId } = await agentAccountId();
    console.log("Agent account ID:", accountId);

    console.log("Fetching agent balance...");
    const agentBal = await agent("getBalance");
    console.log("Agent balance:", agentBal);

    // EVM address and balance
    console.log("Deriving EVM address and public key...");
    const { address: evmAddress } = await Evm.deriveAddressAndPublicKey(
      contractId,
      "ethereum-1"
    );
    console.log("EVM address:", evmAddress);

    console.log("Fetching EVM balance...");
    const evmBal = await Evm.getBalance(evmAddress);
    console.log("EVM balance:", evmBal);

    // BTC address, public key and balance
    console.log("Deriving BTC address and public key...");
    const { address: btcAddress, publicKey: btcPublicKey } =
      await Btc.deriveAddressAndPublicKey(contractId, "bitcoin-1");
    console.log("BTC address:", btcAddress);
    console.log("BTC public key:", btcPublicKey);

    console.log("Fetching BTC balance...");
    const btcBal = await Btc.getBalance(btcAddress);
    console.log("BTC balance:", btcBal);

    const response = {
      accountId,
      balance: agentBal.balance,
      evmAddress,
      evmBalance: evmBal.balance.toString(),
      btcAddress,
      btcPublicKey,
      btcBalance: btcBal.balance.toString(),
    };

    console.log("Final response:", response);
    return c.json(response, 200);
  } catch (error) {
    console.error("Error aggregating data:", error);
    return c.json({ error: "Failed to retrieve account data: " + error }, 500);
  }
});

export default app;
