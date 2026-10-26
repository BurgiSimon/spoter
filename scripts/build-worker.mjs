// Bundles the background worker and the migration runner into self-contained ESM files.
import { build } from "esbuild";

const shared = {
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: true,
  logLevel: "info",
  // pg optionally requires pg-native; we never use it.
  external: ["pg-native"],
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
};

await build({ ...shared, entryPoints: ["src/worker/index.ts"], outfile: "dist/worker.mjs" });
await build({ ...shared, entryPoints: ["scripts/migrate.ts"], outfile: "dist/migrate.mjs" });
