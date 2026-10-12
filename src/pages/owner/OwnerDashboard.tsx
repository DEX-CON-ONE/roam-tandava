import { useEffect } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, ExternalLink, Ticket, UserPlus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { EmptyState, ErrorNote, OwnerPage, Section, Spinner, ownerKeys, useOwnerAction } from "@/components/owner/OwnerPage";
import { getDashboard, setStudioDiscoverable, topUpSchedules, type DashboardSession, type OwnerStudio } from "@/lib/owner/api";
import { formatDate, formatDayTime, formatTime } from "@/lib/owner/format";

function Stat({ icon: Icon, label, value, testId }: { icon: typeof Users; label: string; value: number; testId: string }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="text-2xl font-bold leading-none" data-testid={testId}>{value}</p>
          <p className="mt-1 truncate text-xs text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function SessionRow({ session, timeZone, showDay }: { session: DashboardSession; timeZone: string; showDay: boolean }) {
  return (
    <Link
      to={`/manage/sessions/${session.id}`}
      className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3 transition-colors hover:bg-secondary"
    >
      <div className="min-w-0">
        <p className="truncate font-medium">{session.class_name}</p>
        <p className="truncate text-xs text-muted-foreground">
          {showDay ? formatDayTime(session.starts_at, timeZone) : formatTime(session.starts_at, timeZone)}
          {session.coach_name ? ` · ${session.coach_name}` : ""}
          {session.location_name ? ` · ${session.location_name}` : ""}
        </p>
      </div>
      <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
        {session.booked_count}/{session.capacity} booked
      </span>
    </Link>
  );
}

function DashboardBody({ studio }: { studio: OwnerStudio }) {
  const queryClient = useQueryClient();
  const run = useOwnerAction();
  const { data, isLoading, error } = useQuery({ queryKey: [...ownerKeys.all, "dashboard", studio.id], queryFn: () => getDashboard(studio.id) });

  // Weekly schedules are topped up whenever a manager looks at the dashboard.
  useEffect(() => {
    if (studio.role !== "owner" && studio.role !== "admin") return;
    let cancelled = false;
    void topUpSchedules(studio.id).then(() => {
      if (!cancelled) void queryClient.invalidateQueries({ queryKey: [...ownerKeys.all, "dashboard", studio.id] });
    });
    return () => { cancelled = true; };
  }, [studio.id, studio.role, queryClient]);

  if (isLoading) return <Spinner />;
  if (error || !data) return <ErrorNote error={error ?? new Error("No data")} />;

  const bookingPage = `/s/${studio.slug}`;

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={CalendarDays} label="Sessions today" value={data.today_sessions.length} testId="stat-sessions-today" />
        <Stat icon={Ticket} label="Bookings today" value={data.today_bookings} testId="stat-bookings-today" />
        <Stat icon={CalendarDays} label="Sessions in the next 7 days" value={data.upcoming_count} testId="stat-upcoming" />
        <Stat icon={Users} label="Members" value={data.member_count} testId="stat-members" />
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="min-w-0">
            <p className="font-medium">Public booking page</p>
            <p className="text-sm text-muted-foreground">
              {studio.discoverable
                ? "Visible to anyone with the link. It shows your classes, prices and upcoming sessions."
                : "Hidden. Turn it on when your classes and prices are ready."}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {studio.discoverable && (
              <Button asChild variant="outline" size="sm">
                <a href={bookingPage} target="_blank" rel="noreferrer">
                  <ExternalLink className="me-1.5 h-4 w-4" />
                  Open
                </a>
              </Button>
            )}
            <Switch
              aria-label="Public booking page"
              checked={studio.discoverable}
              disabled={studio.role !== "owner" && studio.role !== "admin"}
              onCheckedChange={(checked) => void run(() => setStudioDiscoverable(studio.id, checked), checked ? "Booking page is public" : "Booking page is hidden")}
            />
          </div>
        </CardContent>
      </Card>

      <Section title="Today">
        {data.today_sessions.length === 0 ? (
          <EmptyState title="No sessions today" body={data.class_type_count === 0 ? "Add your first class to get started." : undefined}>
            <Button asChild variant="outline" size="sm">
              <Link to="/manage/schedule">Go to classes</Link>
            </Button>
          </EmptyState>
        ) : (
          <div className="space-y-2">
            {data.today_sessions.map((session) => <SessionRow key={session.id} session={session} timeZone={studio.timezone} showDay={false} />)}
          </div>
        )}
      </Section>

      <Section title="Coming up">
        {data.upcoming_sessions.length === 0 ? (
          <EmptyState title="Nothing scheduled after today" body="Sessions you add to the schedule appear here." />
        ) : (
          <div className="space-y-2">
            {data.upcoming_sessions.map((session) => <SessionRow key={session.id} session={session} timeZone={studio.timezone} showDay />)}
          </div>
        )}
      </Section>

      <Section title="Recent sign-ups">
        {data.recent_signups.length === 0 ? (
          <EmptyState title="No members yet" body="People appear here when they create an account, book or buy." />
        ) : (
          <div className="space-y-2">
            {data.recent_signups.map((member) => (
              <Link
                key={member.profile_id}
                to={`/manage/members/${member.profile_id}`}
                className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3 transition-colors hover:bg-secondary"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <UserPlus className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <p className="truncate font-medium">{member.name ?? member.email}</p>
                    {member.name && <p className="truncate text-xs text-muted-foreground">{member.email}</p>}
                  </div>
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">{formatDate(member.joined_at, studio.timezone)}</span>
              </Link>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

export default function OwnerDashboard() {
  return (
    <OwnerPage title="Dashboard" description="Today at a glance.">
      {(studio) => <DashboardBody studio={studio} />}
    </OwnerPage>
  );
}
