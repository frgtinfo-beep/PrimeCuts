const Subscription = require("../models/Subscription");
const Appointment = require("../models/Appointment");
const { SUBSCRIPTION_PLANS } = require("../config/subscriptionPlans");

// Every subscription's schedule is fully determined by its startDate + plan, so any occurrence can
// be computed on its own — occurrence 0 is the first (paid) visit on startDate, occurrence n is the
// nth one after that. This is what lets a regular booking, an admin reschedule, or a new
// subscription check "is this seat reserved by a subscriber?" for dates the renewal sweep hasn't
// stamped out as real appointments yet — without it, those future seats were up for grabs.
//
// All date math is done in UTC on plain YYYY-MM-DD strings, so the server's timezone can't shift a
// date by one.
const DAY_MS = 24 * 60 * 60 * 1000;
const parseDate = (dateStr) => {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
const formatDate = (date) => date.toISOString().slice(0, 10);

// "monthly": same day-of-month, clamped to shorter months (31st -> 30th/28th), then rolled forward to
// Monday if it lands on a weekend (shop is closed Sat/Sun). Always counted from startDate's month,
// never from the previous visit — so a weekend roll-over into the next month (e.g. Sat 31 Jan -> Mon
// 2 Feb) or an admin reschedule can never make the schedule skip or drift a month.
function occurrenceDate(subscription, n) {
  const start = parseDate(subscription.startDate);
  const plan = SUBSCRIPTION_PLANS[subscription.frequency] || SUBSCRIPTION_PLANS.monthly;

  if (plan.intervalDays) {
    return formatDate(new Date(start.getTime() + n * plan.intervalDays * DAY_MS));
  }

  const year = start.getUTCFullYear();
  const month = start.getUTCMonth() + n;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const date = new Date(Date.UTC(year, month, Math.min(subscription.dayOfMonth, lastDay)));
  const weekday = date.getUTCDay();
  if (weekday === 6) date.setUTCDate(date.getUTCDate() + 2);
  if (weekday === 0) date.setUTCDate(date.getUTCDate() + 1);
  return formatDate(date);
}

// The occurrence number n (>= 1) that falls on dateStr, or null if this subscription has no visit
// that day. Occurrence 0 isn't reported — that's the first visit, which always exists as a real
// appointment from the moment of signup.
function occurrenceIndexOn(subscription, dateStr) {
  if (!subscription.startDate || dateStr <= subscription.startDate) return null;
  const plan = SUBSCRIPTION_PLANS[subscription.frequency] || SUBSCRIPTION_PLANS.monthly;

  if (plan.intervalDays) {
    const days = Math.round((parseDate(dateStr) - parseDate(subscription.startDate)) / DAY_MS);
    return days % plan.intervalDays === 0 ? days / plan.intervalDays : null;
  }

  // A weekend roll-over can push an occurrence into the next month, so check this month's and the
  // previous month's occurrence.
  const target = parseDate(dateStr);
  const start = parseDate(subscription.startDate);
  const months =
    (target.getUTCFullYear() - start.getUTCFullYear()) * 12 + (target.getUTCMonth() - start.getUTCMonth());
  for (const n of [months, months - 1]) {
    if (n >= 1 && occurrenceDate(subscription, n) === dateStr) return n;
  }
  return null;
}

// Subscriptions still holding their seats: "active" ones, plus "pending" ones mid-checkout (those
// get flipped to "expired" as soon as their first payment fails, so they can't hold seats forever).
const HOLDING_STATUSES = ["pending", "active"];

// Times on dateStr that belong to a subscriber but haven't been generated as a real appointment yet.
// Once the renewal sweep has generated that occurrence, the appointment itself occupies the slot (or,
// if the subscriber cancelled/moved that visit, the seat is free again) — either way it's no longer
// this function's job, so it's left out here.
async function reservedSlotsOn(dateStr, { excludeSubscriptionId } = {}) {
  const candidates = await Subscription.find({
    status: { $in: HOLDING_STATUSES },
    startDate: { $lt: dateStr },
  });

  const reserved = [];
  for (const subscription of candidates) {
    if (excludeSubscriptionId && subscription._id.equals(excludeSubscriptionId)) continue;
    if (occurrenceIndexOn(subscription, dateStr) === null) continue;

    const generated = await Appointment.exists({
      subscriptionId: subscription._id,
      subscriptionOccurrenceDate: dateStr,
    });
    if (generated) continue;

    reserved.push({ time: subscription.time, subscriptionId: subscription._id });
  }
  return reserved;
}

async function isReservedBySubscription(dateStr, time, options) {
  const reserved = await reservedSlotsOn(dateStr, options);
  return reserved.some((slot) => slot.time === time);
}

module.exports = {
  occurrenceDate,
  occurrenceIndexOn,
  reservedSlotsOn,
  isReservedBySubscription,
  parseDate,
  formatDate,
  DAY_MS,
};
