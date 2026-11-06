/** @type {import('next').NextConfig} */
const nextConfig = {
  // @ask-away/shared used to resolve only through workspace symlinks, which do
  // not exist in Vercel's isolated build, so type errors were ignored wholesale.
  // tsconfig.json now maps the package to ../shared explicitly, so the build can
  // type-check for real again.
  // ESLint was never actually installed, so `ignoreDuringBuilds` was hiding the
  // absence of linting rather than a backlog of warnings. It runs in the build
  // now: errors fail the build, remaining warnings are advisory.

  // Sentry ships tracing, replay and debug machinery in its browser bundle and
  // decides at runtime whether to use them. All three are off in
  // sentry.client.config.ts, so these flags let the bundler drop the code
  // instead of shipping it to every phone. Without them Sentry added ~79 kB to
  // the shared First Load JS, roughly doubling it.
  webpack(config, { webpack }) {
    config.plugins.push(
      new webpack.DefinePlugin({
        __SENTRY_DEBUG__: false,
        __SENTRY_TRACING__: false,
        __RRWEB_EXCLUDE_IFRAME__: true,
        __RRWEB_EXCLUDE_SHADOW_DOM__: true,
        __SENTRY_EXCLUDE_REPLAY_WORKER__: true,
      }),
    );
    return config;
  },

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

const { withSentryConfig } = require('@sentry/nextjs');

// Wrapped unconditionally — withSentryConfig is a no-op for uploads without
// SENTRY_AUTH_TOKEN, so a build with no Sentry credentials behaves exactly as
// it did before. Source map upload turns itself on once the token is set.
module.exports = withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,

  // Quiet, now that uploads are known to work.
  //
  // This was false for one build on purpose. `silent: true` hides the upload
  // step entirely — including its failures — so a build that uploads nothing
  // and a build that fails to upload look identical from the outside, which is
  // how source maps stayed missing without anyone noticing. If maps ever stop
  // arriving, set this to false and read the build log before changing
  // anything else.
  silent: true,

  // Strip the injected source map comments so the maps are uploaded to Sentry
  // but not served to the public — readable stack traces for us, not for
  // whoever opens devtools on the marketing page.
  hideSourceMaps: true,

  // No tunnelRoute. It was set to '/monitoring' so an ad blocker cutting off
  // sentry.io could not take error reporting with it — but the route was never
  // generated, and the bundle still pointed every event at it. Deployed, that
  // meant Sentry captured errors correctly and POSTed all of them to a 404:
  // strictly worse than the problem it was added for, and silent, because a
  // failed send is exactly what error reporting cannot report.
  //
  // Events go straight to ingest.us.sentry.io now. Some ad blockers will drop
  // them; all of them arrived nowhere before.

  // sentry.client.config.ts is the right filename on Next 14. The SDK warns
  // about instrumentation-client.ts, which is a Next 15 / Turbopack
  // convention and is not picked up here.
  webpack: {
    treeshake: {
      // Drops the SDK's own debug logging from the browser bundle.
      removeDebugLogging: true,
    },
  },
});
