import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { MemberShell, MemberEmptyState, type MemberStudio } from "@/components/member/MemberShell";
import { useAuth } from "@/contexts/AuthContext";
import { useCancelMyBooking, useMyBookings, useMyPasses, type MyBooking } from "@/lib/member/api";
import { bookingStatusLabel, cancellationState, formatDateTime, friendlyError, registerUrl, signInUrl } from "@/lib/member/format";

const PAID_WITH: Record<string, string> = { membership: "Membership", class_pack: "Class pass", drop_in: "Paid online", other: "" };

function BookingRow({ booking, studio, onCancel, cancelling }: { booking: MyBooking; studio: MemberStudio; onCancel?: (booking: MyBooking) => void; cancelling: boolean }) {
  const state = cancellationState(booking);
  return (
    <Card data-testid="my-booking" data-status={booking.status} data-occurrence={booking.occurrence_id}>
      <CardContent className="flex items-center justify-between gap-3 p-4">
        <div className="min-w-0">
          <Link to={`/s/${studio.slug}/class/${booking.occurrence_id}`} className="block truncate font-medium hover:underline">{booking.offering_name}</Link>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {formatDateTime(booking.starts_at, studio.timezone)}
            {booking.location_name ? ` · ${booking.location_name}` : ""}
            {PAID_WITH[booking.paid_with] ? ` · ${PAID_WITH[booking.paid_with]}` : ""}
          </p>
          {booking.class_cancelled && <p className="mt-1 text-xs text-destructive">This class was cancelled by the studio.</p>}
          {onCancel && state === "late" && <p className="mt-1 text-xs text-muted-foreground">Inside the late-cancellation window: cancelling will not return the class to your pass.</p>}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <Badge variant={booking.status === "confirmed" ? "default" : "secondary"}>
            {bookingStatusLabel(booking.status)}{booking.status === "waitlisted" && booking.waitlist_position ? ` #${booking.waitlist_position}` : ""}
          </Badge>
          {onCancel && state !== "not_cancellable" && (
            <Button variant="outline" size="sm" onClick={() => onCancel(booking)} disabled={cancelling} data-testid="my-booking-cancel">Cancel</Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function Mine({ studio }: { studio: MemberStudio }) {
  const { user, isLoading: authLoading } = useAuth();
  const location = useLocation();
  const here = `${location.pathname}${location.search}`;
  const bookings = useMyBookings(studio.slug, Boolean(user));
  const passes = useMyPasses(studio.slug, Boolean(user));
  const cancel = useCancelMyBooking();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (authLoading) return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="Loading" /></div>;
  if (!user) {
    return (
      <MemberEmptyState title="Sign in to see your bookings" body="Your bookings, passes and memberships are kept in your account.">
        <Button asChild><Link to={signInUrl(here)}>Sign in</Link></Button>
        <Button asChild variant="outline"><Link to={registerUrl(here)}>Create account</Link></Button>
      </MemberEmptyState>
    );
  }
  if (bookings.isLoading || passes.isLoading) return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="Loading" /></div>;
  if (bookings.isError || passes.isError) return <MemberEmptyState title="We could not load your bookings" body="Please check your connection and try again." />;

  const now = Date.now();
  const all = bookings.data ?? [];
  const upcoming = all.filter((b) => new Date(b.starts_at).getTime() > now && ["confirmed", "waitlisted"].includes(b.status)).reverse();
  const past = all.filter((b) => !upcoming.includes(b));
  const activePacks = (passes.data?.packs ?? []);
  const memberships = (passes.data?.memberships ?? []);

  const onCancel = async (booking: MyBooking) => {
    setError(null);
    setNotice(null);
    try {
      const cancelled = await cancel.mutateAsync(booking.booking_id);
      setNotice(cancelled?.status === "late_cancel"
        ? `${booking.offering_name} is cancelled. It was inside the late-cancellation window, so the class is not returned to your pass.`
        : `${booking.offering_name} is cancelled.`);
    } catch (e) {
      setError(friendlyError(e instanceof Error ? e.message : String(e)));
    }
  };

  return (
    <div className="space-y-8" data-testid="my-bookings">
      {error && <Alert variant="destructive" data-testid="my-error"><AlertDescription>{error}</AlertDescription></Alert>}
      {notice && <Alert data-testid="my-notice"><AlertDescription>{notice}</AlertDescription></Alert>}

      <section>
        <h2 className="mb-3 text-lg font-semibold">Upcoming</h2>
        {upcoming.length === 0 ? (
          <Card><CardContent className="p-5 text-sm text-muted-foreground" data-testid="my-upcoming-empty">
            You have no upcoming bookings. <Link to={`/s/${studio.slug}/schedule`} className="text-primary underline">See the schedule</Link>
          </CardContent></Card>
        ) : (
          <div className="space-y-2" data-testid="my-upcoming">
            {upcoming.map((booking) => <BookingRow key={booking.booking_id} booking={booking} studio={studio} onCancel={onCancel} cancelling={cancel.isPending} />)}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Passes and memberships</h2>
        {activePacks.length === 0 && memberships.length === 0 ? (
          <Card><CardContent className="p-5 text-sm text-muted-foreground" data-testid="my-passes-empty">
            You do not have a pass or membership yet. <Link to={`/s/${studio.slug}/plans`} className="text-primary underline">See what is on sale</Link>
          </CardContent></Card>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2" data-testid="my-passes">
            {memberships.map((m) => (
              <Card key={m.id} data-testid="my-membership"><CardContent className="p-4">
                <div className="flex items-center justify-between gap-2"><p className="font-medium">{m.name}</p><Badge variant={m.status === "active" ? "default" : "secondary"}>{m.status.replace("_", " ")}</Badge></div>
                <p className="mt-1 text-sm">{m.classes_per_cycle == null ? "Unlimited classes" : `${Math.max(m.classes_per_cycle - m.classes_used_this_cycle, 0)} of ${m.classes_per_cycle} classes left this period`}</p>
                <p className="mt-1 text-xs text-muted-foreground">Current period ends {formatDateTime(m.current_period_end, studio.timezone)}</p>
              </CardContent></Card>
            ))}
            {activePacks.map((p) => (
              <Card key={p.id} data-testid="my-pack" data-remaining={p.classes_remaining}><CardContent className="p-4">
                <div className="flex items-center justify-between gap-2"><p className="font-medium">{p.name}</p><Badge variant={p.status === "active" ? "default" : "secondary"}>{p.status}</Badge></div>
                <p className="mt-1 text-sm"><span data-testid="my-pack-remaining">{p.classes_remaining}</span> of {p.classes_total} classes left</p>
                <p className="mt-1 text-xs text-muted-foreground">Valid until {formatDateTime(p.expires_at, studio.timezone)}</p>
              </CardContent></Card>
            ))}
          </div>
        )}
      </section>

      {past.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-semibold">Past and cancelled</h2>
          <div className="space-y-2" data-testid="my-past">
            {past.map((booking) => <BookingRow key={booking.booking_id} booking={booking} studio={studio} cancelling={false} />)}
          </div>
        </section>
      )}
    </div>
  );
}

/** The signed-in member's bookings (upcoming, past) and passes at a studio. */
export default function MyBookings() {
  return (
    <MemberShell title="My bookings">
      {(studio) => (
        <>
          <h1 className="mb-4 text-2xl font-bold tracking-tight">My bookings</h1>
          <Mine studio={studio} />
        </>
      )}
    </MemberShell>
  );
}
