import * as esbuild from "esbuild";
import { rm } from "node:fs/promises";

// tsc -b (run first for type-checking) emits unbundled files into dist/. Clear
// them so the published dist/ is just the self-contained bundle.
await rm("dist", { recursive: true, force: true });

// Bundle the plugin's server entry (src/index.ts) into a single self-contained
// dist/index.js. Baking express-openapi-validator + ajv 8 into the bundle means
// they resolve against the versions we ship, not whatever signalk-server has
// hoisted into ~/.signalk/node_modules. This is the durable fix for #95, where
// npm sometimes leaves ajv-draft-04 hoisted next to signalk-server's ajv 6
// (which has no dist/core), crashing the plugin on load.
await esbuild.build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  sourcemap: false,
  // What must be bundled to fix #95 is the @neaps/api -> express-openapi-validator
  // -> ajv/ajv-draft-04 chain, so ajv 8 resolves against our copy instead of
  // signalk-server's hoisted ajv 6. Everything else is safe to leave external:
  //   - @signalk/server-api: types only (erased), provided by the host.
  //   - neaps: the offline tide engine we import directly. Large station data,
  //     no ajv dependency, so bundling it just bloats dist for no benefit.
  //   - Node built-ins: external automatically on platform: "node".
  external: ["@signalk/server-api", "neaps"],
  // Some bundled CJS deps (express, ajv) do dynamic require() calls that can't
  // be resolved statically. Provide a require() in the ESM output so they work.
  banner: {
    js: "import { createRequire as __createRequire } from 'module';\nconst require = __createRequire(import.meta.url);",
  },
  logLevel: "info",
});
