/**
 * Which social sign-in buttons to show. A button for a provider that is not
 * enabled on the backend only produces an error, so each one is opt-in:
 *
 *   VITE_AUTH_GOOGLE_ENABLED=true   once Google is enabled in Supabase Auth
 *   VITE_AUTH_APPLE_ENABLED=true    once Apple is enabled in Supabase Auth
 *
 * Demo builds (VITE_DEMO_MODE=true) show both, since nothing is called.
 */
export function resolveAuthProviders(env: Record<string, string | undefined>) {
  const demo = env.VITE_DEMO_MODE === "true";
  const google = demo || env.VITE_AUTH_GOOGLE_ENABLED === "true";
  const apple = demo || env.VITE_AUTH_APPLE_ENABLED === "true";
  return { google, apple, any: google || apple, count: Number(google) + Number(apple) };
}

export const authProviders = resolveAuthProviders(import.meta.env as unknown as Record<string, string | undefined>);
