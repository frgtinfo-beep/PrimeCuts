const nodemailer = require("nodemailer");

const FRONTEND_URL = (process.env.FRONTEND_BASE_URL || "https://primecuts.onrender.com").replace(/\/$/, "");

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

const formatEuro = (amount) => amount.toFixed(2).replace(".", ",");
// Reflects what actually happened with the refund (see refundService.js), not just an assumption
// that it will happen — refundStatus/refundAmount are set on the appointment before this is called.
const depositLine = (appointment, euroSymbol) => {
  if (appointment.refundStatus === "refunded") {
    return `Je aanbetaling van ${euroSymbol}${formatEuro(appointment.refundAmount)} is teruggestort naar je betaalmethode. `;
  }
  if (typeof appointment.depositAmount === "number") {
    return `Je aanbetaling van ${euroSymbol}${formatEuro(appointment.depositAmount)} wordt zo snel mogelijk handmatig door ons teruggestort. `;
  }
  return "Je betaling wordt zo snel mogelijk handmatig door ons teruggestort. ";
};

const buildCancellationEmailHtml = (appointment) => `<!DOCTYPE html>
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
            <p style="margin:0 0 8px;color:#e5342a;font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;">Afspraak geannuleerd</p>
            <h1 style="margin:0 0 20px;color:#ffffff;font-size:26px;font-weight:800;letter-spacing:0.5px;text-transform:uppercase;">Afspraak Geannuleerd</h1>
            <p style="margin:0 0 24px;color:#a3a3a3;font-size:15px;line-height:1.6;">Hoi ${appointment.customerName}, je afspraak bij PrimeCuts op ${appointment.date} om ${appointment.time} is helaas geannuleerd.</p>
            <p style="margin:0 0 24px;color:#a3a3a3;font-size:15px;line-height:1.6;">${depositLine(appointment, "&euro;")}Neem gerust contact met ons op als je vragen hebt of een nieuwe afspraak wilt maken.</p>
            <p style="margin:24px 0 0;color:#737373;font-size:13px;line-height:1.6;">Met vriendelijke groet,<br>PrimeCuts Barbershop</p>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding-top:20px;color:#404040;font-size:11px;font-family:Arial,Helvetica,sans-serif;">PrimeCuts Barbershop</td>
        </tr>
      </table>
    </div>
  </body>
</html>`;

// Failing to send this shouldn't fail the cancellation itself — the slot must still free up either way.
const sendCancellationEmail = async (appointment) => {
  if (!mailTransporter) {
    console.error("Email not configured (missing GMAIL_USER/GMAIL_APP_PASSWORD) — skipping cancellation email.");
    return;
  }

  try {
    await mailTransporter.sendMail({
      from: `"PrimeCuts" <${process.env.GMAIL_USER}>`,
      to: appointment.customerEmail,
      subject: "Je afspraak bij PrimeCuts is geannuleerd",
      text: `Hoi ${appointment.customerName},

Je afspraak bij PrimeCuts op ${appointment.date} om ${appointment.time} is helaas geannuleerd.

${depositLine(appointment, "€")}Neem gerust contact met ons op als je vragen hebt of een nieuwe afspraak wilt maken.

Met vriendelijke groet,
PrimeCuts`,
      html: buildCancellationEmailHtml(appointment),
    });
  } catch (error) {
    console.error("Failed to send cancellation email:", error.message);
  }
};

module.exports = { sendCancellationEmail };
