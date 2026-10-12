import { useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { CheckCircle2, Clock, Loader2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MemberShell, type MemberStudio } from "@/components/member/MemberShell";
import { useAuth } from "@/contexts/AuthContext";
import { memberApi } from "@/lib/member/api";
import { useQueryClient } from "@tanstack/react-query";

const POLL_MS = 2000;
const GIVE_UP_MS = 90_000;

type Phase = "checking" | "confirmed" | "pending";

/**
 * Has the purchase actually landed? Asks the database, which only changes when
 * the Stripe webhook has been received and processed. Never assumes success
 * from the fact that Stripe redirected here.
 */
async function purchaseLanded(studio: MemberStudio, kind: string, occurrenceId: string | null, startedAt: number): Promise<boolean> {
  if (kind === "drop_in" && occurrenceId) {
    const options = await memberApi.bookingOptions(occurrenceId);
    return options.my_booking_status === "confirmed";
  }
  const passes = await memberApi.myPasses(studio.slug);
  const since = startedAt - 5 * 60 * 1000; // allow for clock differences
  if (kind === "class_pack") return passes.packs.some((pack) => new Date(pack.purchased_at).getTime() >= since);
  if (kind === "membership") return passes.memberships.some((m) => new Date(m.started_at).getTime() >= since && m.status === "active");
  return false;
}

function Outcome({ studio }: { studio: MemberStudio }) {
  const { outcome } = useParams();
  const [params] = useSearchParams();
  const { user, isLoading: authLoading } = useAuth();
  const queryClient = useQueryClient();
  const kind = params.get("kind") ?? "";
  const occurrenceId = params.get("occ");
  const startedAt = Number(params.get("t")) || Date.now();
  const [phase, setPhase] = useState<Phase>("checking");
  const began = useRef(Date.now());

  useEffect(() => {
    if (outcome !== "success" || authLoading || !user) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        if (await purchaseLanded(studio, kind, occurrenceId, startedAt)) {
          if (!stopped) {
            setPhase("confirmed");
            void queryClient.invalidateQueries({ queryKey: ["member"] });
          }
          return;
        }
      } catch {
        // keep trying until the deadline
      }
      if (stopped) return;
      if (Date.now() - began.current > GIVE_UP_MS) setPhase("pending");
      else timer = setTimeout(tick, POLL_MS);
    };
    void tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [outcome, authLoading, user, studio, kind, occurrenceId, startedAt, queryClient]);

  const what = kind === "drop_in" ? "class" : kind === "membership" ? "membership" : "pass";

  if (outcome !== "success") {
    return (
      <div className="py-12 text-center" data-testid="checkout-cancelled">
        <XCircle className="mx-auto h-12 w-12 text-muted-foreground" />
        <h1 className="mt-4 text-xl font-semibold">Payment cancelled</h1>
        <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">You left the payment page before paying, so nothing has been charged and nothing has been booked.</p>
        <div className="mt-6 flex justify-center gap-3">
          <Button asChild><Link to={occurrenceId ? `/s/${studio.slug}/class/${occurrenceId}` : `/s/${studio.slug}/plans`}>Try again</Link></Button>
          <Button asChild variant="outline"><Link to={`/s/${studio.slug}/schedule`}>Schedule</Link></Button>
        </div>
      </div>
    );
  }

  if (!authLoading && !user) {
    return (
      <div className="py-12 text-center" data-testid="checkout-signed-out">
        <Clock className="mx-auto h-12 w-12 text-muted-foreground" />
        <h1 className="mt-4 text-xl font-semibold">Sign in to see your purchase</h1>
        <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">Your payment is handled by Stripe. Sign in to check that your {what} has arrived.</p>
        <Button asChild className="mt-6"><Link to={`/auth/login?next=${encodeURIComponent(`/s/${studio.slug}/my`)}`}>Sign in</Link></Button>
      </div>
    );
  }

  if (phase === "checking") {
    return (
      <div className="py-12 text-center" data-testid="checkout-checking">
        <Loader2 className="mx-auto h-12 w-12 animate-spin text-muted-foreground" />
        <h1 className="mt-4 text-xl font-semibold">Confirming your payment</h1>
        <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">We are waiting for Stripe to confirm the payment. This usually takes a few seconds. Please keep this page open.</p>
      </div>
    );
  }

  if (phase === "pending") {
    return (
      <div className="py-12 text-center" data-testid="checkout-pending">
        <Clock className="mx-auto h-12 w-12 text-muted-foreground" />
        <h1 className="mt-4 text-xl font-semibold">We have not had confirmation yet</h1>
        <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
          Your {what} has not appeared in your account yet. If you completed the payment it should arrive shortly: check My bookings in a minute. If it does not, contact {studio.name} before paying again.
        </p>
        <Button asChild className="mt-6"><Link to={`/s/${studio.slug}/my`}>My bookings</Link></Button>
      </div>
    );
  }

  return (
    <div className="py-12 text-center" data-testid="checkout-confirmed" data-kind={kind}>
      <CheckCircle2 className="mx-auto h-12 w-12 text-primary" />
      <h1 className="mt-4 text-xl font-semibold">{kind === "drop_in" ? "You are booked in" : kind === "membership" ? "Your membership is active" : "Your pass is ready"}</h1>
      <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
        {kind === "drop_in" ? "Payment received and your place is confirmed." : "Payment received. You can use it to book classes now."}
      </p>
      <div className="mt-6 flex justify-center gap-3">
        <Button asChild><Link to={kind === "drop_in" ? `/s/${studio.slug}/my` : `/s/${studio.slug}/schedule`} data-testid="checkout-continue">{kind === "drop_in" ? "My bookings" : "Book a class"}</Link></Button>
        {kind !== "drop_in" && <Button asChild variant="outline"><Link to={`/s/${studio.slug}/my`}>My passes</Link></Button>}
      </div>
    </div>
  );
}

/** Where Stripe Checkout returns to. Shows the real state of the purchase, polled from the database. */
export default function CheckoutReturn() {
  return <MemberShell title="Payment">{(studio) => <Outcome studio={studio} />}</MemberShell>;
}
