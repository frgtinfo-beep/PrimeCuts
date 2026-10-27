const Subscription = require("../models/Subscription");
const SubscriptionCharge = require("../models/SubscriptionCharge");
const Appointment = require("../models/Appointment");
const { SUBSCRIPTION_PLANS, BILLING } = require("../config/subscriptionPlans");
const { occurrenceDate } = require("./subscriptionSchedule");
const { generateForSubscription } = require("./subscriptionRenewal");
const sumup = require("./sumupRecurring");
const emails = require("./subscriptionEmails");
const { shopNow } = require("../utils/shopTime");

const DAY_MS = 24 * 60 * 60 * 1000;
// A charge attempt still "processing" after this long is assumed to have crashed mid-way — its
// SumUp checkout is checked (paid or not) before anything is tried again.
const STALE_PROCESSING_MS = 10 * 60 * 1000;
// A signup whose card step was never finished (closed the tab, card declined) releases its seat.
const SIGNUP_TIMEOUT_MS = 20 * 60 * 1000;

const roundToCents = (amount) => Math.round(amount * 100) / 100;
const periodOf = (dateStr) => dateStr.slice(0, 7);
const nextPeriod = (period) => {
  const [y, m] = period.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
};
const firstOfPeriod = (period) => `${period}-01`;

// Visits of this schedule that fall in the same month as its first visit (the first one included).
function visitsInFirstMonth(draft) {
  const period = periodOf(draft.startDate);
  const dates = [];
  for (let n = 0; n < 40; n++) {
    const date = occurrenceDate(draft, n);
    if (periodOf(date) !== period) break;
    dates.push(date);
  }
  return dates;
}

// The signup charge: the monthly price, scaled down for the visits left in the first month (signing
// up for a weekly Friday on the 25th shouldn't cost a full month). Never more than a full month,
// even in a month with 5 of that weekday.
function firstMonthAmount(draft) {
  const plan = SUBSCRIPTION_PLANS[draft.frequency];
  const visits = visitsInFirstMonth(draft).length;
  return roundToCents(plan.monthlyPrice * Math.min(1, visits / plan.visitsPerMonth));
}

// --------------------------------------------------------------------------- one charge attempt
// Claims the charge (so overlapping runs can't both charge), checks a previous attempt that might
// already have gone through, then charges the saved card. Returns the updated charge.
async function attemptCharge(charge, subscription, clock = new Date()) {
  const now = clock.getTime();
  const claimed = await SubscriptionCharge.findOneAndUpdate(
    {
      _id: charge._id,
      $or: [
        { status: "failed" },
        { status: "processing", attempts: 0 },
        { status: "processing", updatedAt: { $lt: new Date(Date.now() - STALE_PROCESSING_MS) } },
      ],
    },
    { $set: { status: "processing" }, $inc: { attempts: 1 } },
    { new: true },
  );
  if (!claimed) return SubscriptionCharge.findById(charge._id);

  // A previous attempt's checkout may have been paid after all (e.g. we crashed right after).
  if (claimed.sumupCheckoutId) {
    const previous = await sumup.readCheckout(claimed.sumupCheckoutId).catch(() => null);
    if (previous?.paid) return markChargePaid(claimed, "card_on_file", previous.transactionId);
  }

  const result = await sumup.chargeSavedCard({
    reference: `sub-${subscription._id}-${claimed.period}-${claimed.attempts}`,
    amount: claimed.amount,
    description: `PrimeCuts abonnement ${claimed.period} — ${SUBSCRIPTION_PLANS[subscription.frequency]?.label || ""}`.trim(),
    customerId: subscription.sumupCustomerId,
    token: subscription.cardToken,
    onCheckoutCreated: (checkoutId) => SubscriptionCharge.updateOne({ _id: claimed._id }, { $set: { sumupCheckoutId: checkoutId } }),
  });

  if (result.paid) return markChargePaid(claimed, "card_on_file", result.transactionId);

  console.error(`Subscription charge failed (${subscription._id}, ${claimed.period}, attempt ${claimed.attempts}): ${result.error}`);
  return SubscriptionCharge.findByIdAndUpdate(
    claimed._id,
    { $set: { status: "failed", lastError: result.error, nextAttemptAt: new Date(now + DAY_MS) } },
    { new: true },
  );
}

async function markChargePaid(charge, paidVia, transactionId) {
  return SubscriptionCharge.findByIdAndUpdate(
    charge._id,
    { $set: { status: "paid", paidAt: new Date(), paidVia, transactionId: transactionId || undefined } },
    { new: true },
  );
}

async function upcomingVisitsIn(subscriptionId, period) {
  return Appointment.find({
    subscriptionId,
    status: { $in: ["pending", "confirmed"] },
    date: { $gte: firstOfPeriod(period), $lt: firstOfPeriod(nextPeriod(period)) },
  }).sort({ date: 1 });
}

// --------------------------------------------------------------------------- signup
// Finishes a signup once the customer completed the card step in SumUp's form: saves the card,
// charges the first (pro-rated) month and confirms the subscription. Safe to call any number of
// times (the page calls it, and so does the background sweep in case the page never did).
// Returns { status: "active" | "pending" | "failed", error? }.
async function completeSignup(subscriptionId) {
  let subscription = await Subscription.findById(subscriptionId);
  if (!subscription) return { status: "failed", error: "Abonnement niet gevonden." };
  if (subscription.status === "active") return { status: "active", subscription };
  if (subscription.status !== "pending") return { status: "failed", error: "Deze aanmelding is verlopen. Meld je opnieuw aan." };

  if (!subscription.cardToken) {
    const setup = await sumup.readCardSetup(subscription.setupCheckoutId, subscription.sumupCustomerId);
    if (!setup.ok) {
      if (setup.terminalFailure) {
        await expireSignup(subscription);
        return { status: "failed", error: setup.error || "Je kaart is niet geaccepteerd. Probeer een andere kaart." };
      }
      return { status: "pending" };
    }
    subscription = await Subscription.findByIdAndUpdate(
      subscription._id,
      { $set: { cardToken: setup.token, cardLast4: setup.last4 || undefined } },
      { new: true },
    );
  }

  const period = periodOf(subscription.startDate);
  let charge;
  try {
    charge = await SubscriptionCharge.create({
      subscriptionId: subscription._id,
      period,
      kind: "first",
      amount: subscription.firstMonthAmount,
    });
  } catch (error) {
    if (error.code !== 11000) throw error;
    charge = await SubscriptionCharge.findOne({ subscriptionId: subscription._id, period });
  }

  if (charge.status !== "paid") charge = await attemptCharge(charge, subscription);

  if (charge.status === "processing") return { status: "pending" }; // another call is charging right now
  if (charge.status !== "paid") {
    // The customer is right there at signup — no silent retries: tell them now so they can use
    // another card.
    await expireSignup(subscription);
    return { status: "failed", error: `De eerste betaling is niet gelukt: ${charge.lastError || "onbekende fout"} Probeer een andere kaart.` };
  }

  return activate(subscription, period);
}

async function activate(subscription, period) {
  const activated = await Subscription.findOneAndUpdate(
    { _id: subscription._id, status: "pending" },
    { $set: { status: "active", paidThrough: period, billingStatus: "ok" } },
    { new: true },
  );
  if (!activated) return { status: "active", subscription: await Subscription.findById(subscription._id) };

  await Appointment.updateOne(
    { _id: activated.firstAppointmentId, status: "pending" },
    { $set: { status: "confirmed" }, $unset: { expiresAt: "" } },
  );
  await generateForSubscription(activated);

  await emails.sendSubscriptionStartedEmail(activated, {
    firstPeriod: period,
    nextChargeDate: firstOfPeriod(nextPeriod(period)),
    visits: await upcomingVisitsIn(activated._id, period),
  });
  return { status: "active", subscription: activated };
}

// Signup abandoned or card refused: release the held first visit and the future seats, and remove
// the saved card if one got stored.
async function expireSignup(subscription) {
  const expired = await Subscription.findOneAndUpdate(
    { _id: subscription._id, status: "pending" },
    { $set: { status: "expired" } },
    { new: true },
  );
  if (!expired) return;
  await Appointment.updateOne(
    { _id: expired.firstAppointmentId, status: "pending" },
    { $set: { status: "expired", releasedReason: "failed", releasedAt: new Date() } },
  );
  if (expired.setupCheckoutId) await sumup.deactivateCheckout(expired.setupCheckoutId);
  await sumup.removeSavedCard(expired.sumupCustomerId, expired.cardToken);
}

// Background safety net (see server.js): finishes signups whose page never called /complete (tab
// closed right after paying) and releases ones that were abandoned.
async function reconcilePendingSignups() {
  const pending = await Subscription.find({ status: "pending", setupCheckoutId: { $exists: true } });
  for (const subscription of pending) {
    try {
      const result = await completeSignup(subscription._id);
      if (result.status === "pending" && Date.now() - subscription.createdAt.getTime() > SIGNUP_TIMEOUT_MS) {
        await expireSignup(subscription);
      }
    } catch (error) {
      console.error(`Signup reconciliation failed for subscription ${subscription._id}:`, error.message);
    }
  }
}

// --------------------------------------------------------------------------- monthly billing
async function chargeMonth(subscription, period, now) {
  let charge;
  try {
    charge = await SubscriptionCharge.create({ subscriptionId: subscription._id, period, kind: "monthly", amount: subscription.price });
  } catch (error) {
    if (error.code !== 11000) throw error;
    return; // already being handled for this month (by another run, or as a failed charge below)
  }

  charge = await attemptCharge(charge, subscription, now);
  if (charge.status === "paid") return onMonthPaid(subscription, charge, now);
  if (charge.status === "failed") return onFirstFailure(subscription, charge, now);
}

async function onMonthPaid(subscription, charge, now = new Date()) {
  const updated = await Subscription.findOneAndUpdate(
    { _id: subscription._id, status: "active" },
    { $set: { paidThrough: charge.period, billingStatus: "ok" }, $unset: { pastDueSince: "" } },
    { new: true },
  );
  if (charge.payLinkCheckoutId) await sumup.deactivateCheckout(charge.payLinkCheckoutId);
  if (!updated) return;
  await generateForSubscription(updated, { now });
  await emails.sendMonthlyReceiptEmail(updated, charge, await upcomingVisitsIn(updated._id, charge.period));
}

const graceDeadline = (charge) => charge.graceUntil || new Date(charge.createdAt.getTime() + BILLING.graceDays * DAY_MS);

async function onFirstFailure(subscription, charge, now = new Date()) {
  const deadline = new Date(now.getTime() + BILLING.graceDays * DAY_MS);
  await Subscription.updateOne({ _id: subscription._id }, { $set: { billingStatus: "past_due", pastDueSince: now } });
  await SubscriptionCharge.updateOne({ _id: charge._id }, { $set: { graceUntil: deadline } });
  try {
    const frontend = (process.env.FRONTEND_BASE_URL || "https://primecutsnl.com").replace(/\/$/, "");
    const link = await sumup.createPayLink({
      reference: `sub-${subscription._id}-${charge.period}-link`,
      amount: charge.amount,
      description: `PrimeCuts abonnement ${charge.period}`,
      customerId: subscription.sumupCustomerId,
      redirectUrl: `${frontend}/subscription.html?billing=paid`,
      validUntil: deadline,
    });
    charge = await SubscriptionCharge.findByIdAndUpdate(
      charge._id,
      { $set: { payLinkCheckoutId: link.checkoutId, payLinkUrl: link.url } },
      { new: true },
    );
  } catch (error) {
    console.error(`Could not create pay link for subscription ${subscription._id}:`, error.message);
  }
  await emails.sendPaymentFailedEmail(subscription, charge, deadline);
}

// Failed charges: paid via the emailed link? Retry the card once a day; pause once the grace period
// is over.
async function followUpFailedCharges(now) {
  const failedCharges = await SubscriptionCharge.find({
    kind: "monthly",
    $or: [
      { status: "failed" },
      // A run that crashed mid-charge — attemptCharge checks its SumUp checkout before anything else.
      { status: "processing", updatedAt: { $lt: new Date(now.getTime() - STALE_PROCESSING_MS) } },
    ],
  });
  for (const charge of failedCharges) {
    try {
      const subscription = await Subscription.findById(charge.subscriptionId);
      if (charge.status === "processing") {
        if (!subscription || subscription.status !== "active") continue;
        const recovered = await attemptCharge(charge, subscription, now);
        if (recovered.status === "paid") await onMonthPaid(subscription, recovered, now);
        else if (recovered.status === "failed" && !recovered.graceUntil) await onFirstFailure(subscription, recovered, now);
        continue;
      }
      if (!subscription || subscription.status !== "active") {
        await SubscriptionCharge.updateOne({ _id: charge._id, status: "failed" }, { $set: { status: "abandoned" } });
        continue;
      }

      if (charge.payLinkCheckoutId) {
        const link = await sumup.readCheckout(charge.payLinkCheckoutId).catch(() => null);
        if (link?.paid) {
          const paid = await SubscriptionCharge.findOneAndUpdate(
            { _id: charge._id, status: "failed" },
            { $set: { status: "paid", paidAt: new Date(), paidVia: "pay_link", transactionId: link.transactionId || undefined } },
            { new: true },
          );
          if (paid) await onMonthPaid(subscription, paid, now);
          continue;
        }
      }

      if (now >= graceDeadline(charge)) {
        await pause(subscription, charge);
        continue;
      }

      if (charge.nextAttemptAt && charge.nextAttemptAt <= now) {
        const retried = await attemptCharge(charge, subscription, now);
        if (retried.status === "paid") await onMonthPaid(subscription, retried, now);
      }
    } catch (error) {
      console.error(`Follow-up of failed charge ${charge._id} failed:`, error.message);
    }
  }
}

async function pause(subscription, charge) {
  const paused = await Subscription.findOneAndUpdate(
    { _id: subscription._id, status: "active" },
    { $set: { status: "paused", pausedAt: new Date() } },
    { new: true },
  );
  await SubscriptionCharge.updateOne({ _id: charge._id, status: "failed" }, { $set: { status: "abandoned" } });
  if (!paused) return;
  if (charge.payLinkCheckoutId) await sumup.deactivateCheckout(charge.payLinkCheckoutId);
  await sumup.removeSavedCard(paused.sumupCustomerId, paused.cardToken);
  console.error(
    "MANUAL FOLLOW-UP REQUIRED:",
    JSON.stringify({ stage: "subscription_billing", reason: "paused_unpaid", subscriptionId: paused._id.toString(), customerName: paused.customerName, period: charge.period }),
  );
  await emails.sendSubscriptionPausedEmail(paused, charge);
}

// Runs periodically (see server.js). From 09:00 on the 1st, charges every active subscription for
// the new month (skipping ones already paid through it, e.g. a first visit later this month); every
// run also follows up on failed charges.
async function runMonthlyBilling({ now = new Date() } = {}) {
  if (!sumup.isConfigured()) return;
  const shop = shopNow(now);
  if (shop.hour < BILLING.chargeFromHour) return;
  const period = periodOf(shop.date);

  const due = await Subscription.find({ status: "active", cardToken: { $exists: true }, paidThrough: { $lt: period } });
  for (const subscription of due) {
    try {
      await chargeMonth(subscription, period, now);
    } catch (error) {
      console.error(`Monthly charge for subscription ${subscription._id} failed:`, error.message);
    }
  }
  await followUpFailedCharges(now);
}

// Stops all future charges (admin cancel): removes the saved card and drops an open failed charge.
async function stopBilling(subscription) {
  const open = await SubscriptionCharge.find({ subscriptionId: subscription._id, status: "failed" });
  for (const charge of open) {
    if (charge.payLinkCheckoutId) await sumup.deactivateCheckout(charge.payLinkCheckoutId);
  }
  await SubscriptionCharge.updateMany({ subscriptionId: subscription._id, status: "failed" }, { $set: { status: "abandoned" } });
  await sumup.removeSavedCard(subscription.sumupCustomerId, subscription.cardToken);
}

module.exports = {
  firstMonthAmount,
  visitsInFirstMonth,
  nextPeriod,
  periodOf,
  completeSignup,
  expireSignup,
  reconcilePendingSignups,
  runMonthlyBilling,
  stopBilling,
};
