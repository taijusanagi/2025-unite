// app/page.tsx
"use client";
import React, { useEffect, useState } from "react";
import { FaGithub } from "react-icons/fa";
import { ConnectButton, useConnectModal } from "@rainbow-me/rainbowkit";
import { uint8ArrayToHex, UINT_256_MAX, UINT_40_MAX } from "@1inch/byte-utils";
import { randomBytes } from "crypto";
import * as Sdk from "@1inch/cross-chain-sdk";
import { Contract, parseEther } from "ethers";
import { useEthersSigner } from "@/hooks/useEthersSigner";
import IWETHContract from "@/lib/contracts/IWETH.json";
import { useAccount, useChainId } from "wagmi";
import { Address } from "@1inch/cross-chain-sdk";
import { config } from "@/lib/config";
import StatusModal, { Status, StatusState } from "@/components/StatusModal"; // Make sure the path is correct

export default function Home() {
  const [showDex, setShowDex] = useState(true);
  const [showConnectModal, setShowConnectModal] = useState(false);
  const { openConnectModal } = useConnectModal();
  const coins = ["/coins/monad.png", "/coins/btc.png"];
  const chains = [
    { name: "Base Sepolia", symbol: "WETH", chainId: 84532, unit: "wei" },
    { name: "Monad Testnet", symbol: "WMON", chainId: 10143, unit: "wei" },
    {
      name: "Bitcoin Testnet 3",
      symbol: "BTC",
      chainId: 99999,
      unit: "satoshi",
    },
  ];

  const [fromChain, setFromChain] = useState(chains[0]);
  const [toChain, setToChain] = useState(chains[1]);

  const [amount] = useState(10000);
  const signer = useEthersSigner();
  const connectedChainId = useChainId();
  const { address: evmConnectedAddress } = useAccount();

  // State for the status modal
  const [isStatusModalOpen, setIsStatusModalOpen] = useState(false);
  const [statuses, setStatuses] = useState<Status[]>([]);

  useEffect(() => {
    if (evmConnectedAddress && showConnectModal) {
      setShowConnectModal(false);
    }
  }, [evmConnectedAddress, showConnectModal]);

  const createOrder = async () => {
    if (!signer) {
      alert("Please connect your wallet first.");
      return;
    }
    if (connectedChainId !== fromChain.chainId) {
      alert("Please switch to the 'From' network in your wallet.");
      return;
    }

    // Open modal and prepare status helpers
    setIsStatusModalOpen(true);
    let currentStatuses: Status[] = [];

    const addStatus = (text: string) => {
      currentStatuses = [...currentStatuses, { text, state: "loading" }];
      setStatuses(currentStatuses);
    };

    const updateLastStatus = (state: StatusState, explorerUrl?: string) => {
      if (currentStatuses.length === 0) return;
      const lastStatus = currentStatuses[currentStatuses.length - 1];
      currentStatuses = [
        ...currentStatuses.slice(0, -1),
        { ...lastStatus, state, explorerUrl },
      ];
      setStatuses(currentStatuses);
    };

    const addFinalStatus = (text: string, state: StatusState) => {
      currentStatuses = [...currentStatuses, { text, state }];
      setStatuses(currentStatuses);
    };

    try {
      // Clear previous statuses
      setStatuses([]);
      const srcChainId = fromChain.chainId;
      const dstChainId = toChain.chainId;
      const srcWrappedNativeTokenContract = new Contract(
        config[srcChainId].wrappedNative,
        IWETHContract.abi,
        signer
      );

      // 1. Balance Check
      addStatus("Checking token balance");
      const balance = await srcWrappedNativeTokenContract.balanceOf(
        signer.address
      );
      updateLastStatus("done");

      if (balance < amount) {
        addStatus("Depositing native token");
        const tx = await srcWrappedNativeTokenContract.deposit({
          value: amount,
        });
        const receipt = await tx.wait();
        // Dummy URL, adjust for other chains as needed
        const url = `https://sepolia.basescan.org/tx/${receipt.hash}`;
        updateLastStatus("done", url);
      }

      // 2. Allowance Check
      addStatus("Checking token allowance");
      const allowance = await srcWrappedNativeTokenContract.allowance(
        signer.address,
        config[srcChainId].limitOrderProtocol
      );
      updateLastStatus("done");

      if (allowance < UINT_256_MAX) {
        addStatus("Approving token allowance");
        const tx = await srcWrappedNativeTokenContract.approve(
          config[srcChainId].limitOrderProtocol,
          UINT_256_MAX
        );
        const receipt = await tx.wait();
        const url = `https://sepolia.basescan.org/tx/${receipt.hash}`;
        updateLastStatus("done", url);
      }

      // 3. Sign Order
      addStatus("Sign the order in your wallet");
      // ... Order creation logic ...
      const secret = uint8ArrayToHex(randomBytes(32));
      const timestamp = BigInt(Math.floor(Date.now() / 1000));
      const order = Sdk.CrossChainOrder.new(
        new Address(config[srcChainId].escrowFactory),
        {
          salt: Sdk.randBigInt(1000n),
          maker: new Address(signer.address),
          makingAmount: BigInt(amount),
          takingAmount: BigInt(amount),
          makerAsset: new Address(config[srcChainId].wrappedNative),
          takerAsset: new Address(config[dstChainId].wrappedNative),
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
      const typedData = order.getTypedData(srcChainId);
      const signature = await signer.signTypedData(
        typedData.domain,
        { Order: typedData.types[typedData.primaryType] },
        typedData.message
      );
      updateLastStatus("done");

      // 4. Share signature
      addStatus("Sharing signature with relayer");
      const hash = order.getOrderHash(srcChainId);
      const res = await fetch("/relayer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
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
      if (!res.ok) throw new Error("Failed to share signature with relayer");
      updateLastStatus("done");

      // 5. Wait for escrows
      addStatus("Waiting for escrows to be created by resolver");
      const resolverRes = await fetch("/resolver", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hash }),
      });
      const resolverData = await resolverRes.json();
      if (!resolverRes.ok)
        throw new Error(`Resolver failed: ${resolverData.error}`);
      updateLastStatus("done");

      // 6. Wait for finality
      addStatus("Waiting for on-chain finality");
      await new Promise((resolve) => setTimeout(resolve, 11000));
      updateLastStatus("done");

      // 7. Withdrawing
      addStatus("Withdrawing assets");
      const {
        dstEscrowAddress,
        srcEscrowAddress,
        dstImmutables,
        srcImmutables,
      } = resolverData;
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
      if (!withdrawRes.ok)
        throw new Error("Withdrawal from destination failed");

      const resolverWithSecretRes = await fetch("/resolver", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hash, secret, srcImmutables, srcEscrowAddress }),
      });
      if (!resolverWithSecretRes.ok)
        throw new Error(`Finalizing withdrawal failed`);
      updateLastStatus("done");

      // 8. Done!
      addFinalStatus("Swap Complete! 🎉", "done");
    } catch (error: any) {
      console.error("An error occurred:", error);
      updateLastStatus("failed");
      addFinalStatus(error.message || "An unknown error occurred", "failed");
    }
  };

  return (
    <>
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-black to-gray-800 text-white flex flex-col">
        {/* Your existing JSX for header, hero, dex, etc. remains here */}
        {/* ... */}
        {/* 1. Header (Always Visible) */}
        <div className="flex justify-between items-center px-6 py-4">
          <div
            className="text-2xl font-bold text-blue-400 cursor-pointer"
            onClick={() => showDex && setShowDex(false)}
          >
            GattaiSwap
          </div>
          {evmConnectedAddress ? (
            <ConnectButton chainStatus={"icon"} accountStatus={"avatar"} />
          ) : (
            <button
              onClick={() => setShowConnectModal(true)}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 cursor-pointer font-semibold"
            >
              Connect
            </button>
          )}
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
                        chains.find(
                          (c) => c.chainId === Number(e.target.value)
                        )!
                      )
                    }
                  >
                    {chains.map((chain) => (
                      <option key={chain.chainId} value={chain.chainId}>
                        {chain.name} ({chain.symbol})
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    value={amount}
                    disabled
                    className="w-18 px-3 py-2 rounded-md bg-gray-700 text-gray-400 border border-gray-600 text-sm cursor-not-allowed"
                  />
                </div>
                <p className="text-xs text-red-400 mt-1">
                  * Amount is fixed to 10000 {fromChain.unit} to keep the demo
                  easier.
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
                        chains.find(
                          (c) => c.chainId === Number(e.target.value)
                        )!
                      )
                    }
                  >
                    {chains.map((chain) => (
                      <option key={chain.chainId} value={chain.chainId}>
                        {chain.name} ({chain.symbol})
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    disabled
                    value={amount}
                    className="w-18 px-3 py-2 rounded-md bg-gray-700 text-gray-400 border border-gray-600 text-sm cursor-not-allowed"
                  />
                </div>
                <p className="text-xs text-red-400 mt-1">
                  * You will receive the same amount in {toChain.unit}. Price
                  oracle is disabled to keep the demo easier.
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
      {showConnectModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-60 cursor-pointer"
          onClick={() => setShowConnectModal(false)}
        >
          <div
            className="bg-gray-900 p-6 rounded-xl w-96 text-white space-y-6 relative cursor-default"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Section 1: Chain Abstraction */}
            <div className="space-y-3 border-b border-gray-700 pb-4">
              <h3 className="text-lg font-semibold text-center text-gray-300">
                Try Chain Abstraction
              </h3>
              <button
                onClick={() => {}}
                className="w-full py-2 bg-gradient-to-r from-blue-600 to-cyan-500 hover:from-blue-700 hover:to-cyan-600 text-white font-semibold rounded-md transition-all text-base cursor-pointer"
              >
                Gattai Wallet
              </button>
            </div>

            {/* Section 2: Specific Wallet Connect */}
            <div className="space-y-3">
              <h3 className="text-lg font-semibold text-center text-gray-300">
                Connect Wallet on Specific Chain
              </h3>

              <button
                onClick={openConnectModal}
                className="w-full py-2 bg-blue-600 rounded-md hover:bg-blue-700 transition cursor-pointer font-semibold"
              >
                EVM Wallet
              </button>

              <button
                onClick={() => {}}
                className="w-full py-2 bg-yellow-600 rounded-md hover:bg-yellow-700 transition cursor-pointer font-semibold"
              >
                BTC Wallet
              </button>
            </div>

            {/* Close Button */}
            <button
              onClick={() => setShowConnectModal(false)}
              className="absolute top-2 right-3 text-gray-400 hover:text-white text-xl cursor-pointer"
            >
              &times;
            </button>
          </div>
        </div>
      )}
      <StatusModal
        isOpen={isStatusModalOpen}
        onClose={() => setIsStatusModalOpen(false)}
        statuses={statuses}
        title="Swap in Progress..."
        fromChainName={fromChain.name}
        toChainName={toChain.name}
        fromAmount={amount.toString()}
        toAmount={amount.toString()}
        fromSymbol={fromChain.unit}
        toSymbol={toChain.unit}
      />
    </>
  );
}
