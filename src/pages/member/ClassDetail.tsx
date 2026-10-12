import { useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, CalendarDays, CheckCircle2, Clock, Loader2, MapPin, User, Users } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { MemberShell, MemberEmptyState, type MemberStudio } from "@/components/member/MemberShell";
import { useAuth } from "@/contexts/AuthContext";
import { memberApi, useBookWithPass, useBookingOptions, useCancelMyBooking, useStudioSchedule, type BookingSource } from "@/lib/member/api";
import { availabilityLabel, formatDay, formatMoney, formatTime, friendlyError, registerUrl, signInUrl } from "@/lib/member/format";

function Detail({ studio }: { studio: MemberStudio }) {
  const { occurrenceId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { user, isLoading: authLoading } = useAuth();
  const here = `${location.pathname}${location.search}`;
  const schedule = useStudioSchedule(studio.slug, 60);
  const options = useBookingOptions(occurrenceId, Boolean(user));
  const book = useBookWithPass();
  const cancel = useCancelMyBooking();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);

  if (schedule.isLoading) return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="Loading" /></div>;
  const row = schedule.data?.find((candidate) => candidate.occurrence_id === occurrenceId);
  if (!row) {
    return (
      <MemberEmptyState title="This class is not available" body="It may have finished, been cancelled or moved.">
        <Button asChild><Link to={`/s/${studio.slug}/schedule`}>See the schedule</Link></Button>
      </MemberEmptyState>
    );
  }

  const opts = options.data;
  const myStatus = opts?.my_booking_status ?? row.my_booking_status;
  const myBookingId = opts?.my_booking_id ?? row.my_booking_id;
  const isFull = opts?.is_full ?? row.booked_count >= row.capacity;
  const usable = (opts?.sources ?? []).filter((source) => !source.reason);
  const unusable = (opts?.sources ?? []).filter((source) => source.reason);
  const dropIn = opts?.drop_in_price_cents ?? row.drop_in_price_cents;
  const busy = book.isPending || cancel.isPending || paying;

  const bookWith = async (source: BookingSource) => {
    setError(null);
    setNotice(null);
    try {
      const booking = await book.mutateAsync({ occurrenceId: row.occurrence_id, source });
      setNotice(booking?.status === "waitlisted" ? "You are on the waitlist. We will book you in if a space opens." : "You are booked in.");
    } catch (e) {
      setError(friendlyError(e instanceof Error ? e.message : String(e)));
    }
  };

  const payDropIn = async () => {
    setError(null);
    setPaying(true);
    const result = await memberApi.startCheckout({ slug: studio.slug, kind: "drop_in", occurrenceId: row.occurrence_id });
    setPaying(false);
    setError(friendlyError(result.error));
  };

  const cancelMine = async () => {
    if (!myBookingId) return;
    setError(null);
    setNotice(null);
    try {
      const cancelled = await cancel.mutateAsync(myBookingId);
      setNotice(cancelled?.status === "late_cancel"
        ? "Your booking is cancelled. It was inside the late-cancellation window, so the class is not returned to your pass."
        : "Your booking is cancelled.");
    } catch (e) {
      setError(friendlyError(e instanceof Error ? e.message : String(e)));
    }
  };

  return (
    <div className="space-y-6" data-testid="class-detail">
      <button type="button" onClick={() => navigate(`/s/${studio.slug}/schedule`)} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" />Schedule
      </button>

      <div>
        <h1 className="text-2xl font-bold tracking-tight" data-testid="class-name">{row.offering_name}</h1>
        <dl className="mt-3 space-y-1.5 text-sm text-muted-foreground">
          <div className="flex items-center gap-2"><CalendarDays className="h-4 w-4 shrink-0" /><dd>{formatDay(row.starts_at, studio.timezone)}</dd></div>
          <div className="flex items-center gap-2"><Clock className="h-4 w-4 shrink-0" /><dd>{formatTime(row.starts_at, studio.timezone)} to {formatTime(row.ends_at, studio.timezone)}</dd></div>
          {row.teacher_name && <div className="flex items-center gap-2"><User className="h-4 w-4 shrink-0" /><dd>{row.teacher_name}</dd></div>}
          {(row.location_name || row.location_address) && (
            <div className="flex items-center gap-2"><MapPin className="h-4 w-4 shrink-0" /><dd>{[row.location_name, row.location_address].filter(Boolean).join(", ")}</dd></div>
          )}
          <div className="flex items-center gap-2"><Users className="h-4 w-4 shrink-0" /><dd data-testid="class-availability">{availabilityLabel(row)} of {row.capacity}</dd></div>
        </dl>
        {row.offering_description && <p className="mt-4 text-sm leading-relaxed">{row.offering_description}</p>}
      </div>

      {error && <Alert variant="destructive" data-testid="booking-error"><AlertDescription>{error}</AlertDescription></Alert>}
      {notice && <Alert data-testid="booking-notice"><AlertDescription>{notice}</AlertDescription></Alert>}

      <Card>
        <CardContent className="space-y-4 p-5">
          {authLoading || (user && options.isLoading) ? (
            <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading" /></div>
          ) : !user ? (
            <div className="space-y-3" data-testid="booking-signed-out">
              <p className="text-sm">Sign in or create an account to book this class.</p>
              <div className="grid grid-cols-2 gap-3">
                <Button asChild size="lg"><Link to={registerUrl(here)}>Create account</Link></Button>
                <Button asChild size="lg" variant="outline"><Link to={signInUrl(here)}>Sign in</Link></Button>
              </div>
            </div>
          ) : options.isError ? (
            <p className="text-sm text-destructive">{friendlyError(options.error instanceof Error ? options.error.message : "")}</p>
          ) : myStatus === "confirmed" || myStatus === "waitlisted" ? (
            <div className="space-y-3" data-testid="booking-mine">
              <p className="flex items-center gap-2 font-medium">
                <CheckCircle2 className="h-5 w-5 text-primary" />
                {myStatus === "confirmed" ? "You are booked into this class." : "You are on the waitlist for this class."}
              </p>
              <div className="grid grid-cols-2 gap-3">
                <Button asChild variant="outline"><Link to={`/s/${studio.slug}/my`}>My bookings</Link></Button>
                <Button variant="outline" onClick={cancelMine} disabled={busy} data-testid="cancel-booking">
                  {cancel.isPending ? "Cancelling..." : "Cancel booking"}
                </Button>
              </div>
              {opts && <p className="text-xs text-muted-foreground">Free cancellation up to {Math.round(opts.cancellation_minutes / 60)} hours before the class starts.</p>}
            </div>
          ) : opts?.has_started ? (
            <p className="text-sm text-muted-foreground">This class has already started.</p>
          ) : (
            <div className="space-y-4" data-testid="booking-options">
              {isFull && (
                <p className="text-sm font-medium">
                  This class is full.{opts?.waitlist_enabled ? " You can join the waitlist with a pass or membership." : ""}
                </p>
              )}
              {usable.length > 0 && (!isFull || opts?.waitlist_enabled) && (
                <div className="space-y-2">
                  <p className="text-sm font-medium">{isFull ? "Join the waitlist with" : "Book with"}</p>
                  {usable.map((source) => (
                    <Button key={source.id} size="lg" className="h-auto w-full justify-between py-3" onClick={() => bookWith(source)} disabled={busy}
                      data-testid="book-with-pass" data-source-type={source.type}>
                      <span className="text-start">
                        <span className="block">{source.name}</span>
                        <span className="block text-xs font-normal opacity-80">
                          {source.remaining == null ? "Unlimited classes" : `${source.remaining} ${source.remaining === 1 ? "class" : "classes"} left`}
                        </span>
                      </span>
                      <span>{book.isPending ? "Booking..." : isFull ? "Join waitlist" : "Book"}</span>
                    </Button>
                  ))}
                </div>
              )}
              {unusable.map((source) => (
                <p key={source.id} className="text-xs text-muted-foreground" data-testid="pass-unusable">{source.name}: {friendlyError(source.reason)}</p>
              ))}
              {!isFull && dropIn ? (
                <div className="space-y-2">
                  {usable.length > 0 && <p className="text-xs text-muted-foreground">Or pay for this class on its own.</p>}
                  <Button size="lg" variant={usable.length > 0 ? "outline" : "default"} className="w-full" onClick={payDropIn} disabled={busy} data-testid="pay-drop-in">
                    {paying ? "Opening secure payment..." : `Pay ${formatMoney(dropIn, opts?.currency ?? studio.currency)} and book`}
                  </Button>
                </div>
              ) : null}
              {usable.length === 0 && (
                <div className="space-y-2">
                  {!dropIn && !isFull && <p className="text-sm text-muted-foreground" data-testid="no-way-to-book">You need a pass or membership to book this class.</p>}
                  <Button asChild variant="outline" className="w-full"><Link to={`/s/${studio.slug}/plans`} data-testid="see-passes">See passes and memberships</Link></Button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** One class session: details, live availability, and every real way this member can book it. */
export default function ClassDetail() {
  return <MemberShell title="Class">{(studio) => <Detail studio={studio} />}</MemberShell>;
}
