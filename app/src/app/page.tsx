"use client";
import React, { useState } from "react";
import { FaGithub } from "react-icons/fa";

import { ConnectButton } from "@rainbow-me/rainbowkit";

export default function Home() {
  const [showDex, setShowDex] = useState(false);

  const coins = ["/coins/monad.png", "/coins/tron.png", "/coins/ton.png"];

  const chains = [
    { name: "Base Sepolia", symbol: "ETH", chainId: 84532 },
    { name: "Arbitrum Sepolia", symbol: "ETH", chainId: 421614 },
    { name: "Monad Testnet", symbol: "MON", chainId: 10143 },
  ];

  const [fromChain, setFromChain] = useState(chains[0]);
  const [toChain, setToChain] = useState(chains[1]);

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
        <ConnectButton />
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
                      {chain.name} ({chain.symbol})
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  placeholder="Amount"
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
                      {chain.name} ({chain.symbol})
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  disabled
                  placeholder="Estimated"
                  className="w-24 px-3 py-2 rounded-md bg-gray-700 text-gray-400 border border-gray-600 text-sm cursor-not-allowed"
                />
              </div>
              <p className="text-xs text-gray-400 mt-1">
                Token: {toChain.symbol}
              </p>
            </div>

            {/* Swap Button */}
            <button className="w-full py-3 mt-4 bg-gradient-to-r from-blue-600 to-cyan-500 hover:from-blue-700 hover:to-cyan-600 text-white font-semibold rounded-md transition-all text-base cursor-pointer">
              Swap Now
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
