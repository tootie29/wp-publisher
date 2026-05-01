/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: { allowedOrigins: ['localhost:3030'] },
    serverComponentsExternalPackages: ['better-sqlite3'],
  },
};
module.exports = nextConfig;
