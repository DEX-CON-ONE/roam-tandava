/**
 * Member booking data access: thin, typed wrappers over the database RPCs
 * (migration 00030) and the stripe-checkout Edge Function, plus React Query
 * hooks. Everything here talks to the real backend; there is no sample data.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { data as backendData, isBackendConfigured } from "@/lib/backend";
import { getSupabaseClient } from "@/lib/backend/supabase";
import { checkoutReturnUrls, type CheckoutKind, type ScheduleRow } from "./format";

export interface BookingSource {
  type: "membership" | "class_pack";
  id: string;
  name: string;
  remaining: number | null;
  expires_at: string | null;
  /** Why this pass cannot book the class; null when it can. */
  reason: string | null;
}

export interface BookingOptions {
  occurrence_id: string;
  studio_id: string;
  is_cancelled: boolean;
  has_started: boolean;
  is_full: boolean;
  waitlist_enabled: boolean;
  drop_in_price_cents: number | null;
  currency: string | null;
  cancellation_minutes: number;
  my_booking_id: string | null;
  my_booking_status: string | null;
  sources: BookingSource[];
}

export interface MyBooking {
  booking_id: string;
  status: string;
  waitlist_position: number | null;
  booked_at: string;
  cancelled_at: string | null;
  paid_with: "membership" | "class_pack" | "drop_in" | "other";
  occurrence_id: string;
  starts_at: string;
  ends_at: string;
  class_cancelled: boolean;
  offering_name: string;
  location_name: string | null;
  teacher_name: string | null;
  free_cancel_until: string | null;
}

export interface MyPasses {
  memberships: Array<{
    id: string; name: string; status: string; billing_cycle: string;
    classes_per_cycle: number | null; classes_used_this_cycle: number; current_period_end: string; started_at: string;
  }>;
  packs: Array<{
    id: string; name: string; status: string; classes_remaining: number; classes_total: number; purchased_at: string; expires_at: string;
  }>;
}

async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  // The hand-written Database type does not describe these functions.
  const { data, error } = await getSupabaseClient().rpc(name as never, args as never);
  if (error) throw new Error(error.message);
  return data as T;
}

export const memberApi = {
  schedule: (slug: string, days = 14) => rpc<ScheduleRow[]>("get_studio_schedule", { p_slug: slug, p_days: days }).then((rows) => rows ?? []),
  bookingOptions: (occurrenceId: string) => rpc<BookingOptions>("get_booking_options", { p_occurrence_id: occurrenceId }),
  myBookings: (slug: string) => rpc<MyBooking[]>("get_my_bookings", { p_slug: slug }).then((rows) => rows ?? []),
  myPasses: (slug: string) => rpc<MyPasses | null>("get_my_passes", { p_slug: slug }).then((passes) => passes ?? { memberships: [], packs: [] }),

  /** Start Stripe Checkout and leave the app. Resolves only on failure. */
  async startCheckout(input: { slug: string; kind: CheckoutKind; occurrenceId?: string; planId?: string }): Promise<{ error: string }> {
    const urls = checkoutReturnUrls(window.location.origin, input.slug, input.kind, { occurrenceId: input.occurrenceId, started: Date.now() });
    const { data, error } = await getSupabaseClient().functions.invoke<{ url?: string; error?: string }>("stripe-checkout", {
      body: {
        type: input.kind,
        ...(input.kind === "drop_in" ? { occurrenceId: input.occurrenceId } : {}),
        ...(input.kind === "class_pack" ? { classPackTypeId: input.planId } : {}),
        ...(input.kind === "membership" ? { membershipTypeId: input.planId } : {}),
        ...urls,
      },
    });
    if (error) {
      // A non-2xx reply carries the function's own message in the response body.
      let message = error.message;
      try {
        const body = await (error as { context?: Response }).context?.json();
        if (body && typeof body.error === "string") message = body.error;
      } catch {
        // keep the generic message
      }
      return { error: message };
    }
    if (!data?.url) return { error: data?.error ?? "No checkout page was returned." };
    window.location.assign(data.url);
    return new Promise(() => {}); // navigating away
  },
};

const live = () => isBackendConfigured();

export function useStudioSchedule(slug: string | undefined, days = 14) {
  return useQuery({ queryKey: ["member", "schedule", slug, days], enabled: Boolean(slug) && live(), queryFn: () => memberApi.schedule(slug!, days) });
}

export function useBookingOptions(occurrenceId: string | undefined, signedIn: boolean) {
  return useQuery({
    queryKey: ["member", "options", occurrenceId],
    enabled: Boolean(occurrenceId) && signedIn && live(),
    queryFn: () => memberApi.bookingOptions(occurrenceId!),
  });
}

export function useMyBookings(slug: string | undefined, signedIn: boolean) {
  return useQuery({ queryKey: ["member", "bookings", slug], enabled: Boolean(slug) && signedIn && live(), queryFn: () => memberApi.myBookings(slug!) });
}

export function useMyPasses(slug: string | undefined, signedIn: boolean) {
  return useQuery({ queryKey: ["member", "passes", slug], enabled: Boolean(slug) && signedIn && live(), queryFn: () => memberApi.myPasses(slug!) });
}

function useInvalidateMember() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ["member"] });
}

/** Book with a membership or class pack through the book_class RPC. */
export function useBookWithPass() {
  const invalidate = useInvalidateMember();
  return useMutation({
    mutationFn: async (input: { occurrenceId: string; source: Pick<BookingSource, "type" | "id"> }) => {
      const { data, error } = await backendData.bookClass({ occurrenceId: input.occurrenceId, sourceType: input.source.type, sourceId: input.source.id });
      if (error) throw new Error(error.message);
      return data;
    },
    onSettled: invalidate,
  });
}

/** Cancel through the cancel_booking RPC (the backend applies the studio's rules). */
export function useCancelMyBooking() {
  const invalidate = useInvalidateMember();
  return useMutation({
    mutationFn: async (bookingId: string) => {
      const { data, error } = await backendData.cancelBooking(bookingId);
      if (error) throw new Error(error.message);
      return data;
    },
    onSettled: invalidate,
  });
}
