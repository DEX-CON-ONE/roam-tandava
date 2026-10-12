/**
 * Booking Notifications (Supabase Edge Function)
 *
 * Sends the booking confirmation (customer) and new-booking notice (studio)
 * for bookings made with a membership or class pack. Called by the
 * `bookings_notify_confirmed` database trigger through pg_net; see handler.ts
 * and migration 00023.
 *
 * Deploy: supabase functions deploy booking-notifications --no-verify-jwt
 *   (verify_jwt is off because the caller is the database, authenticated by a
 *   dedicated shared secret rather than a JWT)
 * Secrets:
 *   supabase secrets set BOOKING_NOTIFICATIONS_SECRET=<long random value>
 *   plus the EMAIL_* / provider settings used by the `email` function, and APP_URL
 * Database (once per project, values never in a migration):
 *   select vault.create_secret('<same value>', 'booking_notifications_secret');
 *   select vault.create_secret('https://<ref>.supabase.co/functions/v1/booking-notifications', 'booking_notifications_url');
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendEmail } from "../email/provider.ts";
import { createBookingNotificationHandler, type BookingNotificationDatabase } from "./handler.ts";

declare const EdgeRuntime: { waitUntil?: (promise: Promise<unknown>) => void } | undefined;

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

serve(createBookingNotificationHandler({
  database: supabase as unknown as BookingNotificationDatabase,
  sendEmail,
  appUrl: Deno.env.get("APP_URL") ?? "http://localhost:8080",
  getSecret: () => Deno.env.get("BOOKING_NOTIFICATIONS_SECRET"),
  runInBackground: typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil
    ? (work) => EdgeRuntime!.waitUntil!(work)
    : undefined,
}));
