import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The HoReCa catalog PDF reads its fonts, logo and seed photos from disk at run time; make sure the
  // deployment bundles them with the two routes that use them.
  outputFileTracingIncludes: {
    "/catalogs/\\[id\\]/pdf": ["./lib/horeca/assets/**/*"],
    "/catalogs/image": ["./lib/horeca/assets/seed/**/*"],
  },
};

export default nextConfig;
