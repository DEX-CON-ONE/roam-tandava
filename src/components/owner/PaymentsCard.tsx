import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, CreditCard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { StatusPill, ownerKeys } from "@/components/owner/OwnerPage";
import { disconnectStripe, getPaymentsStatus, startStripeOnboarding, type OwnerStudio, type PaymentsStatus } from "@/lib/owner/api";
import { stripeModeFromKey } from "@/lib/owner/format";

type State = "unavailable" | "site_account" | "unfinished" | "connected";

function stateOf(status: PaymentsStatus): State {
  if (status.mode === "missing" || status.problem === "not_configured" || status.problem === "live_not_allowed") return "unavailable";
  if (status.connected) return "connected";
  return status.accountLinked ? "unfinished" : "site_account";
}

/**
 * Where card payments go, and the owner's controls for linking the studio's
 * own Stripe account. The facts come from the stripe-connect function, which
 * asks Stripe; nothing here is assumed from the browser.
 */
export function PaymentsCard({ studio }: { studio: OwnerStudio }) {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const isOwner = studio.role === "owner";
  const key = [...ownerKeys.all, "payments-status", studio.id];
  const status = useQuery({ queryKey: key, queryFn: getPaymentsStatus, enabled: isOwner, retry: false });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  // Back from Stripe's own pages: drop the marker and ask Stripe where things stand.
  useEffect(() => {
    if (!searchParams.get("stripe")) return;
    searchParams.delete("stripe");
    setSearchParams(searchParams, { replace: true });
    void queryClient.invalidateQueries({ queryKey: key });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const connect = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const result = await startStripeOnboarding();
      if (result.url) {
        window.location.assign(result.url);
        return;
      }
      setNotice(result.message ?? "Stripe could not start the set-up. Try again in a moment.");
    } catch (error) {
      setNotice((error as Error).message);
    }
    await queryClient.invalidateQueries({ queryKey: ownerKeys.all });
    setBusy(false);
  };

  const disconnect = async () => {
    setBusy(true);
    setNotice(null);
    try {
      await disconnectStripe();
    } catch (error) {
      setNotice((error as Error).message);
    }
    await queryClient.invalidateQueries({ queryKey: ownerKeys.all });
    setBusy(false);
    setConfirmDisconnect(false);
  };

  // Managers see what the build says; the account controls are the owner's.
  if (!isOwner) {
    const mode = stripeModeFromKey(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY);
    return (
      <Card id="payments" data-testid="stripe-status" data-stripe-mode={mode}>
        <CardContent className="flex gap-3 p-4 text-sm">
          <CreditCard className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <p className="text-muted-foreground">
            {mode === "not_connected" ? "Card payments are not set up on this site yet." : `Card payments go through Stripe${mode === "test" ? " in test mode: no real money moves" : ""}.`} The studio owner manages the Stripe account.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (status.isLoading) {
    return <Card id="payments"><CardContent className="p-4 text-sm text-muted-foreground">Checking card payments…</CardContent></Card>;
  }
  if (status.error || !status.data) {
    return (
      <Card id="payments" className="border-amber-500/40 bg-amber-500/5" data-testid="stripe-status" data-stripe-state="unknown">
        <CardContent className="flex gap-3 p-4 text-sm">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <p>Could not check card payments just now. Prices can still be changed.</p>
        </CardContent>
      </Card>
    );
  }

  const data = status.data;
  const state = stateOf(data);
  const test = data.mode === "test";
  const problem = notice ?? (!data.ok ? data.message ?? null : null);

  return (
    <Card id="payments" className={state === "unavailable" || state === "unfinished" ? "border-amber-500/40 bg-amber-500/5" : undefined} data-testid="stripe-status" data-stripe-mode={data.mode} data-stripe-state={state}>
      <CardContent className="space-y-3 p-4 text-sm">
        <div className="flex gap-3">
          {state === "connected" ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" /> : state === "site_account" ? <CreditCard className="mt-0.5 h-5 w-5 shrink-0 text-primary" /> : <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />}
          <div className="min-w-0 space-y-1">
            <p className="flex flex-wrap items-center gap-2 font-medium">
              {state === "unavailable" && "Card payments are not set up yet"}
              {state === "site_account" && "Your Stripe account is not connected yet"}
              {state === "unfinished" && "Finish setting up your Stripe account"}
              {state === "connected" && "Card payments are paid out to your Stripe account"}
              {state !== "unavailable" && (test ? <StatusPill tone="warn">Test mode</StatusPill> : <StatusPill tone="good">Live</StatusPill>)}
            </p>
            <p className="text-muted-foreground">
              {state === "unavailable" && (data.message ?? "Nobody can pay online until this site is given a Stripe key. You can still set prices and book members in yourself.")}
              {state === "site_account" && `Until you connect it, card payments are taken by the Stripe account this site was set up with, not yours. ${test ? "That account is in test mode: only Stripe test cards work and no real money moves." : ""}`}
              {state === "unfinished" && `Stripe still needs ${data.detailsSubmitted ? "to finish checking your details" : "some details from you"} before it can pay you. Until then, card payments are taken by the Stripe account this site was set up with.`}
              {state === "connected" && `Checkout charges the prices on this page in ${studio.currency} and Stripe pays them out to your account. ${test ? "Test mode: only Stripe test cards work and no real money moves." : ""}`}
            </p>
            {state !== "unavailable" && (
              <p className="text-xs text-muted-foreground">There is nothing to set up in Stripe for each price: a change on this page applies to the next purchase.</p>
            )}
          </div>
        </div>
        {problem && <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-destructive" role="alert" data-testid="stripe-problem">{problem}</p>}
        {state !== "unavailable" && (
          <div className="flex flex-wrap gap-2">
            {state === "site_account" && <Button size="sm" disabled={busy} onClick={() => void connect()}>{busy ? "Opening Stripe…" : "Connect your Stripe account"}</Button>}
            {state === "unfinished" && <Button size="sm" disabled={busy} onClick={() => void connect()}>{busy ? "Opening Stripe…" : "Continue with Stripe"}</Button>}
            {state !== "site_account" && <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirmDisconnect(true)}>Disconnect</Button>}
          </div>
        )}
      </CardContent>

      <Dialog open={confirmDisconnect} onOpenChange={setConfirmDisconnect}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Disconnect your Stripe account?</DialogTitle>
            <DialogDescription>
              New card payments will stop going to your account and go to the Stripe account this site was set up with instead. Your Stripe account itself is not closed, and existing memberships keep billing where they were started.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmDisconnect(false)}>Keep it connected</Button>
            <Button variant="destructive" disabled={busy} onClick={() => void disconnect()}>Disconnect</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
