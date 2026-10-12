/**
 * What the studio setup wizard starts from, and what its first step must
 * collect. Pure, so the rules can be tested without a browser.
 *
 * A white-labelled build (VITE_BRAND_NAME set) is one studio's own booking
 * system, so the wizard starts from that brand: its name, palette, timezone
 * and currency. It must never start from another country's defaults or from
 * sample values that an owner could save without noticing.
 */

import type { Brand } from "../../config/brand-core";
import { slugify } from "../../config/brand-core";

export const TIMEZONE_OPTIONS: [string, string][] = [
  ["Europe/London", "UK (London)"],
  ["Europe/Dublin", "Ireland (Dublin)"],
  ["Europe/Paris", "Central Europe (Paris)"],
  ["America/New_York", "Eastern (ET)"],
  ["America/Chicago", "Central (CT)"],
  ["America/Denver", "Mountain (MT)"],
  ["America/Los_Angeles", "Pacific (PT)"],
  ["Australia/Sydney", "Australia (Sydney)"],
];

export const CURRENCY_OPTIONS: [string, string][] = [["GBP", "GBP (£)"], ["EUR", "EUR (€)"], ["USD", "USD ($)"], ["CAD", "CAD ($)"], ["AUD", "AUD ($)"]];

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const HEX6 = /^#[0-9a-f]{6}$/i;

export const isValidSlug = (value: string): boolean => value.length >= 2 && value.length <= 60 && SLUG.test(value);
export const isValidEmail = (value: string): boolean => EMAIL.test(value.trim());
export const isHexColor = (value: string): boolean => HEX6.test(value.trim());

/** The booking page address for a studio name: "ROAM Athletics" -> "roam-athletics". */
export function slugFromName(name: string): string {
  return slugify(name).slice(0, 60).replace(/-+$/, "");
}

export interface WizardDefaults {
  studioName: string;
  studioSlug: string;
  timezone: string;
  currency: string;
  primaryColor: string;
  secondaryColor: string;
  /** Sample values an upstream demo shows; empty on a studio's own build. */
  rooms: string;
  classPrice: string;
}

type Env = Record<string, string | undefined>;

export function wizardDefaults(brand: Brand, env: Env): WizardDefaults {
  const clean = (value: string | undefined) => (value ?? "").trim();
  if (!brand.isCustom) {
    return {
      studioName: "",
      studioSlug: "",
      timezone: "America/Los_Angeles",
      currency: "USD",
      primaryColor: "#4fd1c5",
      secondaryColor: "#f687b3",
      rooms: "Main Studio, Hot Room",
      classPrice: "25",
    };
  }
  const slug = clean(env.VITE_DEFAULT_STUDIO_SLUG).toLowerCase();
  const full = (hex: string | undefined, fallback: string) => (hex && HEX6.test(hex) ? hex : fallback);
  return {
    studioName: brand.name,
    studioSlug: isValidSlug(slug) ? slug : slugFromName(brand.name),
    timezone: clean(env.VITE_BRAND_TIMEZONE) || "Europe/London",
    currency: (clean(env.VITE_BRAND_CURRENCY) || "GBP").toUpperCase(),
    primaryColor: full(brand.colors.primary, "#4fd1c5"),
    secondaryColor: full(brand.colors.secondary, "#f687b3"),
    rooms: "",
    classPrice: "",
  };
}

/** Options for a select, with the current value added if the list does not have it. */
export function withOption(options: [string, string][], value: string): [string, string][] {
  return !value || options.some(([v]) => v === value) ? options : [[value, value], ...options];
}

export interface StudioInfoInput {
  name: string;
  email: string;
  slug: string;
}

/** Problems with the wizard's first step, by field. Empty when it can be saved. */
export function studioInfoProblems(input: StudioInfoInput): Partial<Record<keyof StudioInfoInput, string>> {
  const problems: Partial<Record<keyof StudioInfoInput, string>> = {};
  if (!input.name.trim()) problems.name = "Enter the studio's name.";
  if (!isValidEmail(input.email)) problems.email = "Enter a contact email address.";
  if (!isValidSlug(input.slug)) problems.slug = "Use lowercase letters, numbers and single hyphens (at least 2 characters).";
  return problems;
}
