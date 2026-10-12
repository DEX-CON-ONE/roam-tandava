import { Link } from "react-router-dom";
import { Clock, Loader2, MapPin, User } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { MemberShell, MemberEmptyState, type MemberStudio } from "@/components/member/MemberShell";
import { useStudioSchedule } from "@/lib/member/api";
import { availabilityLabel, formatMoney, formatTime, groupByDay, spacesLeft, type ScheduleRow } from "@/lib/member/format";

function ClassRow({ row, studio }: { row: ScheduleRow; studio: MemberStudio }) {
  const left = spacesLeft(row);
  const booked = row.my_booking_status === "confirmed";
  const waitlisted = row.my_booking_status === "waitlisted";
  return (
    <Link to={`/s/${studio.slug}/class/${row.occurrence_id}`} className="block" data-testid="schedule-class" data-occurrence={row.occurrence_id}>
      <Card className="transition-colors hover:border-primary/40">
        <CardContent className="flex items-center gap-4 p-4">
          <div className="w-14 shrink-0 text-center">
            <p className="text-lg font-semibold leading-none">{formatTime(row.starts_at, studio.timezone)}</p>
            {row.duration_minutes ? <p className="mt-1 text-xs text-muted-foreground">{row.duration_minutes} min</p> : null}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{row.offering_name}</p>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
              {row.teacher_name && <span className="inline-flex items-center gap-1"><User className="h-3 w-3" />{row.teacher_name}</span>}
              {row.location_name && <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" />{row.location_name}</span>}
            </p>
          </div>
          <div className="shrink-0 text-end">
            {booked ? (
              <Badge data-testid="schedule-booked">Booked</Badge>
            ) : waitlisted ? (
              <Badge variant="secondary">Waitlist</Badge>
            ) : (
              <Badge variant={left === 0 ? "secondary" : "outline"} data-testid="schedule-spaces">{availabilityLabel(row)}</Badge>
            )}
            {row.drop_in_price_cents ? (
              <p className="mt-1 text-xs text-muted-foreground">{formatMoney(row.drop_in_price_cents, studio.currency)}</p>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function ScheduleBody({ studio }: { studio: MemberStudio }) {
  const { data: rows, isLoading, isError } = useStudioSchedule(studio.slug, 14);

  if (isLoading) return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="Loading" /></div>;
  if (isError) return <MemberEmptyState title="We could not load the schedule" body="Please check your connection and try again." />;
  if (!rows || rows.length === 0) {
    return <MemberEmptyState title="No classes scheduled yet" body={`There are no upcoming classes at ${studio.name} in the next two weeks. Please check back soon.`} />;
  }

  return (
    <div className="space-y-8" data-testid="schedule-list">
      {groupByDay(rows, studio.timezone).map((day) => (
        <section key={day.key} aria-label={day.label}>
          <h2 className="sticky top-14 z-10 -mx-4 bg-background/95 px-4 py-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground backdrop-blur">
            {day.label}
          </h2>
          <div className="mt-2 space-y-2">
            {day.rows.map((row) => <ClassRow key={row.occurrence_id} row={row} studio={studio} />)}
          </div>
        </section>
      ))}
      <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
        <Clock className="h-3 w-3" />Times shown in {studio.timezone.replace(/_/g, " ")} time.
      </p>
    </div>
  );
}

/** Public schedule for a studio: real upcoming sessions for the next two weeks, grouped by day. */
export default function StudioSchedule() {
  return (
    <MemberShell title="Schedule">
      {(studio) => (
        <>
          <h1 className="mb-4 text-2xl font-bold tracking-tight">Schedule</h1>
          <ScheduleBody studio={studio} />
        </>
      )}
    </MemberShell>
  );
}
