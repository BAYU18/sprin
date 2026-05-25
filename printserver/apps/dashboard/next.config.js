/** @type {import('next').NextConfig} */

const nextConfig = {
  // Output standalone untuk Docker multi-stage build
  output: 'standalone',

  // Transpile packages
  transpilePackages: [],

  // Environment variables untuk client-side
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
    NEXT_PUBLIC_WS_URL: process.env.NEXT_PUBLIC_WS_URL,
  },

  // Rewrites untuk proxy API requests ke backend
  async rewrites() {
    const apiUrl = process.env.API_PUBLIC_URL || 'http://localhost:3000';

    return [
      {
        source: '/api/:path*',
        destination: `${apiUrl}/api/:path*`,
      },
    ];
  },

  // Security headers
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'X-Frame-Options',
            value: 'SAMEORIGIN',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
        ],
      },
    ];
  },

  // Experimental features
  experimental: {
    // Enable server actions
    serverActions: {
      allowedOrigins: ['localhost:3001'],
    },
  },
};

module.exports = nextConfig;