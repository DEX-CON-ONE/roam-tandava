import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { OwnerPage } from "@/components/owner/OwnerPage";
import type { OwnerStudio } from "@/lib/owner/api";

function Topic({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <Card id={id} data-testid="help-topic">
      <CardContent className="space-y-2 p-4 text-sm leading-relaxed">
        <h2 className="text-base font-semibold">{title}</h2>
        {children}
      </CardContent>
    </Card>
  );
}

const Go = ({ to, children }: { to: string; children: ReactNode }) => <Link to={to} className="font-medium underline">{children}</Link>;

function HelpBody({ studio }: { studio: OwnerStudio }) {
  const owner = studio.role === "owner";
  return (
    <div className="space-y-4">
      <Topic id="start" title="The short version">
        <ol className="list-decimal space-y-1 ps-5">
          <li>Check your studio details in <Go to="/manage/settings">Settings</Go> and press Confirm.</li>
          <li>Add your classes and their times in <Go to="/manage/schedule">Classes</Go>.</li>
          <li>Set prices in <Go to="/manage/offerings">Prices</Go>.</li>
          <li>Connect your Stripe account, also in <Go to="/manage/offerings">Prices</Go>.</li>
          <li>Turn on your public booking page in <Go to="/manage/settings">Settings</Go>.</li>
          <li>Make a test booking at <a className="font-medium underline" href={`/s/${studio.slug}/schedule`} target="_blank" rel="noreferrer">/s/{studio.slug}/schedule</a>.</li>
        </ol>
        <p className="text-muted-foreground">The Dashboard keeps this list and ticks each step off as you do it.</p>
      </Topic>

      <Topic id="classes" title="Classes and the schedule">
        <p>A <strong>class type</strong> is what you offer: its name, how long it lasts and how many people it takes. A <strong>session</strong> is one class type at one date and time.</p>
        <p>In <Go to="/manage/schedule">Classes</Go>, create the class type first, then press <strong>Add to schedule</strong>. Choose <em>Every week</em> for a regular slot (sessions are created 12 weeks ahead and kept topped up) or <em>One session</em> for a one-off. Pick the coach and location for each.</p>
        <p>To change one session, use the pencil. To cancel it, use the cross: everyone booked is released and any class taken from a pass is given back. Card payments are not refunded automatically; refund those in Stripe. To stop a regular slot, open <em>Weekly schedules</em> and press <strong>End schedule</strong>.</p>
      </Topic>

      <Topic id="prices" title="Prices">
        <p>There are three ways to sell, and you can use any mix:</p>
        <ul className="list-disc space-y-1 ps-5">
          <li><strong>Drop-in</strong>: the price of one session of a class type.</li>
          <li><strong>Class pack</strong>: a set number of sessions paid up front, valid for a number of days.</li>
          <li><strong>Membership</strong>: a recurring subscription, unlimited or with a number of sessions each billing period.</li>
        </ul>
        <p>A class with no drop-in price can only be booked with a pack or membership. A price change applies to new purchases; packs and memberships people already hold are not altered.</p>
      </Topic>

      <Topic id="stripe" title="Taking card payments with Stripe">
        <p>Card payments go through Stripe. In <Go to="/manage/offerings">Prices</Go>, the box at the top shows where payments currently go.{owner ? " Press Connect your Stripe account: Stripe asks for your business and bank details on its own pages and brings you back here." : " The studio owner connects the Stripe account."}</p>
        <p>While the box says <strong>Test mode</strong>, no real money moves. You can try a purchase with Stripe's test card 4242 4242 4242 4242, any future expiry date and any three digits.</p>
        <p>Every payment Stripe confirms is listed in <Go to="/manage/financials">Payments</Go>.</p>
      </Topic>

      <Topic id="members" title="Members, bookings and attendance">
        <p>Anyone who creates an account, books or buys appears in <Go to="/manage/students">Members</Go>. Open a member to see their passes, bookings and payments, or to book them into a session yourself.</p>
        <p>Open a session's <strong>Roster</strong> from <Go to="/manage/schedule">Classes</Go> or the Dashboard to see who is booked. Mark each person attended or no-show there, or add someone who turned up.</p>
        <p>Already have a member list elsewhere? <Go to="/manage/import">Import members</Go> reads a spreadsheet export.</p>
      </Topic>

      <Topic id="booking-page" title="Your public booking page">
        <p>Members book at <a className="font-medium underline" href={`/s/${studio.slug}/schedule`} target="_blank" rel="noreferrer">/s/{studio.slug}/schedule</a>. It shows your schedule, lets people create an account, buy and book, and see their own bookings.</p>
        <p>The page is {studio.discoverable ? <strong>on</strong> : <strong>off</strong>}. Switch it from the Dashboard or <Go to="/manage/settings">Settings</Go>. The cancellation window in Settings decides how late a member can cancel and keep their class.</p>
      </Topic>

      <Topic id="team" title="Giving other people access">
        <p>In <Go to="/manage/settings">Settings</Go>, under <strong>Team</strong>, enter someone's email address, choose a role and press Send invitation. They get an email, create an account with that same address and are taken straight in. An invitation lasts 7 days and can be cancelled.</p>
        <ul className="list-disc space-y-1 ps-5">
          <li><strong>Owner</strong>: everything, including payments, settings and the team.</li>
          <li><strong>Manager</strong>: classes, schedule, prices, members and attendance.</li>
          <li><strong>Coach</strong>: can be assigned to classes; no management screens.</li>
        </ul>
        <p>One owner is the <strong>primary owner</strong>. Only they can remove another owner or pass the primary role on.</p>
      </Topic>
    </div>
  );
}

export default function OwnerHelp() {
  return (
    <OwnerPage title="Help" description="How to run your classes here, step by step.">
      {(studio) => <HelpBody studio={studio} />}
    </OwnerPage>
  );
}
