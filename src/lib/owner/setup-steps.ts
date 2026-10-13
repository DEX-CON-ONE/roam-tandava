/** The owner's first-run steps, in order. Each is ticked from real rows by manage_setup_checklist(). */

export interface SetupProgress {
  details_confirmed: boolean;
  has_class_times: boolean;
  has_prices: boolean;
  stripe_connected: boolean;
  public_booking: boolean;
  has_booking: boolean;
}

export interface SetupStep {
  key: keyof SetupProgress;
  title: string;
  hint: string;
  to: string;
  external?: boolean;
  ownerOnly?: boolean;
}

export function setupSteps(studio: { slug: string }): SetupStep[] {
  return [
    { key: "details_confirmed", title: "Check your studio details", hint: "Name, contact email, timezone and cancellation window. Press Confirm when they are right.", to: "/manage/settings", ownerOnly: true },
    { key: "has_class_times", title: "Add your class times", hint: "Create each class, then put it on the schedule, weekly or one-off.", to: "/manage/schedule" },
    { key: "has_prices", title: "Set your prices", hint: "A drop-in price, a class pack or a membership: at least one.", to: "/manage/offerings" },
    { key: "stripe_connected", title: "Connect your Stripe account", hint: "So card payments are paid out to you.", to: "/manage/offerings#payments", ownerOnly: true },
    { key: "public_booking", title: "Turn on your public booking page", hint: "Until it is on, nobody else can see or book your classes.", to: "/manage/settings", ownerOnly: true },
    { key: "has_booking", title: "Make a test booking", hint: "Open your booking page as a member would and book a class.", to: `/s/${studio.slug}/schedule`, external: true },
  ];
}

