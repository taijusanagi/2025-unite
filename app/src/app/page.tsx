"use client";
import React, { useState } from "react";
import { FaGithub } from "react-icons/fa";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { uint8ArrayToHex, UINT_256_MAX, UINT_40_MAX } from "@1inch/byte-utils";
import { randomBytes } from "crypto";

// Force to use the patched version
import * as Sdk from "@1inch/cross-chain-sdk";

import { Contract, parseEther, parseUnits } from "ethers";
import { useEthersSigner } from "@/hooks/useEthersSigner";
import IWETHContract from "@/lib/contracts/IWETH.json";
import { toast } from "react-toastify";
import { useChainId } from "wagmi";
import { Address } from "@1inch/cross-chain-sdk";
import { config } from "@/lib/config";
import { Resolver } from "@/lib/resolver";

export default function Home() {
  const [showDex, setShowDex] = useState(true);

  const coins = ["/coins/monad.png", "/coins/tron.png", "/coins/ton.png"];

  const chains = [
    { name: "Base Sepolia", symbol: "WETH", chainId: 84532 },
    { name: "Arbitrum Sepolia", symbol: "WETH", chainId: 421614 },
    { name: "Monad Testnet", symbol: "WMON", chainId: 10143 },
  ];

  const [fromChain, setFromChain] = useState(chains[0]);
  const [toChain, setToChain] = useState(chains[1]);

  const [amount, setAmount] = useState("0.001");
  const signer = useEthersSigner();
  const connectedChainId = useChainId();

  const createOrder = async () => {
    if (!signer) {
      console.error("Signer not defined");
      toast.error("Please connect your wallet first.");
      return;
    }
    if (connectedChainId !== fromChain.chainId) {
      console.error("Connected chain does not match fromChain");
      toast.error("Please switch to the from network.");
      return;
    }
    if (amount == "0") {
      console.error("Amount cannot be zero");
      toast.error("Amount must be greater than zero.");
      return;
    }
    if (Number(amount) > 0.001) {
      console.error("Amount exceeds maximum limit");
      toast.error("Amount cannot exceed 0.001 for sustainable demo.");
      return;
    }

    console.log("signer", signer);
    console.log("Sdk", Sdk);

    const srcChainId = fromChain.chainId;
    const dstChainId = toChain.chainId;
    console.log("srcChainId", srcChainId);
    console.log("dstChainId", dstChainId);

    const srcWrappedNativeTokenContract = new Contract(
      config[srcChainId].wrappedNative,
      IWETHContract.abi,
      signer
    );
    console.log("srcWrappedNativeTokenContract", srcWrappedNativeTokenContract);

    const secret = uint8ArrayToHex(randomBytes(32));
    console.log("secret", secret);

    const timestamp = BigInt(Math.floor(Date.now() / 1000));
    console.log("timestamp", timestamp);

    const balance = await srcWrappedNativeTokenContract.balanceOf(
      signer.address
    );
    console.log("balance", balance.toString());
    console.log(
      "balance < parseUnits(amount, 18)",
      balance < parseUnits(amount, 18)
    );

    if (balance < parseUnits(amount, 18)) {
      console.log("Insufficient balance, depositing...");
      await toast.promise(
        (async () => {
          const tx = await srcWrappedNativeTokenContract.deposit({
            value: parseUnits(amount, 18),
          });
          console.log("Deposit transaction sent:", tx.hash);
          return await tx.wait();
        })(),
        {
          pending: "Depositing native token...",
          success: "Deposit successful ✅",
          error: "Deposit failed ❌",
        }
      );
      console.log("Deposit successful");
    } else {
      console.log("Sufficient balance, no deposit needed");
    }

    const allowance = await srcWrappedNativeTokenContract.allowance(
      signer.address,
      config[srcChainId].limitOrderProtocol
    );
    console.log("allowance", allowance.toString());
    console.log("allowance < UINT_256_MAX", allowance < UINT_256_MAX);

    if (allowance < UINT_256_MAX) {
      console.log("Insufficient allowance, approving...");
      await toast.promise(
        (async () => {
          const tx = await srcWrappedNativeTokenContract.approve(
            config[srcChainId].limitOrderProtocol,
            UINT_256_MAX
          );
          console.log("Approval transaction sent:", tx.hash);
          return await tx.wait();
        })(),
        {
          pending: "Approving token allowance...",
          success: "Approval successful ✅",
          error: "Approval failed ❌",
        }
      );
      console.log("Approval successful");
    } else {
      console.log("Sufficient allowance, no approval needed");
    }

    const order = Sdk.CrossChainOrder.new(
      new Address(config[srcChainId].escrowFactory),
      {
        salt: Sdk.randBigInt(1000n),
        maker: new Address(signer.address),
        makingAmount: parseUnits(amount, 18),
        takingAmount: parseUnits(amount, 18),
        makerAsset: new Address(config[srcChainId].wrappedNative),
        takerAsset: new Address(config[dstChainId].wrappedNative),
      },
      {
        hashLock: Sdk.HashLock.forSingleFill(secret),
        timeLocks: Sdk.TimeLocks.new({
          srcWithdrawal: 10n, // 10sec finality lock for test
          srcPublicWithdrawal: 120n, // 2m for private withdrawal
          srcCancellation: 121n, // 1sec public withdrawal
          srcPublicCancellation: 122n, // 1sec private cancellation
          dstWithdrawal: 10n, // 10sec finality lock for test
          dstPublicWithdrawal: 100n, // 100sec private withdrawal
          dstCancellation: 101n, // 1sec public withdrawal
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
            address: new Address(config[srcChainId].resolver),
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

    const typedData = order.getTypedData(srcChainId);
    console.log("typedData", typedData);

    const signature = await toast.promise(
      signer.signTypedData(
        typedData.domain,
        { Order: typedData.types[typedData.primaryType] },
        typedData.message
      ),
      {
        pending: "Waiting for your signature...",
        success: "Signature successful ✅",
        error: "Signature rejected ❌",
      }
    );

    console.log("signature", signature);

    // This must be in backend, but for demo purposes we will send it to backend from app
    const hash = order.getOrderHash(srcChainId);
    // Prepare payload to send
    const res = await fetch("/relayer", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(
        // Pass chain ID for easy implementation for demo
        {
          hash,
          srcChainId,
          dstChainId,
          order: order.build(),
          extension: order.extension,
          signature,
        },
        (_, value) => (typeof value === "bigint" ? value.toString() : value)
      ),
    });

    const relayerData = await res.json();

    if (!res.ok) {
      console.error("Failed to store order:", relayerData.error);
      toast.error(`Failed to store order: ${relayerData.error}`);
      return;
    }

    console.log("Order stored successfully:", relayerData);

    const resolverRes = await fetch("/resolver", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ hash }),
    });

    const resolverData = await resolverRes.json();

    if (!resolverRes.ok) {
      console.error("Failed to resolve order:", resolverData.error);
      toast.error(`Resolve failed: ${resolverData.error}`);
      return;
    }

    console.log("Order processed successfully:", resolverData);

    const { dstEscrowAddress, srcEscrowAddress, dstImmutables, srcImmutables } =
      resolverData;

    console.log("Waiting for finality...");
    await new Promise((resolve) => setTimeout(resolve, 11000));

    console.log("Withdrawing from destination escrow...");
    const withdrawRes = await fetch("/relayer/withdraw", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        srcChainId,
        dstChainId,
        dstEscrowAddress,
        secret,
        dstImmutables,
      }),
    });

    const { error } = await withdrawRes.json();

    if (!withdrawRes.ok) {
      console.error("Withdraw route error:", error);
      toast.error(`Withdraw failed: ${error}`);
      return;
    }

    const resolverWithSecretRes = await fetch("/resolver", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ hash, secret, srcImmutables, srcEscrowAddress }),
    });

    const resolverWithSecretData = await resolverWithSecretRes.json();

    if (!resolverWithSecretRes.ok) {
      console.error(
        "Failed to withdraw from destination escrow:",
        resolverWithSecretData.error
      );
      toast.error(`Withdraw failed: ${resolverWithSecretData.error}`);
      return;
    }

    console.log(
      "Withdrawal from destination complete:",
      resolverWithSecretData
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-black to-gray-800 text-white flex flex-col">
      {/* 1. Header (Always Visible) */}
      <div className="flex justify-between items-center px-6 py-4">
        <div
          className="text-2xl font-bold text-blue-400 cursor-pointer"
          onClick={() => showDex && setShowDex(false)}
        >
          GattaiSwap
        </div>
        <ConnectButton chainStatus="icon" accountStatus="avatar" />
      </div>

      {/* 2. Hero */}
      {!showDex && (
        <div className="flex-grow flex items-center justify-center px-4">
          <div className="relative text-center max-w-3xl">
            {/* Background Glow */}
            <div className="absolute inset-0 z-0">
              <div className="w-full h-full bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-blue-600/20 via-blue-900/10 to-black"></div>
            </div>

            {/* Hero Content */}
            <div className="relative z-10">
              <div className="relative z-10 flex flex-col items-center text-center">
                {/* Main Image with title */}
                <div className="relative inline-block mx-auto">
                  <img
                    src="/icon.png"
                    alt="GattaiSwap Character"
                    className="max-w-xs md:max-w-sm rounded-xl"
                  />

                  {/* Title over image */}
                  <div className="absolute bottom-14 left-0 right-0 flex flex-col items-center text-center px-4">
                    <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight leading-tight bg-clip-text text-transparent bg-gradient-to-r from-blue-400 via-blue-50 to-blue-400 drop-shadow-lg">
                      GattaiSwap
                    </h1>
                  </div>

                  {/* Floating Coins */}
                  <div className="absolute bottom-0 left-0 right-0 flex flex-col items-center text-center">
                    <div className="flex flex-wrap justify-center gap-6">
                      {coins.map((src, i) => (
                        <img
                          key={i}
                          src={src}
                          alt={`coin-${i}`}
                          className={`w-10 h-10 object-contain`}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-4 text-center">
                <button
                  onClick={() => setShowDex(true)}
                  className="w-full max-w-xs mx-auto py-3 bg-gradient-to-r from-blue-600 to-cyan-500 hover:from-blue-700 hover:to-cyan-600 text-white font-semibold rounded-md transition-all text-base cursor-pointer"
                >
                  Start
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 3. Dex */}
      {showDex && (
        <div className="flex-grow flex items-center justify-center px-4 py-10">
          <div className="w-full max-w-md bg-gradient-to-br from-gray-800 via-gray-900 to-black border border-blue-900 shadow-xl p-6 rounded-xl space-y-6">
            <h2 className="text-lg font-semibold text-center text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-cyan-400">
              Swap with 1inch Fusion +
            </h2>

            {/* From Section */}
            <div className="space-y-2">
              <label className="block text-sm text-gray-300">From</label>
              <div className="flex space-x-2">
                <select
                  className="flex-1 px-3 py-2 rounded-md bg-gray-700 text-white border border-gray-600 focus:ring-2 focus:ring-blue-500 cursor-pointer"
                  value={fromChain.chainId}
                  onChange={(e) =>
                    setFromChain(
                      chains.find((c) => c.chainId === Number(e.target.value))!
                    )
                  }
                >
                  {chains.map((chain) => (
                    <option key={chain.chainId} value={chain.chainId}>
                      {chain.name}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  placeholder="Amount"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-24 px-3 py-2 rounded-md bg-gray-700 text-white border border-gray-600 focus:ring-2 focus:ring-blue-500 text-sm"
                />
              </div>
              <p className="text-xs text-gray-400 mt-1">
                Token: {fromChain.symbol}
              </p>
            </div>

            {/* To Section */}
            <div className="space-y-2">
              <label className="block text-sm text-gray-300">To</label>
              <div className="flex space-x-2">
                <select
                  className="flex-1 px-3 py-2 rounded-md bg-gray-700 text-white border border-gray-600 focus:ring-2 focus:ring-cyan-500 cursor-pointer"
                  value={toChain.chainId}
                  onChange={(e) =>
                    setToChain(
                      chains.find((c) => c.chainId === Number(e.target.value))!
                    )
                  }
                >
                  {chains.map((chain) => (
                    <option key={chain.chainId} value={chain.chainId}>
                      {chain.name}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  disabled
                  value={amount}
                  className="w-24 px-3 py-2 rounded-md bg-gray-700 text-gray-400 border border-gray-600 text-sm cursor-not-allowed"
                />
              </div>
              <p className="text-xs text-gray-400 mt-1">
                Token: {toChain.symbol}
              </p>
            </div>

            {/* Swap Button */}
            <button
              className="w-full py-3 mt-4 bg-gradient-to-r from-blue-600 to-cyan-500 hover:from-blue-700 hover:to-cyan-600 text-white font-semibold rounded-md transition-all text-base cursor-pointer"
              onClick={createOrder}
            >
              Create Order
            </button>
          </div>
        </div>
      )}

      {/* 4. Footer (Always Visible) */}
      <footer className="px-6 py-4 text-sm text-gray-400 flex items-center justify-end">
        <a
          href="https://github.com/taijusanagi/2025-unite"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center space-x-2 hover:text-white transition cursor-pointer"
        >
          <FaGithub className="w-5 h-5" />
        </a>
      </footer>
    </div>
  );
}
