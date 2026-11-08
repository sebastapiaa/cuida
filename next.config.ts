import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  // The record PDFs are read from disk at runtime (ingested at boot). Make sure every
  // serverless function bundle on Vercel ships them.
  outputFileTracingIncludes: {
    "/**": ["./records/**/*"],
  },
};

export default nextConfig;
