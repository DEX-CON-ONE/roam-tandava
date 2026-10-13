import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, ChevronRight, Circle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { ownerKeys } from "@/components/owner/OwnerPage";
import { getSetupChecklist, type OwnerStudio } from "@/lib/owner/api";
import { setupSteps } from "@/lib/owner/setup-steps";

/** The owner's first-run list. Every tick comes from real rows; it disappears once all six are done. */
export function SetupChecklist({ studio }: { studio: OwnerStudio }) {
  const checklist = useQuery({ queryKey: [...ownerKeys.all, "checklist", studio.id], queryFn: () => getSetupChecklist(studio.id) });
  if (!checklist.data) return null;
  const steps = setupSteps(studio);
  const done = steps.filter((step) => checklist.data[step.key]).length;
  if (done === steps.length) return null;
  const isOwner = studio.role === "owner";

  return (
    <Card data-testid="setup-checklist">
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="font-semibold">Getting ready to take bookings</p>
          <p className="text-xs text-muted-foreground" data-testid="setup-progress">{done} of {steps.length} done</p>
        </div>
        <ul className="divide-y divide-border">
          {steps.map((step) => {
            const ticked = checklist.data[step.key];
            const locked = step.ownerOnly && !isOwner;
            const body = (
              <>
                {ticked ? <CheckCircle2 className="h-5 w-5 shrink-0 text-primary" aria-label="Done" /> : <Circle className="h-5 w-5 shrink-0 text-muted-foreground/50" aria-label="To do" />}
                <span className="min-w-0 flex-1">
                  <span className={`block text-sm font-medium ${ticked ? "text-muted-foreground line-through" : ""}`}>{step.title}</span>
                  {!ticked && <span className="block text-xs text-muted-foreground">{locked ? "The studio owner does this." : step.hint}</span>}
                </span>
                {!locked && <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
              </>
            );
            const className = "flex items-center gap-3 py-2.5";
            return (
              <li key={step.key} data-testid={`setup-${step.key}`} data-done={ticked}>
                {locked ? <div className={className}>{body}</div>
                  : step.external ? <a className={`${className} hover:bg-secondary/60`} href={step.to} target="_blank" rel="noreferrer">{body}</a>
                  : <Link className={`${className} hover:bg-secondary/60`} to={step.to}>{body}</Link>}
              </li>
            );
          })}
        </ul>
        <p className="text-xs text-muted-foreground">
          Stuck? <Link to="/manage/help" className="underline">Read the owner guide</Link>.
        </p>
      </CardContent>
    </Card>
  );
}
