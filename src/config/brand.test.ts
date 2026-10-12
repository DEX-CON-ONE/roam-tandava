import { describe, expect, it } from "vitest";
import { applyBrandText, brandCssVariables, brandStyleSheet, buildBrand, hexToHslTriplet } from "./brand-core";
import { brandHtml, brandManifest } from "../../brand/vite-plugin-brand";

// A fictional brand: the tests must not depend on any real deployment.
const env = {
  VITE_BRAND_NAME: "Harbour Strength",
  VITE_BRAND_SHORT_NAME: "Harbour",
  VITE_BRAND_TAGLINE: "Lift well.",
  VITE_BRAND_LOGO_URL: "/logo.png",
  VITE_BRAND_LOGO_BACKGROUND: "#101010",
  VITE_BRAND_SITE_URL: "https://harbour.example.test/",
  VITE_BRAND_FONT_DISPLAY: "Josefin Sans",
  VITE_BRAND_COLOR_BACKGROUND: "#F3F0EA",
  VITE_BRAND_COLOR_FOREGROUND: "#191a17",
  VITE_BRAND_COLOR_PRIMARY: "#b66d3b",
  VITE_BRAND_COLOR_CHROME: "#191a17",
  VITE_BRAND_COLOR_ACCENT: "not-a-colour",
};
const custom = buildBrand(env);
const upstream = buildBrand({});

describe("brand config", () => {
  it("defaults to the upstream brand when nothing is set", () => {
    expect(upstream).toMatchObject({ isCustom: false, name: "Tandava", shortName: "Tandava", logoUrl: null, twitterHandle: "@TandavaYoga" });
    expect(upstream.colors).toEqual({});
    expect(brandCssVariables(upstream)).toEqual({});
    expect(brandStyleSheet(upstream)).toBe("");
  });

  it("reads a white-label brand from VITE_BRAND_* and ignores invalid colours", () => {
    expect(custom).toMatchObject({
      isCustom: true, name: "Harbour Strength", shortName: "Harbour", tagline: "Lift well.", logoUrl: "/logo.png",
      siteUrl: "https://harbour.example.test", domain: "harbour.example.test", slug: "harbour-strength", twitterHandle: null,
    });
    expect(custom.colors).toEqual({ background: "#f3f0ea", foreground: "#191a17", primary: "#b66d3b", chrome: "#191a17" });
    expect(custom.description).toContain("Harbour Strength");
  });

  it("treats blank values as unset", () => {
    expect(buildBrand({ VITE_BRAND_NAME: "   " }).isCustom).toBe(false);
  });

  it("converts hex colours to the HSL token form", () => {
    expect(hexToHslTriplet("#ffffff")).toBe("0 0% 100%");
    expect(hexToHslTriplet("#000")).toBe("0 0% 0%");
    expect(hexToHslTriplet("#ff0000")).toBe("0 100% 50%");
    expect(hexToHslTriplet("#b66d3b")).toBe("24 51% 47%");
  });

  it("maps the palette onto design tokens and fonts", () => {
    const vars = brandCssVariables(custom);
    expect(vars["--background"]).toBe(hexToHslTriplet("#f3f0ea"));
    expect(vars["--primary"]).toBe("24 51% 47%");
    expect(vars["--accent-teal"]).toBe("#b66d3b");
    expect(vars["--font-display"]).toContain("Josefin Sans");
    expect(vars["--accent"]).toBeUndefined();
    expect(brandStyleSheet(custom)).toMatch(/^html:root,html:root\.dark,html:root\.light\{/);
  });
});

describe("applyBrandText (last line of defence)", () => {
  it("leaves an upstream build untouched", () => {
    expect(applyBrandText("Welcome to Tandava!", upstream)).toBe("Welcome to Tandava!");
  });

  it("replaces upstream and demo-studio names, domains and links", () => {
    expect(applyBrandText("Welcome to Tandava! Powered by Tandava.", custom)).toBe("Welcome to Harbour Strength! Powered by Harbour Strength.");
    expect(applyBrandText("e.g. Tandava Yoga / Oxatl Yoga / Oxatl Yoga Studio", custom)).toBe("e.g. Harbour Strength / Harbour Strength / Harbour Strength");
    expect(applyBrandText("maya@tandava.yoga https://tandavayoga.com/schedule support@tandava.io tandavastudio.com", custom))
      .toBe("maya@harbour.example.test https://harbour.example.test/schedule support@harbour.example.test harbour.example.test");
    expect(applyBrandText('href="https://github.com/TaylorONeal/tandava/tree/main/docs"', custom)).toBe('href="https://harbour.example.test"');
    expect(applyBrandText("/s/tandava-yoga/page utm_term: \"tandava yoga\" @TandavaYoga", custom)).toBe('/s/harbour-strength/page utm_term: "harbour strength" ');
  });

  it("replaces the name next to non-Latin text and its Arabic transliteration", () => {
    expect(applyBrandText("Tandavaへようこそ!", custom)).toBe("Harbour Strengthへようこそ!");
    expect(applyBrandText("مرحبًا بك في تاندافا!", custom)).toBe("مرحبًا بك في Harbour Strength!");
  });

  it("does not touch identifiers, storage keys, element names or translation keys", () => {
    for (const technical of [
      "t('register.welcomeToTandava')", "class TandavaSchedule extends HTMLElement", 'customElements.define("tandava-schedule"',
      "lookupLocalStorage: 'tandava-language'", '"tandava:onboarding-draft"', '{ type: "tandava-embed-height" }', "const CACHE_NAME = 'tandava-v1'",
    ]) {
      expect(applyBrandText(technical, custom)).toBe(technical);
    }
  });
});

describe("brand build plugin", () => {
  const html = `<!doctype html><html><head>
    <meta name="theme-color" content="#0f0a14" />
    <meta name="apple-mobile-web-app-title" content="Tandava" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <link rel="icon" type="image/x-icon" href="/favicon.ico" />
    <title>Tandava | Open Source Studio Management</title>
    <meta name="description" content="Open-source studio management software for yoga." />
    <meta name="author" content="Tandava" />
    <meta name="keywords" content="yoga studio software, open source" />
    <link rel="canonical" href="https://tandava.yoga" />
    <meta property="og:title" content="Tandava | Open Source Studio Management" />
    <meta property="og:description" content="Free, open-source studio management." />
    <meta name="twitter:title" content="Tandava | Open Source Studio Management" />
    <meta name="twitter:description" content="Free, open-source studio management." />
  </head><body><div id="root"><div><p>Tandava</p><p>Loading...</p></div></div></body></html>`;

  it("rewrites the static shell so nothing upstream is left", () => {
    const out = brandHtml(html, custom, false);
    expect(out).toContain("<title>Harbour Strength | Lift well.</title>");
    expect(out).toContain('<meta name="apple-mobile-web-app-title" content="Harbour" />');
    expect(out).toContain('<meta name="theme-color" content="#191a17" />');
    expect(out).toContain('id="brand-theme"');
    expect(out).toContain("family=Josefin+Sans");
    expect(out).toContain("<p>Harbour Strength</p>");
    expect(out).not.toContain("favicon.svg");
    expect(out).not.toMatch(/tandava|open.source|yoga/i);
  });

  it("writes a branded manifest", () => {
    const manifest = brandManifest({ name: "Tandava", short_name: "Tandava", description: "Open-source", start_url: "/", theme_color: "#0f0a14", background_color: "#0f0a14",
      icons: [{ src: "/favicon.svg" }, { src: "/icon-192.png" }] }, custom, false);
    expect(manifest).toMatchObject({ name: "Harbour Strength", short_name: "Harbour", start_url: "/", theme_color: "#191a17", background_color: "#f3f0ea" });
    expect(manifest.icons).toEqual([{ src: "/icon-192.png" }]);
    expect(JSON.stringify(manifest)).not.toMatch(/tandava|open.source/i);
  });
});
