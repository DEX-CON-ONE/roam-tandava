/**
 * Team invitations (Supabase Edge Function)
 *
 * Creates an invitation for someone to join a studio's team and emails it,
 * through the same mail provider as every other studio email.
 *
 *   { action: "invite", studioId, email, role }   role: owner | admin | teacher
 *   { action: "resend", inviteId }
 *
 * The caller must be signed in. Whether they may invite is decided by the
 * database, not here: the invitation is created through manage_invite_staff()
 * with the caller's own session, which only a studio owner passes. The role is
 * never granted by this function or by the email: the invited person gets it
 * when they sign in with that address (claim_studio_invites()).
 *
 * The answer always says whether the email went out, so the owner can pass the
 * sign-up address on themselves if it did not.
 *
 * Deploy: supabase functions deploy team-invite
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendEmail } from "../email/provider.ts";
import { teamInviteEmail } from "../email/templates.ts";
import { describeRole } from "./roles.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const appUrl = (Deno.env.get("APP_URL") ?? "http://localhost:8080").replace(/\/+$/, "");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  const asCaller = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: { user }, error: userErr } = await asCaller.auth.getUser();
  if (userErr || !user) return json({ error: "Not authenticated" }, 401);

  let payload: { action?: string; studioId?: string; email?: string; role?: string; inviteId?: string };
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  let inviteId: string;
  if (payload.action === "resend") {
    inviteId = String(payload.inviteId ?? "");
  } else if (payload.action === "invite") {
    // The database decides: only a studio owner gets an invitation back.
    const { data, error } = await asCaller.rpc("manage_invite_staff", {
      p_studio_id: payload.studioId,
      p_email: payload.email,
      p_role: payload.role,
    });
    if (error || !data) return json({ ok: false, error: error?.message ?? "Could not create the invitation" });
    inviteId = (data as { id: string }).id;
  } else {
    return json({ error: "Unknown action" }, 400);
  }

  // Read the invitation as the caller: row level security shows it to the studio's owners only.
  const { data: invite } = await asCaller
    .from("studio_invites")
    .select("id, studio_id, email, role, expires_at, accepted_at, revoked_at")
    .eq("id", inviteId)
    .maybeSingle();
  if (!invite) return json({ ok: false, error: "Invitation not found" });
  if (invite.accepted_at || invite.revoked_at || new Date(invite.expires_at as string).getTime() <= Date.now()) {
    return json({ ok: false, error: "That invitation is no longer open. Send a new one." });
  }

  const db = createClient(supabaseUrl, serviceKey);
  const [{ data: studio }, { data: inviter }] = await Promise.all([
    db.from("studios").select("name, email, timezone").eq("id", invite.studio_id).single(),
    db.from("profiles").select("first_name, last_name, display_name").eq("id", user.id).single(),
  ]);
  const studioName = (studio?.name as string) ?? "the studio";
  const inviterName = (inviter?.display_name as string)?.trim()
    || [inviter?.first_name, inviter?.last_name].filter(Boolean).join(" ").trim()
    || "The studio owner";
  const role = describeRole(invite.role as string);
  const expiresOn = new Date(invite.expires_at as string).toLocaleDateString("en-GB", {
    day: "numeric", month: "long", year: "numeric", timeZone: (studio?.timezone as string) || "UTC",
  });

  const message = teamInviteEmail({
    studioName,
    inviterName,
    roleLabel: role.label,
    roleSummary: role.summary,
    email: invite.email as string,
    expiresOn,
    registerUrl: `${appUrl}/auth/register`,
    signInUrl: `${appUrl}/auth/login`,
  });
  const sent = await sendEmail({
    to: invite.email as string,
    ...message,
    replyTo: (studio?.email as string) || undefined,
    tags: { type: "team_invite" },
  });
  await db.rpc("record_invite_email", { p_invite_id: invite.id, p_error: sent.success ? null : (sent.error ?? "not sent").slice(0, 300) });
  console.log(`[team-invite] invite ${invite.id}: emailed=${sent.success} provider=${sent.provider}`);

  return json({ ok: true, inviteId: invite.id, emailed: sent.success, registerUrl: `${appUrl}/auth/register` });
});
