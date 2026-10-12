import type { ReactNode } from "react";
import { Link, NavLink, useLocation, useParams } from "react-router-dom";
import { CalendarDays, Loader2, LogIn, LogOut, Ticket, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BrandMark } from "@/components/BrandMark";
import { SEOHead } from "@/components/seo/SEOHead";
import { useAuth } from "@/contexts/AuthContext";
import { useStudioStorefront } from "@/hooks/useBooking";
import { isBackendConfigured } from "@/lib/backend";
import { brand } from "@/config/brand";
import { cn } from "@/lib/utils";
import { signInUrl } from "@/lib/member/format";
import type { StudioStorefront } from "@/types/database";

export interface MemberStudio {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  currency: string;
  accent: string | null;
  storefront: StudioStorefront;
}

function EmptyState({ title, body, children }: { title: string; body: string; children?: ReactNode }) {
  return (
    <div className="py-16 text-center" data-testid="member-empty">
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">{body}</p>
      {children && <div className="mt-6 flex justify-center gap-3">{children}</div>}
    </div>
  );
}

/**
 * Frame for the member booking screens of one studio (/s/:slug/...): header,
 * three-item navigation that works one-handed on a phone, and the studio's
 * public record loaded once. Children render only when the studio exists.
 */
export function MemberShell({ title, children }: { title: string; children: (studio: MemberStudio) => ReactNode }) {
  const { slug } = useParams();
  const location = useLocation();
  const { user, isLoading: authLoading, signOut } = useAuth();
  const { data: storefront, isLoading, isError } = useStudioStorefront(slug);
  const base = `/s/${slug}`;
  const here = `${location.pathname}${location.search}`;

  const studio: MemberStudio | null = storefront
    ? {
        id: storefront.studio.id,
        name: storefront.studio.name,
        slug: storefront.studio.slug,
        timezone: storefront.studio.timezone,
        currency: storefront.studio.currency,
        accent: storefront.studio.primary_color || null,
        storefront,
      }
    : null;

  const nav = [
    { to: `${base}/schedule`, label: "Schedule", icon: CalendarDays },
    { to: `${base}/plans`, label: "Passes", icon: Ticket },
    { to: `${base}/my`, label: "My bookings", icon: UserRound },
  ];

  return (
    <div className="min-h-screen bg-background pb-20 sm:pb-0">
      <SEOHead title={studio ? `${title} | ${studio.name}` : title} canonical={here} noindex />
      <header className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between gap-3 px-4">
          <Link to={base} className="flex min-w-0 items-center gap-2" data-testid="member-home-link">
            <BrandMark size="sm" />
            <span className="truncate font-semibold tracking-tight">{studio?.name ?? brand.name}</span>
          </Link>
          <nav className="hidden items-center gap-1 sm:flex" aria-label="Booking">
            {nav.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) => cn("rounded-md px-3 py-2 text-sm font-medium", isActive ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground")}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          {authLoading ? null : user ? (
            <Button variant="ghost" size="sm" onClick={() => void signOut()} data-testid="member-sign-out">
              <LogOut className="me-1.5 h-4 w-4" />Sign out
            </Button>
          ) : (
            <Button asChild variant="outline" size="sm">
              <Link to={signInUrl(here)} data-testid="member-sign-in"><LogIn className="me-1.5 h-4 w-4" />Sign in</Link>
            </Button>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-6">
        {!isBackendConfigured() ? (
          <EmptyState title="Booking is not connected" body="This deployment has no booking system configured." />
        ) : isLoading ? (
          <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="Loading" /></div>
        ) : isError ? (
          <EmptyState title="We could not load this page" body="Please check your connection and try again." />
        ) : !studio ? (
          <EmptyState title="Online booking is not open yet" body={`Booking with ${brand.name} is still being set up. Please check back soon.`} />
        ) : (
          children(studio)
        )}
      </main>

      {/* Phone navigation: thumb-reachable, always visible. */}
      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background sm:hidden" aria-label="Booking">
        <div className="mx-auto grid max-w-3xl grid-cols-3">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => cn("flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium", isActive ? "text-primary" : "text-muted-foreground")}
            >
              <item.icon className="h-5 w-5" />
              {item.label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}

export { EmptyState as MemberEmptyState };
