import { describe, expect, it, vi } from "vitest";
import { acsAuthorization, parseAcsConnectionString, sendAcsEmail } from "../../supabase/functions/email/acs.ts";
import { sendEmail } from "../../supabase/functions/email/provider.ts";

const config = parseAcsConnectionString("endpoint=https://example.communication.azure.com/;accesskey=a2V5")!;
const message = { to: "recipient@example.com", subject: "Subject", text: "Text", html: "<p>Text</p>" };

function fetchFor(statuses: string[], sendStatus = 202): typeof fetch {
  let index = 0;
  return vi.fn(async () => {
    if (index++ === 0) return new Response(JSON.stringify({ id: "operation_1" }), { status: sendStatus });
    return new Response(JSON.stringify({ status: statuses.shift() }), { status: 200 });
  }) as typeof fetch;
}

describe("ACS REST email provider", () => {
  it("signs the documented canonical string with Web Crypto", async () => {
    const signed = await acsAuthorization("GET", "/emails/operations/op?api-version=2023-03-31", "", config, "Mon, 06 Oct 2025 12:00:00 GMT");
    const expected = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(""));
    const hash = btoa(String.fromCharCode(...new Uint8Array(expected)));
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("key"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const canonical = `GET\n/emails/operations/op?api-version=2023-03-31\nMon, 06 Oct 2025 12:00:00 GMT;example.communication.azure.com;${hash}`;
    const expectedSignature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(canonical));
    expect(signed.contentHash).toBe(hash);
    expect(signed.authorization).toBe(`HMAC-SHA256 SignedHeaders=x-ms-date;host;x-ms-content-sha256&Signature=${btoa(String.fromCharCode(...new Uint8Array(expectedSignature)))}`);
  });

  it("accepts only Succeeded and treats failed, canceled, unknown, and timeout as failures", async () => {
    await expect(sendAcsEmail(config, "sender@example.com", message, fetchFor(["Running", "Succeeded"]), undefined, async () => {})).resolves.toEqual({ id: "operation_1" });
    for (const status of ["Failed", "Canceled", "Queued"]) {
      await expect(sendAcsEmail(config, "sender@example.com", message, fetchFor([status]), undefined, async () => {})).rejects.toThrow();
    }
    await expect(sendAcsEmail(config, "sender@example.com", message, fetchFor(["Running"]), undefined, async () => {}, 0)).rejects.toThrow("timed out");
    await expect(sendAcsEmail(config, "sender@example.com", message, fetchFor([], 500))).rejects.toThrow("send request failed");
  });

  it("rejects missing or malformed connection strings", () => {
    expect(parseAcsConnectionString(undefined)).toBeNull();
    expect(parseAcsConnectionString("endpoint=http://example.com;accesskey=key")).toBeNull();
    expect(parseAcsConnectionString("endpoint=https://example.com;accesskey=not-base64!")).toBeNull();
  });

  it("reports unconfigured ACS without making a network request", async () => {
    const runtime = globalThis as typeof globalThis & { Deno?: { env: { get(name: string): string | undefined } } };
    const savedDeno = runtime.Deno;
    const savedFetch = globalThis.fetch;
    const fetchMock = vi.fn();
    runtime.Deno = { env: { get: (name: string) => ({ EMAIL_PROVIDER: "acs" } as Record<string, string>)[name] } };
    globalThis.fetch = fetchMock as typeof fetch;

    try {
      await expect(sendEmail(message)).resolves.toEqual({ success: false, error: "ACS email provider not configured", provider: "acs" });
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = savedFetch;
      runtime.Deno = savedDeno;
    }
  });

  it("returns a recoverable safe failure when the ACS provider throws", async () => {
    const runtime = globalThis as typeof globalThis & { Deno?: { env: { get(name: string): string | undefined } } };
    const savedDeno = runtime.Deno;
    const savedFetch = globalThis.fetch;
    const secret = "fake-private-access-key";
    const recipient = "private-recipient@example.com";
    const subject = "private subject";
    const html = "private body";
    runtime.Deno = { env: { get: (name: string) => ({
      EMAIL_PROVIDER: "acs",
      AZURE_COMMUNICATION_CONNECTION_STRING: `endpoint=https://example.communication.azure.com/;accesskey=${btoa("fake-key")}`,
      AZURE_COMMUNICATION_SENDER_EMAIL: "sender@example.com",
    } as Record<string, string>)[name] } };
    globalThis.fetch = vi.fn(async () => { throw new Error(`${secret} ${recipient} ${subject} ${html}`); }) as typeof fetch;
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const result = await sendEmail({ to: recipient, subject, html });
      expect(result).toEqual({ success: false, error: "ACS email delivery failed", provider: "acs" });
      expect(logged).not.toHaveBeenCalled();
      expect(JSON.stringify(result)).not.toMatch(new RegExp(`${secret}|${recipient}|${subject}|${html}`));
    } finally {
      logged.mockRestore();
      globalThis.fetch = savedFetch;
      runtime.Deno = savedDeno;
    }
  });
});
