import { describe, expect, it } from "vitest";
import { brandingFromStudio } from "./ThemeContext";

describe("brandingFromStudio", () => {
  it("maps stored studio branding to the ThemeContext overrides", () => {
    expect(brandingFromStudio({
      primary_color: "#b66d3b",
      secondary_color: "#313b32",
      font: "Josefin Sans",
    })).toEqual({
      primaryColorOverride: "#b66d3b",
      secondaryColorOverride: "#313b32",
      fontOverride: "Josefin Sans",
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
