import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Dev server binds 0.0.0.0; browsers use 127.0.0.1 — allow both for /_next + fetch.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};

export default nextConfig;
