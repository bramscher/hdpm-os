/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['@anthropic-ai/sdk'],
  outputFileTracingIncludes: {
    '/admin/habu-demo/forms/[form]': ['./app/admin/habu-demo/reference-forms/*.pdf'],
  },
};

export default nextConfig;
