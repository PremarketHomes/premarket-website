import { withSentryConfig } from "@sentry/nextjs";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Enable compression
  compress: true,

  // Exclude pdfkit from webpack bundling (it uses fs.readFileSync for fonts)
  serverExternalPackages: ['pdfkit'],

  // The shareable property card route renders text via sharp's native
  // text mode using an explicit bundled font file (see
  // src/app/api/services/propertyCardRenderer.js). sharp/libvips opens
  // that file from native code, which Vercel's automatic file tracing
  // can miss since it only sees plain JS import/fs calls — this makes
  // sure the font files are always included in the deployed function.
  outputFileTracingIncludes: {
    '/api/reports/property-card': ['./src/app/api/services/fonts/**'],
  },

  // Optimize images
  images: {
    formats: ['image/avif', 'image/webp'],
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'premarketvideos.b-cdn.net',
      },
      {
        protocol: 'https',
        hostname: 'premarket.homes',
      },
      {
        protocol: 'https',
        hostname: 'www.airtasker.com',
      },
      {
        protocol: 'https',
        hostname: 'firebasestorage.googleapis.com',
      },
    ],
  },

  // Generate metadata for all pages
  async headers() {
    return [
      {
        source: '/rex-embed/:path*',
        headers: [
          {
            key: 'X-Frame-Options',
            value: 'ALLOWALL',
          },
          {
            key: 'Content-Security-Policy',
            value: "frame-ancestors 'self' *.rexsoftware.com",
          },
        ],
      },
      {
        source: '/:path*',
        headers: [
          {
            key: 'X-DNS-Prefetch-Control',
            value: 'on'
          },
          {
            key: 'X-Frame-Options',
            value: 'SAMEORIGIN'
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff'
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin'
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()'
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload'
          },
        ],
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  silent: true,
  hideSourceMaps: true,
});
