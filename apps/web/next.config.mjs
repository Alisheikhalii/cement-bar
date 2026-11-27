// @ts-check
const isDev = process.env.NODE_ENV !== 'production';
const apiOrigin = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';

/**
 * CSP decision: Next.js App Router injects inline bootstrap scripts. Nonce-based CSP would force every
 * page to be dynamically rendered (middleware + headers()), so we accept 'unsafe-inline' for scripts and
 * rely on: no third-party origins, React auto-escaping, no dangerouslySetInnerHTML. Recorded in
 * docs/DECISIONS.md (open question). 'unsafe-eval' is dev-only (React Refresh).
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self'${isDev ? ' ws: wss:' : ''}`,
  "manifest-src 'self'",
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Standalone output is for the Linux Docker image. On Windows dev machines, tracing copies pnpm
  // symlinks and fails with EPERM unless Developer Mode is on, so it is skipped there
  // (override with NEXT_STANDALONE=1).
  output: process.platform !== 'win32' || process.env.NEXT_STANDALONE === '1' ? 'standalone' : undefined,
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@cb/ui'],
  // Lint runs separately (`pnpm lint`, root flat config without the Next plugin).
  eslint: { ignoreDuringBuilds: true },
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiOrigin}/api/:path*` }];
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
