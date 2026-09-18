const nodemailer = require("nodemailer");

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

const FRONTEND_URL = (process.env.FRONTEND_BASE_URL || "https://primecutsnl.nl").replace(/\/$/, "");

// customerName is filled in by whoever booked — escape before interpolating into the HTML email so
// a name like "<img src=x onerror=...>" can't run in whatever renders it.
const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);

const buildRescheduleEmailHtml = (appointment, oldDate, oldTime) => `<!DOCTYPE html>
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
            <p style="margin:0 0 8px;color:#e5342a;font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;">Afspraak verzet</p>
            <h1 style="margin:0 0 20px;color:#ffffff;font-size:26px;font-weight:800;letter-spacing:0.5px;text-transform:uppercase;">Nieuwe Datum &amp; Tijd</h1>
            <p style="margin:0 0 24px;color:#a3a3a3;font-size:15px;line-height:1.6;">Hoi ${escapeHtml(appointment.customerName)}, je afspraak bij PrimeCuts is verzet van ${oldDate} om ${oldTime} naar:</p>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0A0A0A;border-radius:12px;border:1px solid #262626;margin-bottom:24px;">
              <tr>
                <td style="padding:14px 16px;color:#737373;font-size:13px;font-family:Arial,Helvetica,sans-serif;border-bottom:1px solid #1f1f1f;">Datum</td>
                <td style="padding:14px 16px;color:#ffffff;font-size:14px;font-weight:600;font-family:Arial,Helvetica,sans-serif;text-align:right;border-bottom:1px solid #1f1f1f;">${appointment.date}</td>
              </tr>
              <tr>
                <td style="padding:14px 16px;color:#737373;font-size:13px;font-family:Arial,Helvetica,sans-serif;">Tijd</td>
                <td style="padding:14px 16px;color:#ffffff;font-size:14px;font-weight:600;font-family:Arial,Helvetica,sans-serif;text-align:right;">${appointment.time}</td>
              </tr>
            </table>
            <p style="margin:0 0 24px;color:#a3a3a3;font-size:15px;line-height:1.6;">Je betaling en aanbetaling blijven ongewijzigd — je hoeft niets opnieuw te doen. Neem contact met ons op als dit nieuwe moment niet uitkomt.</p>
            <p style="margin:24px 0 0;color:#737373;font-size:13px;line-height:1.6;">Tot dan!<br>PrimeCuts Barbershop</p>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding-top:20px;color:#404040;font-size:11px;font-family:Arial,Helvetica,sans-serif;">PrimeCuts Barbershop</td>
        </tr>
      </table>
    </div>
  </body>
</html>`;

// Failing to send this shouldn't fail the reschedule itself — the appointment's new slot is already saved either way.
const sendRescheduleEmail = async (appointment, oldDate, oldTime) => {
  if (!mailTransporter) {
    console.error("Email not configured (missing GMAIL_USER/GMAIL_APP_PASSWORD) — skipping reschedule email.");
    return;
  }

  try {
    await mailTransporter.sendMail({
      from: `"PrimeCuts" <${process.env.GMAIL_USER}>`,
      to: appointment.customerEmail,
      subject: "Je afspraak bij PrimeCuts is verzet",
      text: `Hoi ${appointment.customerName},

Je afspraak bij PrimeCuts is verzet van ${oldDate} om ${oldTime} naar ${appointment.date} om ${appointment.time}.

Je betaling en aanbetaling blijven ongewijzigd — je hoeft niets opnieuw te doen. Neem contact met ons op als dit nieuwe moment niet uitkomt.

Tot dan!
PrimeCuts`,
      html: buildRescheduleEmailHtml(appointment, oldDate, oldTime),
    });
  } catch (error) {
    console.error("Failed to send reschedule email:", error.message);
  }
};

module.exports = { sendRescheduleEmail };
