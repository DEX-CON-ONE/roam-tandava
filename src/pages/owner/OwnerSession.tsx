import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Check, Search, UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState, ErrorNote, OwnerPage, Section, Spinner, StatusPill, ownerKeys, useOwnerAction } from "@/components/owner/OwnerPage";
import { bookMember, cancelBooking, getSession, listMembers, listRoster, setAttendance, type OwnerStudio, type RosterBooking } from "@/lib/owner/api";
import { formatDayTime, formatTime, personName } from "@/lib/owner/format";

const ACTIVE = ["confirmed", "checked_in", "no_show"];

function paidWith(booking: RosterBooking): string {
  if (booking.class_pack_id) return "Class pack";
  if (booking.membership_id) return "Membership";
  if (booking.transaction_id) return "Paid by card";
  return "Complimentary";
}

function statusPill(status: string) {
  switch (status) {
    case "checked_in": return <StatusPill tone="good">Attended</StatusPill>;
    case "no_show": return <StatusPill tone="bad">No-show</StatusPill>;
    case "confirmed": return <StatusPill tone="muted">Booked</StatusPill>;
    case "waitlisted": return <StatusPill tone="warn">Waiting list</StatusPill>;
    case "late_cancel": return <StatusPill tone="muted">Late cancel</StatusPill>;
    default: return <StatusPill tone="muted">Cancelled</StatusPill>;
  }
}

function AddMember({ studio, occurrenceId, bookedIds }: { studio: OwnerStudio; occurrenceId: string; bookedIds: Set<string> }) {
  const run = useOwnerAction();
  const [search, setSearch] = useState("");
  const [complimentary, setComplimentary] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const term = search.trim();
  const results = useQuery({
    queryKey: [...ownerKeys.all, "member-search", studio.id, term],
    queryFn: () => listMembers(studio.id, term),
    enabled: term.length >= 2,
  });

  const book = async (profileId: string) => {
    setBusyId(profileId);
    await run(() => bookMember(occurrenceId, profileId, complimentary), "Member booked");
    setBusyId(null);
  };

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <Label htmlFor="roster-search">Add a member to this session</Label>
        <div className="relative">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input id="roster-search" className="ps-9" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name or email" />
        </div>
        <div className="flex items-center gap-2">
          <Checkbox id="roster-comp" checked={complimentary} onCheckedChange={(value) => setComplimentary(value === true)} />
          <Label htmlFor="roster-comp" className="text-sm font-normal text-muted-foreground">Complimentary (don't use their class pack or membership)</Label>
        </div>
        {term.length >= 2 && (
          results.isLoading ? <Spinner label="Searching" /> : results.error ? <ErrorNote error={results.error} /> : (results.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No members match "{term}".</p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {(results.data ?? []).slice(0, 8).map((member) => (
                <li key={member.profile_id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{personName(member)}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {member.email} · {member.active_passes > 0 ? `${member.active_passes} active pass${member.active_passes === 1 ? "" : "es"}` : "no active pass"}
                    </p>
                  </div>
                  {bookedIds.has(member.profile_id) ? (
                    <StatusPill tone="muted">Booked</StatusPill>
                  ) : (
                    <Button size="sm" onClick={() => void book(member.profile_id)} disabled={busyId === member.profile_id}>
                      {busyId === member.profile_id ? "Booking…" : "Book"}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )
        )}
      </CardContent>
    </Card>
  );
}

function SessionBody({ studio, id }: { studio: OwnerStudio; id: string }) {
  const run = useOwnerAction();
  const session = useQuery({ queryKey: [...ownerKeys.all, "session", id], queryFn: () => getSession(id) });
  const roster = useQuery({ queryKey: [...ownerKeys.all, "roster", id], queryFn: () => listRoster(id) });

  if (session.isLoading || roster.isLoading) return <Spinner />;
  if (session.error || roster.error) return <ErrorNote error={session.error ?? roster.error} />;
  if (!session.data) return <EmptyState title="Session not found" body="It may have been removed from the schedule." />;

  const s = session.data;
  const bookings = roster.data ?? [];
  const active = bookings.filter((booking) => ACTIVE.includes(booking.status));
  const waiting = bookings.filter((booking) => booking.status === "waitlisted");
  const bookedIds = new Set([...active, ...waiting].map((booking) => booking.profile_id));
  const attended = active.filter((booking) => booking.status === "checked_in").length;

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ms-2">
        <Link to="/manage/schedule"><ArrowLeft className="me-1.5 h-4 w-4" />Classes</Link>
      </Button>

      <Card>
        <CardContent className="space-y-1 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-semibold">{s.offering?.name ?? "Session"}</h2>
            {s.is_cancelled && <StatusPill tone="bad">Cancelled</StatusPill>}
          </div>
          <p className="text-sm text-muted-foreground">
            {formatDayTime(s.starts_at, studio.timezone)} to {formatTime(s.ends_at, studio.timezone)} · {personName(s.teacher, "No coach assigned")} · {s.location?.name ?? "No location"}
          </p>
          <p className="text-sm" data-testid="roster-summary">
            {active.length}/{s.capacity} booked · {attended} attended{waiting.length > 0 ? ` · ${waiting.length} waiting` : ""}
          </p>
          {s.is_cancelled && s.cancellation_reason && <p className="text-sm text-muted-foreground">Reason: {s.cancellation_reason}</p>}
        </CardContent>
      </Card>

      <Section title="Roster">
        {active.length === 0 && waiting.length === 0 ? (
          <EmptyState title="Nobody is booked yet" body="Bookings appear here as members book. You can also add a member below." />
        ) : (
          <ul className="space-y-2">
            {[...active, ...waiting].map((booking) => (
              <li key={booking.id} data-testid="roster-row">
                <Card>
                  <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 font-medium">
                        <Link to={`/manage/members/${booking.profile_id}`} className="truncate hover:underline">{personName(booking.profile)}</Link>
                        {statusPill(booking.status)}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">{booking.profile?.email} · {paidWith(booking)}</p>
                    </div>
                    {!s.is_cancelled && booking.status !== "waitlisted" && (
                      <div className="flex flex-wrap gap-1">
                        {booking.status === "confirmed" ? (
                          <>
                            <Button size="sm" onClick={() => void run(() => setAttendance(booking.id, "checked_in"), "Marked as attended")}>
                              <Check className="me-1.5 h-4 w-4" />Mark attended
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => void run(() => setAttendance(booking.id, "no_show"), "Marked as no-show")}>
                              <UserX className="me-1.5 h-4 w-4" />No-show
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => void run(() => cancelBooking(booking.id), "Booking cancelled")}>Cancel booking</Button>
                          </>
                        ) : (
                          <Button size="sm" variant="ghost" onClick={() => void run(() => setAttendance(booking.id, "confirmed"), "Attendance cleared")}>Undo</Button>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {!s.is_cancelled && <AddMember studio={studio} occurrenceId={s.id} bookedIds={bookedIds} />}
    </div>
  );
}

export default function OwnerSession() {
  const { id } = useParams<{ id: string }>();
  return (
    <OwnerPage title="Session" description="Who is booked, and who turned up.">
      {(studio) => (id ? <SessionBody studio={studio} id={id} /> : <EmptyState title="Session not found" />)}
    </OwnerPage>
  );
}
