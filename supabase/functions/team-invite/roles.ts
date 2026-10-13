/** How each staff role is described to the person being invited. */
export function describeRole(role: string): { label: string; summary: string } {
  switch (role) {
    case "owner":
      return { label: "an owner", summary: "Owners can do everything: classes, prices, members, payments, settings and the team." };
    case "admin":
      return { label: "a manager", summary: "Managers run the day to day: classes, the schedule, prices, members and attendance." };
    default:
      return { label: "a coach", summary: "Coaches can be assigned to classes on the schedule." };
  }
}
