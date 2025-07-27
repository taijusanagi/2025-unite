// app/api/resolve/route.ts
import { NextResponse } from "next/server";
import { Wallet, Contract, parseEther, JsonRpcProvider } from "ethers";
import { config } from "@/lib/config";

import IWETHContract from "@/lib/contracts/IWETH.json";
import ResolverContract from "@/lib/contracts/Resolver.json";
import { UINT_256_MAX } from "@1inch/byte-utils";

const privateKey = process.env.PRIVATE_KEY || "0x";

export async function GET() {
  const depositAmount = parseEther("0.01");

  const results: Record<string, string> = {};

  for (const [chainIdStr, chain] of Object.entries(config)) {
    const chainId = Number(chainIdStr);
    const label = `chain:${chainId}`;

    try {
      const provider = new JsonRpcProvider(chain.url);
      const wallet = new Wallet(privateKey, provider);

      const WETH = new Contract(chain.wrappedNative, IWETHContract.abi, wallet);
      const Resolver = new Contract(
        chain.resolver,
        ResolverContract.abi,
        wallet
      );

      const resolverETHBalance = await provider.getBalance(chain.resolver);
      if (resolverETHBalance < depositAmount) {
        const tx = await wallet.sendTransaction({
          to: chain.resolver,
          value: depositAmount,
        });
        await tx.wait();
      }

      const resolverWETHBalance = await WETH.balanceOf(chain.resolver);
      if (resolverWETHBalance < depositAmount) {
        const depositTx = await WETH.deposit({ value: depositAmount });
        await depositTx.wait();

        const transferTx = await WETH.transfer(chain.resolver, depositAmount);
        await transferTx.wait();
      }

      const resolverWETHAllowance = await WETH.allowance(
        chain.resolver,
        chain.escrowFactory
      );
      if (resolverWETHAllowance < UINT_256_MAX) {
        const approveData = WETH.interface.encodeFunctionData("approve", [
          chain.escrowFactory,
          UINT_256_MAX,
        ]);
        const tx = await Resolver.arbitraryCalls(
          [chain.wrappedNative],
          [approveData]
        );
        await tx.wait();
      }
      results[label] = "Success";
    } catch (err: any) {
      console.error(`Error on ${label}:`, err.message);
      results[label] = `Error: ${err.message}`;
    }
  }

  return NextResponse.json(results);
}
