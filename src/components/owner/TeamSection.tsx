import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Mail, ShieldCheck, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { ErrorNote, Field, NativeSelect, Section, Spinner, StatusPill, ownerKeys, useOwnerAction } from "@/components/owner/OwnerPage";
import {
  TEAM_ROLES, inviteToTeam, listTeam, removeFromTeam, resendInvite, revokeInvite, setTeamRole, teamRoleLabel, transferPrimaryOwner,
  type OwnerStudio, type TeamMember, type TeamRole,
} from "@/lib/owner/api";
import { formatDate } from "@/lib/owner/format";
import { isValidEmail } from "@/lib/owner/studio-defaults";

type Confirm = { kind: "remove" | "transfer"; member: TeamMember } | null;

/** Settings → Team: who has access, invitations, and the primary owner. Owners only. */
export function TeamSection({ studio }: { studio: OwnerStudio }) {
  const run = useOwnerAction();
  const { toast } = useToast();
  const team = useQuery({ queryKey: [...ownerKeys.all, "team", studio.id], queryFn: () => listTeam(studio.id) });
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<TeamRole>("admin");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [lastLink, setLastLink] = useState<{ email: string; url: string; emailed: boolean } | null>(null);

  const invite = async () => {
    setBusy(true);
    const address = email.trim().toLowerCase();
    const result = await run(() => inviteToTeam(studio.id, address, role));
    setBusy(false);
    if (!result) return;
    setLastLink({ email: address, url: result.registerUrl ?? `${window.location.origin}/auth/register`, emailed: Boolean(result.emailed) });
    toast(result.emailed
      ? { title: "Invitation sent", description: `An email is on its way to ${address}.` }
      : { title: "Invitation created, but the email was not sent", description: "Pass the sign-up address on yourself (shown below).", variant: "destructive" });
    setEmail("");
  };

  const confirmed = async () => {
    if (!confirm) return;
    const { kind, member } = confirm;
    setBusy(true);
    await run(
      () => (kind === "remove" ? removeFromTeam(studio.id, member.profile_id) : transferPrimaryOwner(studio.id, member.profile_id)),
      kind === "remove" ? "Removed from the team" : "Primary owner changed",
    );
    setBusy(false);
    setConfirm(null);
  };

  const selected = TEAM_ROLES.find((item) => item.value === role)!;

  return (
    <Section title="Team">
      <div id="team" className="space-y-4">
        <Card>
          <CardContent className="space-y-4 p-4">
            <div className="flex items-center gap-2 font-medium"><UserPlus className="h-4 w-4" />Invite someone</div>
            <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
              <Field label="Their email address" htmlFor="team-email">
                <Input id="team-email" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" />
              </Field>
              <Field label="Role" htmlFor="team-role">
                <NativeSelect id="team-role" value={role} onChange={(e) => setRole(e.target.value as TeamRole)}>
                  {TEAM_ROLES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                </NativeSelect>
              </Field>
            </div>
            <p className="text-xs text-muted-foreground" data-testid="team-role-summary">{selected.label}: {selected.summary}</p>
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={() => void invite()} disabled={busy || !isValidEmail(email)}>
                <Mail className="me-1.5 h-4 w-4" />Send invitation
              </Button>
              <p className="text-xs text-muted-foreground">
                They get the role when they create an account, or sign in, with exactly this address. The invitation lasts 7 days.
              </p>
            </div>
            {lastLink && (
              <p className="rounded-lg border border-border bg-muted/50 px-3 py-2 text-xs" data-testid="team-invite-result">
                {lastLink.emailed ? "Emailed to" : "Not emailed. Ask"} <strong>{lastLink.email}</strong>{lastLink.emailed ? ". They can also go straight to " : " to sign up at "}
                <span className="break-all font-medium">{lastLink.url}</span> and use that address.
              </p>
            )}
          </CardContent>
        </Card>

        {team.isLoading ? <Spinner /> : team.error ? <ErrorNote error={team.error} /> : team.data && (
          <>
            {team.data.invites.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Invitations waiting</p>
                {team.data.invites.map((item) => (
                  <Card key={item.id} data-testid="team-invite">
                    <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-2 font-medium">
                          <span className="truncate">{item.email}</span>
                          <StatusPill tone="muted">{teamRoleLabel(item.role)}</StatusPill>
                          {item.expired ? <StatusPill tone="bad">Expired</StatusPill> : item.email_error ? <StatusPill tone="warn">Email not sent</StatusPill> : null}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {item.expired ? "Expired" : "Expires"} {formatDate(item.expires_at, studio.timezone)}
                        </p>
                      </div>
                      <div className="flex gap-1">
                        {!item.expired && (
                          <Button variant="outline" size="sm" disabled={busy} onClick={() => void run(() => resendInvite(item.id), (result) => (result.emailed ? "Invitation emailed again" : "The email could not be sent"))}>
                            Send again
                          </Button>
                        )}
                        <Button variant="ghost" size="sm" disabled={busy} onClick={() => void run(() => revokeInvite(item.id), "Invitation cancelled")}>
                          Cancel invitation
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">People with access</p>
              {team.data.members.map((member) => {
                const canChange = !member.is_primary && !member.is_me && (member.role !== "owner" || team.data.i_am_primary);
                return (
                  <Card key={member.profile_id} data-testid="team-member">
                    <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-2 font-medium">
                          <span className="truncate">{member.name ?? member.email}</span>
                          <StatusPill tone={member.role === "owner" ? "good" : "muted"}>{teamRoleLabel(member.role)}</StatusPill>
                          {member.is_primary && <StatusPill tone="good"><ShieldCheck className="me-1 h-3 w-3" />Primary owner</StatusPill>}
                          {member.is_me && <StatusPill tone="muted">You</StatusPill>}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">{member.email}</p>
                      </div>
                      {canChange && (
                        <div className="flex flex-wrap items-center gap-1">
                          <NativeSelect
                            aria-label={`Role for ${member.name ?? member.email}`}
                            className="h-9 w-32"
                            value={member.role}
                            disabled={busy}
                            onChange={(e) => void run(() => setTeamRole(studio.id, member.profile_id, e.target.value as TeamRole), "Role changed")}
                          >
                            {TEAM_ROLES.filter((item) => item.value !== "owner" || team.data.i_am_primary).map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                            {!TEAM_ROLES.some((item) => item.value === member.role) && <option value={member.role}>{teamRoleLabel(member.role)}</option>}
                          </NativeSelect>
                          {member.role === "owner" && team.data.i_am_primary && (
                            <Button variant="outline" size="sm" disabled={busy} onClick={() => setConfirm({ kind: "transfer", member })}>Make primary owner</Button>
                          )}
                          <Button variant="ghost" size="sm" disabled={busy} onClick={() => setConfirm({ kind: "remove", member })}>Remove</Button>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
              <p className="text-xs text-muted-foreground">
                Any owner can invite people and manage managers and coaches. Only the primary owner can remove another owner or pass the primary role on.
              </p>
            </div>
          </>
        )}
      </div>

      <Dialog open={Boolean(confirm)} onOpenChange={(next) => !next && setConfirm(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{confirm?.kind === "transfer" ? "Make them the primary owner?" : "Remove from the team?"}</DialogTitle>
            <DialogDescription>
              {confirm?.kind === "transfer"
                ? `${confirm.member.name ?? confirm.member.email} becomes the primary owner. You stay an owner, and they will be able to remove you.`
                : `${confirm?.member.name ?? confirm?.member.email} loses access straight away. Classes they were coaching stay on the schedule with no coach assigned.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button>
            <Button variant={confirm?.kind === "remove" ? "destructive" : "default"} disabled={busy} onClick={() => void confirmed()}>
              {confirm?.kind === "transfer" ? "Make primary owner" : "Remove"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Section>
  );
}
