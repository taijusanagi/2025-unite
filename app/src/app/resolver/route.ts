import { NextResponse } from "next/server";
import { JsonRpcProvider } from "ethers";
import * as Sdk from "@1inch/cross-chain-sdk";
import { config } from "@/lib/config";
import { Wallet } from "@/lib/wallet";
import { Resolver } from "@/lib/resolver";
import { EscrowFactory } from "@/lib/escrow-factory";
import { Address } from "@1inch/cross-chain-sdk";

const privateKey = process.env.PRIVATE_KEY || "0x";

export async function POST(req: Request) {
  try {
    const { hash, secret, srcImmutables, srcEscrowAddress } = await req.json();
    if (!hash) {
      return NextResponse.json({ error: "Missing hash" }, { status: 400 });
    }

    const relayerUrl = `http://localhost:3000/relayer/${hash}`;
    const response = await fetch(relayerUrl);

    if (!response.ok) {
      return NextResponse.json(
        { error: "Order not found in relayer" },
        { status: 404 }
      );
    }

    const {
      srcChainId,
      dstChainId,
      order: _order,
      extension,
      signature,
    } = await response.json();
    const order = Sdk.CrossChainOrder.fromDataAndExtension(_order, extension);
    console.log("srcChainId", srcChainId);
    console.log("dstChainId", dstChainId);
    console.log("order", order);

    const srcProvider = new JsonRpcProvider(config[srcChainId].url, srcChainId);
    const dstProvider = new JsonRpcProvider(config[dstChainId].url, dstChainId);

    const srcResolverWallet = new Wallet(privateKey, srcProvider);
    const dstResolverWallet = new Wallet(privateKey, dstProvider);

    const srcEscrowFactory = new EscrowFactory(
      srcResolverWallet.provider,
      config[srcChainId].escrowFactory
    );
    const dstEscrowFactory = new EscrowFactory(
      dstResolverWallet.provider,
      config[dstChainId].escrowFactory
    );

    const resolver = new Resolver(
      config[srcChainId].resolver,
      config[dstChainId].resolver
    );

    if (!secret || !srcImmutables) {
      const fillAmount = order.makingAmount;
      console.log("Deploying source escrow contract...");
      const { blockHash: srcDeployBlock } = await srcResolverWallet.send(
        resolver.deploySrc(
          srcChainId,
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

      console.log("Fetching source deployment event...");
      const srcEvent = await srcEscrowFactory.getSrcDeployEvent(srcDeployBlock);
      console.log("Source deployment event fetched.");

      console.log("Constructing destination escrow immutables...");
      const dstImmutables = srcEvent[0]
        .withComplement(srcEvent[1])
        .withTaker(new Address(resolver.dstAddress));

      console.log("Deploying destination escrow contract...");
      const { blockTimestamp: dstDeployedAt } = await dstResolverWallet.send(
        resolver.deployDst(dstImmutables)
      );
      console.log(`Destination deployed at timestamp: ${dstDeployedAt}`);

      console.log("Calculating destination escrow address...");
      const dstEscrowAddress = new Sdk.EscrowFactory(
        new Address(config[dstChainId].escrowFactory)
      ).getDstEscrowAddress(
        srcEvent[0],
        srcEvent[1],
        dstDeployedAt,
        new Address(resolver.dstAddress),
        await dstEscrowFactory.getDestinationImpl()
      );
      console.log(`Destination escrow address: ${dstEscrowAddress}`);

      console.log("Calculating source escrow address...");
      const srcEscrowAddress = new Sdk.EscrowFactory(
        new Address(config[srcChainId].escrowFactory)
      ).getSrcEscrowAddress(
        srcEvent[0],
        await srcEscrowFactory.getSourceImpl()
      );
      console.log(`Source escrow address: ${srcEscrowAddress}`);

      return NextResponse.json({
        success: true,
        dstEscrowAddress: dstEscrowAddress.toString(),
        srcEscrowAddress: srcEscrowAddress.toString(),
        dstImmutables: dstImmutables.withDeployedAt(dstDeployedAt).build(),
        srcImmutables: srcEvent[0].build(),
      });
    } else {
      console.log("Withdrawing from source escrow...");
      await srcResolverWallet.send(
        resolver.withdraw("src", srcEscrowAddress, secret, srcImmutables)
      );
      console.log("Withdrawal from source complete.");
      return NextResponse.json({ success: true });
    }
  } catch (err) {
    console.error("Resolver error:", err);
    return NextResponse.json({ error: "Resolver failed" }, { status: 500 });
  }
}
