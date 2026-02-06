// Next.js configuration for kiosk application
/** @type {import('next').NextConfig} */
const nextConfig = {
  // External packages for server components
  serverExternalPackages: ['@libsql/client', 'drizzle-orm', 'postgres'],

  experimental: {
    // Optimize for kiosk environment
    optimizePackageImports: ['@tailwindcss/forms', 'lucide-react'],
  },

  // Asset optimization for kiosk displays
  images: {
    formats: ['image/webp', 'image/avif'],
    deviceSizes: [768, 1024, 1280, 1920], // Common kiosk screen sizes
  },

  // Empty turbopack config to silence warning
  turbopack: {},

  // Security headers for public kiosk terminals
  async headers() {
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
            value: 'camera=(), microphone=(), geolocation=(), payment=()',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
