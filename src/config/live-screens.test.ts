import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LIVE_ROUTE_PATHS, isLiveRoute } from "./live-screens";
import { resolveAuthProviders } from "./auth-providers";
import { applyBrandText, buildBrand } from "./brand-core";

const source = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const app = source("src/App.tsx");
const routes = [...app.matchAll(/<Route path="([^"]+)" element=\{(.*)\} \/>/g)].map((match) => ({ path: match[1], element: match[2] }));

describe("live-data-only mode", () => {
  it("finds the route table", () => {
    expect(routes.length).toBeGreaterThan(60);
    for (const path of LIVE_ROUTE_PATHS) expect(routes.map((route) => route.path), path).toContain(path);
  });

  it("every route is either declared live, a redirected marketing page, or wrapped in <LiveOnly>", () => {
    for (const { path, element } of routes) {
      const wrapped = element.startsWith("<LiveOnly>") && element.endsWith("</LiveOnly>");
      const marketing = element.startsWith("<MarketingRoute>");
      if (isLiveRoute(path)) expect(wrapped, `${path} is declared live but wrapped`).toBe(false);
      else expect(wrapped || marketing, `${path} would show sample data: wrap it or declare it live`).toBe(true);
    }
  });

  it("screens declared live do not carry page-level sample data", () => {
    // The files behind the live routes that render records.
    const ownerScreens = ["OwnerDashboard", "OwnerClasses", "OwnerSession", "OwnerMembers", "OwnerMemberDetail", "OwnerPrices", "OwnerPayments", "OwnerSettings", "OwnerHelp"].map((name) => `src/pages/owner/${name}.tsx`);
    for (const file of ["src/pages/StudioStorefront.tsx", "src/pages/member/StudioSchedule.tsx", "src/pages/member/ClassDetail.tsx", "src/pages/member/StudioPlans.tsx", "src/pages/member/MyBookings.tsx", "src/pages/member/CheckoutReturn.tsx", "src/pages/manage/Import.tsx", "src/pages/auth/Login.tsx", "src/pages/auth/Register.tsx", ...ownerScreens]) {
      expect(source(file), file).not.toMatch(/^const (mock|MOCK|sample|SAMPLE)[A-Za-z_]*\s*[:=]/m);
    }
  });

  it("studio setup sits behind the database access check, and every other manage route needs a studio permission", () => {
    const setup = routes.find((route) => route.path === "/manage/onboarding");
    expect(setup?.element).toBe("<ProtectedRoute><StudioSetupRoute><OnboardingManage /></StudioSetupRoute></ProtectedRoute>");
    for (const { path, element } of routes.filter((route) => route.path.startsWith("/manage") && route.path !== "/manage/onboarding")) {
      expect(element, `${path} must require a studio permission`).toMatch(/<ProtectedRoute permission="studio\.[a-z_]+">/);
    }
  });

  it("sample-only screens are left out of a live-data-only bundle", () => {
    for (const name of ["Schedule", "Index", "ReportsManage", "TeachersManage", "AuditLogsManage", "Kiosk"]) {
      expect(app, name).toMatch(new RegExp(`const ${name} = import\\.meta\\.env\\.VITE_LIVE_DATA_ONLY === "true" \\? NoPage : lazy\\(`));
    }
    // Owner screens: the real one in a live-data-only bundle, the mock-up otherwise.
    for (const name of ["ManageDashboard", "ScheduleManage", "StudentsManage", "OfferingsManage", "FinancialsManage", "MemberDetailManage", "SettingsManage"]) {
      expect(app, name).toContain(`const ${name} = import.meta.env.VITE_LIVE_DATA_ONLY === "true" ? lazy(() => import("./pages/owner/Owner`);
    }
    for (const name of ["StudioStorefront", "MemberSchedule", "MemberClassDetail", "MemberPlans", "MemberBookings", "MemberCheckoutReturn", "Login", "Register", "OnboardingManage", "ImportManage"]) {
      expect(app, name).toMatch(new RegExp(`const ${name} = lazy\\(`));
    }
  });
});

describe("social sign-in buttons", () => {
  it("are hidden unless enabled", () => {
    expect(resolveAuthProviders({})).toEqual({ google: false, apple: false, any: false, count: 0 });
    expect(resolveAuthProviders({ VITE_AUTH_GOOGLE_ENABLED: "false", VITE_AUTH_APPLE_ENABLED: "1" })).toMatchObject({ any: false });
    expect(resolveAuthProviders({ VITE_AUTH_GOOGLE_ENABLED: "true" })).toEqual({ google: true, apple: false, any: true, count: 1 });
    expect(resolveAuthProviders({ VITE_AUTH_GOOGLE_ENABLED: "true", VITE_AUTH_APPLE_ENABLED: "true" })).toMatchObject({ count: 2 });
  });

  it("are all shown in demo mode", () => {
    expect(resolveAuthProviders({ VITE_DEMO_MODE: "true" })).toMatchObject({ google: true, apple: true });
  });
});

describe("import notices under a white-label brand", () => {
  const brand = buildBrand({ VITE_BRAND_NAME: "Harbour Strength" });
  it("make no affiliation or open-source claim in the brand's name", () => {
    const out = applyBrandText("Tandava is not affiliated with, endorsed by, or connected to Example Inc. in any way. Tandava is not affiliated with any of these providers.", brand);
    expect(out).toBe("This tool is not affiliated with, endorsed by, or connected to Example Inc. in any way. This tool is not affiliated with any of these providers.");
    const legal = source("src/lib/connectors/legal.ts");
    expect(legal).toContain("brand.isCustom");
    const neutral = legal.slice(legal.indexOf("const NEUTRAL_LEGAL_NOTICE"), legal.indexOf("export const CONNECTOR_LEGAL_NOTICE"));
    expect(neutral.length).toBeGreaterThan(200);
    expect(neutral).not.toMatch(/open.source|Tandava|independent/i);
  });
});
