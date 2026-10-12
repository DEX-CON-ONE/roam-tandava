/**
 * Remembering where a visitor was going when they were sent to sign in or
 * register, so they land back on the class they wanted to book. Survives the
 * email-confirmation and Google round trips (both come back to "/").
 */
import { safeNextPath } from "./format";

const KEY = "booking:post-auth-next";
const MAX_AGE_MS = 2 * 60 * 60 * 1000;

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Call on the sign-in / register pages: remembers a valid ?next= path. */
export function rememberNextFromUrl(search: string): string | null {
  const next = safeNextPath(new URLSearchParams(search).get("next"));
  if (next) storage()?.setItem(KEY, JSON.stringify({ path: next, at: Date.now() }));
  return next;
}

export function peekNext(): string | null {
  try {
    const raw = storage()?.getItem(KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as { path?: string; at?: number };
    if (!saved.at || Date.now() - saved.at > MAX_AGE_MS) return null;
    return safeNextPath(saved.path);
  } catch {
    return null;
  }
}

/** Read and clear. */
export function takeNext(): string | null {
  const next = peekNext();
  storage()?.removeItem(KEY);
  return next;
}

/**
 * Where a signed-in member goes when nothing more specific is known. Set
 * VITE_DEFAULT_STUDIO_SLUG on a single-studio deployment.
 */
export function defaultMemberHome(): string | null {
  const slug = (import.meta.env.VITE_DEFAULT_STUDIO_SLUG as string | undefined)?.trim();
  return slug && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(slug) ? `/s/${slug}/schedule` : null;
}
