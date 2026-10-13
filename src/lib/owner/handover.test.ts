import { describe, expect, it } from "vitest";
import { connectStatusFromAccount, describeStripeError, mustRefuseWithoutConnectedAccount, stripeKeyMode } from "../../../supabase/functions/stripe/config.ts";
import { teamInviteEmail } from "../../../supabase/functions/email/templates.ts";
import { describeRole } from "../../../supabase/functions/team-invite/roles.ts";
import { setupSteps } from "./setup-steps";

describe("Stripe account status for a studio", () => {
  it("recognises the kind of key without exposing it", () => {
    expect(stripeKeyMode(undefined)).toBe("missing");
    expect(stripeKeyMode("")).toBe("missing");
    expect(stripeKeyMode("sk_test_abc")).toBe("test");
    expect(stripeKeyMode("sk_live_abc")).toBe("live");
    expect(stripeKeyMode("rk_live_abc")).toBe("live");
  });

  it("counts an account as connected only when Stripe will actually take payments for it", () => {
    expect(connectStatusFromAccount({ charges_enabled: true, details_submitted: true })).toEqual({ connected: true, chargesEnabled: true, detailsSubmitted: true });
    // Details handed in, Stripe still verifying: not connected yet.
    expect(connectStatusFromAccount({ charges_enabled: false, details_submitted: true }).connected).toBe(false);
    expect(connectStatusFromAccount({ charges_enabled: true, details_submitted: false }).connected).toBe(false);
    expect(connectStatusFromAccount({}).connected).toBe(false);
  });

  it("explains Stripe failures to the owner and never repeats Stripe's raw text", () => {
    const notEnabled = describeStripeError(new Error("You can only create new accounts if you've signed up for Connect, which you can do at https://dashboard.stripe.com/connect."));
    expect(notEnabled.problem).toBe("connect_not_enabled");
    expect(notEnabled.message).not.toMatch(/dashboard\.stripe\.com/);
    expect(describeStripeError(Object.assign(new Error("Invalid API Key provided: sk_test_****1234"), { type: "StripeAuthenticationError" }))).toEqual({
      problem: "stripe_key_rejected", message: "Stripe rejected this site's key.",
    });
    expect(describeStripeError(new Error("No such account: 'acct_123'")).problem).toBe("account_unavailable");
    expect(describeStripeError(new Error("boom")).problem).toBe("stripe_error");
    for (const error of [new Error("Invalid API Key provided: sk_test_secretvalue"), new Error("boom sk_live_x")]) {
      expect(describeStripeError(error).message).not.toMatch(/sk_(test|live)_/);
    }
  });

  it("refuses checkout without a connected account only when the deployment requires one", () => {
    expect(mustRefuseWithoutConnectedAccount(false, null)).toBe(false);
    expect(mustRefuseWithoutConnectedAccount(true, "acct_1")).toBe(false);
    expect(mustRefuseWithoutConnectedAccount(true, null)).toBe(true);
  });
});

describe("team invitation email", () => {
  const email = teamInviteEmail({
    studioName: "ROAM <Athletics>",
    inviterName: "Olive Owner",
    ...(() => { const role = describeRole("owner"); return { roleLabel: role.label, roleSummary: role.summary }; })(),
    email: "new.owner@example.test",
    expiresOn: "20 October 2026",
    registerUrl: "https://app.example.test/auth/register",
    signInUrl: "https://app.example.test/auth/login",
  });

  it("is in the studio's name, says who invited them, as what, and until when", () => {
    expect(email.subject).toBe("You have been invited to manage ROAM <Athletics>");
    expect(email.html).toContain("ROAM &lt;Athletics&gt;");
    expect(email.html).not.toContain("ROAM <Athletics>");
    for (const text of [email.html, email.text]) {
      expect(text).toContain("Olive Owner");
      expect(text).toContain("an owner");
      expect(text).toContain("new.owner@example.test");
      expect(text).toContain("20 October 2026");
      expect(text).toContain("https://app.example.test/auth/register");
    }
    expect(email.html).not.toMatch(/tandava|yoga/i);
  });

  it("carries no secret link: the address in it is the public sign-up page", () => {
    expect(email.html).not.toMatch(/token=|access_token|invite=|[?&]email=/);
    expect(email.text).not.toMatch(/token=|[?&]email=/);
  });

  it("describes each role it can grant", () => {
    expect(describeRole("owner").label).toBe("an owner");
    expect(describeRole("admin").label).toBe("a manager");
    expect(describeRole("teacher").label).toBe("a coach");
  });
});

describe("owner first-run checklist", () => {
  it("lists the six steps in order, each with somewhere to go", () => {
    const steps = setupSteps({ slug: "roam" });
    expect(steps.map((step) => step.key)).toEqual(["details_confirmed", "has_class_times", "has_prices", "stripe_connected", "public_booking", "has_booking"]);
    expect(steps.map((step) => step.to)).toEqual(["/manage/settings", "/manage/schedule", "/manage/offerings", "/manage/offerings#payments", "/manage/settings", "/s/roam/schedule"]);
  });
});
