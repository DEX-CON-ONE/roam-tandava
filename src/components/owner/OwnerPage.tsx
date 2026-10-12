/**
 * Shared frame and small building blocks for the owner (studio admin) screens.
 * Each screen renders inside ManageLayout once the caller's studio is known;
 * an account with no studio yet gets a plain empty state instead.
 */

import { type ReactNode, type SelectHTMLAttributes, useEffect } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { ManageLayout } from "@/components/manage/ManageLayout";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { getMyStudio, type OwnerStudio } from "@/lib/owner/api";

export const ownerKeys = {
  all: ["owner"] as const,
  studio: ["owner", "studio"] as const,
};

export function useOwnerStudio() {
  return useQuery({ queryKey: ownerKeys.studio, queryFn: getMyStudio, staleTime: 60_000 });
}

/** Runs a write, refreshes every owner query, and reports the outcome as a toast. */
export function useOwnerAction() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return async function run<T>(work: () => Promise<T>, success?: string | ((result: T) => string)): Promise<T | undefined> {
    try {
      const result = await work();
      await queryClient.invalidateQueries({ queryKey: ownerKeys.all });
      if (success) toast({ title: typeof success === "function" ? success(result) : success });
      return result;
    } catch (error) {
      toast({ title: "That didn't work", description: (error as Error).message, variant: "destructive" });
      return undefined;
    }
  };
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-sm text-muted-foreground" role="status">
      <Loader2 className="h-4 w-4 animate-spin" />
      {label}…
    </div>
  );
}

export function EmptyState({ title, body, children }: { title: string; body?: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center" data-testid="empty-state">
      <p className="font-medium">{title}</p>
      {body && <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{body}</p>}
      {children && <div className="mt-4 flex flex-wrap justify-center gap-2">{children}</div>}
    </div>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <div className="rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive" role="alert">
      Couldn't load this: {(error as Error).message}
    </div>
  );
}

export function Field({ label, htmlFor, hint, children }: { label: string; htmlFor: string; hint?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** A native select: reliable on phones and with assistive technology. */
export function NativeSelect({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}

export function StatusPill({ tone, children }: { tone: "good" | "warn" | "bad" | "muted"; children: ReactNode }) {
  const tones = {
    good: "bg-primary/10 text-primary border-primary/20",
    warn: "bg-amber-500/10 text-amber-700 border-amber-500/30",
    bad: "bg-destructive/10 text-destructive border-destructive/30",
    muted: "bg-muted text-muted-foreground border-border",
  } as const;
  return <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium", tones[tone])}>{children}</span>;
}

export function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

interface OwnerPageProps {
  title: string;
  description?: string;
  actions?: (studio: OwnerStudio) => ReactNode;
  children: (studio: OwnerStudio) => ReactNode;
}

export function OwnerPage({ title, description, actions, children }: OwnerPageProps) {
  const { data: studio, isLoading, error } = useOwnerStudio();

  useEffect(() => {
    document.title = studio ? `${title} · ${studio.name}` : title;
  }, [title, studio]);

  return (
    <ManageLayout>
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
            {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
          </div>
          {studio && actions && <div className="flex flex-wrap gap-2">{actions(studio)}</div>}
        </div>
        {isLoading ? (
          <Spinner />
        ) : error ? (
          <ErrorNote error={error} />
        ) : !studio ? (
          <EmptyState title="No studio yet" body="Set up the studio first. Classes, prices and members appear here once it exists.">
            <Button asChild>
              <Link to="/manage/onboarding">Open studio setup</Link>
            </Button>
          </EmptyState>
        ) : (
          children(studio)
        )}
      </div>
    </ManageLayout>
  );
}
