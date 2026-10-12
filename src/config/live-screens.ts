/**
 * Live-data-only mode.
 *
 * Most screens in this app are still interactive mock-ups: they render
 * hard-coded sample records (classes, members, teachers, audit entries,
 * revenue) and their actions only change local state. That is right for the
 * demo, and wrong for a real studio, where an owner or customer would be
 * looking at records that do not exist.
 *
 * Set VITE_LIVE_DATA_ONLY=true to show only the screens that read and write
 * the real backend. Every other route renders a plain "not available yet"
 * state instead of sample data, its code is left out of the bundle, and its
 * navigation entries are hidden. Unset (the default), nothing changes.
 *
 * When a screen is wired to the backend, add its route path here.
 */
export const LIVE_DATA_ONLY = import.meta.env.VITE_LIVE_DATA_ONLY === "true";

/** Route paths (as written in App.tsx) whose screens use real data only. */
export const LIVE_ROUTE_PATHS: readonly string[] = [
  "/", // resolver only: redirects by session
  "/s/:slug", // public storefront: studio, schedule, plans from the database
  "/s/:slug/schedule", // member journey: live schedule (get_studio_schedule)
  "/s/:slug/class/:occurrenceId", // class detail + booking (book_class / stripe-checkout)
  "/s/:slug/plans", // passes and memberships on sale (stripe-checkout)
  "/s/:slug/my", // my bookings and passes (get_my_bookings / get_my_passes)
  "/s/:slug/checkout/:outcome", // return from Stripe: polls the real state
  "/auth/login",
  "/auth/register",
  "/auth/reset",
  "/auth/reset-confirm",
  "/auth/callback",
  "/embed/schedule/:slug", // public schedule widget: database
  "/manage", // owner dashboard: manage_dashboard RPC
  "/manage/schedule", // class types, weekly schedules, sessions
  "/manage/sessions/:id", // session roster and attendance
  "/manage/students", // members list and search
  "/manage/members/:id", // one member: passes, bookings, payments
  "/manage/offerings", // drop-in prices, class packs, memberships
  "/manage/financials", // payments recorded by the Stripe webhook
  "/manage/settings", // studio name, booking page, cancellation window, colours
  "/manage/onboarding", // studio setup wizard: onboarding Edge Function
  "/manage/import", // member import: import-members Edge Function
  "/manage/embed", // embed snippet generator: no records shown
  "*", // not-found page
];

export function isLiveRoute(path: string): boolean {
  return LIVE_ROUTE_PATHS.includes(path);
}
