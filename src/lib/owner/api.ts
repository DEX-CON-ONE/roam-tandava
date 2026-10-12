/**
 * Data access for the owner (studio admin) screens.
 *
 * Everything here runs as the signed-in user: table reads and writes go
 * through row level security, and the RPCs (migration 00031) check the
 * caller's studio role themselves. Nothing uses a privileged key.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseClient } from "@/lib/backend/supabase";
import { slugify } from "./format";

// The hand-written Database type does not cover these tables' relations or
// the RPCs, so this module uses the client without the schema generic.
const db = (): SupabaseClient => getSupabaseClient() as unknown as SupabaseClient;

// Rows are typed by the caller: the untyped client cannot infer embedded relations.
function must<T = unknown>(result: { data: unknown; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message);
  return result.data as T;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OwnerStudio {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  currency: string;
  discoverable: boolean;
  stripe_account_id: string | null;
  stripe_onboarding_complete: boolean;
  role: string;
  email: string | null;
  description: string | null;
  cancellation_minutes: number;
  primary_color: string | null;
  secondary_color: string | null;
  font: string | null;
}

export interface StudioSettingsInput {
  name: string;
  slug: string;
  email: string;
  timezone: string;
  cancellationMinutes: number;
  discoverable: boolean;
  primaryColor: string;
  secondaryColor: string;
}

export interface SetupAccess {
  single_studio_mode: boolean;
  studio_exists: boolean;
  is_owner: boolean;
  can_create_studio: boolean;
  can_open_setup: boolean;
}

export interface ClassType {
  id: string;
  name: string;
  description: string | null;
  duration_minutes: number;
  capacity: number;
  drop_in_price_cents: number | null;
  is_active: boolean;
}

export interface ClassTypeInput {
  name: string;
  description: string | null;
  duration_minutes: number;
  capacity: number;
  drop_in_price_cents: number | null;
}

export interface StudioLocation {
  id: string;
  name: string;
}

export interface Coach {
  profile_id: string;
  role: string;
  name: string;
}

interface PersonRef {
  first_name: string | null;
  last_name: string | null;
  display_name?: string | null;
  email?: string | null;
}

export interface Session {
  id: string;
  starts_at: string;
  ends_at: string;
  capacity: number;
  booked_count: number;
  checked_in_count: number;
  waitlist_count: number;
  is_cancelled: boolean;
  cancellation_reason: string | null;
  schedule_rule_id: string | null;
  offering_id: string;
  location_id: string;
  teacher_id: string | null;
  offering: { name: string } | null;
  location: { name: string } | null;
  teacher: PersonRef | null;
}

export interface WeeklySchedule {
  id: string;
  day_of_week: string;
  start_time: string;
  end_time: string;
  effective_until: string | null;
  offering: { name: string } | null;
  location: { name: string } | null;
  teacher: PersonRef | null;
}

export interface RosterBooking {
  id: string;
  status: string;
  class_pack_id: string | null;
  membership_id: string | null;
  transaction_id: string | null;
  checked_in_at: string | null;
  booked_at: string;
  profile_id: string;
  profile: PersonRef | null;
}

export interface PackType {
  id: string;
  name: string;
  description: string | null;
  class_count: number;
  price_cents: number;
  validity_days: number;
  is_active: boolean;
}
export type PackTypeInput = Omit<PackType, "id" | "is_active">;

export interface MembershipType {
  id: string;
  name: string;
  description: string | null;
  billing_cycle: string;
  price_cents: number;
  classes_per_cycle: number | null;
  is_active: boolean;
}
export type MembershipTypeInput = Omit<MembershipType, "id" | "is_active">;

export interface MemberRow {
  profile_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  phone: string | null;
  joined_at: string;
  total_classes_attended: number;
  last_class_at: string | null;
  active_passes: number;
  upcoming_bookings: number;
}

export interface MemberPack {
  id: string;
  status: string;
  classes_remaining: number;
  classes_total: number;
  expires_at: string;
  purchased_at: string;
  class_pack_type: { name: string } | null;
}

export interface MemberMembership {
  id: string;
  status: string;
  current_period_end: string;
  classes_used_this_cycle: number;
  membership_type: { name: string; classes_per_cycle: number | null } | null;
}

export interface MemberBooking {
  id: string;
  status: string;
  booked_at: string;
  occurrence: { id: string; starts_at: string; offering: { name: string } | null } | null;
}

export interface Payment {
  id: string;
  type: string;
  status: string;
  amount_cents: number;
  currency: string;
  description: string | null;
  created_at: string;
  profile_id: string;
  profile: PersonRef | null;
}

export interface MemberDetail {
  profile: (PersonRef & { id: string; phone: string | null; created_at: string }) | null;
  packs: MemberPack[];
  memberships: MemberMembership[];
  bookings: MemberBooking[];
  payments: Payment[];
}

export interface DashboardSession {
  id: string;
  starts_at: string;
  ends_at: string;
  capacity: number;
  booked_count: number;
  checked_in_count: number;
  class_name: string;
  location_name: string | null;
  coach_name: string | null;
}

export interface Dashboard {
  today_sessions: DashboardSession[];
  today_bookings: number;
  upcoming_sessions: DashboardSession[];
  upcoming_count: number;
  recent_signups: { profile_id: string; joined_at: string; email: string; name: string | null }[];
  member_count: number;
  class_type_count: number;
}

// ---------------------------------------------------------------------------
// Studio
// ---------------------------------------------------------------------------

export async function getMyStudio(): Promise<OwnerStudio | null> {
  return must<OwnerStudio | null>(await db().rpc("manage_my_studio"));
}

export async function getSetupAccess(): Promise<SetupAccess> {
  return must<SetupAccess>(await db().rpc("studio_setup_access"));
}

export async function setStudioDiscoverable(studioId: string, discoverable: boolean): Promise<void> {
  must(await db().from("studios").update({ discoverable }).eq("id", studioId).select("id").single());
}

/** Validated, owner-only update of the studio's settings (migration 00032). */
export async function updateStudio(studioId: string, input: StudioSettingsInput): Promise<OwnerStudio> {
  return must<OwnerStudio>(
    await db().rpc("manage_update_studio", {
      p_studio_id: studioId,
      p_name: input.name,
      p_slug: input.slug,
      p_email: input.email,
      p_timezone: input.timezone,
      p_cancellation_minutes: input.cancellationMinutes,
      p_discoverable: input.discoverable,
      p_primary_color: input.primaryColor,
      p_secondary_color: input.secondaryColor,
    }),
  );
}

export async function getDashboard(studioId: string): Promise<Dashboard> {
  return must<Dashboard>(await db().rpc("manage_dashboard", { p_studio_id: studioId }));
}

// ---------------------------------------------------------------------------
// Class types, locations, coaches
// ---------------------------------------------------------------------------

const CLASS_TYPE_COLUMNS = "id, name, description, duration_minutes, capacity, drop_in_price_cents, is_active";

export async function listClassTypes(studioId: string): Promise<ClassType[]> {
  return must<ClassType[]>(
    await db().from("offerings").select(CLASS_TYPE_COLUMNS).eq("studio_id", studioId).order("is_active", { ascending: false }).order("name"),
  );
}

export async function createClassType(studioId: string, input: ClassTypeInput): Promise<ClassType> {
  const slug = `${slugify(input.name)}-${Math.random().toString(36).slice(2, 6)}`;
  return must<ClassType>(
    await db().from("offerings").insert({ studio_id: studioId, slug, category: "class", ...input }).select(CLASS_TYPE_COLUMNS).single(),
  );
}

export async function updateClassType(id: string, patch: Partial<ClassTypeInput> & { is_active?: boolean }): Promise<ClassType> {
  return must<ClassType>(await db().from("offerings").update(patch).eq("id", id).select(CLASS_TYPE_COLUMNS).single());
}

export async function listLocations(studioId: string): Promise<StudioLocation[]> {
  return must<StudioLocation[]>(
    await db().from("locations").select("id, name").eq("studio_id", studioId).eq("is_active", true).order("is_primary", { ascending: false }).order("name"),
  );
}

export async function createLocation(studioId: string, name: string, isPrimary: boolean): Promise<StudioLocation> {
  return must<StudioLocation>(
    await db().from("locations").insert({ studio_id: studioId, name, is_primary: isPrimary }).select("id, name").single(),
  );
}

export async function listCoaches(studioId: string): Promise<Coach[]> {
  const rows = must<{ profile_id: string; role: string; profile: PersonRef | null }[]>(
    await db()
      .from("studio_staff")
      .select("profile_id, role, profile:profiles(first_name, last_name, display_name, email)")
      .eq("studio_id", studioId)
      .eq("is_active", true),
  );
  return rows.map((row) => {
    const p = row.profile;
    const name = p?.display_name?.trim() || [p?.first_name, p?.last_name].filter(Boolean).join(" ").trim() || p?.email || "Team member";
    return { profile_id: row.profile_id, role: row.role, name };
  });
}

// ---------------------------------------------------------------------------
// Schedule
// ---------------------------------------------------------------------------

const SESSION_COLUMNS =
  "id, starts_at, ends_at, capacity, booked_count, checked_in_count, waitlist_count, is_cancelled, cancellation_reason, schedule_rule_id, offering_id, location_id, teacher_id, " +
  "offering:offerings(name), location:locations(name), teacher:profiles!class_occurrences_teacher_id_fkey(first_name, last_name, display_name, email)";

export async function listUpcomingSessions(studioId: string, limit = 200): Promise<Session[]> {
  // Include sessions that started in the last three hours so a running class stays reachable.
  const since = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
  return must<Session[]>(
    await db().from("class_occurrences").select(SESSION_COLUMNS).eq("studio_id", studioId).gte("starts_at", since).order("starts_at").limit(limit),
  );
}

export async function getSession(id: string): Promise<Session | null> {
  return must<Session | null>(await db().from("class_occurrences").select(SESSION_COLUMNS).eq("id", id).maybeSingle());
}

export async function listWeeklySchedules(studioId: string): Promise<WeeklySchedule[]> {
  return must<WeeklySchedule[]>(
    await db()
      .from("schedule_rules")
      .select("id, day_of_week, start_time, end_time, effective_until, offering:offerings(name), location:locations(name), teacher:profiles(first_name, last_name, display_name, email)")
      .eq("studio_id", studioId)
      .eq("is_active", true)
      .order("day_of_week")
      .order("start_time"),
  );
}

export interface SessionInput {
  offeringId: string;
  locationId: string;
  coachId: string | null;
  startTime: string;
  capacity: number | null;
}

export async function createWeeklySchedule(
  input: SessionInput & { day: string; from: string | null; until: string | null },
): Promise<{ rule_id: string; sessions_created: number }> {
  return must(
    await db().rpc("manage_create_weekly_schedule", {
      p_offering_id: input.offeringId,
      p_location_id: input.locationId,
      p_teacher_id: input.coachId,
      p_day: input.day,
      p_start_time: input.startTime,
      p_effective_from: input.from,
      p_effective_until: input.until,
      p_capacity: input.capacity,
    }),
  );
}

export async function createSession(input: SessionInput & { date: string }): Promise<void> {
  must(
    await db().rpc("manage_create_session", {
      p_offering_id: input.offeringId,
      p_location_id: input.locationId,
      p_teacher_id: input.coachId,
      p_date: input.date,
      p_start_time: input.startTime,
      p_capacity: input.capacity,
    }),
  );
}

export async function updateSession(
  id: string,
  input: { date: string; startTime: string; coachId: string | null; locationId: string; capacity: number },
): Promise<void> {
  must(
    await db().rpc("manage_update_session", {
      p_occurrence_id: id,
      p_date: input.date,
      p_start_time: input.startTime,
      p_teacher_id: input.coachId,
      p_location_id: input.locationId,
      p_capacity: input.capacity,
    }),
  );
}

export async function cancelSession(id: string, reason: string): Promise<{ bookings_cancelled: number; paid_bookings: number }> {
  return must(await db().rpc("manage_cancel_session", { p_occurrence_id: id, p_reason: reason || null }));
}

export async function endWeeklySchedule(ruleId: string): Promise<{ sessions_removed: number; sessions_cancelled: number }> {
  return must(await db().rpc("manage_end_schedule", { p_rule_id: ruleId }));
}

/** Keeps weekly schedules filled ahead. Best-effort: a failure must not block a screen. */
export async function topUpSchedules(studioId: string): Promise<void> {
  await db().rpc("manage_top_up_schedules", { p_studio_id: studioId });
}

// ---------------------------------------------------------------------------
// Roster, bookings, attendance
// ---------------------------------------------------------------------------

export async function listRoster(occurrenceId: string): Promise<RosterBooking[]> {
  return must<RosterBooking[]>(
    await db()
      .from("bookings")
      .select("id, status, class_pack_id, membership_id, transaction_id, checked_in_at, booked_at, profile_id, profile:profiles!bookings_profile_id_fkey(first_name, last_name, display_name, email)")
      .eq("class_occurrence_id", occurrenceId)
      .order("booked_at"),
  );
}

export async function bookMember(occurrenceId: string, profileId: string, complimentary: boolean): Promise<void> {
  must(await db().rpc("staff_book_member", { p_occurrence_id: occurrenceId, p_profile_id: profileId, p_source: complimentary ? "comp" : "auto" }));
}

export async function setAttendance(bookingId: string, status: "confirmed" | "checked_in" | "no_show"): Promise<void> {
  must(await db().rpc("staff_set_attendance", { p_booking_id: bookingId, p_status: status }));
}

export async function cancelBooking(bookingId: string): Promise<void> {
  must(await db().rpc("cancel_booking", { p_booking_id: bookingId }));
}

// ---------------------------------------------------------------------------
// Prices
// ---------------------------------------------------------------------------

const PACK_COLUMNS = "id, name, description, class_count, price_cents, validity_days, is_active";
const MEMBERSHIP_COLUMNS = "id, name, description, billing_cycle, price_cents, classes_per_cycle, is_active";

export async function listPackTypes(studioId: string): Promise<PackType[]> {
  return must<PackType[]>(await db().from("class_pack_types").select(PACK_COLUMNS).eq("studio_id", studioId).order("is_active", { ascending: false }).order("price_cents"));
}

export async function savePackType(studioId: string, input: PackTypeInput, id?: string): Promise<void> {
  if (id) must(await db().from("class_pack_types").update(input).eq("id", id).select("id").single());
  else must(await db().from("class_pack_types").insert({ studio_id: studioId, ...input }).select("id").single());
}

export async function setPackTypeActive(id: string, isActive: boolean): Promise<void> {
  must(await db().from("class_pack_types").update({ is_active: isActive }).eq("id", id).select("id").single());
}

export async function listMembershipTypes(studioId: string): Promise<MembershipType[]> {
  return must<MembershipType[]>(await db().from("membership_types").select(MEMBERSHIP_COLUMNS).eq("studio_id", studioId).order("is_active", { ascending: false }).order("price_cents"));
}

export async function saveMembershipType(studioId: string, input: MembershipTypeInput, id?: string): Promise<void> {
  if (id) must(await db().from("membership_types").update(input).eq("id", id).select("id").single());
  else must(await db().from("membership_types").insert({ studio_id: studioId, ...input }).select("id").single());
}

export async function setMembershipTypeActive(id: string, isActive: boolean): Promise<void> {
  must(await db().from("membership_types").update({ is_active: isActive }).eq("id", id).select("id").single());
}

// ---------------------------------------------------------------------------
// Members and payments
// ---------------------------------------------------------------------------

export async function listMembers(studioId: string, search: string): Promise<MemberRow[]> {
  return must<MemberRow[]>(await db().rpc("manage_list_members", { p_studio_id: studioId, p_search: search || null }));
}

const PAYMENT_COLUMNS = "id, type, status, amount_cents, currency, description, created_at, profile_id, profile:profiles(first_name, last_name, display_name, email)";

export async function listPayments(studioId: string, limit = 200): Promise<Payment[]> {
  return must<Payment[]>(
    await db().from("transactions").select(PAYMENT_COLUMNS).eq("studio_id", studioId).order("created_at", { ascending: false }).limit(limit),
  );
}

export async function getMemberDetail(studioId: string, profileId: string): Promise<MemberDetail> {
  const client = db();
  const [profile, packs, memberships, bookings, payments] = await Promise.all([
    client.from("profiles").select("id, first_name, last_name, display_name, email, phone, created_at").eq("id", profileId).maybeSingle(),
    client
      .from("class_packs")
      .select("id, status, classes_remaining, classes_total, expires_at, purchased_at, class_pack_type:class_pack_types(name)")
      .eq("studio_id", studioId)
      .eq("profile_id", profileId)
      .order("purchased_at", { ascending: false }),
    client
      .from("memberships")
      .select("id, status, current_period_end, classes_used_this_cycle, membership_type:membership_types(name, classes_per_cycle)")
      .eq("studio_id", studioId)
      .eq("profile_id", profileId)
      .order("created_at", { ascending: false }),
    client
      .from("bookings")
      .select("id, status, booked_at, occurrence:class_occurrences(id, starts_at, offering:offerings(name))")
      .eq("studio_id", studioId)
      .eq("profile_id", profileId)
      .order("booked_at", { ascending: false })
      .limit(100),
    client.from("transactions").select(PAYMENT_COLUMNS).eq("studio_id", studioId).eq("profile_id", profileId).order("created_at", { ascending: false }).limit(100),
  ]);
  return {
    profile: must<MemberDetail["profile"]>(profile),
    packs: must<MemberPack[]>(packs),
    memberships: must<MemberMembership[]>(memberships),
    bookings: must<MemberBooking[]>(bookings),
    payments: must<Payment[]>(payments),
  };
}
