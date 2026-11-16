import { build } from "esbuild";

await build({
  // The recovery CLI ships in dist/ because the runtime image has no tsx or sources.
  entryPoints: { index: "src/index.ts", "admin-reset-password": "scripts/admin-reset-password.ts" },
  outdir: "dist",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  sourcemap: true,
  packages: "external",
  alias: { "@funnel/shared": "../../packages/shared/src/index.ts" },
});
