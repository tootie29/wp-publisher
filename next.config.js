const path = require('path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Disable parallel build workers — shared cPanel hosting (CloudLinux LVE)
  // limits the number of processes a user can spawn, which causes EAGAIN
  // during the static generation phase. Single-threaded build is slower but
  // reliable.
  experimental: {
    serverActions: {
      allowedOrigins: ['localhost:3030', 'wp-publisher.entrsolutions.com'],
    },
    serverComponentsExternalPackages: ['better-sqlite3'],
    cpus: 1,
    workerThreads: false,
  },
  webpack(config) {
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      '@': path.resolve(__dirname),
    };
    return config;
  },
};
module.exports = nextConfig;
