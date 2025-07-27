import express, { Request, Response } from "express";
import "dotenv/config";
import {
  parseEther,
  parseUnits,
  randomBytes,
  JsonRpcProvider,
  Contract,
  recoverAddress,
} from "ethers";
import { uint8ArrayToHex, UINT_40_MAX, UINT_256_MAX } from "@1inch/byte-utils";
import * as Sdk from "@1inch/cross-chain-sdk";
const Address = Sdk.Address;
import { config } from "./lib/config";
import { Wallet } from "./lib/wallet";
import { Resolver } from "./lib/resolver";
import { EscrowFactory } from "./lib/escrow-factory";

import IWETHContract from "./lib/contracts/IWETH.json";
import ResolverContract from "./lib/contracts/Resolver.json";

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());

const userPk = process.env.PRIVATE_KEY || "0x";
const resolverPk = process.env.PRIVATE_KEY || "0x";

const sourceResolverAddress = "0x88049d50AAE11BAa334b5E86B6B90BaE078f5851";
const destinationResolverAddress = "0xF920618C3CF765cE5570A15665C50b3e3f287352";
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

app.get("/", async (req: Request, res: Response) => {
  res.send("Resolver API");
  console.log(orders);
  const depositAmount = parseEther("0.01");

  const srcUserWallet = new Wallet(userPk, srcProvider);
  const srcResolverWallet = new Wallet(resolverPk, srcProvider);
  const dstResolverWallet = new Wallet(resolverPk, dstProvider);

  const dstResolverContract = new Contract(
    destinationResolverAddress,
    ResolverContract.abi,
    dstResolverWallet.signer
  );

  const srcWrappedNativeTokenContract = new Contract(
    config.chain.source.wrappedNative,
    IWETHContract.abi,
    srcUserWallet.signer
  );

  const dstWrappedNativeTokenContract = new Contract(
    config.chain.destination.wrappedNative,
    IWETHContract.abi,
    dstResolverWallet.signer
  );

  const srcBalance = await srcWrappedNativeTokenContract.balanceOf(
    await srcUserWallet.getAddress()
  );

  if (srcBalance < depositAmount) {
    console.log("Insufficient balance, depositing...");
    const tx = await srcWrappedNativeTokenContract.deposit({
      value: depositAmount,
    });
    await tx.wait();
    console.log("Deposit successful");
  } else {
    console.log("Sufficient balance, no deposit needed");
  }

  const srcAllowance = await srcWrappedNativeTokenContract.allowance(
    await srcUserWallet.getAddress(),
    config.chain.source.limitOrderProtocol
  );

  if (srcAllowance < UINT_256_MAX) {
    console.log("Insufficient allowance, approving...");
    const tx = await srcWrappedNativeTokenContract.approve(
      config.chain.source.limitOrderProtocol,
      UINT_256_MAX
    );
    await tx.wait();
    console.log("Approval successful");
  } else {
    console.log("Sufficient allowance, no approval needed");
  }

  const dstNativeTokenBalance = await dstProvider.getBalance(
    destinationResolverAddress
  );

  if (dstNativeTokenBalance < depositAmount) {
    console.log("Insufficient balance on destination chain, depositing...");
    const tx = await dstResolverWallet.signer.sendTransaction({
      to: destinationResolverAddress,
      value: depositAmount,
    });
    await tx.wait();
    console.log("Deposit successful");
  } else {
    console.log("Sufficient balance on destination chain, no deposit needed");
  }

  const dstWrappedNativeTokenBalance =
    await dstWrappedNativeTokenContract.balanceOf(destinationResolverAddress);

  if (dstWrappedNativeTokenBalance < depositAmount) {
    console.log("Insufficient balance on destination chain, depositing...");
    const depositTx = await dstWrappedNativeTokenContract.deposit({
      value: depositAmount,
    });
    await depositTx.wait();
    console.log("Deposit successful");
    const transferTx = await dstWrappedNativeTokenContract.transfer(
      destinationResolverAddress, // or any recipient you intend
      depositAmount
    );
    await transferTx.wait();
    console.log("Transfer successful");
  } else {
    console.log("Sufficient balance on destination chain, no deposit needed");
  }

  const dstAllowance = await dstWrappedNativeTokenContract.allowance(
    destinationResolverAddress,
    config.chain.destination.limitOrderProtocol
  );

  if (dstAllowance < UINT_256_MAX) {
    console.log("Insufficient allowance on destination chain, approving...");
    const functionData =
      dstWrappedNativeTokenContract.interface.encodeFunctionData("approve", [
        config.chain.destination.limitOrderProtocol,
        UINT_256_MAX,
      ]);
    const tx = await dstResolverContract.arbitraryCalls(
      [config.chain.destination.wrappedNative],
      [functionData]
    );
    await tx.wait();
    console.log("Approval successful");
  } else {
    console.log(
      "Sufficient allowance on destination chain, no approval needed"
    );
  }
});

// Create and store order
app.post("/create-order", async (req: Request, res: Response) => {
  try {
    const secret = uint8ArrayToHex(randomBytes(32));
    const srcChainId = config.chain.source.chainId;
    const dstChainId = config.chain.destination.chainId;
    const timestamp = BigInt(Math.floor(Date.now() / 1000));

    const srcUserWallet = new Wallet(userPk, srcProvider);

    const order = Sdk.CrossChainOrder.new(
      new Address(sourceEscrowFactory),
      {
        salt: Sdk.randBigInt(1000n),
        maker: new Address(await srcUserWallet.getAddress()),
        makingAmount: parseUnits("0.0001", 18),
        takingAmount: parseUnits("0.00009", 18),
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

    console.log("order", order);

    const signature = await srcUserWallet.signOrder(srcChainId, order);

    console.log("signature", signature);

    if (orders.length == 0) {
      orders.push({ order, signature, secret });
    } else {
      orders[0] = { order, signature, secret };
    }
    res.json({ success: true });
  } catch (e) {
    console.error("Error creating order:", e);
    res.status(500).send("Error creating order");
  }
});

// Cron job to process fillable orders
app.post("/process-orders", async (req: Request, res: Response) => {
  try {
    console.log("Initializing resolvers...");
    const srcChainResolver = new Wallet(resolverPk, srcProvider);
    const dstChainResolver = new Wallet(resolverPk, dstProvider);
    const resolverContract = new Resolver(
      sourceResolverAddress,
      destinationResolverAddress
    );

    const processed = [];

    console.log(`Processing ${orders.length} orders...`);
    for (const [index, entry] of orders.entries()) {
      console.log(`\nProcessing order ${index + 1}/${orders.length}`);
      const { order, signature, secret } = entry;

      const orderHash = order.getOrderHash(config.chain.source.chainId);
      console.log(`Order hash: ${orderHash}`);

      const signer = recoverAddress(orderHash, signature);

      console.log("Recovered address:", signer);

      const fillAmount = order.makingAmount;
      console.log("Deploying source escrow contract...");

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
      console.log(`Source deployed at block hash: ${srcDeployBlock}`);

      const srcFactory = new EscrowFactory(
        srcChainResolver.provider,
        sourceEscrowFactory
      );
      const dstFactory = new EscrowFactory(
        dstChainResolver.provider,
        dstEscrowFactory
      );

      console.log("Fetching source deployment event...");
      const srcEvent = await srcFactory.getSrcDeployEvent(srcDeployBlock);
      console.log("Source deployment event fetched.");

      console.log("Constructing destination escrow immutables...");
      const dstImmutables = srcEvent[0]
        .withComplement(srcEvent[1])
        .withTaker(new Address(resolverContract.dstAddress));

      console.log("Deploying destination escrow contract...");
      const { blockTimestamp: dstDeployedAt } = await dstChainResolver.send(
        resolverContract.deployDst(dstImmutables)
      );
      console.log(`Destination deployed at timestamp: ${dstDeployedAt}`);

      console.log("Calculating destination escrow address...");
      const dstEscrowAddress = new Sdk.EscrowFactory(
        new Address(dstEscrowFactory)
      ).getDstEscrowAddress(
        srcEvent[0],
        srcEvent[1],
        dstDeployedAt,
        new Address(resolverContract.dstAddress),
        await dstFactory.getDestinationImpl()
      );
      console.log(`Destination escrow address: ${dstEscrowAddress}`);

      console.log("Calculating source escrow address...");
      const srcEscrowAddress = new Sdk.EscrowFactory(
        new Address(sourceEscrowFactory)
      ).getSrcEscrowAddress(srcEvent[0], await srcFactory.getSourceImpl());
      console.log(`Source escrow address: ${srcEscrowAddress}`);

      console.log("Withdrawing from destination escrow...");
      await dstChainResolver.send(
        resolverContract.withdraw(
          "dst",
          dstEscrowAddress,
          secret,
          dstImmutables.withDeployedAt(dstDeployedAt)
        )
      );
      console.log("Withdrawal from destination complete.");

      console.log("Withdrawing from source escrow...");
      await srcChainResolver.send(
        resolverContract.withdraw("src", srcEscrowAddress, secret, srcEvent[0])
      );
      console.log("Withdrawal from source complete.");

      // const orderHash = order.getOrderHash(config.chain.source.chainId);
      processed.push(orderHash);
      console.log(`Order processed: ${orderHash}`);
    }

    console.log("All orders processed successfully.");
    res.json({ processed });
  } catch (e) {
    console.error("Error processing orders:", e);
    res.status(500).send("Error processing orders");
  }
});

app.listen(PORT, () => {
  console.log(`Resolver API running at http://localhost:${PORT}`);
});
