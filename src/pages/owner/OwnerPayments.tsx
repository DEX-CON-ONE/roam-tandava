import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState, ErrorNote, OwnerPage, Spinner, StatusPill, ownerKeys } from "@/components/owner/OwnerPage";
import { listPayments, type OwnerStudio } from "@/lib/owner/api";
import { formatDayTime, formatMoney, personName, transactionLabel } from "@/lib/owner/format";
import { PAYMENT_TONE } from "./OwnerMemberDetail";

function PaymentsBody({ studio }: { studio: OwnerStudio }) {
  const payments = useQuery({ queryKey: [...ownerKeys.all, "payments", studio.id], queryFn: () => listPayments(studio.id) });
  if (payments.isLoading) return <Spinner />;
  if (payments.error) return <ErrorNote error={payments.error} />;
  const rows = payments.data ?? [];

  if (rows.length === 0) {
    return (
      <EmptyState
        title="No payments yet"
        body="A payment is recorded here when Stripe confirms it: a drop-in, a class pack or a membership."
      />
    );
  }

  const completed = rows.filter((row) => row.status === "completed");
  const total = completed.reduce((sum, row) => sum + row.amount_cents, 0);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div>
            <p className="text-xs text-muted-foreground">Completed payments shown</p>
            <p className="text-2xl font-bold" data-testid="payments-total">{formatMoney(total, studio.currency)}</p>
          </div>
          <p className="text-xs text-muted-foreground">{completed.length} completed · {rows.length} in total (most recent 200)</p>
        </CardContent>
      </Card>
      <ul className="space-y-2">
        {rows.map((payment) => (
          <li key={payment.id} data-testid="payment-row" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3">
            <div className="min-w-0">
              <p className="truncate font-medium">
                {transactionLabel(payment.type)}
                {" · "}
                <Link to={`/manage/members/${payment.profile_id}`} className="hover:underline">{personName(payment.profile, "Member")}</Link>
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {formatDayTime(payment.created_at, studio.timezone)}{payment.description ? ` · ${payment.description}` : ""}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="tabular-nums font-medium">{formatMoney(payment.amount_cents, studio.currency)}</span>
              <StatusPill tone={PAYMENT_TONE[payment.status] ?? "muted"}>{payment.status.replace("_", " ")}</StatusPill>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function OwnerPayments() {
  return (
    <OwnerPage title="Payments" description="Transactions recorded from Stripe.">
      {(studio) => <PaymentsBody studio={studio} />}
    </OwnerPage>
  );
}
