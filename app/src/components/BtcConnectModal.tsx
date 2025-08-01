// components/BtcConnectModal.tsx

import React, { useState } from "react";

interface BtcConnectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConnect: (privateKey: string) => void;
}

const BtcConnectModal: React.FC<BtcConnectModalProps> = ({
  isOpen,
  onClose,
  onConnect,
}) => {
  const [privateKey, setPrivateKey] = useState("");

  if (!isOpen) return null;

  const handleConnect = () => {
    if (privateKey.trim()) {
      onConnect(privateKey.trim());
    } else {
      alert("Private key cannot be empty.");
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-75 flex justify-center items-center z-50">
      <div className="bg-gray-800 border border-slate-700 rounded-lg p-6 w-full max-w-md m-4">
        <h2 className="text-xl font-bold text-white mb-4">
          Connect Bitcoin Wallet (Testnet3)
        </h2>

        <div
          className="bg-red-900 border border-red-500 text-red-200 px-4 py-3 rounded-md mb-4"
          role="alert"
        >
          <strong className="font-bold">⚠️ WARNING!</strong>
          <span className="block sm:inline ml-2">For Testnet3 ONLY.</span>
          <p className="text-sm mt-1">
            Never enter your mainnet private key. This method is highly insecure
            and stores your key in your browser's local storage. Use only for
            testing purposes.
          </p>
        </div>

        <div className="mb-4">
          <label
            htmlFor="privateKey"
            className="block text-sm font-medium text-gray-300 mb-2"
          >
            Enter Your Testnet3 Private Key (WIF)
          </label>
          <input
            type="password"
            id="privateKey"
            value={privateKey}
            onChange={(e) => setPrivateKey(e.target.value)}
            className="w-full px-3 py-2 bg-gray-700 text-white border border-gray-600 rounded-md focus:ring-2 focus:ring-blue-500"
            placeholder="Your WIF format private key"
          />
        </div>

        <div className="flex justify-end space-x-4">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700"
          >
            Cancel
          </button>
          <button
            onClick={handleConnect}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
          >
            Connect
          </button>
        </div>
      </div>
    </div>
  );
};

export default BtcConnectModal;
