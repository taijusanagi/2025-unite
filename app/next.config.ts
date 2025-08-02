import type { NextConfig } from "next";

const CopyPlugin = require("copy-webpack-plugin");
const path = require("path");

const nextConfig: NextConfig = {
  /* config options here */
  eslint: {
    ignoreDuringBuilds: true,
  },
  webpack(config, { isServer }) {
    config.experiments = {
      ...config.experiments,
      asyncWebAssembly: true,
    };
    if (!isServer) {
      config.resolve.fallback = {
        fs: false,
      };
      config.plugins.push(
        new CopyPlugin({
          patterns: [
            {
              from: path.resolve(
                __dirname,
                "node_modules/tiny-secp256k1/lib/secp256k1.wasm"
              ),
              to: path.resolve(__dirname, ".next/server/secp256k1.wasm"),
            },
          ],
        })
      );
    }
    config.module.rules.push({
      test: /\.wasm$/,
      type: "asset/resource",
    });
    return config;
  },
};

export default nextConfig;
