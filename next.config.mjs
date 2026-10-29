/** @type {import('next').NextConfig} */
const nextConfig = {
  // Keep verification builds separate from an already running developer server.
  distDir: process.env.HOTEL_VERIFY_DIST === '1' ? '.next-hotel-check' : '.next',
  experimental: {
    // The CMS accepts videos up to 50 MB. Allow a little extra room for the
    // multipart/form-data envelope so middleware does not truncate uploads.
    proxyClientMaxBodySize: '55mb',
    // ~300 routes on webpack blew the default ~4 GB heap during `next build`.
    webpackMemoryOptimizations: true,
  },
  images: {
    unoptimized: true,
    remotePatterns: [],
  },
  async rewrites() {
    return [
      // Uploaded images (UPLOADS_DIR) via media route — /uploads/menu/*.jpg in prod.
      {
        source: '/uploads/:path*',
        destination: '/api/media/:path*',
      },
    ];
  },
};

export default nextConfig;
