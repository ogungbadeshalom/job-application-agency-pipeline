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
    return {
      // beforeFiles: the root MUST serve the static landing (public/index.html)
      // instead of the app/page.tsx route, so / is the canonical, crawlable
      // homepage with no redirect. The middleware gate (logged-in -> workspace)
      // runs before this, so anonymous visitors reach the landing here.
      beforeFiles: [
        { source: '/', destination: '/index.html' },
        { source: '/index.html', destination: '/index.html' },
      ],
      afterFiles: [
        // Static marketing pages (public/*.html) at clean URLs. These never
        // touch /login or /client/* (the live system).
        { source: '/how-it-works', destination: '/how-it-works.html' },
        { source: '/pricing', destination: '/pricing.html' },
        { source: '/about', destination: '/about.html' },
        { source: '/faq', destination: '/faq.html' },
        { source: '/contact', destination: '/contact.html' },
        { source: '/privacy-policy', destination: '/privacy.html' },
        { source: '/terms', destination: '/terms.html' },
      ],
    };
  },
};

module.exports = nextConfig;