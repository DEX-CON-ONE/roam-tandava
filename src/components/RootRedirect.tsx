import { useEffect, type ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { getRootRedirect, type RootRedirect as RootRedirectTarget } from "@/lib/root-redirect";

/** Sends the visitor to the configured root redirect (see lib/root-redirect.ts). */
export function RootRedirect({ target }: { target: RootRedirectTarget }) {
  useEffect(() => {
    if (target.kind === "external") window.location.replace(target.url);
  }, [target]);

  if (target.kind === "internal") return <Navigate to={target.path} replace />;

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
    </div>
  );
}

/**
 * Wraps the platform's own marketing pages (landing, demo, blog, tools). When a
 * root redirect is configured they are not part of this deployment, so a
 * visitor who reaches one by URL is redirected instead.
 */
export function MarketingRoute({ children }: { children: ReactNode }) {
  const target = getRootRedirect();
  return target ? <RootRedirect target={target} /> : <>{children}</>;
}
