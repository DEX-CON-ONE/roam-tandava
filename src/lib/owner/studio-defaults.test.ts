import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildBrand } from "../../config/brand-core";
import { isValidSlug, slugFromName, studioInfoProblems, wizardDefaults, withOption, TIMEZONE_OPTIONS } from "./studio-defaults";

/** brands/roam/brand.env as the build loads it. */
function roamEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of readFileSync(join(process.cwd(), "brands", "roam", "brand.env"), "utf8").split("\n")) {
    const match = /^([A-Z0-9_]+)="?(.*?)"?\s*$/.exec(line.trim());
    if (match) env[match[1]] = match[2];
  }
  return env;
}

describe("studio setup wizard defaults", () => {
  it("the ROAM build starts from ROAM's own name, address, timezone, currency and palette", () => {
    const env = roamEnv();
    const defaults = wizardDefaults(buildBrand(env), env);
    expect(defaults).toEqual({
      studioName: "ROAM Athletics",
      studioSlug: "roam",
      timezone: "Europe/London",
      currency: "GBP",
      primaryColor: "#b66d3b",
      secondaryColor: "#313b32",
      rooms: "",
      classPrice: "",
    });
  });

  it("a white-labelled build never starts from US or sample values, even with nothing else configured", () => {
    const env = { VITE_BRAND_NAME: "Harbour Strength" };
    const defaults = wizardDefaults(buildBrand(env), env);
    expect(defaults.studioName).toBe("Harbour Strength");
    expect(defaults.studioSlug).toBe("harbour-strength");
    expect(defaults.timezone).not.toMatch(/^America\//);
    expect(defaults.currency).not.toBe("USD");
    expect(defaults.rooms).toBe("");
    expect(defaults.classPrice).toBe("");
  });

  it("the upstream build is unchanged", () => {
    const defaults = wizardDefaults(buildBrand({}), {});
    expect(defaults).toMatchObject({ studioName: "", timezone: "America/Los_Angeles", currency: "USD", primaryColor: "#4fd1c5" });
  });

  it("the first step cannot be saved without a name, a contact email and a usable address", () => {
    expect(studioInfoProblems({ name: "", email: "", slug: "" })).toEqual({
      name: expect.any(String), email: expect.any(String), slug: expect.any(String),
    });
    expect(studioInfoProblems({ name: "   ", email: "owner@example", slug: "My Studio" })).toHaveProperty("name");
    expect(studioInfoProblems({ name: "ROAM Athletics", email: "owner@example.com", slug: "roam" })).toEqual({});
  });

  it("derives a booking page address from the studio name", () => {
    expect(slugFromName("ROAM Athletics")).toBe("roam-athletics");
    expect(slugFromName("  Café & Barbell Club!  ")).toBe("caf-barbell-club");
    expect(isValidSlug("roam")).toBe(true);
    for (const bad of ["", "a", "Roam", "roam--club", "-roam", "roam-", "roam club", "roam/club"]) expect(isValidSlug(bad), bad).toBe(false);
  });

  it("keeps a configured timezone selectable even when it is not in the short list", () => {
    expect(withOption(TIMEZONE_OPTIONS, "Europe/London")).toBe(TIMEZONE_OPTIONS);
    expect(withOption(TIMEZONE_OPTIONS, "Europe/Lisbon")[0]).toEqual(["Europe/Lisbon", "Europe/Lisbon"]);
  });
});
