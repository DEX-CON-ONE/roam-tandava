/**
 * Build plugin for white-labelled builds. Does nothing unless VITE_BRAND_NAME
 * is set, so an upstream build is byte-for-byte what it was.
 *
 * With a brand configured it:
 *   - rewrites the static shell (index.html): title, meta, splash text, theme
 *     colour, fonts, and injects the brand palette as design-token overrides
 *   - writes manifest.json and copies the brand's icons over the default ones
 *     (from VITE_BRAND_ASSETS_DIR: favicon.ico, icon-192.png, icon-512.png,
 *     apple-touch-icon.png, logo.png and optionally favicon.svg)
 *   - runs `applyBrandText` over the emitted JS, HTML, JSON and public scripts
 *     as a last line of defence against hard-coded upstream names
 *   - removes robots/sitemap entries that advertise the upstream site
 */
import { copyFileSync, existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Plugin } from "vite";
import { applyBrandText, brandStyleSheet, type Brand } from "../src/config/brand-core";

const ICONS = ["favicon.ico", "favicon.svg", "icon-192.png", "icon-512.png", "apple-touch-icon.png", "logo.png"];
const TEXT_FILE = /\.(?:js|mjs|html|json|css|txt|webmanifest)$/;
const esc = (value: string) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

export function brandHtml(html: string, brand: Brand, hasSvgIcon: boolean): string {
  const title = brand.tagline ? `${brand.name} | ${brand.tagline}` : brand.name;
  const meta = (attr: string, key: string, content: string) =>
    new RegExp(`(<meta\\s+${attr}="${key}"\\s+content=")[^"]*(")`, "g");
  let out = html
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`)
    .replace(/<link rel="canonical"[^>]*>\s*/g, "")
    .replace(/<meta name="keywords"[^>]*>\s*/g, "");
  for (const [attr, key, content] of [
    ["name", "description", brand.description], ["name", "author", brand.name],
    ["name", "apple-mobile-web-app-title", brand.shortName],
    ["property", "og:title", title], ["property", "og:description", brand.description], ["property", "og:image", "/icon-512.png"],
    ["name", "twitter:title", title], ["name", "twitter:description", brand.description], ["name", "twitter:image", "/icon-512.png"],
  ] as const) {
    out = out.replace(meta(attr, key, content), `$1${esc(content)}$2`);
  }
  const chrome = brand.colors.chrome ?? brand.colors.background;
  if (chrome) out = out.replace(meta("name", "theme-color", chrome), `$1${chrome}$2`);
  if (!hasSvgIcon) out = out.replace(/<link rel="icon" type="image\/svg\+xml"[^>]*>\s*/g, "");

  const head: string[] = [];
  if (brand.fontDisplay) {
    const family = encodeURIComponent(brand.fontDisplay).replace(/%20/g, "+");
    head.push(`<link href="https://fonts.googleapis.com/css2?family=${family}:wght@400;600;700&display=swap" rel="stylesheet" />`);
  }
  const css = brandStyleSheet(brand);
  if (css) head.push(`<style id="brand-theme">${css}</style>`);
  // The pre-React splash is styled inline for the default dark theme.
  if (brand.colors.background && brand.colors.foreground) {
    head.push(`<style id="brand-splash">#root>div:first-child{background:${brand.colors.background} !important;color:${brand.colors.foreground} !important;}#root>div:first-child p{font-family:${brand.fontDisplay ? `'${brand.fontDisplay}',` : ""}Arial,sans-serif !important;}</style>`);
  }
  out = out.replace("</head>", `  ${head.join("\n    ")}\n  </head>`);
  return applyBrandText(out, brand);
}

export function brandManifest(manifest: Record<string, unknown>, brand: Brand, hasSvgIcon: boolean): Record<string, unknown> {
  const icons = (Array.isArray(manifest.icons) ? manifest.icons : []) as Array<Record<string, unknown>>;
  return {
    ...manifest,
    name: brand.name,
    short_name: brand.shortName,
    description: brand.description,
    background_color: brand.colors.background ?? manifest.background_color,
    theme_color: brand.colors.chrome ?? brand.colors.background ?? manifest.theme_color,
    icons: hasSvgIcon ? icons : icons.filter((icon) => icon.src !== "/favicon.svg"),
  };
}

export function brandPlugin(brand: Brand, assetsDir: string | undefined): Plugin | false {
  if (!brand.isCustom) return false;
  const assets = assetsDir ? resolve(process.cwd(), assetsDir) : null;
  const hasSvgIcon = Boolean(assets && existsSync(join(assets, "favicon.svg")));
  let outDir = "dist";

  return {
    name: "brand",
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    transformIndexHtml: { order: "post", handler: (html) => brandHtml(html, brand, hasSvgIcon) },
    closeBundle() {
      if (!existsSync(outDir)) return;
      if (assets) {
        for (const icon of ICONS) {
          const from = join(assets, icon);
          if (existsSync(from)) copyFileSync(from, join(outDir, icon));
        }
      }
      if (!hasSvgIcon) rmSync(join(outDir, "favicon.svg"), { force: true });
      const manifestPath = join(outDir, "manifest.json");
      if (existsSync(manifestPath)) {
        const manifest = brandManifest(JSON.parse(readFileSync(manifestPath, "utf8")), brand, hasSvgIcon);
        writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
      }
      // Static leftovers of the platform blog (public/blog) are not part of a white-labelled build.
      rmSync(join(outDir, "blog"), { recursive: true, force: true });
      const robots = join(outDir, "robots.txt");
      if (existsSync(robots)) {
        writeFileSync(robots, readFileSync(robots, "utf8").split("\n").filter((line) => !/^\s*(Sitemap|Host):/i.test(line)).join("\n"));
      }
      for (const file of walk(outDir)) {
        if (!TEXT_FILE.test(file)) continue;
        const before = readFileSync(file, "utf8");
        // No "Powered by" credit on a white-labelled embed widget.
        const after = applyBrandText(before, brand).replace(/<p class="ft">Powered by [^<]*<\/p>/g, "");
        if (after !== before) writeFileSync(file, after);
      }
    },
  };
}
