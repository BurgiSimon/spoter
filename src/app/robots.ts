import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/api/",
          "/discover",
          "/duel",
          "/rank",
          "/for-you",
          "/likes",
          "/taste",
          "/import",
          "/settings",
        ],
      },
    ],
  };
}
