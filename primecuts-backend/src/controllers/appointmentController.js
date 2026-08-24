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
  return `${getBaseUrl(req)}/appointment.html?payment=success&appointmentId=${appointmentId}`;
};

const getPaymentReturnUrl = (req) => {
  return `${getBaseUrl(req)}/api/appointments/webhook`;
};

// Pull confirmed bookings for frontend UI
const getAppointments = async (req, res) => {
  try {
    const { date } = req.query;
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

// Step 2: called by the payment provider once payment goes through
const handlePaymentWebhook = async (req, res) => {
  try {
    const body = req.body || {};
    const appointmentId =
      body.checkout_reference || body.appointmentId || body.checkoutReference;
    const checkoutId = body.checkout_id || body.checkoutId || body.id;
    const reportedStatus = String(body.status || "").toUpperCase();

    if (!appointmentId && !checkoutId) {
      return res.status(400).json({ error: "Missing checkout reference." });
    }

    let checkoutStatus = reportedStatus;
    if (checkoutId) {
      try {
        const checkout = await sumupClient.checkouts.get(checkoutId);
        checkoutStatus = String(
          checkout.status || checkoutStatus,
        ).toUpperCase();
      } catch (lookupError) {
        console.error("Unable to verify SumUp checkout:", lookupError.message);
        if (!checkoutStatus) {
          return res
            .status(500)
            .json({ error: "Unable to verify SumUp checkout status." });
        }
      }
    }

    const appointmentQuery = [];
    if (appointmentId) {
      appointmentQuery.push({ _id: appointmentId });
      appointmentQuery.push({ sumupCheckoutReference: appointmentId });
    }
    if (checkoutId) {
      appointmentQuery.push({ sumupCheckoutId: checkoutId });
    }

    const appointment = await Appointment.findOne({ $or: appointmentQuery });
    if (!appointment) {
      return res
        .status(200)
        .json({
          success: true,
          message: "Appointment hold expired or not found.",
        });
    }

    if (checkoutStatus && checkoutStatus !== "PAID") {
      await Appointment.findByIdAndDelete(appointment._id);
      return res
        .status(200)
        .json({
          success: true,
          message: `Checkout finished with status ${checkoutStatus}.`,
        });
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
      return res
        .status(409)
        .json({
          error: "Slot was taken by someone else before payment completed.",
        });
    }

    // Clear expiration timer and lock it in as confirmed
    appointment.status = "confirmed";
    appointment.sumupCheckoutId = checkoutId || appointment.sumupCheckoutId;
    appointment.sumupCheckoutReference =
      appointmentId || appointment.sumupCheckoutReference;
    appointment.expiresAt = undefined;
    await appointment.save();

    res
      .status(200)
      .json({
        success: true,
        message: "Payment verified and appointment confirmed!",
      });
  } catch (error) {
    console.error("Webhook Error:", error);
    res.status(500).json({ error: "Webhook processing failed" });
  }
};

// Step 3: for when a payment is cancelled or fails.
// PAYMENT DEV: uncomment this, add cancelAppointment to module.exports below, and turn on the
// '/cancel' route in appointmentRoutes.js. Call it from the frontend as soon as the payment
// provider's cancel/fail redirect fires, so the slot frees up right away instead of the
// customer's browser having to wait for the 10-min auto-delete.
/*
const cancelAppointment = async (req, res) => {
    try {
        const { appointmentId } = req.body;

        const appointment = await Appointment.findById(appointmentId);
        if (!appointment) {
            // Already auto-deleted or never existed, nothing to do
            return res.status(200).json({ success: true, message: 'Nothing to cancel.' });
        }

        // Don't delete a booking that's already been paid for, just in case
        if (appointment.status === 'confirmed') {
            return res.status(400).json({ error: 'This appointment is already confirmed and cannot be cancelled.' });
        }

        await Appointment.findByIdAndDelete(appointmentId);

        res.status(200).json({ success: true, message: 'Booking cancelled, slot released.' });
    } catch (error) {
        console.error("Cancel Error:", error);
        res.status(500).json({ error: 'Cancel processing failed' });
    }
};
*/

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
};
