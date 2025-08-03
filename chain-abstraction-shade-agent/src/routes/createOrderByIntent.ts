import { Hono } from "hono";
import Sdk from "../../../chains/sdk/evm/cross-chain-sdk-shims";
import {
  nativeTokenAddress,
  nullAddress,
} from "../../../chains/sdk/evm/constants";
import { UINT_40_MAX } from "@1inch/byte-utils";

const app = new Hono();

app.post("/order", async (c) => {
  try {
    const {
      makerAddress,
      srcChainId,
      dstChainId,
      amount = 5000,
    } = await c.req.json();
    const timestamp = BigInt(Math.floor(Date.now() / 1000));
    const escrowFacotryAddress = new Sdk.Address(nullAddress); // Update if needed
    const makerAsset = new Sdk.Address(nativeTokenAddress);
    const takerAsset = new Sdk.Address(nativeTokenAddress);
    const resolverAddress = new Sdk.Address(nativeTokenAddress); // Placeholder resolver

    const receiver = new Sdk.Address(makerAddress); // Simplified dummy: maker is receiver

    const hashLock = {
      keccak256: "0x" + "00".repeat(32), // dummy
      sha256: Buffer.alloc(32), // dummy
    };

    const order = Sdk.CrossChainOrder.new(
      escrowFacotryAddress,
      {
        salt: Sdk.randBigInt(1000n),
        maker: new Sdk.Address(makerAddress),
        makingAmount: BigInt(amount),
        takingAmount: BigInt(amount),
        makerAsset,
        takerAsset,
        receiver,
      },
      {
        hashLock: hashLock.keccak256,
        timeLocks: Sdk.TimeLocks.new({
          srcWithdrawal: 1n,
          srcPublicWithdrawal: 1023n,
          srcCancellation: 1024n,
          srcPublicCancellation: 1225n,
          dstWithdrawal: 1n,
          dstPublicWithdrawal: 511n,
          dstCancellation: 512n,
        }),
        srcChainId,
        dstChainId,
        srcSafetyDeposit: 0n,
        dstSafetyDeposit: 0n,
      },
      {
        auction: new Sdk.AuctionDetails({
          initialRateBump: 0,
          points: [],
          duration: 120n,
          startTime: timestamp,
        }),
        whitelist: [
          {
            address: resolverAddress,
            allowFrom: 0n,
          },
        ],
        resolvingStartTime: 0n,
      },
      {
        nonce: Sdk.randBigInt(UINT_40_MAX),
        allowPartialFills: false,
        allowMultipleFills: false,
      }
    );

    order.inner.fusionExtension.srcChainId = srcChainId;
    order.inner.fusionExtension.dstChainId = dstChainId;

    return c.json({
      success: true,
      order: order.build(),
      extension: order.extension,
    });
  } catch (err: any) {
    console.error("Failed to create order:", err);
    return c.json(
      { error: "Failed to create order", details: err.message },
      500
    );
  }
});

export default app;
