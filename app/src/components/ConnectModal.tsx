// components/ConnectModal.tsx
"use client";
import React from "react";

interface ConnectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConnectEVM: () => void;
  onConnectBTC: () => void;
  onConnectGattai: () => void;
}

const ConnectModal: React.FC<ConnectModalProps> = ({
  isOpen,
  onClose,
  onConnectEVM,
  onConnectBTC,
  onConnectGattai,
}) => {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-60 cursor-pointer"
      onClick={onClose}
    >
      <div
        className="bg-gray-900 p-6 rounded-xl w-96 text-white space-y-6 relative cursor-default border border-blue-900/50 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Section 1: Chain Abstraction */}
        <div className="space-y-3 border-b border-gray-700 pb-4">
          <h3 className="text-lg font-semibold text-center text-gray-300">
            Try Chain Abstraction
          </h3>
          <button
            onClick={onConnectGattai}
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
            onClick={onConnectEVM}
            className="w-full py-2 bg-blue-600 rounded-md hover:bg-blue-700 transition cursor-pointer font-semibold"
          >
            EVM Wallet
          </button>

          <button
            onClick={onConnectBTC}
            className="w-full py-2 bg-yellow-600 rounded-md hover:bg-yellow-700 transition cursor-pointer font-semibold"
          >
            BTC Wallet
          </button>
        </div>

        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-2 right-3 text-gray-400 hover:text-white text-xl cursor-pointer"
        >
          &times;
        </button>
      </div>
    </div>
  );
};

export default ConnectModal;
