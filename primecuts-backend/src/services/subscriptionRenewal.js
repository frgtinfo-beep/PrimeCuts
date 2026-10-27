const Subscription = require("../models/Subscription");
const Appointment = require("../models/Appointment");
const BlockedTime = require("../models/BlockedTime");
const { overlapsBlockedRange } = require("../utils/timeOverlap");
const { occurrenceDate, formatDate } = require("./subscriptionSchedule");

// Hard stop on the occurrence loop, purely as a guard against a corrupt startDate looping forever.
const MAX_OCCURRENCES = 2000;

// Older subscriptions (from before startDate existed) — recover it from their first appointment.
async function ensureStartDate(subscription) {
  if (subscription.startDate) return true;
  const first = subscription.firstAppointmentId
    ? await Appointment.findById(subscription.firstAppointmentId).select("date")
    : null;
  if (!first) return false;
  subscription.startDate = first.date;
  await Subscription.updateOne({ _id: subscription._id }, { $set: { startDate: first.date } });
  return true;
}

// Stamps out every occurrence of one subscription from today on that doesn't exist yet — but only in
// months that are paid for (paidThrough, see subscriptionBilling.js);
// the next month's visits appear once its charge on the 1st goes through. Occurrences already in the
// past are never backfilled. Each occurrence is independent: one that can't be generated (slot
// taken or blocked) is flagged for the admin and skipped, without holding up the ones after it.
//
// No per-visit email: the signup and monthly receipt emails list the month's visits, and every
// visit gets the day-before reminder.
async function generateForSubscription(subscription, { now = new Date() } = {}) {
  if (!(await ensureStartDate(subscription))) return;
  if (!subscription.paidThrough) return;

  const today = formatDate(now);
  let firstIssue = null;

  for (let n = 1; n <= MAX_OCCURRENCES; n++) {
    const date = occurrenceDate(subscription, n);
    // A paid month goes into the agenda in full right away; unpaid months' seats stay reserved
    // (see reservedSlotsOn in subscriptionSchedule.js) until their charge goes through.
    if (date.slice(0, 7) > subscription.paidThrough) break;
    if (date < today) continue;

    // Already generated — including ones the customer since cancelled or an admin moved to another
    // day; those must not come back. The second clause matches visits generated before
    // subscriptionOccurrenceDate existed.
    const alreadyExists = await Appointment.exists({
      subscriptionId: subscription._id,
      $or: [{ subscriptionOccurrenceDate: date }, { date, subscriptionOccurrenceDate: { $exists: false } }],
    });
    if (alreadyExists) continue;

    const blockedRanges = await BlockedTime.find({ date }).select("startTime endTime -_id");
    if (overlapsBlockedRange(subscription.time, blockedRanges)) {
      firstIssue = firstIssue || { reason: "slot_blocked", date };
      logFollowUp(subscription, "slot_blocked", date);
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
        date,
        time: subscription.time,
        // Paid for by the monthly subscription charge — nothing per visit, nothing owed in store,
        // nothing to refund for a single visit. The emails, calendar feed and refund logic read this.
        totalPrice: 0,
        depositAmount: 0,
        checkoutFee: 0,
        status: "confirmed",
        paymentProvider: "subscription",
        subscriptionId: subscription._id,
        subscriptionOccurrenceDate: date,
      });
    } catch (createError) {
      // The unique (date, time) index: someone else already holds this exact slot.
      if (createError.code === 11000) {
        firstIssue = firstIssue || { reason: "slot_taken", date };
        logFollowUp(subscription, "slot_taken", date);
        continue;
      }
      throw createError;
    }

    console.log(
      `Subscription renewal: generated appointment ${newAppointment._id} for subscription ${subscription._id} on ${date} ${subscription.time}.`,
    );
  }

  // Persisted (not just logged) so it shows up in the admin portal. Re-evaluated every sweep, so it
  // clears itself once the conflict is resolved or that date has passed.
  if (firstIssue) {
    await Subscription.updateOne(
      { _id: subscription._id },
      { $set: { renewalIssue: firstIssue.reason, renewalIssueDate: firstIssue.date, renewalIssueAt: new Date() } },
    );
  } else if (subscription.renewalIssue) {
    await Subscription.updateOne(
      { _id: subscription._id },
      { $unset: { renewalIssue: "", renewalIssueDate: "", renewalIssueAt: "" } },
    );
  }
}

function logFollowUp(subscription, reason, date) {
  console.error(
    "MANUAL FOLLOW-UP REQUIRED:",
    JSON.stringify({
      stage: "subscription_renewal",
      reason,
      subscriptionId: subscription._id.toString(),
      customerName: subscription.customerName,
      date,
      time: subscription.time,
    }),
  );
}

// Runs periodically (see server.js), and once per subscription right after its first payment.
async function generateUpcomingSubscriptionAppointments() {
  const activeSubscriptions = await Subscription.find({ status: "active" });

  for (const subscription of activeSubscriptions) {
    try {
      await generateForSubscription(subscription);
    } catch (error) {
      console.error(`Subscription renewal failed for subscription ${subscription._id}:`, error.message);
    }
  }
}

module.exports = { generateUpcomingSubscriptionAppointments, generateForSubscription };
