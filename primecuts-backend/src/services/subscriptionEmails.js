const nodemailer = require("nodemailer");
const { formatDateNl, shopNow } = require("../utils/shopTime");

// Customer emails for subscription billing: started, monthly receipt, payment failed, paused.
// Same inline-styled dark layout as the other emails (email clients don't load stylesheets).
const mailTransporter =
  process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD
    ? nodemailer.createTransport({
        service: "gmail",
        auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
      })
    : null;

const FRONTEND_URL = (process.env.FRONTEND_BASE_URL || "https://primecutsnl.com").replace(/\/$/, "");
const SHOP_PHONE_DISPLAY = "06 24469649";

const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
const formatEuro = (amount) => amount.toFixed(2).replace(".", ",");
const SCHEDULE_LABELS = { weekly: "elke week", biweekly: "om de week", monthly: "elke maand" };
const scheduleText = (subscription) => `${SCHEDULE_LABELS[subscription.frequency] || "vaste plek"} om ${subscription.time}`;
// "november 2026"
const monthName = (period) =>
  new Date(`${period}-01T12:00:00Z`).toLocaleDateString("nl-NL", { month: "long", year: "numeric", timeZone: "UTC" });
const cardText = (subscription) => (subscription.cardLast4 ? `je kaart eindigend op ${subscription.cardLast4}` : "je opgeslagen kaart");

const p = (html) => `<p style="margin:0 0 20px;color:#a3a3a3;font-size:15px;line-height:1.6;">${html}</p>`;
const visitListHtml = (visits) =>
  `<ul style="margin:0 0 20px;padding-left:20px;color:#ffffff;font-size:15px;line-height:1.8;">${visits
    .map((v) => `<li>${formatDateNl(v.date)} om ${v.time}</li>`)
    .join("")}</ul>`;
const button = (url, label) =>
  `<p style="margin:0 0 20px;"><a href="${url}" style="display:inline-block;background:#e5342a;color:#ffffff;font-weight:700;text-decoration:none;padding:14px 22px;border-radius:10px;text-transform:uppercase;font-size:14px;letter-spacing:0.5px;">${label}</a></p>`;

const layout = ({ eyebrow, title, body }) => `<!DOCTYPE html>
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
            <p style="margin:0 0 8px;color:#e5342a;font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;">${eyebrow}</p>
            <h1 style="margin:0 0 20px;color:#ffffff;font-size:26px;font-weight:800;letter-spacing:0.5px;text-transform:uppercase;">${title}</h1>
            ${body}
            <p style="margin:24px 0 0;color:#737373;font-size:13px;line-height:1.6;">Tot snel!<br>PrimeCuts Barbershop</p>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding-top:20px;color:#404040;font-size:11px;font-family:Arial,Helvetica,sans-serif;">PrimeCuts Barbershop</td>
        </tr>
      </table>
    </div>
  </body>
</html>`;

const visitListText = (visits) => visits.map((v) => `- ${formatDateNl(v.date)} om ${v.time}`).join("\n");

async function send(to, subject, text, html, label) {
  if (!mailTransporter) {
    console.error(`Email not configured (missing GMAIL_USER/GMAIL_APP_PASSWORD) — skipping ${label} email.`);
    return false;
  }
  try {
    await mailTransporter.sendMail({ from: `"PrimeCuts" <${process.env.GMAIL_USER}>`, to, subject, text, html });
    return true;
  } catch (error) {
    console.error(`Failed to send ${label} email to ${to}:`, error.message);
    return false;
  }
}

// Signup done: card saved, first (pro-rated) month paid.
function sendSubscriptionStartedEmail(subscription, { firstPeriod, nextChargeDate, visits }) {
  const name = escapeHtml(subscription.customerName);
  const html = layout({
    eyebrow: "Betaling ontvangen",
    title: "Abonnement Gestart",
    body: [
      p(`Hoi ${name}, je vaste plek bij PrimeCuts staat vast — ${scheduleText(subscription)}.`),
      p(`Je hebt <strong style="color:#fff;">&euro;${formatEuro(subscription.firstMonthAmount)}</strong> betaald voor ${monthName(firstPeriod)}. Je afspraken die maand:`),
      visitListHtml(visits),
      p(`Vanaf ${formatDateNl(nextChargeDate)} wordt elke 1e van de maand automatisch <strong style="color:#fff;">&euro;${formatEuro(subscription.price)}</strong> afgeschreven van ${cardText(subscription)}. In de winkel betaal je niets meer.`),
      p(`Wil je stoppen? Laat het ons weten via ${SHOP_PHONE_DISPLAY}, dan zeggen we je abonnement op en schrijven we niets meer af.`),
    ].join(""),
  });
  const text = `Hoi ${subscription.customerName},

Je vaste plek bij PrimeCuts staat vast — ${scheduleText(subscription)}.

Je hebt €${formatEuro(subscription.firstMonthAmount)} betaald voor ${monthName(firstPeriod)}. Je afspraken die maand:
${visitListText(visits)}

Vanaf ${formatDateNl(nextChargeDate)} wordt elke 1e van de maand automatisch €${formatEuro(subscription.price)} afgeschreven van ${cardText(subscription)}. In de winkel betaal je niets meer.

Wil je stoppen? Laat het ons weten via ${SHOP_PHONE_DISPLAY}, dan zeggen we je abonnement op en schrijven we niets meer af.

Tot snel!
PrimeCuts`;
  return send(subscription.customerEmail, "Je abonnement bij PrimeCuts is gestart", text, html, "subscription started");
}

// The automatic charge on the 1st went through.
function sendMonthlyReceiptEmail(subscription, charge, visits) {
  const name = escapeHtml(subscription.customerName);
  const html = layout({
    eyebrow: "Betaling ontvangen",
    title: `Abonnement ${monthName(charge.period)}`,
    body: [
      p(`Hoi ${name}, we hebben <strong style="color:#fff;">&euro;${formatEuro(charge.amount)}</strong> afgeschreven van ${cardText(subscription)} voor je abonnement in ${monthName(charge.period)}.`),
      visits.length ? p("Je afspraken deze maand:") + visitListHtml(visits) : "",
      p("Je krijgt de dag voor elke afspraak nog een herinnering."),
    ].join(""),
  });
  const text = `Hoi ${subscription.customerName},

We hebben €${formatEuro(charge.amount)} afgeschreven van ${cardText(subscription)} voor je abonnement in ${monthName(charge.period)}.
${visits.length ? `\nJe afspraken deze maand:\n${visitListText(visits)}\n` : ""}
Je krijgt de dag voor elke afspraak nog een herinnering.

Tot snel!
PrimeCuts`;
  return send(subscription.customerEmail, `Betaling ontvangen — abonnement ${monthName(charge.period)}`, text, html, "monthly receipt");
}

// The automatic charge failed — pay link, and the deadline before the seat is released.
function sendPaymentFailedEmail(subscription, charge, deadline) {
  const name = escapeHtml(subscription.customerName);
  // deadline is a moment in time — shown as the shop-local calendar day it falls on.
  const deadlineText = formatDateNl(shopNow(deadline).date);
  const html = layout({
    eyebrow: "Betaling mislukt",
    title: "Even Je Kaart Checken",
    body: [
      p(`Hoi ${name}, het lukte niet om &euro;${formatEuro(charge.amount)} af te schrijven van ${cardText(subscription)} voor je abonnement in ${monthName(charge.period)}.`),
      charge.payLinkUrl ? button(charge.payLinkUrl, `Betaal &euro;${formatEuro(charge.amount)}`) : "",
      p(`We proberen het de komende dagen nog automatisch. Is het op ${deadlineText} nog niet betaald, dan pauzeren we je abonnement en komt je vaste plek vrij.`),
      p(`Vragen? Bel of app ons via ${SHOP_PHONE_DISPLAY}.`),
    ].join(""),
  });
  const text = `Hoi ${subscription.customerName},

Het lukte niet om €${formatEuro(charge.amount)} af te schrijven van ${cardText(subscription)} voor je abonnement in ${monthName(charge.period)}.
${charge.payLinkUrl ? `\nBetaal hier: ${charge.payLinkUrl}\n` : ""}
We proberen het de komende dagen nog automatisch. Is het op ${deadlineText} nog niet betaald, dan pauzeren we je abonnement en komt je vaste plek vrij.

Vragen? Bel of app ons via ${SHOP_PHONE_DISPLAY}.

PrimeCuts`;
  return send(subscription.customerEmail, "Betaling voor je PrimeCuts abonnement is mislukt", text, html, "payment failed");
}

function sendSubscriptionPausedEmail(subscription, charge) {
  const name = escapeHtml(subscription.customerName);
  const html = layout({
    eyebrow: "Abonnement gepauzeerd",
    title: "Je Plek Is Vrijgegeven",
    body: [
      p(`Hoi ${name}, de betaling van &euro;${formatEuro(charge.amount)} voor ${monthName(charge.period)} is niet gelukt, dus we hebben je abonnement (${scheduleText(subscription)}) gepauzeerd. Er wordt niets meer afgeschreven en je vaste plek is vrijgegeven.`),
      p(`Wil je weer een vaste plek? Neem contact met ons op via ${SHOP_PHONE_DISPLAY} of meld je opnieuw aan op de website.`),
    ].join(""),
  });
  const text = `Hoi ${subscription.customerName},

De betaling van €${formatEuro(charge.amount)} voor ${monthName(charge.period)} is niet gelukt, dus we hebben je abonnement (${scheduleText(subscription)}) gepauzeerd. Er wordt niets meer afgeschreven en je vaste plek is vrijgegeven.

Wil je weer een vaste plek? Neem contact met ons op via ${SHOP_PHONE_DISPLAY} of meld je opnieuw aan op de website.

PrimeCuts`;
  return send(subscription.customerEmail, "Je PrimeCuts abonnement is gepauzeerd", text, html, "subscription paused");
}

module.exports = {
  sendSubscriptionStartedEmail,
  sendMonthlyReceiptEmail,
  sendPaymentFailedEmail,
  sendSubscriptionPausedEmail,
};
