const API_VERSION = "2023-03-31";
const POLL_INTERVAL_MS = 1_000;
const POLL_TIMEOUT_MS = 20_000;

type AcsConfig = { endpoint: string; accessKey: string };

export function parseAcsConnectionString(value: string | undefined): AcsConfig | null {
  if (!value) return null;
  const fields = Object.fromEntries(value.split(";").map((part) => {
    const separator = part.indexOf("=");
    return separator < 0 ? ["", ""] : [part.slice(0, separator).trim().toLowerCase(), part.slice(separator + 1).trim()];
  }));
  try {
    const endpoint = new URL(fields.endpoint);
    if (endpoint.protocol !== "https:" || !fields.accesskey || !/^[A-Za-z0-9+/]+=*$/.test(fields.accesskey)) return null;
    atob(fields.accesskey);
    return { endpoint: endpoint.origin, accessKey: fields.accesskey };
  } catch {
    return null;
  }
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function bytesFromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

export async function acsAuthorization(
  method: string,
  pathAndQuery: string,
  body: string,
  config: AcsConfig,
  date: string,
): Promise<{ authorization: string; contentHash: string; host: string }> {
  const host = new URL(config.endpoint).host;
  const contentHash = base64(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body))));
  const stringToSign = `${method.toUpperCase()}\n${pathAndQuery}\n${date};${host};${contentHash}`;
  const key = await crypto.subtle.importKey("raw", bytesFromBase64(config.accessKey), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = base64(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(stringToSign))));
  return {
    authorization: `HMAC-SHA256 SignedHeaders=x-ms-date;host;x-ms-content-sha256&Signature=${signature}`,
    contentHash,
    host,
  };
}

export async function sendAcsEmail(
  config: AcsConfig,
  sender: string,
  message: { to: string; subject: string; text?: string; html: string; replyTo?: string },
  fetcher: typeof fetch = fetch,
  now: () => Date = () => new Date(),
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  timeoutMs = POLL_TIMEOUT_MS,
): Promise<{ id: string }> {
  const sendPath = `/emails:send?api-version=${API_VERSION}`;
  const sendBody = JSON.stringify({
    senderAddress: sender,
    content: { subject: message.subject, plainText: message.text ?? "", html: message.html },
    recipients: { to: [{ address: message.to }] },
    replyTo: message.replyTo ? [{ address: message.replyTo }] : undefined,
  });
  const request = async (method: string, path: string, body = "") => {
    const date = now().toUTCString();
    const signed = await acsAuthorization(method, path, body, config, date);
    return fetcher(`${config.endpoint}${path}`, {
      method,
      headers: {
        "x-ms-date": date,
        "x-ms-content-sha256": signed.contentHash,
        "Content-Type": "application/json",
        Authorization: signed.authorization,
      },
      ...(method === "POST" ? { body } : {}),
    });
  };

  const response = await request("POST", sendPath, sendBody);
  if (response.status !== 202) throw new Error("ACS email send request failed");
  let operationId = response.headers.get("Operation-Id") ?? "";
  const operationLocation = response.headers.get("Operation-Location");
  if (!operationId && operationLocation) {
    const match = new URL(operationLocation).pathname.match(/\/operations\/([^/]+)$/);
    operationId = match?.[1] ?? "";
  }
  try {
    const payload = await response.json();
    operationId ||= typeof payload.id === "string" ? payload.id : "";
  } catch {
    // Operation-Id header is sufficient when the response has no JSON body.
  }
  if (!operationId || !/^[A-Za-z0-9_-]+$/.test(operationId)) throw new Error("ACS email operation id missing");

  const pollPath = `/emails/operations/${encodeURIComponent(operationId)}?api-version=${API_VERSION}`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(Math.min(POLL_INTERVAL_MS, deadline - Date.now()));
    const poll = await request("GET", pollPath);
    if (!poll.ok) throw new Error("ACS email status request failed");
    const payload = await poll.json();
    const status = typeof payload.status === "string" ? payload.status : "";
    if (status === "Succeeded") return { id: operationId };
    if (status === "Failed" || status === "Canceled") throw new Error(`ACS email ${status.toLowerCase()}`);
    if (status !== "NotStarted" && status !== "Running") throw new Error("ACS email returned an unknown status");
  }
  throw new Error("ACS email status polling timed out");
}
