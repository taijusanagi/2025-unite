import express, { Request, Response } from "express";
import "dotenv/config";
import { parseEther, parseUnits, randomBytes, JsonRpcProvider } from "ethers";
import { uint8ArrayToHex, UINT_40_MAX } from "@1inch/byte-utils";
import * as Sdk from "@1inch/cross-chain-sdk";
const Address = Sdk.Address;
import { config } from "./lib/config";
import { Wallet } from "./lib/wallet";
import { Resolver } from "./lib/resolver";
import { EscrowFactory } from "./lib/escrow-factory";

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());

const userPk = process.env.PRIVATE_KEY || "0x";
const resolverPk = process.env.PRIVATE_KEY || "0x";

const sourceResolverAddress = "0x88049d50AAE11BAa334b5E86B6B90BaE078f5851";
const destinationResolverAddress = "0x15e4294eA33f19828eCA2B6B2B867aBf0C2509f8";
const sourceEscrowFactory = "0x99275358DC3931Bcb10FfDd4DFa6276C38D9a6f0";
const dstEscrowFactory = "0x73e5d195b5cf7eb46de86901ad941986e74921ca";

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
