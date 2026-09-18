const bcrypt = require("bcryptjs");
const Appointment = require("../models/Appointment");
const BlockedTime = require("../models/BlockedTime");
const Subscription = require("../models/Subscription");
const { sendCancellationEmail } = require("../services/cancellationEmail");
const { sendRescheduleEmail } = require("../services/rescheduleEmail");
const { scheduleBranchCancellation } = require("../services/branchReporter");
const { refundAppointment } = require("../services/refundService");
const { overlapsBlockedRange } = require("../utils/timeOverlap");

const login = async (req, res) => {
  try {
    const { email, password } = req.body || {};

    const validEmail =
      typeof email === "string" &&
      process.env.ADMIN_EMAIL &&
      email.trim().toLowerCase() === process.env.ADMIN_EMAIL.toLowerCase();

    // Always run bcrypt.compare, even when the email is already known to be wrong, so a bad
    // email doesn't return faster than a bad password (timing side-channel for username enumeration).
    const validPassword =
      typeof password === "string" &&
      process.env.ADMIN_PASSWORD_HASH &&
      (await bcrypt.compare(password, process.env.ADMIN_PASSWORD_HASH));

    if (!validEmail || !validPassword) {
      return res.status(401).json({ error: "Ongeldige inloggegevens." });
    }

    req.session.isAdmin = true;
    res.json({ success: true });
  } catch (error) {
    console.error("Admin login error:", error);
    res.status(500).json({ error: "Inloggen mislukt." });
  }
};

const logout = (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
};

const checkSession = (req, res) => {
  res.json({ authenticated: !!(req.session && req.session.isAdmin) });
};

// Confirmed + cancelled only — pending holds are just abandoned checkout attempts, not real bookings.
const listAppointments = async (req, res) => {
  try {
    const appointments = await Appointment.find({
      status: { $in: ["confirmed", "cancelled"] },
    }).sort({ date: 1, time: 1 });

    res.json({ success: true, data: appointments });
  } catch (error) {
    console.error("Admin list appointments error:", error);
    res.status(500).json({ error: "Kon afspraken niet laden." });
  }
};

const cancelAppointmentByAdmin = async (req, res) => {
  try {
    const appointment = await Appointment.findById(req.params.appointmentId);
    if (!appointment) {
      return res.status(404).json({ error: "Afspraak niet gevonden." });
    }
    if (appointment.status !== "confirmed") {
      return res.status(400).json({ error: "Alleen bevestigde afspraken kunnen worden geannuleerd." });
    }

    appointment.status = "cancelled";
    appointment.cancelledAt = new Date();
    await appointment.save();

    // Refund first (and awaited, not parallel) so the cancellation email can accurately say
    // whether the money is already back or still needs a manual refund.
    const refundResult = await refundAppointment(appointment);
    appointment.refundStatus = refundResult.status;
    appointment.refundedAt = new Date();
    if (refundResult.status === "refunded") {
      appointment.refundAmount = refundResult.amount;
    } else {
      appointment.refundError = refundResult.reason;
    }
    await appointment.save();

    await Promise.all([sendCancellationEmail(appointment), scheduleBranchCancellation(appointment)]);

    res.json({ success: true, refundStatus: refundResult.status });
  } catch (error) {
    console.error("Admin cancel appointment error:", error);
    res.status(500).json({ error: "Annuleren mislukt." });
  }
};

// Moves a confirmed booking to a different open slot without touching payment at all — no
// cancellation, no refund, no rebooking. Existed because the only prior way to "move" an
// appointment was cancel (triggering a refund) + have the customer book again + admin re-refunds
// manually if that new booking never happens.
//
// The actual guarantee against two active appointments ever sharing a slot is the unique index on
// (date, time) in the Appointment model — not a check-then-save race here. A reschedule
// deliberately gets priority over a slot held only by a "pending" (unpaid) checkout: that's just
// someone mid-checkout or an abandoned attempt, not a real booking, so this releases it and takes
// the slot instead of failing. It never bumps an already-"confirmed" (paid) appointment — that
// still comes back as a clean "already taken" error. In the vanishingly rare case a preempted
// pending hold's payment actually does land moments later, the webhook/redirect confirm flow's own
// independent collision check (resolveCheckoutStatus) catches that and reports it as a genuine
// payment-issue for a human, same as any other same-slot collision.
const rescheduleAppointmentByAdmin = async (req, res) => {
  try {
    const { date, time } = req.body || {};
    const isDate = typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date);
    const isTime = typeof time === "string" && /^\d{2}:\d{2}$/.test(time);
    if (!isDate || !isTime) {
      return res.status(400).json({ error: "Ongeldige datum of tijd." });
    }

    const appointment = await Appointment.findById(req.params.appointmentId);
    if (!appointment) {
      return res.status(404).json({ error: "Afspraak niet gevonden." });
    }
    if (appointment.status !== "confirmed") {
      return res.status(400).json({ error: "Alleen bevestigde afspraken kunnen worden verzet." });
    }
    if (date === appointment.date && time === appointment.time) {
      return res.status(400).json({ error: "Dit is al de huidige datum en tijd." });
    }

    const blockedRanges = await BlockedTime.find({ date }).select("startTime endTime -_id");
    if (overlapsBlockedRange(time, blockedRanges)) {
      return res.status(400).json({ error: "Dit tijdslot is geblokkeerd." });
    }

    const oldDate = appointment.date;
    const oldTime = appointment.time;

    const attemptMove = async () => {
      appointment.date = date;
      appointment.time = time;
      await appointment.save();
    };

    try {
      await attemptMove();
    } catch (saveError) {
      if (saveError.code !== 11000) throw saveError;

      const blocker = await Appointment.findOne({
        _id: { $ne: appointment._id },
        date,
        time,
        status: { $in: ["pending", "confirmed"] },
      });

      if (blocker && blocker.status === "confirmed") {
        return res.status(400).json({ error: "Dit tijdslot is al bezet." });
      }

      // A pending hold was in the way (or it cleared itself between the failed save and this
      // lookup) — preempt it and retry once. Bounded to a single retry: if this still collides,
      // something else genuinely confirmed into the slot in that same instant.
      if (blocker) {
        await Appointment.findByIdAndUpdate(blocker._id, {
          $set: { status: "expired", releasedReason: "admin_reschedule", releasedAt: new Date() },
        });
      }

      try {
        await attemptMove();
      } catch (retryError) {
        if (retryError.code === 11000) {
          return res.status(400).json({ error: "Dit tijdslot is al bezet." });
        }
        throw retryError;
      }
    }

    await sendRescheduleEmail(appointment, oldDate, oldTime);

    res.json({ success: true, data: appointment });
  } catch (error) {
    console.error("Admin reschedule appointment error:", error);
    res.status(500).json({ error: "Verzetten mislukt." });
  }
};

// Only ever shows today onward — a block for a day that's already passed has nothing left to guard.
const listBlockedTimes = async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const blockedTimes = await BlockedTime.find({ date: { $gte: today } }).sort({
      date: 1,
      startTime: 1,
    });
    res.json({ success: true, data: blockedTimes });
  } catch (error) {
    console.error("Admin list blocked times error:", error);
    res.status(500).json({ error: "Kon geblokkeerde tijden niet laden." });
  }
};

const createBlockedTime = async (req, res) => {
  try {
    const { date, startTime, endTime, reason } = req.body || {};

    const isDate = typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date);
    const isTime = (t) => typeof t === "string" && /^\d{2}:\d{2}$/.test(t);

    if (!isDate || !isTime(startTime) || !isTime(endTime)) {
      return res.status(400).json({ error: "Ongeldige datum of tijd." });
    }
    if (startTime >= endTime) {
      // The most common cause: the browser's time picker defaulted to AM instead of PM (e.g.
      // typing "7" for 19:00 saves as 07:00), so call that out instead of just "invalid".
      return res.status(400).json({
        error: `Eindtijd (${endTime}) ligt voor of gelijk aan starttijd (${startTime}). Controleer of je AM/PM goed hebt ingesteld.`,
      });
    }

    const blockedTime = await BlockedTime.create({
      date,
      startTime,
      endTime,
      reason: typeof reason === "string" && reason.trim() ? reason.trim().slice(0, 200) : undefined,
    });

    // Doesn't touch any existing booking in this window — just flags it so the admin can decide
    // (call the customer, cancel it manually) rather than silently cancelling a paid appointment.
    const conflictingAppointments = await Appointment.find({
      date,
      status: "confirmed",
    }).select("time customerName customerPhone -_id");
    const conflicts = conflictingAppointments.filter((appointment) =>
      overlapsBlockedRange(appointment.time, [{ startTime, endTime }]),
    );

    res.status(201).json({ success: true, data: blockedTime, conflicts });
  } catch (error) {
    console.error("Admin create blocked time error:", error);
    res.status(500).json({ error: "Blokkeren mislukt." });
  }
};

const deleteBlockedTime = async (req, res) => {
  try {
    const blockedTime = await BlockedTime.findByIdAndDelete(req.params.blockedTimeId);
    if (!blockedTime) {
      return res.status(404).json({ error: "Geblokkeerde tijd niet gevonden." });
    }
    res.json({ success: true });
  } catch (error) {
    console.error("Admin delete blocked time error:", error);
    res.status(500).json({ error: "Verwijderen mislukt." });
  }
};

// Pending ones are shown too (not just active) so the admin can see a signup still waiting on its
// first payment, not just ones that already went through.
const listSubscriptions = async (req, res) => {
  try {
    const subscriptions = await Subscription.find({ status: { $in: ["pending", "active"] } }).sort({
      dayOfMonth: 1,
      time: 1,
    });
    res.json({ success: true, data: subscriptions });
  } catch (error) {
    console.error("Admin list subscriptions error:", error);
    res.status(500).json({ error: "Kon abonnementen niet laden." });
  }
};

// Stops future renewals only — never retroactively touches appointments already generated for
// this membership (those get cancelled individually, same as any other appointment, if needed).
const cancelSubscriptionByAdmin = async (req, res) => {
  try {
    const subscription = await Subscription.findById(req.params.subscriptionId);
    if (!subscription) {
      return res.status(404).json({ error: "Abonnement niet gevonden." });
    }

    subscription.status = "cancelled";
    subscription.cancelledAt = new Date();
    await subscription.save();

    res.json({ success: true });
  } catch (error) {
    console.error("Admin cancel subscription error:", error);
    res.status(500).json({ error: "Opzeggen mislukt." });
  }
};

// "expired" appointments where the customer's payment actually went through (per resolveCheckoutStatus
// in appointmentController.js) but the slot had already been taken by someone else in the meantime —
// real money with nowhere to go, needs a human to refund or reschedule. This is exactly the class of
// problem that used to disappear without a trace (see Sept 7) — it can't anymore, but it still needs
// a person to see it, not just sit logged on Render.
const listPaymentIssues = async (req, res) => {
  try {
    const issues = await Appointment.find({
      status: "expired",
      releasedReason: "collision",
    }).sort({ releasedAt: -1 });
    res.json({ success: true, data: issues });
  } catch (error) {
    console.error("Admin list payment issues error:", error);
    res.status(500).json({ error: "Kon betalingsproblemen niet laden." });
  }
};

module.exports = {
  login,
  logout,
  checkSession,
  listAppointments,
  cancelAppointmentByAdmin,
  rescheduleAppointmentByAdmin,
  listBlockedTimes,
  createBlockedTime,
  deleteBlockedTime,
  listSubscriptions,
  cancelSubscriptionByAdmin,
  listPaymentIssues,
};
