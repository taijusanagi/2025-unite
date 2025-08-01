// app/api/resolver/orders/[hash]/process/route.ts

import { NextResponse } from "next/server";
import { JsonRpcProvider } from "ethers";
import * as Sdk from "@1inch/cross-chain-sdk";
import { config } from "@/lib/config";
import { Wallet } from "@sdk/evm/wallet";
import { Resolver } from "@sdk/evm/resolver";
import { EscrowFactory } from "@sdk/evm/escrow-factory";
import { Address } from "@1inch/cross-chain-sdk";

const privateKey = process.env.ETH_PRIVATE_KEY || "0x";

export async function POST(
  _req: Request,
  context: { params: Promise<{ hash: string }> }
) {
  try {
    const { hash } = await context.params;
    if (!hash) {
      return NextResponse.json({ error: "Missing hash" }, { status: 400 });
    }

    const response = await fetch(
      `${process.env.APP_URL}/api/relayer/orders/${hash}`
    );

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

    const srcProvider = new JsonRpcProvider(config[srcChainId].rpc, srcChainId);
    const dstProvider = new JsonRpcProvider(config[dstChainId].rpc, dstChainId);

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

    const fillAmount = order.makingAmount;
    console.log("Deploying source escrow contract...");
    const {
      txHash: srcDeployHash,
      blockHash: srcDeployBlock,
      blockTimestamp: srcDeployedAt,
    } = await srcResolverWallet.send(
      resolver.deploySrc(
        srcChainId,
        config[srcChainId].limitOrderProtocol,
        order,
        signature,
        Sdk.TakerTraits.default()
          .setExtension(order.extension)
          .setAmountMode(Sdk.AmountMode.maker)
          .setAmountThreshold(order.takingAmount),
        fillAmount
      )
    );
    console.log(
      `Source deployed at block hash: ${srcDeployHash}, timestamp: ${srcDeployedAt}`
    );

    console.log("Fetching source deployment event...");
    const srcEvent = await srcEscrowFactory.getSrcDeployEvent(srcDeployBlock);
    console.log("Source deployment event fetched.");

    console.log("Constructing destination escrow immutables...");
    const dstImmutables = srcEvent[0]
      .withComplement(srcEvent[1])
      .withTaker(new Address(resolver.dstAddress));

    console.log("Deploying destination escrow contract...");
    const { txHash: dstDeployHash, blockTimestamp: dstDeployedAt } =
      await dstResolverWallet.send(resolver.deployDst(dstImmutables));
    console.log(
      `Destination deployed at block hash: ${srcDeployHash}, timestamp: ${dstDeployedAt}`
    );
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
    ).getSrcEscrowAddress(srcEvent[0], await srcEscrowFactory.getSourceImpl());
    console.log(`Source escrow address: ${srcEscrowAddress}`);

    fetch(`${process.env.APP_URL}/api/relayer/orders/${hash}/escrow`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        srcEscrowAddress: srcEscrowAddress.toString(),
        dstEscrowAddress: dstEscrowAddress.toString(),
        srcImmutables: srcEvent[0].build(),
        dstImmutables: dstImmutables.withDeployedAt(dstDeployedAt).build(),
        srcDeployHash,
        dstDeployHash,
      }),
    });

    return NextResponse.json({
      success: true,
    });
  } catch (err) {
    console.error("Resolver error:", err);
    return NextResponse.json({ error: "Resolver failed" }, { status: 500 });
  }
}
