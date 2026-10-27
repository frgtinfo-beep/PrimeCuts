const { default: SumUp } = require("@sumup/sdk");
const { extractSuccessfulTransaction } = require("./branchReporter");

// Saved-card ("recurring") payments for subscriptions. The SDK (0.1.x) covers customers, checkouts
// and saved cards, but has no call for *processing* a checkout with a saved card — that one goes
// straight to SumUp's REST API (PUT /v0.1/checkouts/{id}).
const sumupClient = new SumUp({ apiKey: process.env.SUMUP_API_KEY || "" });
const SUMUP_API_BASE = (process.env.SUMUP_API_BASE_URL || "https://api.sumup.com").replace(/\/$/, "");

const isConfigured = () => Boolean(process.env.SUMUP_API_KEY && process.env.SUMUP_MERCHANT_CODE);

const splitName = (fullName) => {
  const parts = String(fullName).trim().split(/\s+/);
  return { first_name: parts[0], last_name: parts.slice(1).join(" ") || undefined };
};

async function createCustomer(subscription) {
  const customerId = `primecuts-sub-${subscription._id}`;
  await sumupClient.customers.create({
    customer_id: customerId,
    personal_details: {
      ...splitName(subscription.customerName),
      email: subscription.customerEmail,
      phone: subscription.customerPhone,
    },
  });
  return customerId;
}

// The signup checkout. Its only job is to have the customer enter their card (with 3D Secure) and
// agree to future charges; SumUp checks the card with a small amount and refunds it immediately.
// The actual first-month charge happens right after, on the saved card (see chargeSavedCard).
async function createCardSetupCheckout({ subscriptionId, customerId, amount, validMinutes }) {
  return sumupClient.checkouts.create({
    checkout_reference: `sub-setup-${subscriptionId}`,
    amount,
    currency: "EUR",
    merchant_code: process.env.SUMUP_MERCHANT_CODE,
    description: "PrimeCuts abonnement — kaart opslaan voor maandelijkse betaling",
    customer_id: customerId,
    purpose: "SETUP_RECURRING_PAYMENT",
    valid_until: new Date(Date.now() + validMinutes * 60 * 1000).toISOString(),
  });
}

// Reads the outcome of the signup checkout: whether the card was accepted, and the saved card.
async function readCardSetup(checkoutId, customerId) {
  const checkout = await sumupClient.checkouts.get(checkoutId);
  const status = String(checkout.status || "").toUpperCase();
  const validUntil = checkout.valid_until ? new Date(checkout.valid_until).getTime() : null;
  const terminalFailure = status === "FAILED" || status === "EXPIRED" || (status !== "PAID" && validUntil !== null && Date.now() > validUntil);
  if (status !== "PAID") return { ok: false, terminalFailure };

  let token = checkout.payment_instrument?.token || null;
  let last4 = null;
  // The token is also listed on the customer — the fallback if it isn't on the checkout itself,
  // and the only place the card's last 4 digits are.
  const instruments = await sumupClient.customers.listPaymentInstruments(customerId).catch(() => []);
  const match = instruments.find((i) => i.active !== false && (!token || i.token === token)) || null;
  if (match) {
    token = token || match.token;
    last4 = match.card?.last_4_digits || null;
  }
  if (!token) return { ok: false, terminalFailure: true, error: "Kaart is niet opgeslagen." };
  return { ok: true, token, last4 };
}

// Checks a checkout we created earlier — used before any retry, so a charge that actually went
// through (e.g. right before a crash) is recognised instead of being charged again.
async function readCheckout(checkoutId) {
  const checkout = await sumupClient.checkouts.get(checkoutId);
  const status = String(checkout.status || "").toUpperCase();
  return { status, paid: status === "PAID", transactionId: extractSuccessfulTransaction(checkout)?.id || null };
}

// Charges a saved card: creates a fresh checkout for this charge, then processes it with the token.
// onCheckoutCreated runs before processing, so the caller can record the checkout id first.
// Returns { paid, checkoutId, transactionId, error }. Never throws for a declined card.
async function chargeSavedCard({ reference, amount, description, customerId, token, onCheckoutCreated }) {
  const checkout = await sumupClient.checkouts.create({
    checkout_reference: reference,
    amount,
    currency: "EUR",
    merchant_code: process.env.SUMUP_MERCHANT_CODE,
    description,
    customer_id: customerId,
  });
  if (onCheckoutCreated) await onCheckoutCreated(checkout.id);

  let processError = null;
  try {
    const response = await fetch(`${SUMUP_API_BASE}/v0.1/checkouts/${encodeURIComponent(checkout.id)}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${process.env.SUMUP_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ payment_type: "card", token, customer_id: customerId }),
    });
    const body = await response.json().catch(() => ({}));
    if (response.status === 202 || body.next_step) {
      // The bank wants the cardholder to approve (3D Secure) — impossible without them present.
      // Treated as a failed automatic charge: the customer gets the pay link instead.
      processError = "De bank vraagt om extra bevestiging van de kaarthouder.";
    } else if (!response.ok) {
      processError = body.message || body.error_message || `SumUp gaf foutcode ${response.status}.`;
    }
  } catch (error) {
    processError = `SumUp niet bereikbaar: ${error.message}`;
  }

  // Always confirm against the checkout itself — a processing call that "succeeded" doesn't by
  // itself mean the money moved, and one that errored (e.g. a timeout) might still have gone through.
  const result = await readCheckout(checkout.id).catch(() => ({ paid: false }));
  if (result.paid) return { paid: true, checkoutId: checkout.id, transactionId: result.transactionId };
  return { paid: false, checkoutId: checkout.id, error: processError || `Betaling niet gelukt (status ${result.status || "onbekend"}).` };
}

// A normal hosted checkout the customer can pay themselves — emailed after an automatic charge failed.
async function createPayLink({ reference, amount, description, customerId, redirectUrl, validUntil }) {
  const checkout = await sumupClient.checkouts.create({
    checkout_reference: reference,
    amount,
    currency: "EUR",
    merchant_code: process.env.SUMUP_MERCHANT_CODE,
    description,
    customer_id: customerId,
    redirect_url: redirectUrl,
    hosted_checkout: { enabled: true },
    valid_until: validUntil.toISOString(),
  });
  return { checkoutId: checkout.id, url: checkout.hosted_checkout_url || checkout.redirect_url };
}

async function deactivateCheckout(checkoutId) {
  await sumupClient.checkouts.deactivate(checkoutId).catch(() => {});
}

// Removes the saved card at SumUp so it can never be charged again (cancel/pause/failed signup).
async function removeSavedCard(customerId, token) {
  if (!customerId || !token) return;
  await sumupClient.customers.deactivatePaymentInstrument(customerId, token).catch((error) => {
    console.error(`Could not remove saved card for SumUp customer ${customerId}:`, error.message);
  });
}

module.exports = {
  isConfigured,
  createCustomer,
  createCardSetupCheckout,
  readCardSetup,
  readCheckout,
  chargeSavedCard,
  createPayLink,
  deactivateCheckout,
  removeSavedCard,
};
