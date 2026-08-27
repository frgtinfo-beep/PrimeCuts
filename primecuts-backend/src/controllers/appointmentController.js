const { isValidObjectId } = require("mongoose");
const nodemailer = require("nodemailer");
const Appointment = require("../models/Appointment");
const ical = require("ical-generator").default;
const { default: SumUp } = require("@sumup/sdk");

// Real prices, kept here so we don't trust whatever price the browser sends us.
// Keep this in sync with the data-price values in frontend/appointment.html.
const SERVICE_PRICES = {
  Knipbeurt: 25,
  "Knipbeurt Kinderen": 20,
  Contour: 10,
  Baard: 10,
};

const ADDON_PRICES = {
  "Baard Trimmen": 5,
};

const sumupClient = new SumUp({
  apiKey: process.env.SUMUP_API_KEY || "",
});

const mailTransporter =
  process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD
    ? nodemailer.createTransport({
        service: "gmail",
        auth: {
          user: process.env.GMAIL_USER,
          pass: process.env.GMAIL_APP_PASSWORD,
        },
      })
    : null;

// Failing to send this shouldn't fail the booking itself — the payment is already confirmed either way.
const sendConfirmationEmail = async (appointment) => {
  if (!mailTransporter) {
    console.error("Email not configured (missing GMAIL_USER/GMAIL_APP_PASSWORD) — skipping confirmation email.");
    return;
  }

  const addonsText =
    appointment.addons && appointment.addons.length > 0
      ? `\nExtra's: ${appointment.addons.join(", ")}`
      : "";

  try {
    await mailTransporter.sendMail({
      from: `"PrimeCuts" <${process.env.GMAIL_USER}>`,
      to: appointment.customerEmail,
      subject: "Je afspraak bij PrimeCuts is bevestigd",
      text: `Hoi ${appointment.customerName},

Je afspraak is bevestigd:

Behandeling: ${appointment.service}${addonsText}
Datum: ${appointment.date}
Tijd: ${appointment.time}
Totaal: €${appointment.totalPrice}

Tot dan!
PrimeCuts`,
    });
  } catch (error) {
    console.error("Failed to send confirmation email:", error.message);
  }
};

const getBaseUrl = (req) => {
  if (process.env.SUMUP_PUBLIC_BASE_URL) {
    return process.env.SUMUP_PUBLIC_BASE_URL.replace(/\/$/, "");
  }

  const forwardedProto = req.headers["x-forwarded-proto"];
  const protocol = Array.isArray(forwardedProto)
    ? forwardedProto[0]
    : forwardedProto || req.protocol;

  return `${protocol}://${req.get("host")}`;
};

const getPaymentRedirectUrl = (req, appointmentId) => {
  // The customer needs to land back on the frontend site, not this backend service — they're
  // deployed as separate Render services on different domains. Falls back to this backend's own
  // origin only if FRONTEND_BASE_URL isn't set, so local single-server testing still works.
  const frontendBaseUrl = process.env.FRONTEND_BASE_URL
    ? process.env.FRONTEND_BASE_URL.replace(/\/$/, "")
    : getBaseUrl(req);
  return `${frontendBaseUrl}/appointment.html?payment=success&appointmentId=${appointmentId}`;
};

const getPaymentReturnUrl = (req) => {
  return `${getBaseUrl(req)}/api/appointments/webhook`;
};

// Pull confirmed bookings for frontend UI
const getAppointments = async (req, res) => {
  try {
    const { date } = req.query;
    // Express parses bracket notation (e.g. ?date[$ne]=x) into an object, which Mongo would then
    // read as a query operator instead of a literal value — reject anything that isn't a plain string.
    if (date !== undefined && typeof date !== "string") {
      return res.status(400).json({ success: false, error: "Invalid date." });
    }

    const query = { status: { $in: ["pending", "confirmed"] } };
    if (date) query.date = date;

    // Anyone can call this to check open times, so only send back the time, never customer info
    const appointments = await Appointment.find(query).select("date time -_id");
    res.status(200).json({ success: true, data: appointments });
  } catch (error) {
    res.status(500).json({ success: false, error: "Server Error" });
  }
};

const getAppointmentById = async (req, res) => {
  try {
    const appointment = await Appointment.findById(
      req.params.appointmentId,
    ).select(
      "date time service addons totalPrice status sumupCheckoutId sumupCheckoutReference",
    );

    if (!appointment) {
      return res
        .status(404)
        .json({ success: false, error: "Appointment not found." });
    }

    res.status(200).json({ success: true, data: appointment });
  } catch (error) {
    res.status(500).json({ success: false, error: "Server Error" });
  }
};

// Step 1: create the booking as 'pending' until payment confirms it
const createAppointment = async (req, res) => {
  let createdAppointment = null;

  try {
    const {
      customerName,
      customerEmail,
      customerPhone,
      service,
      addons,
      date,
      time,
    } = req.body;

    // date/time feed straight into a Mongo query below — reject anything that isn't a plain string
    // so a crafted object (e.g. { "$ne": null }) can't be read as a query operator.
    if (typeof date !== "string" || typeof time !== "string") {
      return res.status(400).json({ error: "Invalid date or time." });
    }

    // Work out the price ourselves instead of trusting the price sent from the browser
    const servicePrice = SERVICE_PRICES[service];
    if (servicePrice === undefined) {
      return res.status(400).json({ error: "Unknown service." });
    }

    const addonsList = Array.isArray(addons) ? addons : [];
    let addonsTotal = 0;
    for (const addon of addonsList) {
      const addonPrice = ADDON_PRICES[addon];
      if (addonPrice === undefined) {
        return res.status(400).json({ error: `Unknown add-on: ${addon}` });
      }
      addonsTotal += addonPrice;
    }

    const totalPrice = servicePrice + addonsTotal;

    // Hold the slot while payment is pending so another customer cannot reserve it.
    const existing = await Appointment.findOne({
      date,
      time,
      status: { $in: ["pending", "confirmed"] },
    });

    if (existing) {
      return res
        .status(400)
        .json({ error: "This time slot is already taken." });
    }

    createdAppointment = await Appointment.create({
      customerName,
      customerEmail,
      customerPhone,
      service,
      addons,
      date,
      time,
      totalPrice,
      status: "pending",
      paymentProvider: "sumup",
    });

    if (!process.env.SUMUP_API_KEY || !process.env.SUMUP_MERCHANT_CODE) {
      await Appointment.findByIdAndDelete(createdAppointment._id);
      return res
        .status(500)
        .json({ error: "Payment configuration is missing." });
    }

    const checkoutReference = createdAppointment._id.toString();
    const checkout = await sumupClient.checkouts.create({
      checkout_reference: checkoutReference,
      amount: totalPrice,
      currency: "EUR",
      merchant_code: process.env.SUMUP_MERCHANT_CODE,
      description: `PrimeCuts afspraak ${service} op ${date} om ${time}`,
      return_url: getPaymentReturnUrl(req),
      redirect_url: getPaymentRedirectUrl(req, checkoutReference),
      hosted_checkout: { enabled: true },
      valid_until: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    });

    await Appointment.findByIdAndUpdate(createdAppointment._id, {
      sumupCheckoutId: checkout.id || null,
      sumupCheckoutReference: checkout.checkout_reference || checkoutReference,
    });

    const paymentUrl = checkout.hosted_checkout_url || checkout.redirect_url;
    if (!paymentUrl) {
      throw new Error("SumUp did not return a hosted checkout URL.");
    }

    res.status(201).json({
      success: true,
      appointmentId: createdAppointment._id,
      checkoutId: checkout.id,
      paymentUrl,
      message: "Payment checkout created.",
    });
  } catch (error) {
    console.error("Booking Error:", error);
    if (createdAppointment) {
      await Appointment.findByIdAndDelete(createdAppointment._id).catch(
        () => {},
      );
    }
    res.status(500).json({ error: "Server error while creating appointment" });
  }
};

// SumUp doesn't sign its webhook payload, so the body can't be trusted for the actual payment
// decision — it's only used to look up which appointment this is about. The real status always
// comes from a fresh GET against SumUp's API using the checkout id WE stored when we created the
// checkout (never one supplied by the caller), so a forged webhook/cancel call can't confirm or
// tamper with a booking. Shared by the webhook and the frontend's return-from-checkout flow, since
// SumUp only offers a single redirect_url for both outcomes and may deliver the webhook late.
const resolveCheckoutStatus = async (appointment) => {
  if (appointment.status === "confirmed") {
    return { status: "confirmed" };
  }

  if (!appointment.sumupCheckoutId) {
    return { status: "error", error: "Appointment has no checkout on record." };
  }

  let checkoutStatus;
  try {
    const checkout = await sumupClient.checkouts.get(appointment.sumupCheckoutId);
    checkoutStatus = String(checkout.status || "").toUpperCase();
  } catch (lookupError) {
    console.error("Unable to verify SumUp checkout:", lookupError.message);
    return { status: "error", error: "Unable to verify SumUp checkout status." };
  }

  if (checkoutStatus !== "PAID") {
    // PENDING just means SumUp hasn't decided yet (e.g. still on 3DS) — leave the hold in place
    // and only release it once SumUp reports a terminal failure so we don't race a late success.
    if (checkoutStatus === "FAILED" || checkoutStatus === "EXPIRED") {
      await Appointment.findByIdAndDelete(appointment._id);
      return { status: "released", checkoutStatus };
    }
    return { status: "pending", checkoutStatus };
  }

  // Double check race conditions just in case
  const collision = await Appointment.findOne({
    date: appointment.date,
    time: appointment.time,
    status: "confirmed",
    _id: { $ne: appointment._id },
  });

  if (collision) {
    await Appointment.findByIdAndDelete(appointment._id);
    return { status: "collision" };
  }

  // Clear expiration timer and lock it in as confirmed
  appointment.status = "confirmed";
  appointment.expiresAt = undefined;
  await appointment.save();

  await sendConfirmationEmail(appointment);

  return { status: "confirmed" };
};

const findAppointmentForCheckoutNotification = async (body) => {
  const rawAppointmentId =
    body.checkout_reference || body.appointmentId || body.checkoutReference;
  const rawCheckoutId = body.checkout_id || body.checkoutId || body.id;

  // These go straight into a Mongo filter below, so only ever accept plain strings — an object
  // like { "$ne": null } would otherwise be read as a query operator and match arbitrary documents.
  const appointmentId = typeof rawAppointmentId === "string" ? rawAppointmentId : null;
  const checkoutId = typeof rawCheckoutId === "string" ? rawCheckoutId : null;

  if (!appointmentId && !checkoutId) {
    return null;
  }

  const appointmentQuery = [];
  if (appointmentId) {
    if (isValidObjectId(appointmentId)) {
      appointmentQuery.push({ _id: appointmentId });
    }
    appointmentQuery.push({ sumupCheckoutReference: appointmentId });
  }
  if (checkoutId) {
    appointmentQuery.push({ sumupCheckoutId: checkoutId });
  }

  if (appointmentQuery.length === 0) {
    return null;
  }

  return Appointment.findOne({ $or: appointmentQuery });
};

// Step 2: called by the payment provider once payment goes through
const handlePaymentWebhook = async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.checkout_reference && !body.appointmentId && !body.checkoutReference && !body.checkout_id && !body.checkoutId && !body.id) {
      return res.status(400).json({ error: "Missing checkout reference." });
    }

    const appointment = await findAppointmentForCheckoutNotification(body);
    if (!appointment) {
      return res.status(200).json({
        success: true,
        message: "Appointment hold expired or not found.",
      });
    }

    const result = await resolveCheckoutStatus(appointment);
    if (result.status === "error") {
      return res.status(502).json({ error: result.error });
    }

    res.status(200).json({ success: true, message: `Checkout resolved: ${result.status}` });
  } catch (error) {
    console.error("Webhook Error:", error);
    res.status(500).json({ error: "Webhook processing failed" });
  }
};

// Step 3: called by the frontend as soon as the browser returns from SumUp's checkout, so the slot
// frees up right away on a failed/expired payment instead of waiting out the 10-min auto-delete.
const cancelAppointment = async (req, res) => {
  try {
    const { appointmentId } = req.body;
    if (typeof appointmentId !== "string" || !isValidObjectId(appointmentId)) {
      return res.status(400).json({ error: "Missing or invalid appointmentId." });
    }

    const appointment = await Appointment.findById(appointmentId);
    if (!appointment) {
      // Already auto-deleted or never existed, nothing to do
      return res.status(200).json({ success: true, status: "released" });
    }

    const result = await resolveCheckoutStatus(appointment);
    if (result.status === "error") {
      return res.status(502).json({ error: result.error });
    }

    res.status(200).json({ success: true, status: result.status });
  } catch (error) {
    console.error("Cancel Error:", error);
    res.status(500).json({ error: "Cancel processing failed" });
  }
};

// Generates the live WebCal feed for the barber's Apple Calendar (confirmed only)
const getCalendarFeed = async (req, res) => {
  try {
    const appointments = await Appointment.find({ status: "confirmed" });
    const calendar = ical({
      name: "Primecuts Bookings",
      timezone: "Europe/Amsterdam",
    });

    appointments.forEach((app) => {
      const startTime = new Date(`${app.date}T${app.time}:00`);
      const endTime = new Date(startTime.getTime() + 30 * 60000);
      const addOnsText =
        app.addons && app.addons.length > 0 ? app.addons.join(", ") : "None";

      calendar.createEvent({
        start: startTime,
        end: endTime,
        summary: `${app.service} - ${app.customerName}`,
        description: `Customer: ${app.customerName}\nPhone: ${app.customerPhone}\nEmail: ${app.customerEmail}\nAdd-ons: ${addOnsText}\nTotal Price: €${app.totalPrice}`,
        location: "Primecuts Barbershop",
      });
    });

    res.set("Content-Type", "text/calendar; charset=utf-8");
    res.send(calendar.toString());
  } catch (error) {
    res.status(500).send("Error generating calendar feed");
  }
};

module.exports = {
  createAppointment,
  getAppointments,
  getAppointmentById,
  getCalendarFeed,
  handlePaymentWebhook,
  cancelAppointment,
};
