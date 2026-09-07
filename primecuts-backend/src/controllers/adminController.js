const bcrypt = require("bcryptjs");
const Appointment = require("../models/Appointment");
const { sendCancellationEmail } = require("../services/cancellationEmail");
const { scheduleBranchCancellation } = require("../services/branchReporter");
const { refundAppointment } = require("../services/refundService");

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

module.exports = {
  login,
  logout,
  checkSession,
  listAppointments,
  cancelAppointmentByAdmin,
};
