// app/page.tsx
"use client";
import React, { useEffect, useState } from "react";
import { FaGithub } from "react-icons/fa";
import { ConnectButton, useConnectModal } from "@rainbow-me/rainbowkit";
import { uint8ArrayToHex, UINT_256_MAX, UINT_40_MAX } from "@1inch/byte-utils";
import { randomBytes } from "crypto";
import { Contract, keccak256 } from "ethers";
import { useEthersSigner } from "@/hooks/useEthersSigner";
import { useAccount, useChainId } from "wagmi";

import { config } from "@/lib/config";
import StatusModal, { Status, StatusState } from "@/components/StatusModal";
import ConnectModal from "@/components/ConnectModal";
import BtcConnectModal from "@/components/BtcConnectModal"; // Import the new BTC modal
import BtcAccountModal from "@/components/BtcAccountModal";

import Sdk from "@sdk/evm/cross-chain-sdk-shims";
import {
  dummySrcChainId,
  dummyDstChainId,
  nativeTokenAddress,
} from "@sdk/evm/constants";
import { patchedDomain, getOrderHashWithPatch } from "@sdk/evm/patch";
import IWETHContract from "@sdk/evm/contracts/IWETH.json";

import {
  addressToEthAddressFormat,
  BtcProvider,
  createDstHtlcScript,
  publicKeyToAddress,
} from "@sdk/btc";

import * as bitcoin from "bitcoinjs-lib";
import ECPairFactory from "ecpair";
import * as ecc from "tiny-secp256k1";

import { walletFromWIF, BtcWallet } from "@sdk/btc";

const ECPair = ECPairFactory(ecc);
const { Address } = Sdk;

export default function Home() {
  const [showDex, setShowDex] = useState(true);
  const { openConnectModal } = useConnectModal();
  const coins = ["/coins/monad.png", "/coins/btc.png"];
  const chains = Object.entries(config).map(([chainId, cfg]) => ({
    chainId: Number(chainId),
    type: cfg.type,
    name: cfg.name,
    symbol: cfg.symbol,
    unit: cfg.unit,
    exproler: cfg.explorer,
  }));

  const [fromChain, setFromChain] = useState(chains[1]);
  const [toChain, setToChain] = useState(chains[0]);
  const [amount] = useState(5000);

  const evmsigner = useEthersSigner();
  const connectedChainId = useChainId();
  const { address: evmConnectedAddress } = useAccount();

  // State for BTC connection
  const [btcUser, setBtcUser] = useState<BtcWallet | null>(null);

  // State for the modals
  const [isStatusModalOpen, setIsStatusModalOpen] = useState(false);
  const [isConnectModalOpen, setIsConnectModalOpen] = useState(false);
  const [isBtcConnectModalOpen, setIsBtcConnectModalOpen] = useState(false);
  const [isBtcAccountModalOpen, setIsBtcAccountModalOpen] = useState(false);
  const [statuses, setStatuses] = useState<Status[]>([]);

  // Check for saved BTC private key on mount
  useEffect(() => {
    const savedKey = localStorage.getItem("btcPrivateKey");
    if (savedKey) {
      try {
        const network = bitcoin.networks.testnet;
        const wallet = walletFromWIF(savedKey, network);
        setBtcUser(wallet);
      } catch (error) {
        console.error("Failed to load/validate BTC private key:", error);
        localStorage.removeItem("btcPrivateKey");
        setBtcUser(null);
      }
    }
  }, []);

  // Renamed from handleConnectEVM
  const evmConnectWallet = () => {
    if (openConnectModal) {
      openConnectModal();
    }
  };

  // Handler for opening the BTC private key modal
  const btcConnectWallet = () => {
    setIsConnectModalOpen(false); // Close the general connect modal
    setIsBtcConnectModalOpen(true); // Open the specific BTC modal
  };

  // Handler for saving the BTC private key from the modal
  const handleBtcConnect = (privateKey: string) => {
    try {
      const network = bitcoin.networks.testnet;
      const wallet = walletFromWIF(privateKey, network);

      localStorage.setItem("btcPrivateKey", privateKey);
      setBtcUser(wallet);
      setIsBtcConnectModalOpen(false);
    } catch (e) {
      console.error(e);
      alert(
        "Invalid Bitcoin Testnet private key (WIF format). Please check and try again."
      );
      localStorage.removeItem("btcPrivateKey");
      setBtcUser(null);
    }
  };

  const createOrder = async () => {
    console.log("🔄 Starting order creation...");

    if (fromChain.chainId === toChain.chainId) {
      console.warn("⚠️ Source and destination networks are the same.");
      alert("The source and destination networks must be different.");
      return;
    }

    if (fromChain.type === "evm" && !evmsigner) {
      console.warn("⚠️ EVM signer not connected.");
      alert("Please connect your EVM wallet to place an order.");
      evmConnectWallet();
      return;
    }

    if (fromChain.type === "evm" && connectedChainId !== fromChain.chainId) {
      console.warn("⚠️ Wrong EVM chain selected.");
      alert("Please switch to the 'From' network in your wallet.");
      return;
    }

    if (fromChain.type === "btc" && !btcUser) {
      console.warn("⚠️ BTC user not connected for source chain.");
      alert("Please connect your BTC wallet to place an order.");
      btcConnectWallet();
      return;
    }

    if (toChain.type === "btc" && !btcUser) {
      console.warn("⚠️ BTC user not connected for destination chain.");
      alert("Please connect your BTC wallet when destination is BTC.");
      btcConnectWallet();
      return;
    }

    console.log("✅ All pre-checks passed.");
    setIsStatusModalOpen(true);
    let currentStatuses: Status[] = [];

    const addStatus = (text: string) => {
      console.log(`📌 Status: ${text}`);
      currentStatuses = [...currentStatuses, { text, state: "loading" }];
      setStatuses(currentStatuses);
    };

    const updateLastStatus = (state: StatusState, explorers?: any[]) => {
      const last = currentStatuses[currentStatuses.length - 1];
      console.log(`✅ Updated last status to '${state}':`, last?.text);
      currentStatuses = [
        ...currentStatuses.slice(0, -1),
        { ...last, state, explorers },
      ];
      setStatuses(currentStatuses);
    };

    const addFinalStatus = (text: string, state: StatusState) => {
      console.log(`🏁 Final Status (${state}): ${text}`);
      currentStatuses = [...currentStatuses, { text, state }];
      setStatuses(currentStatuses);
    };

    try {
      console.log("🚧 Order preparation started...");
      setStatuses([]);

      const srcChainId = fromChain.chainId;
      const dstChainId = toChain.chainId;

      if (config[srcChainId].type === "evm") {
        const srcWrappedNativeTokenContract = new Contract(
          config[srcChainId].wrappedNative!,
          IWETHContract.abi,
          evmsigner!
        );

        addStatus("Checking token balance");
        const balance = await srcWrappedNativeTokenContract.balanceOf(
          evmsigner!.address
        );
        console.log("💰 Token balance:", balance.toString());
        updateLastStatus("done");

        if (balance < amount) {
          addStatus("Depositing native token");
          const tx = await srcWrappedNativeTokenContract.deposit({
            value: amount,
          });
          console.log("📤 Deposit TX:", tx.hash);
          await tx.wait();
          updateLastStatus("done", [
            {
              explorerUrl: `${fromChain.exproler}/tx/${tx.hash}`,
              network: fromChain.name,
            },
          ]);
        }

        addStatus("Checking token allowance");
        const allowance = await srcWrappedNativeTokenContract.allowance(
          evmsigner!.address,
          config[srcChainId].limitOrderProtocol
        );
        console.log("🔓 Token allowance:", allowance.toString());
        updateLastStatus("done");

        if (allowance < UINT_256_MAX) {
          addStatus("Approving token allowance");
          const tx = await srcWrappedNativeTokenContract.approve(
            config[srcChainId].limitOrderProtocol,
            UINT_256_MAX
          );
          console.log("✍️ Approve TX:", tx.hash);
          await tx.wait();
          updateLastStatus("done", [
            {
              explorerUrl: `${fromChain.exproler}/tx/${tx.hash}`,
              network: fromChain.name,
            },
          ]);
        }
      }

      addStatus("Sign the order in your wallet");
      const secret = randomBytes(32);
      const hashLock = {
        keccak256: Sdk.HashLock.forSingleFill(uint8ArrayToHex(secret)),
        sha256: bitcoin.crypto.sha256(secret),
      };
      console.log("🔐 Hash lock created", hashLock);

      const timestamp = BigInt(Math.floor(Date.now() / 1000));
      let takerAsset = new Address(nativeTokenAddress);
      if (config[dstChainId].type === "evm") {
        takerAsset = new Address(config[dstChainId].wrappedNative!);
      }

      const order = Sdk.CrossChainOrder.new(
        new Address(config[srcChainId].escrowFactory),
        {
          salt: Sdk.randBigInt(1000n),
          maker: new Address(evmsigner!.address),
          makingAmount: BigInt(amount),
          takingAmount: BigInt(amount),
          makerAsset: new Address(config[srcChainId].wrappedNative!),
          takerAsset,
        },
        {
          hashLock: hashLock.keccak256,
          timeLocks: Sdk.TimeLocks.new({
            srcWithdrawal: 10n,
            srcPublicWithdrawal: 120n,
            srcCancellation: 121n,
            srcPublicCancellation: 122n,
            dstWithdrawal: 10n,
            dstPublicWithdrawal: 100n,
            dstCancellation: 101n,
          }),
          srcChainId: dummySrcChainId,
          dstChainId: dummyDstChainId,
          srcSafetyDeposit: 0n,
          dstSafetyDeposit: 0n,
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
              address: new Address(config[srcChainId].resolver!),
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

      console.log("📦 Order constructed:", order);
      order.inner.fusionExtension.srcChainId = srcChainId;
      order.inner.fusionExtension.dstChainId = dstChainId;
      order.inner.inner.takerAsset = new Address(config[srcChainId].trueERC20!);

      let signature = "";
      if (config[dstChainId].type === "btc") {
        order.inner.inner.receiver = new Address(
          addressToEthAddressFormat(btcUser!.address)
        );
      }

      if (config[srcChainId].type !== "btc") {
        const typedData = order.getTypedData(srcChainId);
        console.log("📝 Signing typed data:", typedData);
        signature = await evmsigner!.signTypedData(
          {
            chainId: srcChainId,
            ...patchedDomain,
            verifyingContract: config[srcChainId].limitOrderProtocol,
          },
          { Order: typedData.types[typedData.primaryType] },
          typedData.message
        );
      }

      updateLastStatus("done");

      addStatus("Submitting order to relayer");
      const hash = getOrderHashWithPatch(srcChainId, order, {
        ...patchedDomain,
        verifyingContract: config[srcChainId].limitOrderProtocol!,
      });

      console.log("📡 Order hash:", hash);

      const res = await fetch("/api/relayer/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          {
            hash,
            hashLock: {
              sha256: hashLock.sha256.toString("hex"),
            },
            srcChainId,
            dstChainId,
            order: order.build(),
            extension: order.extension,
            signature,
            btcUserPublicKey: btcUser!.publicKey.toString("hex"),
          },
          (_, v) => (typeof v === "bigint" ? v.toString() : v)
        ),
      });

      if (!res.ok) throw new Error("Failed to submit order");
      console.log("📨 Order submitted to relayer");
      updateLastStatus("done");

      addStatus("Waiting for escrow creation");
      while (true) {
        const statusRes = await fetch(`/api/relayer/orders/${hash}/status`);
        const statusJson = await statusRes.json();
        if (statusJson.status === "escrow_created") {
          console.log("🏗️ Escrow created:", statusJson);
          await new Promise((r) => setTimeout(r, 10000));
          updateLastStatus("done", [
            {
              explorerUrl: `${fromChain.exproler}/tx/${statusJson.srcDeployHash}`,
              network: fromChain.name,
            },
            {
              explorerUrl: `${toChain.exproler}/tx/${statusJson.dstDeployHash}`,
              network: toChain.name,
            },
          ]);
          break;
        }
        await new Promise((r) => setTimeout(r, 3000));
      }

      if (config[dstChainId].type === "btc") {
        console.log("🔁 Starting BTC claim flow");
        const dstWithdrawParamsRes = await fetch(
          `/api/relayer/orders/${hash}/btc/dst-withdraw-params`
        );
        if (!dstWithdrawParamsRes.ok)
          throw new Error("Failed to fetch BTC withdraw params");

        const dstWithdrawParamsJson = await dstWithdrawParamsRes.json();
        console.log("📬 BTC withdraw params:", dstWithdrawParamsJson);

        const network = bitcoin.networks.testnet;
        const btcProvider = new BtcProvider(config[99999].rpc);
        const rawTxHex = await btcProvider.getRawTransactionHex(
          dstWithdrawParamsJson.dstEscrowAddress
        );

        const dstTimeLocks = Sdk.TimeLocks.fromBigInt(
          BigInt(dstWithdrawParamsJson.dstImmutables.timelocks)
        ).toDstTimeLocks();

        const spendPsbt = new bitcoin.Psbt({ network });
        console.log(
          "dstWithdrawParamsJson.htlcScript",
          dstWithdrawParamsJson.htlcScript
        );
        const htlcScript = Buffer.from(dstWithdrawParamsJson.htlcScript, "hex");
        spendPsbt.setLocktime(Number(dstTimeLocks.privateWithdrawal));
        spendPsbt.addInput({
          hash: dstWithdrawParamsJson.dstEscrowAddress,
          index: 0,
          nonWitnessUtxo: Buffer.from(rawTxHex, "hex"),
          redeemScript: htlcScript,
          sequence: 0xfffffffe,
        });

        const redeemFee = 1000;
        const redeemValue =
          dstWithdrawParamsJson.dstImmutables.amount - redeemFee;
        if (redeemValue <= 0) {
          console.error("❌ Not enough value to redeem HTLC.");
          return;
        }

        spendPsbt.addOutput({
          address: btcUser!.address,
          value: redeemValue,
        });

        spendPsbt.signInput(0, {
          publicKey: btcUser!.publicKey,
          sign: (hash) => Buffer.from(btcUser!.keyPair.sign(hash)),
        });

        spendPsbt.finalizeInput(0, (_: number, input: any) => {
          const signature = input.partialSig[0].signature;
          const unlockingScript = bitcoin.script.compile([
            signature,
            secret,
            bitcoin.opcodes.OP_TRUE,
          ]);

          const payment = bitcoin.payments.p2sh({
            redeem: {
              input: unlockingScript,
              output: htlcScript,
            },
          });

          return {
            finalScriptSig: payment.input,
            finalScriptWitness: undefined,
          };
        });

        const finalTxHex = spendPsbt.extractTransaction().toHex();
        const finalTxId = await btcProvider.broadcastTx(finalTxHex);

        console.log("🎉 Maker successfully claimed BTC from HTLC!");
        console.log("✅ Redemption TXID:", finalTxId);
      }

      addStatus("Submitting secret");
      const secretRes = await fetch(`/api/relayer/orders/${hash}/secret`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: uint8ArrayToHex(secret) }),
      });
      if (!secretRes.ok) throw new Error("Failed to share secret");
      updateLastStatus("done");

      addStatus("Waiting for withdrawal to complete");
      while (true) {
        const statusRes = await fetch(`/api/relayer/orders/${hash}/status`);
        const statusJson = await statusRes.json();
        if (statusJson.status === "withdraw_completed") {
          console.log("✅ Withdrawal complete:", statusJson);
          updateLastStatus("done", [
            {
              explorerUrl: `${fromChain.exproler}/tx/${statusJson.srcWithdrawHash}`,
              network: fromChain.name,
            },
            {
              explorerUrl: `${toChain.exproler}/tx/${statusJson.dstWithdrawHash}`,
              network: toChain.name,
            },
          ]);
          break;
        }
        await new Promise((r) => setTimeout(r, 3000));
      }

      addFinalStatus("Swap Complete! 🎉", "done");
      console.log("✅ Order process completed.");
    } catch (error: any) {
      console.error("❌ Error in createOrder:", error);
      updateLastStatus("failed");
      addFinalStatus(error.message || "An unknown error occurred", "failed");
    }
  };

  return (
    <>
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-black to-gray-800 text-white flex flex-col">
        {/* Header */}
        <div className="flex justify-end md:justify-between items-center px-4 py-4">
          <div
            className="hidden md:block text-2xl font-bold text-blue-400 cursor-pointer"
            onClick={() => showDex && setShowDex(false)}
          >
            GattaiSwap
          </div>
          <div className="flex items-center gap-4">
            {/* Show EVM wallet if connected */}
            {evmsigner && (
              <ConnectButton
                chainStatus="icon"
                accountStatus="avatar"
                showBalance={false}
              />
            )}

            {/* Show BTC wallet if connected */}
            {btcUser && (
              <div>
                <button
                  onClick={() => setIsBtcAccountModalOpen(true)}
                  className="px-4 py-2 bg-gray-800 border border-gray-600 rounded-md text-white hover:bg-gray-700 cursor-pointer font-mono"
                >
                  {btcUser.address.slice(0, 6)}...
                  {btcUser.address.slice(-4)}
                </button>
              </div>
            )}

            {/* Show a connect button if EITHER wallet is not connected */}
            {(!evmsigner || !btcUser) && (
              <button
                onClick={() => setIsConnectModalOpen(true)}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 cursor-pointer font-semibold"
              >
                Connect
              </button>
            )}
          </div>
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
                    onChange={(e) => {
                      const selected = chains.find(
                        (c) => c.chainId === Number(e.target.value)
                      );
                      setFromChain(selected!);
                    }}
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
                <p className="text-xs text-blue-200 mt-1">
                  * Amount is fixed to {amount} {fromChain.unit} to keep the
                  demo easier.
                </p>
              </div>
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
                <p className="text-xs text-blue-200 mt-1">
                  * You will receive the same amount in {toChain.unit}.
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

      {/* MODALS */}
      <ConnectModal
        isOpen={isConnectModalOpen}
        onClose={() => setIsConnectModalOpen(false)}
        onConnectEVM={evmConnectWallet}
        onConnectBTC={btcConnectWallet}
        onConnectGattai={() =>
          alert("Gattai Wallet connection not implemented yet.")
        }
        isEvmConnected={!!evmsigner}
        isBtcConnected={!!btcUser}
      />
      <BtcConnectModal
        isOpen={isBtcConnectModalOpen}
        onClose={() => setIsBtcConnectModalOpen(false)}
        onConnect={handleBtcConnect}
      />
      <BtcAccountModal
        isOpen={isBtcAccountModalOpen}
        onClose={() => setIsBtcAccountModalOpen(false)}
        address={btcUser?.address || ""}
        publicKey={btcUser?.publicKey.toString("hex") || ""}
        onDisconnect={() => {
          localStorage.removeItem("btcPrivateKey");
          setBtcUser(null);
          setIsBtcAccountModalOpen(false);
        }}
      />
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
