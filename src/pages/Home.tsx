import { lazy } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { hasPermission } from "@/types/roles";
import { resolveStudioSlug } from "@/lib/studio-host";
import { getRootRedirect } from "@/lib/root-redirect";
import { RootRedirect } from "@/components/RootRedirect";

const NoPage = () => null;
const Demo = import.meta.env.VITE_ROOT_REDIRECT_URL ? NoPage : lazy(() => import("./Demo"));
const OpenSource = import.meta.env.VITE_ROOT_REDIRECT_URL ? NoPage : lazy(() => import("./OpenSource"));
const StudioStorefront = lazy(() => import("./StudioStorefront"));

/**
 * Root route (`/`) resolver.
 *
 * The demo landing (role picker + Oxatl sample data) is the front door ONLY on
 * demo or no-backend deployments. On a real production deployment it must never
 * appear at the root — a visitor to e.g. tandavastudio.com would otherwise see
 * a fictional studio's personas instead of a real entry point.
 *
 *   demo / no backend  → the demo landing (unchanged showcase behavior)
 *   production, guest  → the platform landing ("start your studio" / try demo),
 *                        or the configured root redirect (VITE_ROOT_REDIRECT_URL)
 *   production, signed in → their workspace (studio admin or member schedule)
 */
export default function Home() {
  const { isDemoMode, isLoading, user, profile, permissions } = useAuth();

  // Per-studio subdomain (e.g. oxatl.tandavastudio.com) → that studio's public
  // storefront. Off unless VITE_ROOT_DOMAIN is configured, so this never fires
  // on the apex, previews, localhost, or self-hosted single-domain setups.
  const studioSlug = resolveStudioSlug();
  if (studioSlug) return <StudioStorefront slug={studioSlug} />;

  // `isDemoMode` is true when VITE_DEMO_MODE is set OR no backend is configured.
  if (isDemoMode) return <Demo />;

  // Production: wait for the initial session check before choosing.
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  // Single-studio deployments (VITE_ROOT_REDIRECT_URL): an anonymous visitor
  // goes to the studio's own site or storefront, never the platform landing.
  // A signed-in user whose profile has not loaded stays inside the app.
  const rootRedirect = getRootRedirect();
  if (!profile && rootRedirect) {
    return user ? <Navigate to="/schedule" replace /> : <RootRedirect target={rootRedirect} />;
  }

  // Anonymous visitor → the platform landing.
  if (!profile) return <OpenSource />;

  // Signed-in user → their workspace. Owners/admins manage; everyone else books.
  return hasPermission(permissions, "studio.manage_schedule")
    ? <Navigate to="/manage" replace />
    : <Navigate to="/schedule" replace />;
}
