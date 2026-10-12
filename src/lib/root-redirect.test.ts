import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveRootRedirect } from "./root-redirect";

const source = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("resolveRootRedirect", () => {
  it("is off by default", () => {
    for (const value of [undefined, null, "", "   "]) expect(resolveRootRedirect(value)).toBeNull();
  });

  it("accepts an absolute https URL", () => {
    expect(resolveRootRedirect("https://studio.example.test")).toEqual({ kind: "external", url: "https://studio.example.test/" });
    expect(resolveRootRedirect(" https://studio.example.test/classes?ref=book ")).toEqual({ kind: "external", url: "https://studio.example.test/classes?ref=book" });
    expect(resolveRootRedirect("http://localhost:3000/")).toEqual({ kind: "external", url: "http://localhost:3000/" });
  });

  it("accepts a path in this app", () => {
    expect(resolveRootRedirect("/s/my-studio")).toEqual({ kind: "internal", path: "/s/my-studio" });
    expect(resolveRootRedirect("/schedule")).toEqual({ kind: "internal", path: "/schedule" });
  });

  it("rejects anything unsafe or that would loop", () => {
    for (const value of [
      "/", "//evil.example.test", "/\\evil.example.test", "/s/my studio",
      "http://studio.example.test", "javascript:alert(1)", "data:text/html,x", "ftp://studio.example.test",
      "https://user:pass@studio.example.test", "studio.example.test", "not a url",
    ]) {
      expect(resolveRootRedirect(value), value).toBeNull();
    }
  });
});

describe("root redirect wiring", () => {
  it("the root route redirects anonymous visitors before the platform landing", () => {
    const home = source("src/pages/Home.tsx");
    expect(home).toContain("getRootRedirect()");
    expect(home.indexOf("<RootRedirect")).toBeGreaterThan(-1);
    expect(home.indexOf("<RootRedirect")).toBeLessThan(home.indexOf("<OpenSource />"));
  });

  it("every platform marketing route is wrapped", () => {
    const app = source("src/App.tsx");
    for (const path of ["/demo", "/open-source", "/tools/studio-calculator", "/blog", "/blog/category/:category", "/blog/:slug"]) {
      const line = app.split("\n").find((candidate) => candidate.includes(`path="${path}"`));
      expect(line, path).toBeDefined();
      expect(line, path).toContain("<MarketingRoute>");
    }
  });

  it("the app's own routes are not wrapped", () => {
    const app = source("src/App.tsx");
    for (const path of ["/auth/login", "/auth/register", "/auth/reset", "/s/:slug", "/schedule", "/manage"]) {
      const line = app.split("\n").find((candidate) => candidate.includes(`path="${path}"`));
      expect(line, path).toBeDefined();
      expect(line, path).not.toContain("MarketingRoute");
    }
  });
});
