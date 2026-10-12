import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import { buildBrand } from "./src/config/brand-core";
import { brandPlugin } from "./brand/vite-plugin-brand";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Opt in only on the public marketing deployment. Normal installs omit all game assets.
  const blogGames = process.env.VITE_BLOG_GAMES === "true";
  // White-label settings (VITE_BRAND_*): from .env files or the build environment.
  const env = { ...loadEnv(mode, process.cwd(), "VITE_"), ...process.env } as Record<string, string | undefined>;
  const brand = buildBrand(env);
  return {
    // Keep the browser gate identical to the Node prerenderer, including when
    // a developer has an old VITE_BLOG_GAMES value in a local .env file.
    define: {
      "import.meta.env.VITE_BLOG_GAMES": JSON.stringify(blogGames ? "true" : "false"),
    },
    server: {
      host: "::",
      port: 8080,
    },
    build: {
      // A white-labelled build does not publish the upstream sources.
      sourcemap: !brand.isCustom,
      rollupOptions: {
        input: blogGames
          ? {
              main: path.resolve(__dirname, "index.html"),
              studioSprout: path.resolve(
                __dirname,
                "editorial/page/studio-sprout/index.html",
              ),
            }
          : undefined,
        output: {
          manualChunks(id) {
            if (!id.includes("node_modules")) return;

            if (id.includes("recharts")) return "charts-vendor";
            if (id.includes("@supabase")) return "supabase-vendor";
            if (id.includes("@sentry")) return "sentry-vendor";
            if (id.includes("@radix-ui")) return "radix-vendor";
            if (
              id.includes("react-router") ||
              id.includes("@tanstack/react-query") ||
              id.includes("i18next")
            ) {
              return "app-vendor";
            }
            if (
              id.includes("react") ||
              id.includes("react-dom") ||
              id.includes("scheduler")
            ) {
              return "react-vendor";
            }
          },
        },
      },
    },
    plugins: [
      react(),
      brandPlugin(brand, env.VITE_BRAND_ASSETS_DIR),
      blogGames && {
        name: "blog-game-entry",
        configureServer(server) {
          server.middlewares.use((req, _res, next) => {
            if (/^\/page\/studio-sprout\/?(?:\?.*)?$/.test(req.url ?? "")) {
              req.url = "/editorial/page/studio-sprout/index.html";
            }
            next();
          });
        },
        generateBundle: {
          order: "post",
          handler(_options, bundle) {
            const original = "editorial/page/studio-sprout/index.html";
            const entry = bundle[original];
            if (!entry)
              throw new Error("Missing standalone blog game HTML entry");
            delete bundle[original];
            entry.fileName = "page/studio-sprout/index.html";
            bundle[entry.fileName] = entry;
          },
        },
      },
      // Upload source maps to Sentry on production builds (when configured)
      mode === "production" &&
        process.env.SENTRY_AUTH_TOKEN &&
        sentryVitePlugin({
          org: process.env.SENTRY_ORG,
          project: process.env.SENTRY_PROJECT,
          authToken: process.env.SENTRY_AUTH_TOKEN,
        }),
    ].filter(Boolean),
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
  };
});
