/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Node-only packages used by the API; load them from node_modules at runtime instead of bundling.
  serverExternalPackages: ['pg', 'nodemailer', 'bcryptjs', 'jsonwebtoken'],
};

export default nextConfig;
