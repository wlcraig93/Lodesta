/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  trailingSlash: true,
  async redirects() {
    // The public bot disclosure moved from /crawler to /bot; external links still point at /crawler.
    return [{ source: "/crawler", destination: "/bot/", permanent: true }];
  },
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
