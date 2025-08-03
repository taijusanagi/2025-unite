// components/ConnectGattaiModal.tsx
import React, { useState } from "react";

interface ConnectGattaiModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConnect: (url: string) => void;
}

const ConnectGattaiModal: React.FC<ConnectGattaiModalProps> = ({
  isOpen,
  onClose,
  onConnect,
}) => {
  const [url, setUrl] = useState("");

  if (!isOpen) return null;

  const handleConnect = () => {
    if (url.trim()) onConnect(url.trim());
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md cursor-pointer"
      onClick={onClose}
    >
      <div
        className="bg-slate-900/80 p-6 rounded-xl w-96 text-white space-y-6 relative cursor-default border border-slate-700 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-xl font-bold text-center text-gray-300">
          Connect Gattai Wallet
        </h2>
        <div className="space-y-2">
          <label className="block text-sm font-medium text-gray-300">
            Gattai Wallet URL
          </label>
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://agent.example.com"
            className="w-full px-3 py-2 bg-gray-700 text-white border border-gray-600 rounded-md focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <button
          onClick={handleConnect}
          className="w-full py-2 bg-gradient-to-r from-blue-600 to-cyan-500 hover:from-blue-700 hover:to-cyan-600 text-white font-semibold rounded-md transition text-base cursor-pointer"
        >
          Connect
        </button>
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

export default ConnectGattaiModal;
