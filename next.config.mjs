/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['@anthropic-ai/sdk'],
  // HABU core is a workspace package shipped as TS source; Next transpiles it.
  transpilePackages: ['@habu/core'],
};

export default nextConfig;
