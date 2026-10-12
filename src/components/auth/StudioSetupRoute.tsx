import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { getSetupAccess } from "@/lib/owner/api";

const Loading = () => (
  <div className="min-h-screen flex items-center justify-center bg-background">
    <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
  </div>
);

function useSetupAccess() {
  const { user, isDemoMode } = useAuth();
  return useQuery({
    queryKey: ["owner", "setup-access", user?.id ?? null],
    queryFn: getSetupAccess,
    enabled: !isDemoMode && Boolean(user),
    retry: false,
    staleTime: 0,
  });
}

/**
 * Guards the studio setup wizard. The database decides who may use it
 * (studio_setup_access, migration 00031): an existing owner, or an account
 * allowed to create a studio. In single-studio mode that is only an
 * allow-listed owner email, and only until the studio exists. Everyone else is
 * sent away; if the check itself fails, the wizard stays closed.
 *
 * This is the convenience layer: the onboarding function and the database
 * triggers refuse the same accounts whatever the browser does.
 */
export function StudioSetupRoute({ children }: { children: ReactNode }) {
  const { isDemoMode } = useAuth();
  const access = useSetupAccess();
  if (isDemoMode) return <>{children}</>;
  if (access.isLoading) return <Loading />;
  if (access.error || !access.data?.can_open_setup) return <Navigate to="/" replace />;
  return <>{children}</>;
}

/** Renders its children only for an account that may create a studio (hides the offer from everyone else). */
export function StudioSetupOnly({ children }: { children: ReactNode }) {
  const { isDemoMode } = useAuth();
  const access = useSetupAccess();
  if (isDemoMode) return <>{children}</>;
  return access.data?.can_create_studio ? <>{children}</> : null;
}

/** Sends an account that may create the studio to the setup wizard; anyone else gets `fallback`. */
export function StudioSetupRedirect({ fallback }: { fallback: ReactNode }) {
  const access = useSetupAccess();
  if (access.isLoading) return <Loading />;
  if (access.data?.can_create_studio) return <Navigate to="/manage/onboarding" replace />;
  return <>{fallback}</>;
}
