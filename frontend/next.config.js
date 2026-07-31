/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      // Supabase Storage (set NEXT_PUBLIC_SUPABASE_URL in your env)
      ...(process.env.NEXT_PUBLIC_SUPABASE_URL
        ? [
            {
              protocol: 'https',
              hostname: new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname,
              pathname: '/storage/v1/object/public/**',
            },
          ]
        : []),
      // Self-hosted backend uploads (development / Railway)
      {
        protocol: 'http',
        hostname: 'localhost',
        port: '3001',
        pathname: '/uploads/**',
      },
      // Production backend domain — set NEXT_PUBLIC_API_HOST to your Railway/Render domain
      ...(process.env.NEXT_PUBLIC_API_HOST
        ? [
            {
              protocol: 'https',
              hostname: process.env.NEXT_PUBLIC_API_HOST,
              pathname: '/uploads/**',
            },
          ]
        : []),
    ],
  },
};

module.exports = nextConfig;
