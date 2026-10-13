import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { EmptyState, Field, NativeSelect, OwnerPage, Section, ownerKeys, useOwnerAction } from "@/components/owner/OwnerPage";
import { useQuery } from "@tanstack/react-query";
import { TeamSection } from "@/components/owner/TeamSection";
import { confirmStudioDetails, getSetupChecklist, updateStudio, type OwnerStudio } from "@/lib/owner/api";
import { TIMEZONE_OPTIONS, isHexColor, isValidEmail, isValidSlug, withOption } from "@/lib/owner/studio-defaults";

const WINDOW_UNITS = [["60", "hours"], ["1", "minutes"]] as const;

function ColorField({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (value: string) => void }) {
  const valid = isHexColor(value);
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label} picker`}
          className="h-10 w-12 shrink-0 cursor-pointer rounded-md border border-input bg-background p-1"
          value={valid ? value : "#000000"}
          onChange={(e) => onChange(e.target.value)}
        />
        <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={!valid} />
      </div>
      {!valid && <p className="text-xs text-destructive" role="alert">Use a six-digit hex colour such as #b66d3b.</p>}
    </div>
  );
}

function SettingsBody({ studio }: { studio: OwnerStudio }) {
  const run = useOwnerAction();
  const [name, setName] = useState(studio.name);
  const [slug, setSlug] = useState(studio.slug);
  const [email, setEmail] = useState(studio.email ?? "");
  const [timezone, setTimezone] = useState(studio.timezone);
  const inHours = studio.cancellation_minutes % 60 === 0;
  const [windowValue, setWindowValue] = useState(String(inHours ? studio.cancellation_minutes / 60 : studio.cancellation_minutes));
  const [windowUnit, setWindowUnit] = useState<string>(inHours ? "60" : "1");
  const [discoverable, setDiscoverable] = useState(studio.discoverable);
  const [primary, setPrimary] = useState(studio.primary_color ?? "");
  const [secondary, setSecondary] = useState(studio.secondary_color ?? "");
  const [busy, setBusy] = useState(false);
  // Whether an owner has confirmed these details yet (the first item on the dashboard's list).
  const checklist = useQuery({ queryKey: [...ownerKeys.all, "checklist", studio.id], queryFn: () => getSetupChecklist(studio.id) });
  const confirmed = checklist.data?.details_confirmed ?? true;

  // The listing can also be switched from the dashboard; follow it.
  useEffect(() => setDiscoverable(studio.discoverable), [studio.discoverable]);

  const minutes = Math.round(Number(windowValue) * Number(windowUnit));
  const problems = {
    name: name.trim() ? "" : "Enter the studio's name.",
    slug: isValidSlug(slug) ? "" : "Use lowercase letters, numbers and single hyphens (at least 2 characters).",
    email: isValidEmail(email) ? "" : "Enter a contact email address.",
    window: windowValue.trim() !== "" && Number.isFinite(minutes) && minutes >= 0 && minutes <= 20160 ? "" : "Enter a time between 0 and 14 days.",
  };
  const valid = !Object.values(problems).some(Boolean) && isHexColor(primary) && isHexColor(secondary);
  const changed =
    name.trim() !== studio.name || slug !== studio.slug || email.trim().toLowerCase() !== (studio.email ?? "") || timezone !== studio.timezone ||
    minutes !== studio.cancellation_minutes || discoverable !== studio.discoverable ||
    primary.toLowerCase() !== (studio.primary_color ?? "").toLowerCase() || secondary.toLowerCase() !== (studio.secondary_color ?? "").toLowerCase();

  if (studio.role !== "owner") {
    return <EmptyState title="Only the studio owner can change settings" />;
  }

  const save = async () => {
    setBusy(true);
    await run(async () => {
      if (changed) await updateStudio(studio.id, { name, slug, email, timezone, cancellationMinutes: minutes, discoverable, primaryColor: primary, secondaryColor: secondary });
      await confirmStudioDetails(studio.id);
    }, changed ? "Settings saved" : "Details confirmed");
    setBusy(false);
  };

  return (
    <div className="space-y-8">
      <Section title="Studio">
        <Card>
          <CardContent className="space-y-4 p-4">
            <Field label="Studio name" htmlFor="settings-name" hint={problems.name || undefined}>
              <Input id="settings-name" value={name} onChange={(e) => setName(e.target.value)} aria-invalid={Boolean(problems.name)} />
            </Field>
            <Field label="Contact email" htmlFor="settings-email" hint={problems.email || "Shown to members and used for booking notifications."}>
              <Input id="settings-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={Boolean(problems.email)} />
            </Field>
            <Field label="Timezone" htmlFor="settings-timezone" hint={timezone !== studio.timezone ? "Sessions already on the schedule keep their moment in time, so their clock time will read differently in the new timezone." : "Class times are entered and shown in this timezone."}>
              <NativeSelect id="settings-timezone" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
                {withOption(TIMEZONE_OPTIONS, timezone).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </NativeSelect>
            </Field>
            <p className="text-xs text-muted-foreground">Currency: {studio.currency}. It is fixed once the studio is set up, because prices and payments are recorded in it.</p>
          </CardContent>
        </Card>
      </Section>

      <Section title="Booking page">
        <Card>
          <CardContent className="space-y-4 p-4">
            <Field
              label="Booking page address"
              htmlFor="settings-slug"
              hint={problems.slug || (slug !== studio.slug
                ? `Links to /s/${studio.slug} will stop working, including the one members land on after signing in until the site is rebuilt.`
                : `Members book at /s/${slug}.`)}
            >
              <Input id="settings-slug" value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))} aria-invalid={Boolean(problems.slug)} />
            </Field>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <Label htmlFor="settings-listed">Public booking page</Label>
                <p className="text-xs text-muted-foreground">{discoverable ? "Anyone with the link can see classes and prices." : "Hidden: nobody can see or book."}</p>
              </div>
              <Switch id="settings-listed" checked={discoverable} onCheckedChange={setDiscoverable} />
            </div>
            <Field label="Cancellation window" htmlFor="settings-window" hint={problems.window || "A member who cancels later than this before a session loses the class from their pass."}>
              <div className="flex gap-2">
                <Input id="settings-window" className="w-28" type="number" inputMode="numeric" min={0} value={windowValue} onChange={(e) => setWindowValue(e.target.value)} aria-invalid={Boolean(problems.window)} />
                <NativeSelect aria-label="Cancellation window unit" className="w-32" value={windowUnit} onChange={(e) => setWindowUnit(e.target.value)}>
                  {WINDOW_UNITS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </NativeSelect>
              </div>
            </Field>
          </CardContent>
        </Card>
      </Section>

      <Section title="Brand colours">
        <Card>
          <CardContent className="space-y-4 p-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <ColorField id="settings-primary" label="Primary colour" value={primary} onChange={setPrimary} />
              <ColorField id="settings-secondary" label="Secondary colour" value={secondary} onChange={setSecondary} />
            </div>
            <p className="text-xs text-muted-foreground">Used on the public booking page: buttons and highlights.</p>
          </CardContent>
        </Card>
      </Section>

      <div className="flex items-center gap-3">
        <Button onClick={() => void save()} disabled={!valid || busy || (!changed && confirmed)}>
          {busy ? "Saving…" : changed || confirmed ? "Save settings" : "Confirm these details"}
        </Button>
        {!changed && confirmed && <span className="text-xs text-muted-foreground">No changes to save.</span>}
        {!changed && !confirmed && <span className="text-xs text-muted-foreground">Check everything above is right, then confirm.</span>}
      </div>

      <TeamSection studio={studio} />
    </div>
  );
}

export default function OwnerSettings() {
  return (
    <OwnerPage title="Settings" description="The studio's name, booking page, cancellation window and colours.">
      {(studio) => <SettingsBody key={studio.id} studio={studio} />}
    </OwnerPage>
  );
}
