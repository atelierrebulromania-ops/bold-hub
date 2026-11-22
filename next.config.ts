import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The HoReCa catalog PDF reads its fonts, logo and seed photos from disk at run time; make sure the
  // deployment bundles them with the two routes that use them. pdfkit also loads its built-in fonts
  // through the "#standard-fonts" import map, which file tracing cannot follow.
  outputFileTracingIncludes: {
    "/catalogs/\\[id\\]/pdf": ["./lib/horeca/assets/**/*", "./node_modules/pdfkit/js/standard-fonts/**/*", "./node_modules/pdfkit/package.json"],
    "/catalogs/image": ["./lib/horeca/assets/seed/**/*"],
  },
};

export default nextConfig;
