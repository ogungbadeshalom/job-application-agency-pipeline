/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Required on Next.js 14 for instrumentation.ts (auto-refill scheduler +
    // unhandledRejection/uncaughtException handlers) to actually load at boot.
    instrumentationHook: true,
    serverComponentsExternalPackages: ['pdf-parse', 'mammoth', 'pg', 'bcryptjs'],
  },
  async rewrites() {
    return [
      // Static marketing pages (public/*.html) at clean URLs. These never touch
      // /login or /client/* (the live system). Root "/" stays handled by
      // app/page.tsx which preserves the logged-in -> workspace redirect.
      { source: '/how-it-works', destination: '/how-it-works.html' },
      { source: '/pricing', destination: '/pricing.html' },
      { source: '/about', destination: '/about.html' },
      { source: '/faq', destination: '/faq.html' },
      { source: '/contact', destination: '/contact.html' },
      { source: '/privacy-policy', destination: '/privacy.html' },
      { source: '/terms', destination: '/terms.html' },
    ];
  },
};

module.exports = nextConfig;
