// The one place subscription ("vaste plek") plans and prices live. The subscription page fetches
// these from GET /api/appointments/subscriptions/plans, so changing a price here is all it takes —
// nothing in the frontend needs to be kept in sync by hand.
//
// PLACEHOLDER PRICES — not final yet.
//
// Billing: a fixed price per calendar month, charged automatically to the customer's saved card on
// the 1st of every month (see services/subscriptionBilling.js). The same price every month, whether
// that month happens to have 4 or 5 of their weekday. Only the very first month is pro-rated: the
// signup charge covers the visits left in the month of the first visit (see firstMonthAmount).
// Visits themselves are then already paid — nothing is owed in store.
//
// intervalDays: plans that repeat on a fixed number of days (always the same weekday). Plans without
// it ("monthly") repeat on the same day-of-month instead — see occurrenceDate in
// services/subscriptionSchedule.js.
// visitsPerMonth: what a "full" month is, for pro-rating the first month only.
const SUBSCRIPTION_PLANS = {
  weekly: {
    monthlyPrice: 130.0,
    visitsPerMonth: 4,
    intervalDays: 7,
    label: "Elke week",
    description: "Altijd fresh — elke week dezelfde dag en tijd",
  },
  biweekly: {
    monthlyPrice: 66.0,
    visitsPerMonth: 2,
    intervalDays: 14,
    label: "Elke 2 weken",
    description: "Om de week fresh — zelfde dag en tijd",
  },
  monthly: {
    monthlyPrice: 32.5,
    visitsPerMonth: 1,
    label: "Elke maand",
    description: "1 keer per maand, rond dezelfde datum",
  },
};

// Monthly charge timing and what happens when it fails.
const BILLING = {
  // The monthly charge runs on the 1st, from this hour (shop time) — not at midnight, so a failure
  // and the "please pay" email land at a sensible time.
  chargeFromHour: 9,
  // A failed charge is retried once a day, and the customer gets a pay link by email, for this many
  // days. Still unpaid after that: the subscription pauses and the seats are freed.
  graceDays: 3,
  // The one-off amount SumUp uses to check and save the card at signup — refunded straight away.
  cardCheckAmount: 1.0,
};

module.exports = { SUBSCRIPTION_PLANS, BILLING };
