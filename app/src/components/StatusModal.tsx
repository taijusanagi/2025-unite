// components/StatusModal.tsx
"use client";
import React, { useEffect, useRef } from "react";

export type StatusState = "loading" | "done" | "failed" | "idle";

// The Status interface now includes an optional explorerUrl
export interface Status {
  text: string;
  state: StatusState;
  explorerUrl?: string;
}

interface StatusModalProps {
  isOpen: boolean;
  onClose: () => void;
  statuses: Status[];
  title: string;
}

const StatusIcon = ({ state }: { state: StatusState }) => {
  const baseClasses =
    "w-6 h-6 rounded-full flex items-center justify-center z-10";
  switch (state) {
    case "loading":
      return (
        <div className={`${baseClasses} bg-gray-700`}>
          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-400"></div>
        </div>
      );
    case "done":
      return (
        <div className={`${baseClasses} bg-green-500/20 text-green-400`}>✓</div>
      );
    case "failed":
      return (
        <div className={`${baseClasses} bg-red-500/20 text-red-400`}>✗</div>
      );
    default:
      return (
        <div className={`${baseClasses} bg-gray-700`}>
          <div className="w-2 h-2 bg-gray-500 rounded-full"></div>
        </div>
      );
  }
};

const StatusModal: React.FC<StatusModalProps> = ({
  isOpen,
  onClose,
  statuses,
  title,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Auto-scroll to the bottom when statuses change
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [statuses]);

  if (!isOpen) return null;

  const isComplete = statuses.every((s) => s.state !== "loading");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-70 backdrop-blur-sm">
      <div className="bg-gray-800 border border-blue-900/50 rounded-lg shadow-xl w-full max-w-md p-6 m-4 flex flex-col">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold text-white">{title}</h2>
          {isComplete && (
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-white text-2xl"
            >
              &times;
            </button>
          )}
        </div>
        <div
          ref={scrollRef}
          className="space-y-1 max-h-[60vh] overflow-y-auto scrollbar-thin scrollbar-thumb-gray-700 scrollbar-track-gray-900 pr-3 -mr-3"
        >
          {statuses.map((status, index) => (
            <div key={index} className="flex">
              {/* Timeline Graphic */}
              <div className="flex flex-col items-center mr-4">
                <StatusIcon state={status.state} />
                {index < statuses.length - 1 && (
                  <div className="w-px flex-grow bg-gray-600" />
                )}
              </div>
              {/* Status Text and Link */}
              <div className="pb-6 pt-0.5">
                <p className="text-gray-200">{status.text}</p>
                {status.explorerUrl && (
                  <a
                    href={status.explorerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-400 hover:underline mt-1 inline-flex items-center gap-1"
                  >
                    View Transaction ↗
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
        {isComplete && (
          <div className="mt-6 text-center border-t border-gray-700 pt-4">
            <button
              onClick={onClose}
              className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 font-semibold"
            >
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default StatusModal;
