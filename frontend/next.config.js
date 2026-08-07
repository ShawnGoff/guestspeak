/** @type {import('next').NextConfig} */
const nextConfig = {
  // @ask-away/shared used to resolve only through workspace symlinks, which do
  // not exist in Vercel's isolated build, so type errors were ignored wholesale.
  // tsconfig.json now maps the package to ../shared explicitly, so the build can
  // type-check for real again.
  // ESLint was never actually installed, so `ignoreDuringBuilds` was hiding the
  // absence of linting rather than a backlog of warnings. It runs in the build
  // now: errors fail the build, remaining warnings are advisory.

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'geolocation=(self), camera=(), microphone=()' },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
        ],
      },
    ];
  },
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
