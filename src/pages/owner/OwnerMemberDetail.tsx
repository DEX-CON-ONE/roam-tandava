import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { EmptyState, ErrorNote, NativeSelect, OwnerPage, Section, Spinner, StatusPill, ownerKeys, useOwnerAction } from "@/components/owner/OwnerPage";
import { bookMember, getMemberDetail, listUpcomingSessions, type OwnerStudio } from "@/lib/owner/api";
import { formatDate, formatDayTime, formatMoney, personName, transactionLabel } from "@/lib/owner/format";

const BOOKING_LABEL: Record<string, { label: string; tone: "good" | "warn" | "bad" | "muted" }> = {
  confirmed: { label: "Booked", tone: "muted" },
  checked_in: { label: "Attended", tone: "good" },
  no_show: { label: "No-show", tone: "bad" },
  waitlisted: { label: "Waiting list", tone: "warn" },
  cancelled: { label: "Cancelled", tone: "muted" },
  late_cancel: { label: "Late cancel", tone: "muted" },
};

export const PAYMENT_TONE: Record<string, "good" | "warn" | "bad" | "muted"> = {
  completed: "good",
  pending: "warn",
  failed: "bad",
  refunded: "muted",
  partially_refunded: "muted",
};

function AddBooking({ studio, profileId }: { studio: OwnerStudio; profileId: string }) {
  const run = useOwnerAction();
  const sessions = useQuery({ queryKey: [...ownerKeys.all, "sessions", studio.id], queryFn: () => listUpcomingSessions(studio.id) });
  const [sessionId, setSessionId] = useState("");
  const [complimentary, setComplimentary] = useState(false);
  const [busy, setBusy] = useState(false);
  const open = (sessions.data ?? []).filter((session) => !session.is_cancelled && new Date(session.starts_at).getTime() > Date.now());

  const book = async () => {
    setBusy(true);
    const done = await run(async () => { await bookMember(sessionId, profileId, complimentary); return true; }, "Booking added");
    setBusy(false);
    if (done) setSessionId("");
  };

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <Label htmlFor="member-session">Book this member into a session</Label>
        {sessions.isLoading ? <Spinner /> : open.length === 0 ? (
          <p className="text-sm text-muted-foreground">There are no upcoming sessions to book.</p>
        ) : (
          <>
            <NativeSelect id="member-session" value={sessionId} onChange={(e) => setSessionId(e.target.value)}>
              <option value="">Choose a session</option>
              {open.map((session) => (
                <option key={session.id} value={session.id} disabled={session.booked_count >= session.capacity}>
                  {formatDayTime(session.starts_at, studio.timezone)} · {session.offering?.name ?? "Class"} ({session.booked_count}/{session.capacity})
                </option>
              ))}
            </NativeSelect>
            <div className="flex items-center gap-2">
              <Checkbox id="member-comp" checked={complimentary} onCheckedChange={(value) => setComplimentary(value === true)} />
              <Label htmlFor="member-comp" className="text-sm font-normal text-muted-foreground">Complimentary (don't use their class pack or membership)</Label>
            </div>
            <Button onClick={() => void book()} disabled={!sessionId || busy}>{busy ? "Booking…" : "Add booking"}</Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function MemberBody({ studio, profileId }: { studio: OwnerStudio; profileId: string }) {
  const detail = useQuery({ queryKey: [...ownerKeys.all, "member", studio.id, profileId], queryFn: () => getMemberDetail(studio.id, profileId) });
  if (detail.isLoading) return <Spinner />;
  if (detail.error) return <ErrorNote error={detail.error} />;
  const member = detail.data;
  if (!member?.profile) return <EmptyState title="Member not found" body="This person is not a member of your studio." />;

  const passes = member.packs.length + member.memberships.length;

  return (
    <div className="space-y-8">
      <Button asChild variant="ghost" size="sm" className="-ms-2">
        <Link to="/manage/students"><ArrowLeft className="me-1.5 h-4 w-4" />Members</Link>
      </Button>

      <Card>
        <CardContent className="space-y-1 p-4">
          <h2 className="text-xl font-semibold" data-testid="member-name">{personName(member.profile)}</h2>
          <p className="text-sm text-muted-foreground">
            {member.profile.email}{member.profile.phone ? ` · ${member.profile.phone}` : ""} · account created {formatDate(member.profile.created_at, studio.timezone)}
          </p>
        </CardContent>
      </Card>

      <Section title="Passes">
        {passes === 0 ? (
          <EmptyState title="No class packs or memberships" />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {member.packs.map((pack) => (
              <Card key={pack.id} data-testid="member-pack">
                <CardContent className="space-y-1 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-medium">{pack.class_pack_type?.name ?? "Class pack"}</p>
                    <StatusPill tone={pack.status === "active" ? "good" : "muted"}>{pack.status === "active" ? "Active" : pack.status === "exhausted" ? "Used up" : "Expired"}</StatusPill>
                  </div>
                  <p className="text-sm">{pack.classes_remaining} of {pack.classes_total} sessions left</p>
                  <p className="text-xs text-muted-foreground">Expires {formatDate(pack.expires_at, studio.timezone)}</p>
                </CardContent>
              </Card>
            ))}
            {member.memberships.map((membership) => (
              <Card key={membership.id} data-testid="member-membership">
                <CardContent className="space-y-1 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-medium">{membership.membership_type?.name ?? "Membership"}</p>
                    <StatusPill tone={membership.status === "active" ? "good" : membership.status === "past_due" ? "bad" : "muted"}>{membership.status.replace("_", " ")}</StatusPill>
                  </div>
                  <p className="text-sm">
                    {membership.membership_type?.classes_per_cycle == null
                      ? "Unlimited sessions"
                      : `${membership.classes_used_this_cycle} of ${membership.membership_type.classes_per_cycle} sessions used this period`}
                  </p>
                  <p className="text-xs text-muted-foreground">Current period ends {formatDate(membership.current_period_end, studio.timezone)}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </Section>

      <Section title="Bookings">
        <AddBooking studio={studio} profileId={profileId} />
        {member.bookings.length === 0 ? (
          <EmptyState title="No bookings yet" />
        ) : (
          <ul className="space-y-2">
            {member.bookings.map((booking) => {
              const state = BOOKING_LABEL[booking.status] ?? { label: booking.status, tone: "muted" as const };
              return (
                <li key={booking.id} data-testid="member-booking" className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{booking.occurrence?.offering?.name ?? "Session"}</p>
                    <p className="truncate text-xs text-muted-foreground">{booking.occurrence ? formatDayTime(booking.occurrence.starts_at, studio.timezone) : "Session removed"}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <StatusPill tone={state.tone}>{state.label}</StatusPill>
                    {booking.occurrence && (
                      <Button asChild variant="ghost" size="sm"><Link to={`/manage/sessions/${booking.occurrence.id}`}>Roster</Link></Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section title="Payments">
        {member.payments.length === 0 ? (
          <EmptyState title="No payments yet" />
        ) : (
          <ul className="space-y-2">
            {member.payments.map((payment) => (
              <li key={payment.id} data-testid="member-payment" className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{transactionLabel(payment.type)}</p>
                  <p className="truncate text-xs text-muted-foreground">{formatDate(payment.created_at, studio.timezone)}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="tabular-nums">{formatMoney(payment.amount_cents, studio.currency)}</span>
                  <StatusPill tone={PAYMENT_TONE[payment.status] ?? "muted"}>{payment.status.replace("_", " ")}</StatusPill>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

export default function OwnerMemberDetail() {
  const { id } = useParams<{ id: string }>();
  return (
    <OwnerPage title="Member" description="Passes, bookings and payments.">
      {(studio) => (id ? <MemberBody studio={studio} profileId={id} /> : <EmptyState title="Member not found" />)}
    </OwnerPage>
  );
}
