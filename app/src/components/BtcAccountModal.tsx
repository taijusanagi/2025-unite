"use client";
import React from "react";

interface BtcAccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  address: string;
  publicKey: string;
  onDisconnect: () => void;
}

const BtcAccountModal: React.FC<BtcAccountModalProps> = ({
  isOpen,
  onClose,
  address,
  publicKey,
  onDisconnect,
}) => {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md cursor-pointer"
      onClick={onClose}
    >
      <div
        className="bg-white text-black w-80 rounded-xl p-5 shadow-2xl relative cursor-default"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-2 right-3 text-gray-500 hover:text-black text-xl cursor-pointer"
        >
          &times;
        </button>

        {/* Icon & Address */}
        <div className="text-center mb-4">
          <img
            src="/coins/btc.png"
            alt="BTC"
            className="w-14 h-14 mx-auto rounded-full"
          />
        </div>

        {/* Full Address */}
        <div className="text-sm font-mono text-center break-all mb-4">
          {address}
        </div>

        {/* Buttons */}
        <div className="flex flex-col gap-2">
          <button
            onClick={() => navigator.clipboard.writeText(address)}
            className="w-full py-2 bg-gray-200 hover:bg-gray-300 rounded-md text-sm font-medium cursor-pointer"
          >
            Copy Address
          </button>
          <button
            onClick={() => navigator.clipboard.writeText(publicKey)}
            className="w-full py-2 bg-gray-200 hover:bg-gray-300 rounded-md text-sm font-medium cursor-pointer"
          >
            Copy Public Key
          </button>
          <button
            onClick={onDisconnect}
            className="w-full py-2 bg-red-500 hover:bg-red-600 text-white rounded-md text-sm font-medium cursor-pointer"
          >
            Disconnect
          </button>
        </div>
      </div>
    </div>
  );
};

export default BtcAccountModal;
