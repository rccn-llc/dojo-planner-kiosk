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

    // CSP for TokenEx + IQPro iframe scripts
    const csp = [
      `default-src 'self'`,
      `script-src 'self' 'unsafe-inline' ${iqproDomains}`,
      `frame-src ${iqproDomains} https://*.tokenex.com`,
      `connect-src 'self' ${iqproDomains}`,
      `style-src 'self' 'unsafe-inline'`,
      `img-src 'self' data: https:`,
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
