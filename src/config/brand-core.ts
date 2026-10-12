/**
 * Brand configuration (pure, no browser or Vite globals).
 *
 * One place that decides what the product is called and how it looks. Every
 * value comes from a build-time `VITE_BRAND_*` variable and falls back to the
 * upstream Tandava value, so an unconfigured build is unchanged.
 *
 * Used by the app (`src/config/brand.ts`) and by the build plugin
 * (`brand/vite-plugin-brand.ts`), which is why it must stay dependency-free.
 */

export type BrandEnv = Record<string, string | undefined>;

export interface Brand {
  /** True when VITE_BRAND_NAME is set, i.e. this is a white-labelled build. */
  isCustom: boolean;
  name: string;
  shortName: string;
  tagline: string;
  description: string;
  /** Public URL of the logo image, or null to show the initial-in-a-tile mark. */
  logoUrl: string | null;
  /** Background behind the logo (for logos drawn in white). */
  logoBackground: string | null;
  /** The organisation's own website. */
  siteUrl: string;
  /** Bare domain used in placeholders and examples, e.g. "example.com". */
  domain: string;
  /** URL-safe slug used in example paths. */
  slug: string;
  supportEmail: string | null;
  twitterHandle: string | null;
  fontDisplay: string | null;
  fontBody: string | null;
  /** Hex colours. All optional; unset keeps the default theme. */
  colors: Partial<Record<BrandColor, string>>;
}

export const BRAND_COLORS = [
  "background", "foreground", "card", "primary", "primaryForeground", "secondary", "accent",
  "muted", "mutedForeground", "border", "chrome", "chromeForeground",
] as const;
export type BrandColor = (typeof BRAND_COLORS)[number];

const clean = (value: string | undefined): string | undefined => {
  const trimmed = (value ?? "").trim();
  return trimmed ? trimmed : undefined;
};
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const envKey = (color: BrandColor) => `VITE_BRAND_COLOR_${color.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase()}`;

export function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function buildBrand(env: BrandEnv): Brand {
  const name = clean(env.VITE_BRAND_NAME);
  const isCustom = Boolean(name);
  const siteUrl = (clean(env.VITE_BRAND_SITE_URL) ?? (isCustom ? "/" : "https://tandavastudio.com")).replace(/\/+$/, "") || "/";
  let domain = clean(env.VITE_BRAND_DOMAIN);
  if (!domain) {
    try {
      domain = new URL(siteUrl).hostname;
    } catch {
      domain = isCustom ? "example.com" : "tandava.yoga";
    }
  }
  const colors: Brand["colors"] = {};
  for (const color of BRAND_COLORS) {
    const value = clean(env[envKey(color)]);
    if (value && HEX.test(value)) colors[color] = value.toLowerCase();
  }
  return {
    isCustom,
    name: name ?? "Tandava",
    shortName: clean(env.VITE_BRAND_SHORT_NAME) ?? name ?? "Tandava",
    tagline: clean(env.VITE_BRAND_TAGLINE) ?? (isCustom ? "" : "Open Source Studio Management"),
    description: clean(env.VITE_BRAND_DESCRIPTION)
      ?? (isCustom
        ? `Book classes and manage your membership with ${name}.`
        : "Open-source studio management software for yoga, pilates, and movement studios. Self-host your data, customize everything, no subscription fees."),
    logoUrl: clean(env.VITE_BRAND_LOGO_URL) ?? null,
    logoBackground: HEX.test(clean(env.VITE_BRAND_LOGO_BACKGROUND) ?? "") ? clean(env.VITE_BRAND_LOGO_BACKGROUND)! : null,
    siteUrl,
    domain,
    slug: clean(env.VITE_BRAND_SLUG) ?? (isCustom ? slugify(name!) : "tandava-yoga"),
    supportEmail: clean(env.VITE_BRAND_SUPPORT_EMAIL) ?? null,
    twitterHandle: clean(env.VITE_BRAND_TWITTER) ?? (isCustom ? null : "@TandavaYoga"),
    fontDisplay: clean(env.VITE_BRAND_FONT_DISPLAY) ?? null,
    fontBody: clean(env.VITE_BRAND_FONT_BODY) ?? null,
    colors,
  };
}

/** "#b66d3b" -> "22 51% 47%" (the space-separated HSL form the design tokens use). */
export function hexToHslTriplet(hex: string): string {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let hue = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) hue = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) hue = (b - r) / d + 2;
    else hue = (r - g) / d + 4;
    hue *= 60;
  }
  return `${Math.round(hue)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

/**
 * Design-token overrides for a brand palette. Empty when no colours are set.
 * Studio-level theming (ThemeContext) still applies on top of these.
 */
export function brandCssVariables(brand: Brand): Record<string, string> {
  const c = brand.colors;
  const vars: Record<string, string> = {};
  const hsl = (names: string[], hex: string | undefined) => {
    if (hex) for (const name of names) vars[name] = hexToHslTriplet(hex);
  };
  const raw = (names: string[], value: string | undefined) => {
    if (value) for (const name of names) vars[name] = value;
  };
  hsl(["--background"], c.background);
  hsl(["--foreground", "--card-foreground", "--popover-foreground", "--secondary-foreground", "--accent-foreground"], c.foreground);
  hsl(["--card", "--popover"], c.card);
  hsl(["--primary", "--ring", "--accent-mint"], c.primary);
  hsl(["--primary-foreground"], c.primaryForeground);
  hsl(["--secondary", "--muted"], c.muted);
  hsl(["--muted-foreground"], c.mutedForeground);
  hsl(["--accent", "--accent-lilac", "--accent-peach", "--accent-yellow", "--warning"], c.accent);
  hsl(["--border", "--input", "--border-strong"], c.border);
  hsl(["--sidebar-background"], c.chrome);
  hsl(["--sidebar-foreground"], c.chromeForeground);
  hsl(["--sidebar-primary"], c.accent);
  hsl(["--sidebar-primary-foreground"], c.chrome);
  hsl(["--sidebar-accent-foreground"], c.chromeForeground);
  hsl(["--sidebar-accent", "--sidebar-border"], c.secondary);
  hsl(["--sidebar-ring"], c.primary);
  raw(["--bg-primary"], c.background);
  raw(["--bg-secondary", "--bg-card"], c.card);
  raw(["--text-primary"], c.foreground);
  raw(["--text-secondary", "--text-muted"], c.mutedForeground);
  raw(["--accent-teal", "--completed"], c.primary);
  raw(["--accent-coral", "--accent-gold"], c.accent);
  raw(["--accent-sage", "--success"], c.secondary);
  if (c.primary) {
    vars["--gradient-primary"] = vars["--gradient-cool"] = vars["--gradient-warm"] = `linear-gradient(135deg, ${c.primary} 0%, ${c.accent ?? c.primary} 100%)`;
    vars["--gradient-subtle"] = vars["--gradient-glow"] = "none";
    vars["--glow-teal"] = vars["--glow-coral"] = "none";
  }
  if (c.border) vars["--glass-border"] = c.border;
  if (brand.fontDisplay) vars["--font-display"] = vars["--font-sanskrit"] = `'${brand.fontDisplay}', Arial, sans-serif`;
  if (brand.fontBody) vars["--font-body"] = `${brand.fontBody}, sans-serif`;
  return vars;
}

/** `<style>` body that applies the brand palette and fonts ahead of the app's own tokens. */
export function brandStyleSheet(brand: Brand): string {
  const vars = brandCssVariables(brand);
  const entries = Object.entries(vars);
  if (entries.length === 0) return "";
  const block = entries.map(([name, value]) => `${name}:${value};`).join("");
  let css = `html:root,html:root.dark,html:root.light{${block}}`;
  if (brand.fontDisplay) css += `.font-display,.font-sanskrit,h1,h2,h3{font-family:'${brand.fontDisplay}',Arial,sans-serif !important;}`;
  if (brand.fontBody) css += `body,.font-sans,.font-body{font-family:${brand.fontBody},sans-serif !important;}`;
  return css;
}

/**
 * Last line of defence for a white-labelled build: rewrites upstream names
 * that are still hard-coded in sample data, placeholders and translations.
 * Deliberately conservative: whole words and known domains only, so code
 * identifiers, storage keys and custom-element names are left alone.
 */
export function applyBrandText(text: string, brand: Brand): string {
  if (!brand.isCustom) return text;
  const site = brand.siteUrl.startsWith("http") ? brand.siteUrl : `https://${brand.domain}`;
  return text
    .replace(/https?:\/\/github\.com\/TaylorONeal\/tandava[^\s"'`)<>\\]*/g, site)
    .replace(/\bTandava Yoga SOMA\b/g, brand.name)
    .replace(/\b(?:Tandava|Oxatl) Yoga Studio\b/g, brand.name)
    .replace(/\b(?:Tandava|Oxatl) Yoga\b/g, brand.name)
    .replace(/\bTandava\b/g, brand.name)
    .replace(/تاندافا/g, brand.name) // Arabic transliteration used in the ar locale
    .replace(/@TandavaYoga\b/g, brand.twitterHandle ?? "")
    .replace(/\btandava yoga\b/g, brand.name.toLowerCase())
    .replace(/\btandava-yoga\b/g, brand.slug)
    .replace(/\b(?:tandavayoga\.com|tandavastudio\.com|tandava\.yoga|tandava\.io)\b/g, brand.domain);
}
