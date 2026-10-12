import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { BrandMark } from "@/components/BrandMark";
import { useAuth } from "@/contexts/AuthContext";
import { brand } from "@/config/brand";
import { LIVE_DATA_ONLY } from "@/config/live-screens";
import { getRootRedirect } from "@/lib/root-redirect";
import { hasPermission } from "@/types/roles";

/**
 * Empty state for a screen that is not wired to real data yet. Shown instead
 * of the screen's sample data in live-data-only mode (see config/live-screens).
 */
export function NotAvailableYet() {
  const { t } = useTranslation("common");
  const { user, permissions, signOut } = useAuth();
  const site = getRootRedirect();
  const canManage = hasPermission(permissions, "studio.manage_schedule");

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-8">
      <div className="w-full max-w-md space-y-6 text-center">
        <BrandMark size="lg" />
        <div className="space-y-2">
          <h1 className="text-2xl font-bold tracking-tight">{t("notAvailable.title", "Not available yet")}</h1>
          <p className="text-muted-foreground">
            {t("notAvailable.body", "This part of {{brandName}} is still being set up. Please check back soon.", { brandName: brand.name })}
          </p>
        </div>
        <div className="space-y-3">
          {canManage && (
            <Button asChild className="w-full" size="lg">
              <Link to="/manage/onboarding">{t("notAvailable.studioSetup", "Open studio setup")}</Link>
            </Button>
          )}
          {site?.kind === "external" && (
            <Button asChild variant={canManage ? "outline" : "default"} className="w-full" size="lg">
              <a href={site.url}>{t("notAvailable.backToSite", "Back to {{brandName}}", { brandName: brand.name })}</a>
            </Button>
          )}
          {site?.kind === "internal" && (
            <Button asChild variant={canManage ? "outline" : "default"} className="w-full" size="lg">
              <Link to={site.path}>{t("notAvailable.backToSite", "Back to {{brandName}}", { brandName: brand.name })}</Link>
            </Button>
          )}
          {user ? (
            <Button variant="ghost" className="w-full" onClick={() => void signOut()}>
              {t("notAvailable.signOut", "Sign out")}
            </Button>
          ) : (
            <Button asChild variant="ghost" className="w-full">
              <Link to="/auth/login">{t("notAvailable.signIn", "Sign in")}</Link>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Wraps a route that still renders sample data; replaced by the empty state in live-data-only mode. */
export function LiveOnly({ children }: { children: ReactNode }) {
  return LIVE_DATA_ONLY ? <NotAvailableYet /> : <>{children}</>;
}
