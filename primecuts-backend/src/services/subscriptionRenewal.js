const Subscription = require("../models/Subscription");
const Appointment = require("../models/Appointment");
const BlockedTime = require("../models/BlockedTime");
const { overlapsBlockedRange } = require("../utils/timeOverlap");
const { sendConfirmationEmail } = require("../controllers/appointmentController");

// How far ahead we're willing to generate the next visit — keeps this sweep from stamping out a
// year of appointments in one go; it just runs periodically (see server.js) and picks up each
// month's occurrence as it comes into this window.
const GENERATE_LEAD_DAYS = 30;

const pad2 = (n) => String(n).padStart(2, "0");
const toDateStr = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

// "weekly" plan: exactly 7 days after the last visit — always lands on the same weekday the
// customer originally picked, so (unlike "monthly") there's never a weekend to roll off of.
// "monthly" plan: same calendar day next month, clamped to that month's actual last day (e.g. day
// 31 in a 30-day month becomes the 30th) — then rolled forward to the following Monday if that
// lands on a weekend, since the shop is closed Sat/Sun.
function nextOccurrenceDate(fromDateStr, dayOfMonth, frequency = "monthly") {
  const from = new Date(`${fromDateStr}T00:00:00`);

  if (frequency === "weekly") {
    from.setDate(from.getDate() + 7);
    return toDateStr(from);
  }

  const year = from.getFullYear();
  const month = from.getMonth() + 1; // 0-indexed -> next month
  const lastDayOfNextMonth = new Date(year, month + 1, 0).getDate();
  const clampedDay = Math.min(dayOfMonth, lastDayOfNextMonth);

  const next = new Date(year, month, clampedDay);
  const weekday = next.getDay();
  if (weekday === 6) next.setDate(next.getDate() + 2); // Saturday -> Monday
  if (weekday === 0) next.setDate(next.getDate() + 1); // Sunday -> Monday

  return toDateStr(next);
}

// Runs periodically (see server.js). For every active membership, finds the most recently
// generated visit (confirmed or cancelled — either way, that's the month already accounted for)
// and, once the next one falls within GENERATE_LEAD_DAYS, stamps out an ordinary confirmed
// Appointment for it. No payment step here — the membership was already paid into; this just
// reserves the slot. If that slot is somehow taken or blocked, it's left for a human rather than
// silently skipped or double-booked.
async function generateUpcomingSubscriptionAppointments() {
  const activeSubscriptions = await Subscription.find({ status: "active" });
  const horizon = new Date(Date.now() + GENERATE_LEAD_DAYS * 24 * 60 * 60 * 1000);

  for (const subscription of activeSubscriptions) {
    try {
      const lastAppointment = await Appointment.findOne({ subscriptionId: subscription._id }).sort({
        date: -1,
      });

      if (!lastAppointment) continue; // shouldn't happen — firstAppointmentId is always set on creation

      const nextDate = nextOccurrenceDate(lastAppointment.date, subscription.dayOfMonth, subscription.frequency);
      if (new Date(`${nextDate}T00:00:00`) > horizon) continue; // not due yet, check again next sweep

      const alreadyExists = await Appointment.findOne({ subscriptionId: subscription._id, date: nextDate });
      if (alreadyExists) continue;

      const blockedRanges = await BlockedTime.find({ date: nextDate }).select("startTime endTime -_id");
      const slotTaken = await Appointment.findOne({
        date: nextDate,
        time: subscription.time,
        status: { $in: ["pending", "confirmed"] },
      });

      if (overlapsBlockedRange(subscription.time, blockedRanges) || slotTaken) {
        const reason = slotTaken ? "slot_taken" : "slot_blocked";
        console.error(
          "MANUAL FOLLOW-UP REQUIRED:",
          JSON.stringify({
            stage: "subscription_renewal",
            reason,
            subscriptionId: subscription._id.toString(),
            customerName: subscription.customerName,
            date: nextDate,
            time: subscription.time,
          }),
        );
        // Persisted (not just logged) so this shows up in the admin portal — every sweep re-attempts
        // the same date until it succeeds, so this naturally clears itself once the conflict is
        // resolved (the blocked time removed, or the conflicting appointment cancelled).
        await Subscription.findByIdAndUpdate(subscription._id, {
          $set: { renewalIssue: reason, renewalIssueDate: nextDate, renewalIssueAt: new Date() },
        });
        continue;
      }

      let newAppointment;
      try {
        newAppointment = await Appointment.create({
          customerName: subscription.customerName,
          customerEmail: subscription.customerEmail,
          customerPhone: subscription.customerPhone,
          service: "Abonnement",
          addons: [],
          date: nextDate,
          time: subscription.time,
          totalPrice: subscription.price,
          depositAmount: subscription.price,
          checkoutFee: 0,
          status: "confirmed",
          paymentProvider: "subscription",
          subscriptionId: subscription._id,
        });
      } catch (createError) {
        // The slotTaken pre-check above just missed a race (something else claimed this exact
        // date+time a moment later) — same outcome as if the pre-check had caught it: flag for a
        // human, try again next sweep, rather than letting this surface only as a console log.
        if (createError.code === 11000) {
          console.error(
            "MANUAL FOLLOW-UP REQUIRED:",
            JSON.stringify({
              stage: "subscription_renewal",
              reason: "slot_taken",
              subscriptionId: subscription._id.toString(),
              customerName: subscription.customerName,
              date: nextDate,
              time: subscription.time,
            }),
          );
          await Subscription.findByIdAndUpdate(subscription._id, {
            $set: { renewalIssue: "slot_taken", renewalIssueDate: nextDate, renewalIssueAt: new Date() },
          });
          continue;
        }
        throw createError;
      }

      // Clears any stale flag from a previous cycle that failed to renew — this cycle just
      // succeeded, so whatever conflict caused that has since been resolved.
      if (subscription.renewalIssue) {
        await Subscription.findByIdAndUpdate(subscription._id, {
          $unset: { renewalIssue: "", renewalIssueDate: "", renewalIssueAt: "" },
        });
      }

      await sendConfirmationEmail(newAppointment);

      console.log(
        `Subscription renewal: generated appointment ${newAppointment._id} for subscription ${subscription._id} on ${nextDate} ${subscription.time}.`,
      );
    } catch (error) {
      console.error(`Subscription renewal failed for subscription ${subscription._id}:`, error.message);
    }
  }
}

module.exports = { generateUpcomingSubscriptionAppointments, nextOccurrenceDate };
