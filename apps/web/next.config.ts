import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@mandate/types", "@mandate/config"],
};

export default nextConfig;
