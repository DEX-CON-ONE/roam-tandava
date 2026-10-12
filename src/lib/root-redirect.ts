/**
 * Root redirect for single-studio deployments.
 *
 * By default an anonymous visitor to `/` sees the platform landing page, and
 * the demo, blog and tools pages are public. A studio that runs this app only
 * as its own booking system does not want customers to land on any of that.
 *
 * Set VITE_ROOT_REDIRECT_URL at build time to send those visitors elsewhere:
 *   - an absolute https URL (the studio's website), or
 *   - a path in this app (e.g. `/s/my-studio`, the studio storefront).
 * Unset (the default), behaviour is unchanged.
 *
 * Signed-in users are never redirected away: `/` still takes them to their
 * workspace, so sign-in, email confirmation and the admin keep working.
 */

export type RootRedirect =
  | { kind: "external"; url: string }
  | { kind: "internal"; path: string };

/** Pure parser, so the accepted forms can be tested exhaustively. */
export function resolveRootRedirect(value: string | undefined | null): RootRedirect | null {
  const raw = (value ?? "").trim();
  if (!raw) return null;

  // A path in this app. `//host` is protocol-relative (external) and `/` would loop.
  if (raw.startsWith("/")) {
    if (raw.startsWith("//") || raw === "/" || /[\s\\]/.test(raw)) return null;
    return { kind: "internal", path: raw };
  }

  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && url.hostname === "localhost")) return null;
    if (url.username || url.password) return null;
    return { kind: "external", url: url.toString() };
  } catch {
    return null;
  }
}

/** The redirect configured for this build, or null. */
export function getRootRedirect(): RootRedirect | null {
  return resolveRootRedirect(import.meta.env.VITE_ROOT_REDIRECT_URL as string | undefined);
}
