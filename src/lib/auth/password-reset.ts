/**
 * Password reset helpers shared by the request page, the set-new-password
 * page and the backend provider, so the routes, the emailed redirect and the
 * validation rules cannot drift apart.
 */

/** Page where a user asks for a reset email. Linked from the sign-in page. */
export const PASSWORD_RESET_REQUEST_PATH = "/auth/reset";

/** Page the emailed link lands on; the user sets a new password here. */
export const PASSWORD_RESET_CONFIRM_PATH = "/auth/reset-confirm";

/** Same minimum the registration form enforces. */
export const MIN_PASSWORD_LENGTH = 8;

/**
 * Absolute URL put in the reset email. It must be covered by the Supabase Auth
 * redirect allow-list (e.g. `https://your-host/**`), or Supabase falls back to
 * the site URL and the user never reaches the set-new-password page.
 */
export function passwordResetRedirectUrl(origin: string): string {
  return `${origin.replace(/\/+$/, "")}${PASSWORD_RESET_CONFIRM_PATH}`;
}

export type NewPasswordProblem = "tooShort" | "mismatch";

export function validateNewPassword(password: string, confirmation: string): NewPasswordProblem | null {
  if (password.length < MIN_PASSWORD_LENGTH) return "tooShort";
  if (password !== confirmation) return "mismatch";
  return null;
}

/**
 * Supabase reports a bad or expired recovery link in the URL fragment (or the
 * query string), e.g. `#error=access_denied&error_code=otp_expired&...`.
 * Returns the error code, or null when the URL carries no error.
 */
export function recoveryLinkError(hash: string, search = ""): string | null {
  for (const part of [hash.replace(/^#/, ""), search.replace(/^\?/, "")]) {
    if (!part) continue;
    const params = new URLSearchParams(part);
    const code = params.get("error_code") || params.get("error");
    if (code) return code;
  }
  return null;
}
