/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Required on Next.js 14 for instrumentation.ts (auto-refill scheduler +
    // unhandledRejection/uncaughtException handlers) to actually load at boot.
    instrumentationHook: true,
    serverComponentsExternalPackages: ['pdf-parse', 'mammoth', 'pg', 'bcryptjs'],
  },
};

module.exports = nextConfig;
