import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { MemberShell, MemberEmptyState, type MemberStudio } from "@/components/member/MemberShell";
import { useAuth } from "@/contexts/AuthContext";
import { memberApi } from "@/lib/member/api";
import { formatMoney, friendlyError, registerUrl, type CheckoutKind } from "@/lib/member/format";

const CYCLE: Record<string, string> = { weekly: "week", monthly: "month", quarterly: "quarter", annual: "year" };

function Plans({ studio }: { studio: MemberStudio }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const memberships = studio.storefront.memberships ?? [];
  const packs = studio.storefront.packs ?? [];

  const buy = async (kind: CheckoutKind, planId: string) => {
    if (!user) {
      navigate(registerUrl(`${location.pathname}${location.search}`));
      return;
    }
    setError(null);
    setPending(planId);
    const result = await memberApi.startCheckout({ slug: studio.slug, kind, planId });
    setPending(null);
    setError(friendlyError(result.error));
  };

  if (memberships.length === 0 && packs.length === 0) {
    return <MemberEmptyState title="No passes on sale yet" body={`${studio.name} has not published any passes or memberships yet.`} />;
  }

  return (
    <div className="space-y-8" data-testid="plans">
      {error && <Alert variant="destructive" data-testid="plans-error"><AlertDescription>{error}</AlertDescription></Alert>}

      {packs.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-semibold">Class passes</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {packs.map((pack) => (
              <Card key={pack.id} data-testid="plan-pack">
                <CardContent className="p-5">
                  <p className="font-medium">{pack.name}</p>
                  <p className="mt-1 text-2xl font-bold">{formatMoney(pack.price_cents, studio.currency)}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {pack.class_count} {pack.class_count === 1 ? "class" : "classes"} · valid for {pack.validity_days} days
                  </p>
                  {pack.description && <p className="mt-2 text-sm text-muted-foreground">{pack.description}</p>}
                  <Button className="mt-4 w-full" size="lg" onClick={() => buy("class_pack", pack.id)} disabled={pending !== null} data-testid="buy-pack">
                    {pending === pack.id ? "Opening secure payment..." : "Buy pass"}
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}

      {memberships.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-semibold">Memberships</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {memberships.map((plan) => (
              <Card key={plan.id} data-testid="plan-membership">
                <CardContent className="p-5">
                  <p className="font-medium">{plan.name}</p>
                  <p className="mt-1 text-2xl font-bold">
                    {formatMoney(plan.price_cents, studio.currency)}
                    <span className="text-sm font-normal text-muted-foreground"> / {CYCLE[plan.billing_cycle] ?? plan.billing_cycle}</span>
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {plan.classes_per_cycle == null ? "Unlimited classes" : `${plan.classes_per_cycle} classes each ${CYCLE[plan.billing_cycle] ?? "period"}`}
                  </p>
                  {plan.description && <p className="mt-2 text-sm text-muted-foreground">{plan.description}</p>}
                  <Button className="mt-4 w-full" size="lg" onClick={() => buy("membership", plan.id)} disabled={pending !== null} data-testid="buy-membership">
                    {pending === plan.id ? "Opening secure payment..." : "Start membership"}
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}
      <p className="text-center text-xs text-muted-foreground">Payments are taken securely by Stripe. You will return here when you are done.</p>
    </div>
  );
}

/** Passes and memberships on sale at a studio, bought through Stripe Checkout. */
export default function StudioPlans() {
  return (
    <MemberShell title="Passes">
      {(studio) => (
        <>
          <h1 className="mb-4 text-2xl font-bold tracking-tight">Passes and memberships</h1>
          <Plans studio={studio} />
        </>
      )}
    </MemberShell>
  );
}
