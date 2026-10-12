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
        // Pitchr FX PWA (converter + calculator) — bare /fx must serve the
        // static shell at /fx/index.html (Next 404s on static subpaths without
        // a trailing slash / explicit rewrite).
        { source: '/fx', destination: '/fx/index.html' },
        { source: '/fx/', destination: '/fx/index.html' },
        // Static marketing pages (public/*.html) at clean URLs. These never
        // touch /login or /client/* (the live system).
        { source: '/how-it-works', destination: '/how-it-works.html' },
        { source: '/pricing', destination: '/pricing.html' },
        { source: '/about', destination: '/about.html' },
        { source: '/faq', destination: '/faq.html' },
        { source: '/contact', destination: '/contact.html' },
        { source: '/projects', destination: '/projects.html' },
        { source: '/privacy-policy', destination: '/privacy.html' },
        { source: '/terms', destination: '/terms.html' },
      ],
    };
  },

  // Cache-control: HTML must revalidate every request so a deploy is never
  // masked by a stale cached page. Next's default `s-maxage=31536000` on
  // statically-prerendered pages (e.g. /login) makes browsers/CDNs hold the
  // OLD page for a year, which is exactly why the user must hard-refresh after
  // every rebuild. Override HTML responses to always revalidate; hashed JS/CSS
  // (/_next/static) keep long cache lives since they change per build.
  async headers() {
    return [
      {
        source: '/:path*',
        // Only touch HTML text responses — this header array applies broadly,
        // but the directives below are safe for documents. Static assets under
        // /_next are handled separately below.
        headers: [
          { key: 'Cache-Control', value: 'private, no-cache, no-store, max-age=0, must-revalidate' },
        ],
      },
      {
        // Hashed production assets: immutable, cache aggressively.
        source: '/_next/static/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
    ];
  },
};

module.exports = nextConfig;