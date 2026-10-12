import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const OUT_DIR = join(process.cwd(), "node_modules", ".cache", "tandava-postbuild");
const tasks = ["generate-sitemap.ts", "prerender-blog.ts", "prerender-tools.ts"];

// Single-studio deployments redirect the platform's marketing pages away
// (see src/lib/root-redirect.ts), so do not publish their static copies either.
if ((process.env.VITE_ROOT_REDIRECT_URL ?? "").trim()) {
  console.log("VITE_ROOT_REDIRECT_URL is set: skipping sitemap, blog and tools prerender.");
  process.exit(0);
}

mkdirSync(OUT_DIR, { recursive: true });

for (const task of tasks) {
  const outfile = join(OUT_DIR, task.replace(/\.ts$/, ".mjs"));

  await build({
    entryPoints: [join("scripts", task)],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    sourcemap: "inline",
    logLevel: "silent",
  });

  await import(pathToFileURL(outfile).href);
}

rmSync(OUT_DIR, { recursive: true, force: true });
