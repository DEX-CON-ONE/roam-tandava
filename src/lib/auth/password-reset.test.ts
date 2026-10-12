import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MIN_PASSWORD_LENGTH,
  PASSWORD_RESET_CONFIRM_PATH,
  PASSWORD_RESET_REQUEST_PATH,
  passwordResetRedirectUrl,
  recoveryLinkError,
  validateNewPassword,
} from "./password-reset";

const source = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("password reset helpers", () => {
  it("builds the emailed redirect on the app's own origin", () => {
    expect(passwordResetRedirectUrl("https://book.example.test")).toBe("https://book.example.test/auth/reset-confirm");
    expect(passwordResetRedirectUrl("https://book.example.test/")).toBe("https://book.example.test/auth/reset-confirm");
    expect(passwordResetRedirectUrl("http://localhost:8080")).toBe("http://localhost:8080/auth/reset-confirm");
  });

  it("requires the same minimum length as registration and a matching confirmation", () => {
    expect(MIN_PASSWORD_LENGTH).toBe(8);
    expect(validateNewPassword("short", "short")).toBe("tooShort");
    expect(validateNewPassword("1234567", "1234567")).toBe("tooShort");
    expect(validateNewPassword("long-enough", "long-enough-typo")).toBe("mismatch");
    expect(validateNewPassword("12345678", "12345678")).toBeNull();
  });

  it("detects an expired or invalid recovery link from the URL", () => {
    expect(recoveryLinkError("#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired")).toBe("otp_expired");
    expect(recoveryLinkError("#error=access_denied")).toBe("access_denied");
    expect(recoveryLinkError("", "?error=server_error&error_code=unexpected_failure")).toBe("unexpected_failure");
    expect(recoveryLinkError("#access_token=fixture&type=recovery")).toBeNull();
    expect(recoveryLinkError("", "?code=fixture")).toBeNull();
    expect(recoveryLinkError("", "")).toBeNull();
  });
});

// The reset flow was broken because links pointed at routes that did not exist.
// These guard the wiring between the link, the emailed redirect and the router.
describe("password reset wiring", () => {
  const app = source("src/App.tsx");

  it("registers a route for both reset pages", () => {
    expect(app).toContain(`path="${PASSWORD_RESET_REQUEST_PATH}"`);
    expect(app).toContain(`path="${PASSWORD_RESET_CONFIRM_PATH}"`);
  });

  it("every /auth/ link in the auth pages has a registered route", () => {
    const routes = new Set([...app.matchAll(/path="(\/auth\/[^"]+)"/g)].map((match) => match[1]));
    for (const page of ["Login", "Register", "ResetPassword", "ResetPasswordConfirm"]) {
      const links = [...source(`src/pages/auth/${page}.tsx`).matchAll(/to="(\/auth\/[^"]+)"/g)].map((match) => match[1]);
      for (const link of links) expect(routes, `${page} links to ${link}`).toContain(link);
    }
  });

  it("the backend sends the reset email with the shared redirect, and can set the new password", () => {
    const backend = source("src/lib/backend/supabase.ts");
    expect(backend).toContain("passwordResetRedirectUrl(window.location.origin)");
    expect(backend).not.toContain("/auth/reset-confirm");
    expect(backend).toContain("auth.updateUser({ password })");
  });
});
