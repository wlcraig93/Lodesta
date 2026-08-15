/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  trailingSlash: true,
  outputFileTracingExcludes: {
    "*": [".data/**", ".design/**"]
  },
  outputFileTracingIncludes: {
    "*": ["./packages/site-agent/reference-boards/**"]
  },
  serverExternalPackages: [
    "postcss",
    "postcss-value-parser",
    "typescript"
  ],
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com"
      }
    ]
  }
};

export default nextConfig;
