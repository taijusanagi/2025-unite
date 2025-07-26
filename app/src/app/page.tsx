import React from "react";

export default function HeroSection() {
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
          <button className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-2xl text-lg shadow-lg transition-all duration-300">
            Start
          </button>
        </div>
      </div>
    </div>
  );
}
