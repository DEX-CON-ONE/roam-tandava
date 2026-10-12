import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarPlus, Pencil, Plus, Repeat, Users, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState, ErrorNote, Field, NativeSelect, OwnerPage, Section, Spinner, StatusPill, ownerKeys, useOwnerAction } from "@/components/owner/OwnerPage";
import {
  cancelSession, createClassType, createLocation, createSession, createWeeklySchedule, endWeeklySchedule,
  listClassTypes, listCoaches, listLocations, listUpcomingSessions, listWeeklySchedules, topUpSchedules,
  updateClassType, updateSession,
  type ClassType, type Coach, type OwnerStudio, type Session, type StudioLocation, type WeeklySchedule,
} from "@/lib/owner/api";
import { WEEKDAYS, centsToInput, formatDay, formatMoney, formatTime, parseMoneyToCents, personName, weekdayLabel, zonedParts } from "@/lib/owner/format";

type Tab = "sessions" | "weekly" | "types";
const NEW_LOCATION = "__new__";

// ---------------------------------------------------------------------------
// Class type dialog
// ---------------------------------------------------------------------------

function ClassTypeDialog({ studio, editing, open, onClose }: { studio: OwnerStudio; editing: ClassType | null; open: boolean; onClose: () => void }) {
  const run = useOwnerAction();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [duration, setDuration] = useState("60");
  const [capacity, setCapacity] = useState("12");
  const [price, setPrice] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(editing?.name ?? "");
    setDescription(editing?.description ?? "");
    setDuration(String(editing?.duration_minutes ?? 60));
    setCapacity(String(editing?.capacity ?? 12));
    setPrice(centsToInput(editing?.drop_in_price_cents));
  }, [open, editing]);

  const durationValue = parseInt(duration, 10);
  const capacityValue = parseInt(capacity, 10);
  const priceValue = price.trim() ? parseMoneyToCents(price) : null;
  const valid = name.trim().length > 0 && durationValue > 0 && capacityValue > 0 && (!price.trim() || priceValue != null);

  const save = async () => {
    setBusy(true);
    const input = {
      name: name.trim(),
      description: description.trim() || null,
      duration_minutes: durationValue,
      capacity: capacityValue,
      drop_in_price_cents: priceValue,
    };
    const saved = await run(() => (editing ? updateClassType(editing.id, input) : createClassType(studio.id, input)), editing ? "Class type saved" : "Class type added");
    setBusy(false);
    if (saved) onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit class type" : "New class type"}</DialogTitle>
          <DialogDescription>A class type is what you offer. You put it on the schedule as sessions.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Field label="Name" htmlFor="class-name">
            <Input id="class-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Strength" />
          </Field>
          <Field label="Description" htmlFor="class-description">
            <Textarea id="class-description" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What people can expect" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Length (minutes)" htmlFor="class-duration">
              <Input id="class-duration" type="number" inputMode="numeric" min={5} value={duration} onChange={(e) => setDuration(e.target.value)} />
            </Field>
            <Field label="Capacity" htmlFor="class-capacity">
              <Input id="class-capacity" type="number" inputMode="numeric" min={1} value={capacity} onChange={(e) => setCapacity(e.target.value)} />
            </Field>
          </div>
          <Field label={`Drop-in price (${studio.currency})`} htmlFor="class-price" hint="Leave empty if this class can't be bought as a single session.">
            <Input id="class-price" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="e.g. 15" />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void save()} disabled={!valid || busy}>{busy ? "Saving…" : "Save class type"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Add / edit session dialog
// ---------------------------------------------------------------------------

interface SessionDialogProps {
  studio: OwnerStudio;
  classTypes: ClassType[];
  coaches: Coach[];
  locations: StudioLocation[];
  editing: Session | null;
  open: boolean;
  onClose: () => void;
}

function SessionDialog({ studio, classTypes, coaches, locations, editing, open, onClose }: SessionDialogProps) {
  const run = useOwnerAction();
  const activeTypes = useMemo(() => classTypes.filter((type) => type.is_active), [classTypes]);
  const [repeat, setRepeat] = useState<"once" | "weekly">("once");
  const [offeringId, setOfferingId] = useState("");
  const [coachId, setCoachId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [newLocation, setNewLocation] = useState("");
  const [date, setDate] = useState("");
  const [day, setDay] = useState<string>("monday");
  const [until, setUntil] = useState("");
  const [time, setTime] = useState("09:00");
  const [capacity, setCapacity] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      const parts = zonedParts(editing.starts_at, studio.timezone);
      setRepeat("once");
      setOfferingId(editing.offering_id);
      setCoachId(editing.teacher_id ?? "");
      setLocationId(editing.location_id);
      setDate(parts.date);
      setTime(parts.time);
      setCapacity(String(editing.capacity));
    } else {
      setRepeat("once");
      setOfferingId(activeTypes[0]?.id ?? "");
      setCoachId("");
      setLocationId(locations[0]?.id ?? NEW_LOCATION);
      setDate("");
      setDay("monday");
      setUntil("");
      setTime("09:00");
      setCapacity("");
    }
    setNewLocation("");
  }, [open, editing, activeTypes, locations, studio.timezone]);

  const needsNewLocation = locationId === NEW_LOCATION;
  const capacityValue = capacity.trim() ? parseInt(capacity, 10) : null;
  const valid =
    Boolean(offeringId) &&
    /^\d{2}:\d{2}/.test(time) &&
    (needsNewLocation ? newLocation.trim().length > 0 : Boolean(locationId)) &&
    (repeat === "weekly" || Boolean(date)) &&
    (capacityValue == null || capacityValue > 0) &&
    (!editing || capacityValue != null);

  const save = async () => {
    setBusy(true);
    const result = await run(async () => {
      const resolvedLocation = needsNewLocation
        ? (await createLocation(studio.id, newLocation.trim(), locations.length === 0)).id
        : locationId;
      const base = { offeringId, locationId: resolvedLocation, coachId: coachId || null, startTime: time, capacity: capacityValue };
      if (editing) {
        await updateSession(editing.id, { date, startTime: time, coachId: coachId || null, locationId: resolvedLocation, capacity: capacityValue ?? editing.capacity });
        return "Session saved";
      }
      if (repeat === "weekly") {
        const created = await createWeeklySchedule({ ...base, day, from: null, until: until || null });
        return `Weekly schedule added: ${created.sessions_created} sessions created`;
      }
      await createSession({ ...base, date });
      return "Session added";
    }, (message) => message);
    setBusy(false);
    if (result) onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit session" : "Add to schedule"}</DialogTitle>
          <DialogDescription>Times are in the studio's timezone ({studio.timezone}).</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {!editing && (
            <Field label="How often" htmlFor="session-repeat">
              <NativeSelect id="session-repeat" value={repeat} onChange={(e) => setRepeat(e.target.value as "once" | "weekly")}>
                <option value="once">One session</option>
                <option value="weekly">Every week</option>
              </NativeSelect>
            </Field>
          )}
          <Field label="Class type" htmlFor="session-class">
            <NativeSelect id="session-class" value={offeringId} onChange={(e) => setOfferingId(e.target.value)} disabled={Boolean(editing)}>
              {(editing ? classTypes : activeTypes).map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}
            </NativeSelect>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            {repeat === "weekly" && !editing ? (
              <Field label="Day" htmlFor="session-day">
                <NativeSelect id="session-day" value={day} onChange={(e) => setDay(e.target.value)}>
                  {WEEKDAYS.map((weekday) => <option key={weekday} value={weekday}>{weekdayLabel(weekday)}</option>)}
                </NativeSelect>
              </Field>
            ) : (
              <Field label="Date" htmlFor="session-date">
                <Input id="session-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </Field>
            )}
            <Field label="Start time" htmlFor="session-time">
              <Input id="session-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </Field>
          </div>
          {repeat === "weekly" && !editing && (
            <Field label="Last date (optional)" htmlFor="session-until" hint="Leave empty to keep it running. Sessions are created 12 weeks ahead.">
              <Input id="session-until" type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
            </Field>
          )}
          <Field label="Coach" htmlFor="session-coach" hint={coaches.length <= 1 ? "Add more coaches in Studio setup, under Staff." : undefined}>
            <NativeSelect id="session-coach" value={coachId} onChange={(e) => setCoachId(e.target.value)}>
              <option value="">No coach assigned</option>
              {coaches.map((coach) => <option key={coach.profile_id} value={coach.profile_id}>{coach.name}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Location" htmlFor="session-location">
            <NativeSelect id="session-location" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
              <option value={NEW_LOCATION}>Add a location…</option>
            </NativeSelect>
          </Field>
          {needsNewLocation && (
            <Field label="New location name" htmlFor="session-new-location">
              <Input id="session-new-location" value={newLocation} onChange={(e) => setNewLocation(e.target.value)} placeholder="e.g. Main room" />
            </Field>
          )}
          <Field label="Capacity" htmlFor="session-capacity" hint={editing ? undefined : "Leave empty to use the class type's capacity."}>
            <Input id="session-capacity" type="number" inputMode="numeric" min={1} value={capacity} onChange={(e) => setCapacity(e.target.value)} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void save()} disabled={!valid || busy}>{busy ? "Saving…" : editing ? "Save session" : "Add to schedule"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Confirm dialogs
// ---------------------------------------------------------------------------

function CancelSessionDialog({ session, timeZone, onClose }: { session: Session | null; timeZone: string; onClose: () => void }) {
  const run = useOwnerAction();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => setReason(""), [session]);

  const confirm = async () => {
    if (!session) return;
    setBusy(true);
    const result = await run(() => cancelSession(session.id, reason.trim()), (outcome) =>
      outcome.paid_bookings > 0
        ? `Session cancelled. ${outcome.paid_bookings} card payment(s) need refunding in Stripe.`
        : `Session cancelled. ${outcome.bookings_cancelled} booking(s) released.`);
    setBusy(false);
    if (result) onClose();
  };

  return (
    <Dialog open={Boolean(session)} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Cancel this session?</DialogTitle>
          <DialogDescription>
            {session && `${session.offering?.name ?? "Session"}, ${formatDay(session.starts_at, timeZone)} at ${formatTime(session.starts_at, timeZone)}. `}
            Bookings are cancelled and any class taken from a pack or membership is given back. Card payments are not refunded automatically.
          </DialogDescription>
        </DialogHeader>
        <Field label="Reason (optional)" htmlFor="cancel-reason">
          <Input id="cancel-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Coach unavailable" />
        </Field>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Keep session</Button>
          <Button variant="destructive" onClick={() => void confirm()} disabled={busy}>{busy ? "Cancelling…" : "Cancel session"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EndScheduleDialog({ schedule, onClose }: { schedule: WeeklySchedule | null; onClose: () => void }) {
  const run = useOwnerAction();
  const [busy, setBusy] = useState(false);
  const confirm = async () => {
    if (!schedule) return;
    setBusy(true);
    const result = await run(() => endWeeklySchedule(schedule.id), (outcome) =>
      `Weekly schedule ended: ${outcome.sessions_removed} session(s) removed, ${outcome.sessions_cancelled} with bookings cancelled.`);
    setBusy(false);
    if (result) onClose();
  };
  return (
    <Dialog open={Boolean(schedule)} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>End this weekly schedule?</DialogTitle>
          <DialogDescription>
            {schedule && `${schedule.offering?.name ?? "Class"}, ${weekdayLabel(schedule.day_of_week)}s at ${schedule.start_time.slice(0, 5)}. `}
            Future sessions nobody has booked are removed. Sessions with bookings are cancelled and the bookings released.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Keep schedule</Button>
          <Button variant="destructive" onClick={() => void confirm()} disabled={busy}>{busy ? "Ending…" : "End schedule"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

function ClassesBody({ studio }: { studio: OwnerStudio }) {
  const queryClient = useQueryClient();
  const run = useOwnerAction();
  const [tab, setTab] = useState<Tab>("sessions");
  const [typeDialog, setTypeDialog] = useState<{ open: boolean; editing: ClassType | null }>({ open: false, editing: null });
  const [sessionDialog, setSessionDialog] = useState<{ open: boolean; editing: Session | null }>({ open: false, editing: null });
  const [cancelling, setCancelling] = useState<Session | null>(null);
  const [ending, setEnding] = useState<WeeklySchedule | null>(null);
  const [showCancelled, setShowCancelled] = useState(false);

  const key = (name: string) => [...ownerKeys.all, name, studio.id];
  const classTypes = useQuery({ queryKey: key("class-types"), queryFn: () => listClassTypes(studio.id) });
  const sessions = useQuery({ queryKey: key("sessions"), queryFn: () => listUpcomingSessions(studio.id) });
  const weekly = useQuery({ queryKey: key("weekly"), queryFn: () => listWeeklySchedules(studio.id) });
  const coaches = useQuery({ queryKey: key("coaches"), queryFn: () => listCoaches(studio.id) });
  const locations = useQuery({ queryKey: key("locations"), queryFn: () => listLocations(studio.id) });

  useEffect(() => {
    let cancelled = false;
    void topUpSchedules(studio.id).then(() => {
      if (!cancelled) void queryClient.invalidateQueries({ queryKey: [...ownerKeys.all, "sessions", studio.id] });
    });
    return () => { cancelled = true; };
  }, [studio.id, queryClient]);

  if (classTypes.isLoading || sessions.isLoading || weekly.isLoading || coaches.isLoading || locations.isLoading) return <Spinner />;
  const loadError = classTypes.error ?? sessions.error ?? weekly.error ?? coaches.error ?? locations.error;
  if (loadError) return <ErrorNote error={loadError} />;

  const types = classTypes.data ?? [];
  const activeTypes = types.filter((type) => type.is_active);
  const allSessions = sessions.data ?? [];
  const visibleSessions = showCancelled ? allSessions : allSessions.filter((session) => !session.is_cancelled);
  const cancelledCount = allSessions.length - allSessions.filter((session) => !session.is_cancelled).length;
  const schedules = weekly.data ?? [];

  const grouped = visibleSessions.reduce<{ day: string; items: Session[] }[]>((groups, session) => {
    const day = formatDay(session.starts_at, studio.timezone);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(session);
    else groups.push({ day, items: [session] });
    return groups;
  }, []);

  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: "sessions", label: "Sessions", count: allSessions.filter((session) => !session.is_cancelled).length },
    { id: "weekly", label: "Weekly schedules", count: schedules.length },
    { id: "types", label: "Class types", count: activeTypes.length },
  ];

  const addToSchedule = (
    <Button onClick={() => setSessionDialog({ open: true, editing: null })} disabled={activeTypes.length === 0}>
      <CalendarPlus className="me-1.5 h-4 w-4" />
      Add to schedule
    </Button>
  );
  const newType = (
    <Button variant={activeTypes.length === 0 ? "default" : "outline"} onClick={() => setTypeDialog({ open: true, editing: null })}>
      <Plus className="me-1.5 h-4 w-4" />
      New class type
    </Button>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 overflow-x-auto rounded-xl bg-muted p-1" role="tablist">
          {tabs.map((item) => (
            <button
              key={item.id}
              role="tab"
              aria-selected={tab === item.id}
              onClick={() => setTab(item.id)}
              className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${tab === item.id ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            >
              {item.label} <span className="text-xs text-muted-foreground">{item.count}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">{tab === "types" ? newType : addToSchedule}</div>
      </div>

      {tab === "sessions" && (
        <Section
          title="Upcoming sessions"
          action={cancelledCount > 0 ? (
            <Button variant="ghost" size="sm" onClick={() => setShowCancelled((value) => !value)}>
              {showCancelled ? "Hide cancelled" : `Show cancelled (${cancelledCount})`}
            </Button>
          ) : undefined}
        >
          {activeTypes.length === 0 ? (
            <EmptyState title="No classes yet" body="Create a class type first, then add it to the schedule.">{newType}</EmptyState>
          ) : grouped.length === 0 ? (
            <EmptyState title="Nothing on the schedule" body="Add a single session, or a class that repeats every week.">{addToSchedule}</EmptyState>
          ) : (
            <div className="space-y-5">
              {grouped.map((group) => (
                <div key={group.day} className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{group.day}</p>
                  {group.items.map((session) => (
                    <Card key={session.id} data-testid="session-row">
                      <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                        <div className="min-w-0">
                          <p className="flex flex-wrap items-center gap-2 font-medium">
                            <span className="tabular-nums">{formatTime(session.starts_at, studio.timezone)}</span>
                            <span className="truncate">{session.offering?.name ?? "Class"}</span>
                            {session.schedule_rule_id && <Repeat className="h-3.5 w-3.5 text-muted-foreground" aria-label="Weekly" />}
                            {session.is_cancelled && <StatusPill tone="bad">Cancelled</StatusPill>}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {personName(session.teacher, "No coach assigned")} · {session.location?.name ?? "No location"} · {session.booked_count}/{session.capacity} booked
                            {session.waitlist_count > 0 ? ` · ${session.waitlist_count} waiting` : ""}
                          </p>
                        </div>
                        {!session.is_cancelled && (
                          <div className="flex flex-wrap gap-1">
                            <Button asChild variant="outline" size="sm">
                              <Link to={`/manage/sessions/${session.id}`}><Users className="me-1.5 h-4 w-4" />Roster</Link>
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => setSessionDialog({ open: true, editing: session })} aria-label="Edit session">
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => setCancelling(session)} aria-label="Cancel session">
                              <XCircle className="h-4 w-4" />
                            </Button>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              ))}
            </div>
          )}
        </Section>
      )}

      {tab === "weekly" && (
        <Section title="Weekly schedules">
          {schedules.length === 0 ? (
            <EmptyState title="No weekly schedules" body="Add a class that repeats every week and its sessions are created 12 weeks ahead.">
              {activeTypes.length > 0 ? addToSchedule : newType}
            </EmptyState>
          ) : (
            <div className="space-y-2">
              {schedules.map((schedule) => (
                <Card key={schedule.id} data-testid="weekly-row">
                  <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                    <div className="min-w-0">
                      <p className="font-medium">{schedule.offering?.name ?? "Class"}</p>
                      <p className="text-xs text-muted-foreground">
                        {weekdayLabel(schedule.day_of_week)}s at {schedule.start_time.slice(0, 5)} · {personName(schedule.teacher, "No coach assigned")} · {schedule.location?.name ?? "No location"}
                        {schedule.effective_until ? ` · until ${schedule.effective_until}` : ""}
                      </p>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => setEnding(schedule)}>End schedule</Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </Section>
      )}

      {tab === "types" && (
        <Section title="Class types">
          {types.length === 0 ? (
            <EmptyState title="No class types yet" body="A class type has a name, a length and a capacity. Add one to start building the schedule.">{newType}</EmptyState>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {types.map((type) => (
                <Card key={type.id} data-testid="class-type-card" className={type.is_active ? undefined : "opacity-60"}>
                  <CardContent className="space-y-2 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-medium">{type.name}</p>
                      {!type.is_active && <StatusPill tone="muted">Archived</StatusPill>}
                    </div>
                    {type.description && <p className="line-clamp-2 text-sm text-muted-foreground">{type.description}</p>}
                    <p className="text-xs text-muted-foreground">
                      {type.duration_minutes} min · up to {type.capacity} people ·{" "}
                      {type.drop_in_price_cents != null ? `${formatMoney(type.drop_in_price_cents, studio.currency)} drop-in` : "no drop-in price"}
                    </p>
                    <div className="flex gap-1 pt-1">
                      <Button variant="outline" size="sm" onClick={() => setTypeDialog({ open: true, editing: type })}>Edit</Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void run(() => updateClassType(type.id, { is_active: !type.is_active }), type.is_active ? "Class type archived" : "Class type restored")}
                      >
                        {type.is_active ? "Archive" : "Restore"}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </Section>
      )}

      <ClassTypeDialog studio={studio} editing={typeDialog.editing} open={typeDialog.open} onClose={() => setTypeDialog({ open: false, editing: null })} />
      <SessionDialog
        studio={studio}
        classTypes={types}
        coaches={coaches.data ?? []}
        locations={locations.data ?? []}
        editing={sessionDialog.editing}
        open={sessionDialog.open}
        onClose={() => setSessionDialog({ open: false, editing: null })}
      />
      <CancelSessionDialog session={cancelling} timeZone={studio.timezone} onClose={() => setCancelling(null)} />
      <EndScheduleDialog schedule={ending} onClose={() => setEnding(null)} />
    </div>
  );
}

export default function OwnerClasses() {
  return (
    <OwnerPage title="Classes" description="Class types, the weekly schedule and individual sessions.">
      {(studio) => <ClassesBody studio={studio} />}
    </OwnerPage>
  );
}
