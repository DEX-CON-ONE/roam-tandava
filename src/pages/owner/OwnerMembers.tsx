import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { EmptyState, ErrorNote, OwnerPage, Spinner, StatusPill, ownerKeys } from "@/components/owner/OwnerPage";
import { listMembers, type OwnerStudio } from "@/lib/owner/api";
import { formatDate, personName } from "@/lib/owner/format";

function MembersBody({ studio }: { studio: OwnerStudio }) {
  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setTerm(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);

  const members = useQuery({
    queryKey: [...ownerKeys.all, "members", studio.id, term],
    queryFn: () => listMembers(studio.id, term),
    placeholderData: (previous) => previous,
  });
  const rows = members.data ?? [];

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          aria-label="Search members"
          className="ps-9"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, email or phone"
        />
      </div>

      {members.isLoading ? (
        <Spinner />
      ) : members.error ? (
        <ErrorNote error={members.error} />
      ) : rows.length === 0 ? (
        term ? (
          <EmptyState title={`No members match "${term}"`} />
        ) : (
          <EmptyState title="No members yet" body="People appear here when they create an account, book a session or buy a pack or membership." />
        )
      ) : (
        <>
          <p className="text-xs text-muted-foreground" data-testid="member-count">{rows.length} member{rows.length === 1 ? "" : "s"}{term ? " found" : ""}</p>
          <ul className="space-y-2">
            {rows.map((member) => (
              <li key={member.profile_id} data-testid="member-row">
                <Link
                  to={`/manage/members/${member.profile_id}`}
                  className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3 transition-colors hover:bg-secondary"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{personName(member)}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {member.email} · joined {formatDate(member.joined_at, studio.timezone)} · {member.total_classes_attended} attended
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {member.active_passes > 0 && <StatusPill tone="good">{member.active_passes} active pass{member.active_passes === 1 ? "" : "es"}</StatusPill>}
                    {member.upcoming_bookings > 0 && <StatusPill tone="muted">{member.upcoming_bookings} upcoming</StatusPill>}
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

export default function OwnerMembers() {
  return (
    <OwnerPage title="Members" description="Everyone with an account at your studio.">
      {(studio) => <MembersBody studio={studio} />}
    </OwnerPage>
  );
}
