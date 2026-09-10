const bcrypt = require("bcryptjs");
const Appointment = require("../models/Appointment");
const BlockedTime = require("../models/BlockedTime");
const { sendCancellationEmail } = require("../services/cancellationEmail");
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

module.exports = {
  login,
  logout,
  checkSession,
  listAppointments,
  cancelAppointmentByAdmin,
  listBlockedTimes,
  createBlockedTime,
  deleteBlockedTime,
};
