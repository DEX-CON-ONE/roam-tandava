import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CreditCard, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState, ErrorNote, Field, NativeSelect, OwnerPage, Section, Spinner, StatusPill, ownerKeys, useOwnerAction } from "@/components/owner/OwnerPage";
import {
  listClassTypes, listMembershipTypes, listPackTypes, saveMembershipType, savePackType, setMembershipTypeActive, setPackTypeActive, updateClassType,
  type ClassType, type MembershipType, type OwnerStudio, type PackType,
} from "@/lib/owner/api";
import { centsToInput, formatMoney, parseMoneyToCents, stripeModeFromKey } from "@/lib/owner/format";

const CYCLES: [string, string][] = [["weekly", "week"], ["monthly", "month"], ["quarterly", "3 months"], ["annual", "year"]];
const cycleLabel = (cycle: string) => CYCLES.find(([value]) => value === cycle)?.[1] ?? cycle;

function StripeStatus({ studio }: { studio: OwnerStudio }) {
  const mode = stripeModeFromKey(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY);
  if (mode === "not_connected") {
    return (
      <Card className="border-amber-500/40 bg-amber-500/5" data-testid="stripe-status" data-stripe-mode={mode}>
        <CardContent className="flex gap-3 p-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <div className="text-sm">
            <p className="font-medium">Stripe is not connected yet</p>
            <p className="text-muted-foreground">
              You can set prices now, but nobody can pay online until this site is connected to a Stripe account. Members can still be booked in by you.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card data-testid="stripe-status" data-stripe-mode={mode}>
      <CardContent className="flex gap-3 p-4">
        <CreditCard className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <div className="text-sm">
          <p className="flex flex-wrap items-center gap-2 font-medium">
            Card payments go through Stripe
            {mode === "test" ? <StatusPill tone="warn">Test mode</StatusPill> : <StatusPill tone="good">Live</StatusPill>}
          </p>
          <p className="text-muted-foreground">
            {mode === "test"
              ? "Test mode: only Stripe test cards work and no real money moves. "
              : ""}
            Checkout charges the prices on this page in {studio.currency}; there is nothing to set up in Stripe for each price. A change here applies to the next purchase.
            {studio.stripe_account_id && !studio.stripe_onboarding_complete ? " Your connected Stripe account has not finished its set-up yet." : ""}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function DropInRow({ type, currency }: { type: ClassType; currency: string }) {
  const run = useOwnerAction();
  const [value, setValue] = useState(centsToInput(type.drop_in_price_cents));
  useEffect(() => setValue(centsToInput(type.drop_in_price_cents)), [type.drop_in_price_cents]);
  const cents = value.trim() ? parseMoneyToCents(value) : null;
  const invalid = value.trim().length > 0 && cents == null;
  const changed = cents !== type.drop_in_price_cents;
  const inputId = `dropin-${type.id}`;

  return (
    <div className="flex flex-wrap items-end justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3" data-testid="dropin-row">
      <div className="min-w-0">
        <p className="truncate font-medium">{type.name}</p>
        <p className="text-xs text-muted-foreground">
          {type.drop_in_price_cents != null ? `${formatMoney(type.drop_in_price_cents, currency)} per session` : "Not sold as a single session"}
        </p>
      </div>
      <div className="flex items-end gap-2">
        <div className="space-y-1">
          <Label htmlFor={inputId} className="text-xs text-muted-foreground">Drop-in price ({currency})</Label>
          <Input id={inputId} className="w-28" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder="None" aria-invalid={invalid} />
        </div>
        <Button
          size="sm"
          disabled={invalid || !changed}
          onClick={() => void run(() => updateClassType(type.id, { drop_in_price_cents: cents }), "Drop-in price saved")}
        >
          Save
        </Button>
      </div>
    </div>
  );
}

function PackDialog({ studio, editing, open, onClose }: { studio: OwnerStudio; editing: PackType | null; open: boolean; onClose: () => void }) {
  const run = useOwnerAction();
  const [name, setName] = useState("");
  const [count, setCount] = useState("10");
  const [price, setPrice] = useState("");
  const [days, setDays] = useState("90");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setName(editing?.name ?? "");
    setCount(String(editing?.class_count ?? 10));
    setPrice(centsToInput(editing?.price_cents));
    setDays(String(editing?.validity_days ?? 90));
  }, [open, editing]);

  const cents = parseMoneyToCents(price);
  const valid = name.trim().length > 0 && parseInt(count, 10) > 0 && parseInt(days, 10) > 0 && cents != null;
  const save = async () => {
    if (cents == null) return;
    setBusy(true);
    const input = { name: name.trim(), description: editing?.description ?? null, class_count: parseInt(count, 10), price_cents: cents, validity_days: parseInt(days, 10) };
    const done = await run(async () => { await savePackType(studio.id, input, editing?.id); return true; }, editing ? "Class pack saved" : "Class pack added");
    setBusy(false);
    if (done) onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit class pack" : "New class pack"}</DialogTitle>
          <DialogDescription>A set number of sessions paid for up front. Changes do not affect packs people already hold.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Field label="Name" htmlFor="pack-name"><Input id="pack-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. 10 sessions" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Sessions" htmlFor="pack-count"><Input id="pack-count" type="number" inputMode="numeric" min={1} value={count} onChange={(e) => setCount(e.target.value)} /></Field>
            <Field label={`Price (${studio.currency})`} htmlFor="pack-price"><Input id="pack-price" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="e.g. 120" /></Field>
          </div>
          <Field label="Valid for (days)" htmlFor="pack-days" hint="Counted from the day it is bought."><Input id="pack-days" type="number" inputMode="numeric" min={1} value={days} onChange={(e) => setDays(e.target.value)} /></Field>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void save()} disabled={!valid || busy}>{busy ? "Saving…" : "Save class pack"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MembershipDialog({ studio, editing, open, onClose }: { studio: OwnerStudio; editing: MembershipType | null; open: boolean; onClose: () => void }) {
  const run = useOwnerAction();
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [cycle, setCycle] = useState("monthly");
  const [unlimited, setUnlimited] = useState(true);
  const [perCycle, setPerCycle] = useState("8");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setName(editing?.name ?? "");
    setPrice(centsToInput(editing?.price_cents));
    setCycle(editing?.billing_cycle ?? "monthly");
    setUnlimited(editing ? editing.classes_per_cycle == null : true);
    setPerCycle(String(editing?.classes_per_cycle ?? 8));
  }, [open, editing]);

  const cents = parseMoneyToCents(price);
  const valid = name.trim().length > 0 && cents != null && (unlimited || parseInt(perCycle, 10) > 0);
  const save = async () => {
    if (cents == null) return;
    setBusy(true);
    const input = { name: name.trim(), description: editing?.description ?? null, billing_cycle: cycle, price_cents: cents, classes_per_cycle: unlimited ? null : parseInt(perCycle, 10) };
    const done = await run(async () => { await saveMembershipType(studio.id, input, editing?.id); return true; }, editing ? "Membership saved" : "Membership added");
    setBusy(false);
    if (done) onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit membership" : "New membership"}</DialogTitle>
          <DialogDescription>A recurring subscription. A new price applies to people who join from now on, not to existing subscriptions.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Field label="Name" htmlFor="membership-name"><Input id="membership-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Unlimited" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={`Price (${studio.currency})`} htmlFor="membership-price"><Input id="membership-price" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="e.g. 90" /></Field>
            <Field label="Billed every" htmlFor="membership-cycle">
              <NativeSelect id="membership-cycle" value={cycle} onChange={(e) => setCycle(e.target.value)}>
                {CYCLES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </NativeSelect>
            </Field>
          </div>
          <div className="flex items-center gap-3">
            <Switch id="membership-unlimited" checked={unlimited} onCheckedChange={setUnlimited} />
            <Label htmlFor="membership-unlimited">Unlimited sessions</Label>
          </div>
          {!unlimited && (
            <Field label="Sessions per billing period" htmlFor="membership-count"><Input id="membership-count" type="number" inputMode="numeric" min={1} value={perCycle} onChange={(e) => setPerCycle(e.target.value)} /></Field>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void save()} disabled={!valid || busy}>{busy ? "Saving…" : "Save membership"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PricesBody({ studio }: { studio: OwnerStudio }) {
  const run = useOwnerAction();
  const key = (name: string) => [...ownerKeys.all, name, studio.id];
  const classTypes = useQuery({ queryKey: key("class-types"), queryFn: () => listClassTypes(studio.id) });
  const packs = useQuery({ queryKey: key("pack-types"), queryFn: () => listPackTypes(studio.id) });
  const memberships = useQuery({ queryKey: key("membership-types"), queryFn: () => listMembershipTypes(studio.id) });
  const [packDialog, setPackDialog] = useState<{ open: boolean; editing: PackType | null }>({ open: false, editing: null });
  const [membershipDialog, setMembershipDialog] = useState<{ open: boolean; editing: MembershipType | null }>({ open: false, editing: null });

  if (classTypes.isLoading || packs.isLoading || memberships.isLoading) return <Spinner />;
  const loadError = classTypes.error ?? packs.error ?? memberships.error;
  if (loadError) return <ErrorNote error={loadError} />;

  const activeTypes = (classTypes.data ?? []).filter((type) => type.is_active);
  const newPack = <Button variant="outline" size="sm" onClick={() => setPackDialog({ open: true, editing: null })}><Plus className="me-1.5 h-4 w-4" />New class pack</Button>;
  const newMembership = <Button variant="outline" size="sm" onClick={() => setMembershipDialog({ open: true, editing: null })}><Plus className="me-1.5 h-4 w-4" />New membership</Button>;

  return (
    <div className="space-y-8">
      <StripeStatus studio={studio} />

      <Section title="Drop-in prices">
        {activeTypes.length === 0 ? (
          <EmptyState title="No class types yet" body="A drop-in price belongs to a class type. Create one first.">
            <Button asChild variant="outline" size="sm"><Link to="/manage/schedule">Go to classes</Link></Button>
          </EmptyState>
        ) : (
          <div className="space-y-2">{activeTypes.map((type) => <DropInRow key={type.id} type={type} currency={studio.currency} />)}</div>
        )}
      </Section>

      <Section title="Class packs" action={newPack}>
        {(packs.data ?? []).length === 0 ? (
          <EmptyState title="No class packs" body="Sell a block of sessions at a set price." />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {(packs.data ?? []).map((pack) => (
              <Card key={pack.id} data-testid="pack-card" className={pack.is_active ? undefined : "opacity-60"}>
                <CardContent className="space-y-2 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-medium">{pack.name}</p>
                    {pack.is_active ? <StatusPill tone="good">On sale</StatusPill> : <StatusPill tone="muted">Not on sale</StatusPill>}
                  </div>
                  <p className="text-2xl font-bold">{formatMoney(pack.price_cents, studio.currency)}</p>
                  <p className="text-xs text-muted-foreground">{pack.class_count} sessions · valid {pack.validity_days} days</p>
                  <div className="flex gap-1 pt-1">
                    <Button variant="outline" size="sm" onClick={() => setPackDialog({ open: true, editing: pack })}>Edit</Button>
                    <Button variant="ghost" size="sm" onClick={() => void run(() => setPackTypeActive(pack.id, !pack.is_active), pack.is_active ? "Class pack taken off sale" : "Class pack on sale")}>
                      {pack.is_active ? "Take off sale" : "Put on sale"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </Section>

      <Section title="Memberships" action={newMembership}>
        {(memberships.data ?? []).length === 0 ? (
          <EmptyState title="No memberships" body="Offer a recurring subscription, with unlimited or a set number of sessions." />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {(memberships.data ?? []).map((membership) => (
              <Card key={membership.id} data-testid="membership-card" className={membership.is_active ? undefined : "opacity-60"}>
                <CardContent className="space-y-2 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-medium">{membership.name}</p>
                    {membership.is_active ? <StatusPill tone="good">On sale</StatusPill> : <StatusPill tone="muted">Not on sale</StatusPill>}
                  </div>
                  <p className="text-2xl font-bold">
                    {formatMoney(membership.price_cents, studio.currency)}
                    <span className="text-sm font-normal text-muted-foreground"> / {cycleLabel(membership.billing_cycle)}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {membership.classes_per_cycle == null ? "Unlimited sessions" : `${membership.classes_per_cycle} sessions per billing period`}
                  </p>
                  <div className="flex gap-1 pt-1">
                    <Button variant="outline" size="sm" onClick={() => setMembershipDialog({ open: true, editing: membership })}>Edit</Button>
                    <Button variant="ghost" size="sm" onClick={() => void run(() => setMembershipTypeActive(membership.id, !membership.is_active), membership.is_active ? "Membership taken off sale" : "Membership on sale")}>
                      {membership.is_active ? "Take off sale" : "Put on sale"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </Section>

      <PackDialog studio={studio} editing={packDialog.editing} open={packDialog.open} onClose={() => setPackDialog({ open: false, editing: null })} />
      <MembershipDialog studio={studio} editing={membershipDialog.editing} open={membershipDialog.open} onClose={() => setMembershipDialog({ open: false, editing: null })} />
    </div>
  );
}

export default function OwnerPrices() {
  return (
    <OwnerPage title="Prices" description="Drop-in prices, class packs and memberships.">
      {(studio) => <PricesBody studio={studio} />}
    </OwnerPage>
  );
}
