// Next.js configuration for kiosk application
/** @type {import('next').NextConfig} */
const nextConfig = {
  // External packages for server components
  serverExternalPackages: ['@libsql/client', 'drizzle-orm', 'postgres'],

  // Include any future migrations in the Vercel serverless bundle
  outputFileTracingIncludes: {
    '/': ['./migrations/**/*'],
  },

  experimental: {
    // Optimize for kiosk environment
    optimizePackageImports: ['@tailwindcss/forms', 'lucide-react'],
  },

  // Asset optimization for kiosk displays
  images: {
    formats: ['image/webp', 'image/avif'],
    deviceSizes: [768, 1024, 1280, 1920], // Common kiosk screen sizes
  },

  turbopack: {},

  // Security headers for public kiosk terminals
  async headers() {
    const isDev = process.env.NODE_ENV === 'development';

    // Determine IQPro domain based on env (sandbox vs production)
    // Both are included so the same build works in preview and production
    const iqproDomains = 'https://sandbox.api.basyspro.com https://api.basyspro.com';
    // Square's SDK host differs per environment and an org's environment is only
    // known at request time, so BOTH are listed — this header is built once.
    const squareCdnDomains = 'https://sandbox.web.squarecdn.com https://web.squarecdn.com';
    const squareApiDomains = 'https://pci-connect.squareupsandbox.com https://pci-connect.squareup.com';

    // CSP for TokenEx + IQPro iframe scripts, and Square's Web Payments SDK.
    // default-src 'self' means anything omitted here is denied.
    const csp = [
      `default-src 'self'`,
      `script-src 'self' 'unsafe-inline' ${iqproDomains} ${squareCdnDomains}`,
      `frame-src ${iqproDomains} https://*.tokenex.com ${squareCdnDomains}`,
      `connect-src 'self' ${iqproDomains} ${squareApiDomains}`,
      `style-src 'self' 'unsafe-inline' ${squareCdnDomains}`,
      `img-src 'self' data: https:`,
      // Square's docs list two external font hosts. We do NOT add them on spec:
      // the card widget renders in its own iframe and falls back to system
      // fonts. Add them only if the sandbox check shows the form is broken.
      `font-src 'self'`,
      // In dev, skip upgrade-insecure-requests to avoid breaking TokenEx postMessage on http://localhost
      ...(!isDev ? [`upgrade-insecure-requests`] : []),
    ].join('; ');

    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
          // HSTS: enforce HTTPS for 1 year in production
          ...(!isDev
            ? [{
                key: 'Strict-Transport-Security',
                value: 'max-age=31536000; includeSubDomains',
              }]
            : []),
          {
            key: 'Content-Security-Policy',
            value: csp,
          },
        ],
      },
    ];
  },
};

export default nextConfig;
