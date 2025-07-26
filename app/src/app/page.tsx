"use client";

import React, { useState } from "react";

export default function Home() {
  const [showDex, setShowDex] = useState(false);

  if (showDex) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-black to-gray-800 text-white flex flex-col">
        {/* Header */}
        <div className="flex justify-between items-center px-6 py-4 border-b border-blue-800 bg-black/30 backdrop-blur-md">
          <div
            className="text-2xl font-bold text-blue-400 cursor-pointer"
            onClick={() => setShowDex(false)}
          >
            GogetaDex
          </div>
          <button className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-semibold transition cursor-pointer">
            Connect Wallet
          </button>
        </div>

        {/* Dex Swap UI - Centered */}
        <div className="flex-grow flex items-center justify-center px-4 py-10">
          <div className="w-full max-w-md bg-gradient-to-br from-gray-800 via-gray-900 to-black border border-blue-900 shadow-xl p-6 rounded-xl space-y-6">
            <h2 className="text-lg font-semibold text-center text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-cyan-400">
              Crosschain Swap with 1inch Fusion +
            </h2>

            {/* From Section */}
            <div className="space-y-2">
              <label className="block text-sm text-gray-300">From</label>
              <div className="flex space-x-2">
                <select className="flex-1 px-3 py-2 rounded-md bg-gray-700 text-white border border-gray-600 focus:ring-2 focus:ring-blue-500 cursor-pointer">
                  <option>Ethereum</option>
                  <option>BNB Chain</option>
                  <option>Polygon</option>
                </select>
                <input
                  type="number"
                  placeholder="Amount"
                  className="w-24 px-3 py-2 rounded-md bg-gray-700 text-white border border-gray-600 focus:ring-2 focus:ring-blue-500 text-sm"
                />
              </div>
              <p className="text-xs text-gray-400 mt-1">
                Token: Auto-selected per chain
              </p>
            </div>

            {/* Swap Arrow */}
            <div className="text-center">
              <div className="inline-block p-2 rounded-md bg-blue-600/30">
                <svg
                  className="w-5 h-5 text-blue-400"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2.5}
                  viewBox="0 0 24 24"
                >
                  <path d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </div>

            {/* To Section */}
            <div className="space-y-2">
              <label className="block text-sm text-gray-300">To</label>
              <div className="flex space-x-2">
                <select className="flex-1 px-3 py-2 rounded-md bg-gray-700 text-white border border-gray-600 focus:ring-2 focus:ring-cyan-500 cursor-pointer">
                  <option>Polygon</option>
                  <option>BNB Chain</option>
                  <option>Ethereum</option>
                </select>
                <input
                  type="text"
                  disabled
                  placeholder="Estimated"
                  className="w-24 px-3 py-2 rounded-md bg-gray-700 text-gray-400 border border-gray-600 text-sm cursor-not-allowed"
                />
              </div>
              <p className="text-xs text-gray-400 mt-1">
                Token: Auto-selected per chain
              </p>
            </div>

            {/* Swap Button */}
            <button className="w-full py-3 mt-4 bg-gradient-to-r from-blue-600 to-cyan-500 hover:from-blue-700 hover:to-cyan-600 text-white font-semibold rounded-md transition-all text-base cursor-pointer">
              Swap Now
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Hero screen
  return (
    <div className="relative min-h-screen bg-gradient-to-br from-gray-900 via-black to-gray-800 flex items-center justify-center text-white px-6">
      {/* Background Glow */}
      <div className="absolute inset-0 z-0">
        <div className="w-full h-full bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-blue-600/20 via-blue-900/10 to-black"></div>
      </div>

      {/* Main Content */}
      <div className="relative z-10 text-center max-w-3xl">
        <img
          src="/character-top.png"
          alt="DexGogeta Character"
          className="mx-auto mb-6 max-w-xs md:max-w-sm drop-shadow-[0_0_30px_rgba(59,130,246,0.7)] rounded-xl"
        />
        <h1 className="text-3xl md:text-5xl font-extrabold tracking-tight leading-tight bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-cyan-500">
          DexGogeta
        </h1>
        <p className="text-lg md:text-xl text-gray-300 font-medium">
          Fusion unleashed. Chains united.
        </p>

        <div className="mt-4">
          <button
            onClick={() => setShowDex(true)}
            className="w-full max-w-xs mx-auto py-3 mt-4 bg-gradient-to-r from-blue-600 to-cyan-500 hover:from-blue-700 hover:to-cyan-600 text-white font-semibold rounded-md transition-all text-base cursor-pointer"
          >
            Start
          </button>
        </div>
      </div>
    </div>
  );
}
