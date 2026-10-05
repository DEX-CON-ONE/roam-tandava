import { describe, expect, it } from "vitest";
import { brandingFromStudio } from "./ThemeContext";

describe("brandingFromStudio", () => {
  it("maps stored studio branding to the ThemeContext overrides", () => {
    expect(brandingFromStudio({
      primary_color: "#1c1c1c",
      secondary_color: "#ffffff",
      font: "DM Sans",
    })).toEqual({
      primaryColorOverride: "#1c1c1c",
      secondaryColorOverride: "#ffffff",
      fontOverride: "DM Sans",
    });
  });

  it("preserves nulls so ThemeContext falls back to its defaults", () => {
    expect(brandingFromStudio({
      primary_color: null,
      secondary_color: null,
      font: null,
    })).toEqual({
      primaryColorOverride: null,
      secondaryColorOverride: null,
      fontOverride: null,
    });
  });
});
