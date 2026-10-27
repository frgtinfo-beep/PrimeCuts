const nodemailer = require("nodemailer");
const Appointment = require("../models/Appointment");
const { shopNow, addDays, formatDateNl } = require("../utils/shopTime");

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

const FRONTEND_URL = (process.env.FRONTEND_BASE_URL || "https://primecutsnl.com").replace(/\/$/, "");

// Same details as the site footer / structured data in frontend/index.html.
const SHOP_ADDRESS = "Ketelmeerstraat 136, Lelystad";
const SHOP_PHONE_DISPLAY = "06 24469649";
const SHOP_PHONE_LINK = "+31624469649";

// Reminders only go out during the day before — never at 00:05 at night. A booking for tomorrow
// made after the window closes simply doesn't get one (its confirmation email just went out anyway).
const SEND_FROM_HOUR = 10;
const SEND_UNTIL_HOUR = 21;
// A booking confirmed this recently already has its confirmation email fresh in the inbox — a
// "see you tomorrow" on top of that a few minutes later is just noise.
const SKIP_IF_BOOKED_WITHIN_MS = 3 * 60 * 60 * 1000;
// A failed send is retried on later sweeps, up to this many times, then left alone (and logged).
const MAX_ATTEMPTS = 3;

// customerName is filled in by whoever booked — escape before interpolating into the HTML email so
// a name like "<img src=x onerror=...>" can't run in whatever renders it.
const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
const formatEuro = (amount) => amount.toFixed(2).replace(".", ",");

// What's still owed in store: the service price minus what was already paid online. totalPrice
// includes the (online-only) checkout fee, so that's taken out too. For a subscription visit after
// the first one, nothing was paid online, so this is the full plan price.
const dueInStore = (appointment) =>
  Math.max(0, appointment.totalPrice - (appointment.depositAmount || 0) - (appointment.checkoutFee || 0));

const buildDetailRow = (label, value, isLast) => `
  <tr>
    <td style="padding:14px 16px;color:#737373;font-size:13px;font-family:Arial,Helvetica,sans-serif;${isLast ? "" : "border-bottom:1px solid #1f1f1f;"}">${label}</td>
    <td style="padding:14px 16px;color:#ffffff;font-size:14px;font-weight:600;font-family:Arial,Helvetica,sans-serif;text-align:right;${isLast ? "" : "border-bottom:1px solid #1f1f1f;"}">${value}</td>
  </tr>`;

const buildReminderEmailHtml = (appointment) => {
  const isSubscription = Boolean(appointment.subscriptionId);
  const due = dueInStore(appointment);
  const rows = [
    ["Wanneer", `Morgen, ${formatDateNl(appointment.date)}`],
    ["Tijd", appointment.time],
    ["Behandeling", escapeHtml(appointment.service)],
    ...(appointment.addons && appointment.addons.length > 0 ? [["Extra's", escapeHtml(appointment.addons.join(", "))]] : []),
    ["Te betalen in de winkel", due ? `&euro;${formatEuro(due)}` : isSubscription ? "Niets — betaald via je abonnement" : "Niets — al betaald"],
    ["Adres", SHOP_ADDRESS],
  ];
  const detailRows = rows.map(([label, value], i) => buildDetailRow(label, value, i === rows.length - 1)).join("");

  return `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background:#050505;">
    <div style="background:#050505;padding:32px 16px;font-family:Arial,Helvetica,sans-serif;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;margin:0 auto;">
        <tr>
          <td align="center" style="padding-bottom:24px;">
            <img src="${FRONTEND_URL}/image/PrimeCuts.png" alt="PrimeCuts" height="36" style="display:block;border:0;">
          </td>
        </tr>
        <tr>
          <td style="background:#111111;border-radius:16px;border:1px solid #262626;padding:32px 24px;">
            <p style="margin:0 0 8px;color:#e5342a;font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;">Herinnering</p>
            <h1 style="margin:0 0 20px;color:#ffffff;font-size:26px;font-weight:800;letter-spacing:0.5px;text-transform:uppercase;">Tot Morgen!</h1>
            <p style="margin:0 0 24px;color:#a3a3a3;font-size:15px;line-height:1.6;">Hoi ${escapeHtml(appointment.customerName)}, ${
              isSubscription ? "morgen staat je vaste plek bij PrimeCuts weer klaar." : "morgen heb je een afspraak bij PrimeCuts."
            }</p>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0A0A0A;border-radius:12px;border:1px solid #262626;">
              ${detailRows}
            </table>
            <p style="margin:24px 0 0;color:#a3a3a3;font-size:14px;line-height:1.6;">Kun je toch niet? Laat het ons zo snel mogelijk weten via <a href="tel:${SHOP_PHONE_LINK}" style="color:#ffffff;font-weight:600;">${SHOP_PHONE_DISPLAY}</a>, dan geven we je plek aan iemand anders.</p>
            <p style="margin:24px 0 0;color:#737373;font-size:13px;line-height:1.6;">Tot morgen!<br>PrimeCuts Barbershop</p>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding-top:20px;color:#404040;font-size:11px;font-family:Arial,Helvetica,sans-serif;">PrimeCuts Barbershop &middot; ${SHOP_ADDRESS}</td>
        </tr>
      </table>
    </div>
  </body>
</html>`;
};

// Returns whether the email actually went out, so the sweep knows to retry if it didn't.
const sendReminderEmail = async (appointment) => {
  const isSubscription = Boolean(appointment.subscriptionId);
  const due = dueInStore(appointment);
  const addonsText =
    appointment.addons && appointment.addons.length > 0 ? `\nExtra's: ${appointment.addons.join(", ")}` : "";

  try {
    await mailTransporter.sendMail({
      from: `"PrimeCuts" <${process.env.GMAIL_USER}>`,
      to: appointment.customerEmail,
      subject: `Herinnering: morgen om ${appointment.time} bij PrimeCuts`,
      text: `Hoi ${appointment.customerName},

${isSubscription ? "Morgen staat je vaste plek bij PrimeCuts weer klaar." : "Morgen heb je een afspraak bij PrimeCuts."}

Wanneer: morgen, ${formatDateNl(appointment.date)}
Tijd: ${appointment.time}
Behandeling: ${appointment.service}${addonsText}
Te betalen in de winkel: ${due ? `€${formatEuro(due)}` : isSubscription ? "niets — betaald via je abonnement" : "niets — al betaald"}
Adres: ${SHOP_ADDRESS}

Kun je toch niet? Laat het ons zo snel mogelijk weten via ${SHOP_PHONE_DISPLAY}, dan geven we je plek aan iemand anders.

Tot morgen!
PrimeCuts`,
      html: buildReminderEmailHtml(appointment),
    });
    return true;
  } catch (error) {
    console.error(`Failed to send reminder email for appointment ${appointment._id}:`, error.message);
    return false;
  }
};

let warnedNotConfigured = false;

// Runs periodically (see server.js). Sends one reminder for every confirmed appointment tomorrow —
// regular bookings and subscription visits alike. Each appointment is claimed atomically before
// sending (reminderSentAt), so overlapping sweeps or a restart mid-sweep can never send it twice;
// a failed send releases the claim so a later sweep retries it.
async function sendAppointmentReminders({ now = new Date() } = {}) {
  if (!mailTransporter) {
    if (!warnedNotConfigured) {
      console.error("Email not configured (missing GMAIL_USER/GMAIL_APP_PASSWORD) — skipping appointment reminders.");
      warnedNotConfigured = true;
    }
    return;
  }

  const shop = shopNow(now);
  if (shop.hour < SEND_FROM_HOUR || shop.hour >= SEND_UNTIL_HOUR) return;
  const tomorrow = addDays(shop.date, 1);

  const due = await Appointment.find({
    date: tomorrow,
    status: "confirmed",
    reminderSentAt: { $exists: false },
    reminderAttempts: { $not: { $gte: MAX_ATTEMPTS } },
  });

  for (const appointment of due) {
    // Booked (or generated) only just now — the confirmation email covers it.
    if (now.getTime() - appointment._id.getTimestamp().getTime() < SKIP_IF_BOOKED_WITHIN_MS) continue;

    const claimed = await Appointment.findOneAndUpdate(
      { _id: appointment._id, status: "confirmed", reminderSentAt: { $exists: false } },
      { $set: { reminderSentAt: now }, $inc: { reminderAttempts: 1 } },
      { new: true },
    );
    if (!claimed) continue;

    const sent = await sendReminderEmail(claimed);
    if (!sent) {
      await Appointment.updateOne({ _id: claimed._id }, { $unset: { reminderSentAt: "" } });
      if (claimed.reminderAttempts >= MAX_ATTEMPTS) {
        console.error(`Giving up on reminder email for appointment ${claimed._id} after ${MAX_ATTEMPTS} attempts.`);
      }
      continue;
    }
    console.log(`Reminder sent for appointment ${claimed._id} (${claimed.date} ${claimed.time}).`);
  }
}

module.exports = { sendAppointmentReminders, sendReminderEmail };
