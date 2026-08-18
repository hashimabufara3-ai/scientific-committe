import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  redirects: async () => [
    {
      source: "/",
      destination: "/ar",
      permanent: false,
    },
  ],
};

export default nextConfig;
