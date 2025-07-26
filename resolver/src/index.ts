import express, { Request, Response } from "express";
import "dotenv/config";
import { parseEther, parseUnits, randomBytes, JsonRpcProvider } from "ethers";
import { uint8ArrayToHex, UINT_40_MAX } from "@1inch/byte-utils";
import Sdk, { Address } from "@1inch/cross-chain-sdk";
import { config } from "./lib/config";
import { Wallet } from "./lib/wallet";
import { Resolver } from "./lib/resolver";
import { EscrowFactory } from "./lib/escrow-factory";

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());

const userPk =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const resolverPk =
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a";

const sourceResolverAddress = process.env.SRC_RESOLVER!;
const destinationResolverAddress = process.env.DST_RESOLVER!;
const sourceEscrowFactory = process.env.SRC_ESCROW_FACTORY!;
const dstEscrowFactory = process.env.DST_ESCROW_FACTORY!;

const srcProvider = new JsonRpcProvider(
  config.chain.source.url,
  config.chain.source.chainId,
  {
    cacheTimeout: -1,
    staticNetwork: true,
  }
);

const dstProvider = new JsonRpcProvider(
  config.chain.destination.url,
  config.chain.destination.chainId,
  {
    cacheTimeout: -1,
    staticNetwork: true,
  }
);

// Mock DB
const orders: any[] = [];

app.get("/", (req: Request, res: Response) => {
  res.send("Resolver API");
});

// Create and store order
app.post("/create-order", async (req: Request, res: Response) => {
  try {
    const secret = uint8ArrayToHex(randomBytes(32));
    const srcChainId = config.chain.source.chainId;
    const dstChainId = config.chain.destination.chainId;
    const timestamp = BigInt(Math.floor(Date.now() / 1000));

    const userWallet = new Wallet(userPk, srcProvider);

    const order = Sdk.CrossChainOrder.new(
      new Address(sourceEscrowFactory),
      {
        salt: Sdk.randBigInt(1000n),
        maker: new Address(await userWallet.getAddress()),
        makingAmount: parseUnits("100", 6),
        takingAmount: parseUnits("99", 6),
        makerAsset: new Address(config.chain.source.wrappedNative),
        takerAsset: new Address(config.chain.destination.wrappedNative),
      },
      {
        hashLock: Sdk.HashLock.forSingleFill(secret),
        timeLocks: Sdk.TimeLocks.new({
          srcWithdrawal: 10n,
          srcPublicWithdrawal: 120n,
          srcCancellation: 121n,
          srcPublicCancellation: 122n,
          dstWithdrawal: 10n,
          dstPublicWithdrawal: 100n,
          dstCancellation: 101n,
        }),
        srcChainId,
        dstChainId,
        srcSafetyDeposit: parseEther("0.001"),
        dstSafetyDeposit: parseEther("0.001"),
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
            address: new Address(sourceResolverAddress),
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

    const signature = await userWallet.signOrder(srcChainId, order);
    orders.push({ order, signature, secret });

    res.json({ order, signature, secret });
  } catch (e) {
    console.error("Error creating order:", e);
    res.status(500).send("Error creating order");
  }
});

// Cron job to process fillable orders
app.post("/process-orders", async (req: Request, res: Response) => {
  try {
    const srcChainResolver = new Wallet(resolverPk, srcProvider);
    const dstChainResolver = new Wallet(resolverPk, dstProvider);
    const resolverContract = new Resolver(
      sourceResolverAddress,
      destinationResolverAddress
    );

    const processed = [];

    for (const entry of orders) {
      const { order, signature, secret } = entry;

      const fillAmount = order.makingAmount;
      const { blockHash: srcDeployBlock } = await srcChainResolver.send(
        resolverContract.deploySrc(
          config.chain.source.chainId,
          order,
          signature,
          Sdk.TakerTraits.default()
            .setExtension(order.extension)
            .setAmountMode(Sdk.AmountMode.maker)
            .setAmountThreshold(order.takingAmount),
          fillAmount
        )
      );

      const srcFactory = new EscrowFactory(
        srcChainResolver.provider,
        sourceEscrowFactory
      );
      const dstFactory = new EscrowFactory(
        dstChainResolver.provider,
        dstEscrowFactory
      );
      const srcEvent = await srcFactory.getSrcDeployEvent(srcDeployBlock);

      const dstImmutables = srcEvent[0]
        .withComplement(srcEvent[1])
        .withTaker(new Address(resolverContract.dstAddress));
      const { blockTimestamp: dstDeployedAt } = await dstChainResolver.send(
        resolverContract.deployDst(dstImmutables)
      );

      const dstEscrowAddress = new Sdk.EscrowFactory(
        new Address(dstEscrowFactory)
      ).getDstEscrowAddress(
        srcEvent[0],
        srcEvent[1],
        dstDeployedAt,
        new Address(resolverContract.dstAddress),
        await dstFactory.getDestinationImpl()
      );

      const srcEscrowAddress = new Sdk.EscrowFactory(
        new Address(sourceEscrowFactory)
      ).getSrcEscrowAddress(srcEvent[0], await srcFactory.getSourceImpl());

      await dstChainResolver.send(
        resolverContract.withdraw(
          "dst",
          dstEscrowAddress,
          secret,
          dstImmutables.withDeployedAt(dstDeployedAt)
        )
      );

      await srcChainResolver.send(
        resolverContract.withdraw("src", srcEscrowAddress, secret, srcEvent[0])
      );

      processed.push(order.getOrderHash(config.chain.source.chainId));
    }

    res.json({ processed });
  } catch (e) {
    console.error("Error processing orders:", e);
    res.status(500).send("Error processing orders");
  }
});

app.listen(PORT, () => {
  console.log(`Resolver API running at http://localhost:${PORT}`);
});
