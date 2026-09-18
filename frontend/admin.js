const API_BASE_URL = "";
const AUTO_REFRESH_MS = 15 * 60 * 1000; // 15 minutes

const loadingState = document.getElementById("loadingState");
const emptyState = document.getElementById("emptyState");
const appointmentList = document.getElementById("appointmentList");
const lastUpdated = document.getElementById("lastUpdated");
const refreshBtn = document.getElementById("refreshBtn");
const logoutBtn = document.getElementById("logoutBtn");
const searchInput = document.getElementById("searchInput");
const searchWrap = document.getElementById("searchWrap");
const tabButtons = document.querySelectorAll(".tab-btn");
const appointmentsView = document.getElementById("appointmentsView");
const availabilityView = document.getElementById("availabilityView");
const subscriptionsView = document.getElementById("subscriptionsView");
const subscriptionsList = document.getElementById("subscriptionsList");
const subscriptionsEmptyState = document.getElementById("subscriptionsEmptyState");

const blockForm = document.getElementById("blockForm");
const blockDate = document.getElementById("blockDate");
const blockStart = document.getElementById("blockStart");
const blockEnd = document.getElementById("blockEnd");
const blockStartConfirm = document.getElementById("blockStartConfirm");
const blockEndConfirm = document.getElementById("blockEndConfirm");
const blockReason = document.getElementById("blockReason");
const blockError = document.getElementById("blockError");
const blockSubmitBtn = document.getElementById("blockSubmitBtn");
const blockedTimesList = document.getElementById("blockedTimesList");
const blockedEmptyState = document.getElementById("blockedEmptyState");

const refundReminder = document.getElementById("refundReminder");
const refundReminderList = document.getElementById("refundReminderList");
const refundReminderCount = document.getElementById("refundReminderCount");

const paymentIssuesReminder = document.getElementById("paymentIssuesReminder");
const paymentIssuesList = document.getElementById("paymentIssuesList");
const paymentIssuesCount = document.getElementById("paymentIssuesCount");

const renewalIssuesReminder = document.getElementById("renewalIssuesReminder");
const renewalIssuesList = document.getElementById("renewalIssuesList");
const renewalIssuesCount = document.getElementById("renewalIssuesCount");

const cancelModal = document.getElementById("cancelModal");
const cancelModalText = document.getElementById("cancelModalText");
const cancelModalClose = document.getElementById("cancelModalClose");
const cancelModalConfirm = document.getElementById("cancelModalConfirm");
const toast = document.getElementById("toast");

const rescheduleModal = document.getElementById("rescheduleModal");
const rescheduleModalText = document.getElementById("rescheduleModalText");
const rescheduleModalClose = document.getElementById("rescheduleModalClose");
const rescheduleCalendarMonth = document.getElementById("rescheduleCalendarMonth");
const rescheduleDateContainer = document.getElementById("rescheduleDateContainer");
const rescheduleTimeContainer = document.getElementById("rescheduleTimeContainer");
const rescheduleError = document.getElementById("rescheduleError");
const rescheduleSubmitBtn = document.getElementById("rescheduleSubmitBtn");

let toastTimeout = null;
function showToast(message, variant) {
  toast.textContent = message;
  toast.className =
    "fixed top-6 left-1/2 -translate-x-1/2 z-[60] max-w-md w-[92%] px-5 py-4 rounded-xl text-sm font-semibold shadow-2xl border " +
    (variant === "error"
      ? "bg-red-950 border-red-800 text-red-200"
      : variant === "warn"
        ? "bg-yellow-950 border-yellow-800 text-yellow-200"
        : "bg-green-950 border-green-800 text-green-200");
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.add("hidden"), 6000);
}

let allAppointments = [];
let allBlockedTimes = [];
let allSubscriptions = [];
let allPaymentIssues = [];
let activeTab = "active"; // "active" | "past" | "availability" | "subscriptions"
let pendingCancelId = null;

function formatEuro(amount) {
  return Number(amount).toFixed(2).replace(".", ",");
}

// Matches APPOINTMENT_DURATION_MINUTES in frontend/appointment.js / primecuts-backend/src/utils/timeOverlap.js
// — used below to build the reschedule picker's slot grid, same as the public booking page.
const APPOINTMENT_DURATION_MINUTES = 35;

function timeToMinutes(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function overlapsBlockedRange(time, blockedRanges) {
  const start = timeToMinutes(time);
  const end = start + APPOINTMENT_DURATION_MINUTES;
  return blockedRanges.some((range) => {
    const blockStart = timeToMinutes(range.startTime);
    const blockEnd = timeToMinutes(range.endTime);
    return start < blockEnd && end > blockStart;
  });
}

// Every appointment/subscription field rendered below (customerName, customerEmail, customerPhone)
// is filled in by anyone who books through the public site — it must never go into innerHTML
// unescaped, or a booking like `customerName: "<img src=x onerror=...>"` runs arbitrary JS in this
// authenticated admin session (session-cookie theft, calling any /api/admin/* endpoint as the admin).
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[ch]);
}

// Appointment's own local date/time string, parsed as a local Date for comparison against "now".
function appointmentDateTime(appointment) {
  return new Date(`${appointment.date}T${appointment.time}:00`);
}

function isPast(appointment) {
  return appointmentDateTime(appointment) < new Date();
}

function statusBadge(appointment) {
  if (appointment.status === "cancelled") {
    return `<span class="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-neutral-800 text-neutral-400 text-xs font-semibold uppercase tracking-wide">
      <i class="fa-solid fa-ban"></i> Geannuleerd
    </span>`;
  }

  if (isPast(appointment)) {
    return `<span class="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-green-500/15 text-green-400 text-xs font-semibold uppercase tracking-wide">
      <i class="fa-solid fa-check"></i> Voltooid
    </span>`;
  }

  return `<div class="flex items-center gap-2">
    <button type="button" data-reschedule-id="${appointment._id}"
        class="reschedule-btn inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-neutral-700 text-neutral-300 hover:border-accent/50 hover:text-accent transition text-xs font-semibold uppercase tracking-wide">
      <i class="fa-solid fa-calendar-days"></i> Verzetten
    </button>
    <button type="button" data-cancel-id="${appointment._id}"
        class="cancel-btn inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-red-900 text-red-400 hover:bg-red-900/20 transition text-xs font-semibold uppercase tracking-wide">
      <i class="fa-solid fa-xmark"></i> Annuleren
    </button>
  </div>`;
}

function appointmentCard(appointment) {
  const addonsText = appointment.addons && appointment.addons.length > 0 ? ` + ${appointment.addons.join(", ")}` : "";
  // Bookings made before the deposit split existed have no depositAmount on record.
  const hasDeposit = typeof appointment.depositAmount === "number";
  const depositText = hasDeposit ? `€${formatEuro(appointment.depositAmount)}` : "—";
  // totalPrice includes checkoutFee (already paid online) — exclude it so this is only the
  // service-price portion still owed in store, not a double-count of the fee.
  const remainingText = hasDeposit
    ? `€${formatEuro(appointment.totalPrice - appointment.depositAmount - (appointment.checkoutFee || 0))}`
    : "—";
  const cancelledStyle = appointment.status === "cancelled" ? "opacity-50" : "";

  return `
    <div class="bg-cardbg border border-neutral-800 rounded-2xl p-6 ${cancelledStyle}">
      <div class="flex flex-wrap justify-between items-start gap-4">
        <div>
          <div class="flex items-center gap-3 mb-1">
            <i class="fa-solid fa-calendar text-accent"></i>
            <span class="font-bebas text-xl tracking-wide">${appointment.date} — ${appointment.time}</span>
          </div>
          <p class="text-neutral-400 text-sm">${appointment.service}${addonsText}${appointment.subscriptionId ? ' <i class="fa-solid fa-repeat text-accent" title="Abonnement"></i>' : ""}</p>
        </div>
        ${statusBadge(appointment)}
      </div>

      <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6 pt-6 border-t border-neutral-800">
        <div>
          <p class="text-[10px] uppercase tracking-widest text-neutral-500 mb-1 font-mono">Klant</p>
          <p class="text-sm font-semibold">${escapeHtml(appointment.customerName)}</p>
        </div>
        <div>
          <p class="text-[10px] uppercase tracking-widest text-neutral-500 mb-1 font-mono">Contact</p>
          <p class="text-sm">${escapeHtml(appointment.customerPhone)}</p>
          <p class="text-sm text-neutral-400">${escapeHtml(appointment.customerEmail)}</p>
        </div>
        <div>
          <p class="text-[10px] uppercase tracking-widest text-neutral-500 mb-1 font-mono">Totaal</p>
          <p class="text-sm font-semibold">€${formatEuro(appointment.totalPrice)}</p>
        </div>
        <div>
          <p class="text-[10px] uppercase tracking-widest text-neutral-500 mb-1 font-mono">Aanbetaald / In winkel</p>
          <p class="text-sm font-semibold">${depositText} / ${remainingText}</p>
        </div>
      </div>
    </div>`;
}

// Same amount SumUp was asked to refund (see refundableAmount in refundService.js) — the deposit,
// or the full price for older bookings made before the deposit split existed.
function refundableAmountFor(appointment) {
  return typeof appointment.depositAmount === "number" ? appointment.depositAmount : appointment.totalPrice;
}

const REFUND_CHECK_HIDE_MS = 12 * 60 * 60 * 1000; // how long a checked item stays visible before dropping off

function refundReminderStorageKey(appointmentId) {
  return `refundCheckedAt:${appointmentId}`;
}

// null = not checked. Otherwise the timestamp (ms) it was checked at.
function getRefundCheckedAt(appointmentId) {
  try {
    const raw = localStorage.getItem(refundReminderStorageKey(appointmentId));
    return raw ? Number(raw) : null;
  } catch {
    return null;
  }
}

function setRefundChecked(appointmentId, checked) {
  try {
    if (checked) {
      localStorage.setItem(refundReminderStorageKey(appointmentId), String(Date.now()));
    } else {
      localStorage.removeItem(refundReminderStorageKey(appointmentId));
    }
  } catch {
    // Private browsing / storage disabled — reminder still works, it just won't remember checks.
  }
}

// Manual-refund todo list: every cancelled booking where the automatic SumUp refund failed.
// Ticking it off doesn't resolve anything server-side — it just keeps the row visible (as done)
// for a 12h grace period, then drops it from the list. If the refund wasn't actually handled,
// the appointment's refundStatus is still "failed" and there's nothing un-hiding it after that —
// this is a daily nudge, not a record of completion.
function renderRefundReminder() {
  const now = Date.now();
  const pending = allAppointments
    .filter((a) => a.refundStatus === "failed")
    .map((a) => ({ appointment: a, checkedAt: getRefundCheckedAt(a._id) }))
    .filter(({ checkedAt }) => checkedAt === null || now - checkedAt < REFUND_CHECK_HIDE_MS)
    .sort((a, b) => new Date(b.appointment.refundedAt || 0) - new Date(a.appointment.refundedAt || 0));

  if (pending.length === 0) {
    refundReminder.classList.add("hidden");
    return;
  }

  refundReminder.classList.remove("hidden");
  const uncheckedCount = pending.filter(({ checkedAt }) => checkedAt === null).length;
  refundReminderCount.textContent = uncheckedCount > 0 ? `${uncheckedCount} open` : "Alles gecheckt";

  refundReminderList.innerHTML = pending
    .map(({ appointment: a, checkedAt }) => {
      const checked = checkedAt !== null;
      return `
        <label class="flex items-start gap-3 text-sm cursor-pointer">
          <input type="checkbox" data-refund-check-id="${a._id}" ${checked ? "checked" : ""}
            class="mt-1 accent-accent w-4 h-4 rounded shrink-0">
          <span class="${checked ? "opacity-40" : ""}">
            <span class="block font-semibold ${checked ? "line-through" : ""}">${escapeHtml(a.customerName)}</span>
            <span class="block text-neutral-500 text-xs">${a.date} — €${formatEuro(refundableAmountFor(a))}</span>
          </span>
        </label>`;
    })
    .join("");

  refundReminderList.querySelectorAll("[data-refund-check-id]").forEach((input) => {
    input.addEventListener("change", () => {
      setRefundChecked(input.getAttribute("data-refund-check-id"), input.checked);
      renderRefundReminder();
    });
  });
}

// Periodic re-render so a row actually drops off 12h after being checked even if the admin
// tab is just left open (no appointment data changes to otherwise trigger a re-render).
function scheduleRefundReminderRefresh() {
  setInterval(renderRefundReminder, 5 * 60 * 1000);
}

// Unlike the refund reminder, there's no "check it off" dismissal here — a payment-issue row is
// real money sitting against a slot that's no longer held, and it should stay visible until the
// underlying appointment is actually dealt with (refunded or rebooked), not just acknowledged.
function paymentIssueCard(appointment) {
  const paidAmount = (appointment.depositAmount || 0) + (appointment.checkoutFee || 0);
  const releasedDate = appointment.releasedAt
    ? new Date(appointment.releasedAt).toLocaleString("nl-NL", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
    : "";
  return `
    <div class="text-sm border-b border-yellow-900/30 pb-3 last:border-0 last:pb-0">
      <span class="block font-semibold">${escapeHtml(appointment.customerName)}</span>
      <span class="block text-neutral-500 text-xs">${appointment.date} — ${appointment.time} &middot; ${escapeHtml(appointment.service)}</span>
      <span class="block text-neutral-500 text-xs">${escapeHtml(appointment.customerPhone)} &middot; ${escapeHtml(appointment.customerEmail)}</span>
      <span class="block text-yellow-400 text-xs mt-1">Betaald: €${formatEuro(paidAmount)}${releasedDate ? ` &middot; ${releasedDate}` : ""}</span>
    </div>`;
}

function renderPaymentIssues() {
  if (allPaymentIssues.length === 0) {
    paymentIssuesReminder.classList.add("hidden");
    return;
  }

  paymentIssuesReminder.classList.remove("hidden");
  paymentIssuesCount.textContent = `${allPaymentIssues.length} open`;
  paymentIssuesList.innerHTML = allPaymentIssues.map(paymentIssueCard).join("");
}

// Sourced from allSubscriptions (already fetched by fetchSubscriptions) rather than a separate
// endpoint — the renewal sweep persists renewalIssue directly onto the Subscription document, and
// listSubscriptions already returns full documents, so this is just filtering data already in hand.
function renewalIssueCard(subscription) {
  const reasonText = subscription.renewalIssue === "slot_taken" ? "tijdslot is al bezet" : "tijdslot is geblokkeerd";
  const issueDate = subscription.renewalIssueAt
    ? new Date(subscription.renewalIssueAt).toLocaleString("nl-NL", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
    : "";
  return `
    <div class="text-sm border-b border-orange-900/30 pb-3 last:border-0 last:pb-0">
      <span class="block font-semibold">${escapeHtml(subscription.customerName)}</span>
      <span class="block text-neutral-500 text-xs">${subscription.renewalIssueDate} — ${subscription.time} &middot; ${reasonText}</span>
      <span class="block text-neutral-500 text-xs">${escapeHtml(subscription.customerPhone)} &middot; ${escapeHtml(subscription.customerEmail)}</span>
      ${issueDate ? `<span class="block text-orange-400 text-xs mt-1">Sinds ${issueDate}</span>` : ""}
    </div>`;
}

function renderRenewalIssues() {
  const issues = allSubscriptions.filter((s) => s.renewalIssue);

  if (issues.length === 0) {
    renewalIssuesReminder.classList.add("hidden");
    return;
  }

  renewalIssuesReminder.classList.remove("hidden");
  renewalIssuesCount.textContent = `${issues.length} open`;
  renewalIssuesList.innerHTML = issues.map(renewalIssueCard).join("");
}

async function fetchPaymentIssues() {
  try {
    const response = await fetch(`${API_BASE_URL}/api/admin/payment-issues`);
    if (response.status === 401) {
      window.location.href = "admin-login.html";
      return;
    }
    const data = await response.json();
    if (!response.ok || !data.success) {
      throw new Error(data.error || "Kon betalingsproblemen niet laden.");
    }
    allPaymentIssues = data.data;
    renderPaymentIssues();
  } catch (error) {
    showToast(error.message, "error");
  }
}

function updateTabStyles() {
  tabButtons.forEach((btn) => {
    const isActiveTab = btn.getAttribute("data-tab") === activeTab;
    btn.classList.toggle("bg-gradient-to-b", isActiveTab);
    btn.classList.toggle("from-accent-light", isActiveTab);
    btn.classList.toggle("via-accent", isActiveTab);
    btn.classList.toggle("to-accent-dark", isActiveTab);
    btn.classList.toggle("text-white", isActiveTab);
    btn.classList.toggle("bg-cardbg", !isActiveTab);
    btn.classList.toggle("border", !isActiveTab);
    btn.classList.toggle("border-neutral-800", !isActiveTab);
    btn.classList.toggle("text-neutral-400", !isActiveTab);
  });
}

function currentlyVisibleAppointments() {
  const query = searchInput.value.trim().toLowerCase();

  return allAppointments
    .filter((a) => (activeTab === "active" ? !isPast(a) : isPast(a)))
    .filter((a) => !query || a.customerName.toLowerCase().includes(query))
    .sort((a, b) => {
      const diff = appointmentDateTime(a) - appointmentDateTime(b);
      return activeTab === "active" ? diff : -diff; // upcoming soonest-first, past most-recent-first
    });
}

function renderCurrentView() {
  updateTabStyles();

  const isAvailability = activeTab === "availability";
  const isSubscriptions = activeTab === "subscriptions";
  appointmentsView.classList.toggle("hidden", isAvailability || isSubscriptions);
  availabilityView.classList.toggle("hidden", !isAvailability);
  subscriptionsView.classList.toggle("hidden", !isSubscriptions);
  searchWrap.classList.toggle("hidden", isAvailability || isSubscriptions);

  if (isAvailability) {
    renderBlockedTimes();
    return;
  }
  if (isSubscriptions) {
    renderSubscriptions();
    return;
  }

  const visible = currentlyVisibleAppointments();

  if (visible.length === 0) {
    appointmentList.innerHTML = "";
    emptyState.classList.remove("hidden");
    return;
  }

  emptyState.classList.add("hidden");
  appointmentList.innerHTML = visible.map(appointmentCard).join("");

  document.querySelectorAll(".cancel-btn").forEach((btn) => {
    btn.addEventListener("click", () => openCancelModal(btn.getAttribute("data-cancel-id")));
  });
  document.querySelectorAll(".reschedule-btn").forEach((btn) => {
    btn.addEventListener("click", () => openRescheduleModal(btn.getAttribute("data-reschedule-id")));
  });
}

function blockedTimeCard(blockedTime) {
  const reasonText = blockedTime.reason ? ` — ${escapeHtml(blockedTime.reason)}` : "";
  return `
    <div class="bg-cardbg border border-neutral-800 rounded-2xl p-5 flex flex-wrap justify-between items-center gap-4">
      <div>
        <span class="font-bebas text-lg tracking-wide">${blockedTime.date}</span>
        <span class="text-neutral-400 text-sm ml-2">${blockedTime.startTime} - ${blockedTime.endTime}${reasonText}</span>
      </div>
      <button type="button" data-delete-block-id="${blockedTime._id}"
        class="delete-block-btn inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-red-900 text-red-400 hover:bg-red-900/20 transition text-xs font-semibold uppercase tracking-wide">
        <i class="fa-solid fa-trash"></i> Verwijderen
      </button>
    </div>`;
}

function renderBlockedTimes() {
  if (allBlockedTimes.length === 0) {
    blockedTimesList.innerHTML = "";
    blockedEmptyState.classList.remove("hidden");
    return;
  }

  blockedEmptyState.classList.add("hidden");
  blockedTimesList.innerHTML = allBlockedTimes.map(blockedTimeCard).join("");

  document.querySelectorAll(".delete-block-btn").forEach((btn) => {
    btn.addEventListener("click", () => deleteBlockedTime(btn.getAttribute("data-delete-block-id")));
  });
}

async function fetchBlockedTimes() {
  try {
    const response = await fetch(`${API_BASE_URL}/api/admin/blocked-times`);
    if (response.status === 401) {
      window.location.href = "admin-login.html";
      return;
    }
    const data = await response.json();
    if (!response.ok || !data.success) {
      throw new Error(data.error || "Kon geblokkeerde tijden niet laden.");
    }
    allBlockedTimes = data.data;
    if (activeTab === "availability") renderBlockedTimes();
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function deleteBlockedTime(blockedTimeId) {
  if (!confirm("Deze geblokkeerde tijd verwijderen?")) return;

  try {
    const response = await fetch(`${API_BASE_URL}/api/admin/blocked-times/${blockedTimeId}`, {
      method: "DELETE",
    });
    const data = await response.json();
    if (!response.ok || !data.success) {
      throw new Error(data.error || "Verwijderen mislukt.");
    }
    await fetchBlockedTimes();
  } catch (error) {
    showToast(error.message, "error");
  }
}

function subscriptionCard(subscription) {
  const statusText =
    subscription.status === "pending"
      ? `<span class="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-yellow-500/15 text-yellow-400 text-xs font-semibold uppercase tracking-wide">Wacht op betaling</span>`
      : `<span class="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-green-500/15 text-green-400 text-xs font-semibold uppercase tracking-wide">Actief</span>`;
  const cancelBtn = `<button type="button" data-cancel-subscription-id="${subscription._id}"
      class="cancel-subscription-btn inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-red-900 text-red-400 hover:bg-red-900/20 transition text-xs font-semibold uppercase tracking-wide">
    <i class="fa-solid fa-xmark"></i> Opzeggen
  </button>`;

  const scheduleText =
    subscription.frequency === "weekly"
      ? `Elke week — ${subscription.time}`
      : `Elke maand op de ${subscription.dayOfMonth}e — ${subscription.time}`;
  const planText = subscription.frequency === "weekly" ? "4x per maand" : "1x per maand";

  return `
    <div class="bg-cardbg border border-neutral-800 rounded-2xl p-6">
      <div class="flex flex-wrap justify-between items-start gap-4">
        <div>
          <div class="flex items-center gap-3 mb-1">
            <i class="fa-solid fa-repeat text-accent"></i>
            <span class="font-bebas text-xl tracking-wide">${scheduleText}</span>
          </div>
          <p class="text-neutral-400 text-sm">€${formatEuro(subscription.price)} / knipbeurt &middot; ${planText}</p>
        </div>
        <div class="flex items-center gap-3">
          ${statusText}
          ${cancelBtn}
        </div>
      </div>

      <div class="grid grid-cols-2 gap-4 mt-6 pt-6 border-t border-neutral-800">
        <div>
          <p class="text-[10px] uppercase tracking-widest text-neutral-500 mb-1 font-mono">Klant</p>
          <p class="text-sm font-semibold">${escapeHtml(subscription.customerName)}</p>
        </div>
        <div>
          <p class="text-[10px] uppercase tracking-widest text-neutral-500 mb-1 font-mono">Contact</p>
          <p class="text-sm">${escapeHtml(subscription.customerPhone)}</p>
          <p class="text-sm text-neutral-400">${escapeHtml(subscription.customerEmail)}</p>
        </div>
      </div>
    </div>`;
}

function renderSubscriptions() {
  if (allSubscriptions.length === 0) {
    subscriptionsList.innerHTML = "";
    subscriptionsEmptyState.classList.remove("hidden");
    return;
  }

  subscriptionsEmptyState.classList.add("hidden");
  subscriptionsList.innerHTML = allSubscriptions.map(subscriptionCard).join("");

  document.querySelectorAll(".cancel-subscription-btn").forEach((btn) => {
    btn.addEventListener("click", () => cancelSubscription(btn.getAttribute("data-cancel-subscription-id")));
  });
}

async function fetchSubscriptions() {
  try {
    const response = await fetch(`${API_BASE_URL}/api/admin/subscriptions`);
    if (response.status === 401) {
      window.location.href = "admin-login.html";
      return;
    }
    const data = await response.json();
    if (!response.ok || !data.success) {
      throw new Error(data.error || "Kon abonnementen niet laden.");
    }
    allSubscriptions = data.data;
    if (activeTab === "subscriptions") renderSubscriptions();
    renderRenewalIssues();
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function cancelSubscription(subscriptionId) {
  if (!confirm("Dit abonnement opzeggen? Toekomstige maanden worden niet meer aangemaakt.")) return;

  try {
    const response = await fetch(`${API_BASE_URL}/api/admin/subscriptions/${subscriptionId}/cancel`, {
      method: "POST",
    });
    const data = await response.json();
    if (!response.ok || !data.success) {
      throw new Error(data.error || "Opzeggen mislukt.");
    }
    await fetchSubscriptions();
    showToast("Abonnement opgezegd.", "success");
  } catch (error) {
    showToast(error.message, "error");
  }
}

// Native time inputs often show a 12-hour AM/PM picker depending on OS/browser locale, which makes
// it easy to select the wrong half of the day (e.g. typing "7" defaults to 07:00 AM, not 19:00).
// Echo back what was actually picked in unambiguous 24h + 12h form so that's obvious before submit.
function formatTimeConfirm(value) {
  if (!value) return "";
  const [h, m] = value.split(":").map(Number);
  const period = h < 12 ? "AM" : "PM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `= ${value} (${hour12}:${String(m).padStart(2, "0")} ${period})`;
}

blockStart.addEventListener("input", () => {
  blockStartConfirm.textContent = formatTimeConfirm(blockStart.value);
});
blockEnd.addEventListener("input", () => {
  blockEndConfirm.textContent = formatTimeConfirm(blockEnd.value);
});

blockForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  blockError.classList.add("hidden");

  if (blockStart.value >= blockEnd.value) {
    blockError.textContent = `Eindtijd (${blockEnd.value}) ligt voor of gelijk aan starttijd (${blockStart.value}). Controleer of je AM/PM goed hebt ingesteld.`;
    blockError.classList.remove("hidden");
    return;
  }

  blockSubmitBtn.disabled = true;
  blockSubmitBtn.textContent = "Bezig...";

  try {
    const response = await fetch(`${API_BASE_URL}/api/admin/blocked-times`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date: blockDate.value,
        startTime: blockStart.value,
        endTime: blockEnd.value,
        reason: blockReason.value,
      }),
    });
    const data = await response.json();

    if (!response.ok || !data.success) {
      throw new Error(data.error || "Blokkeren mislukt.");
    }

    blockForm.reset();
    await fetchBlockedTimes();

    if (data.conflicts && data.conflicts.length > 0) {
      const names = data.conflicts.map((a) => `${a.time} (${a.customerName})`).join(", ");
      showToast(`Geblokkeerd — let op: ${data.conflicts.length} bestaande afspraak(en) valt/vallen hierin: ${names}`, "warn");
    } else {
      showToast("Tijd geblokkeerd.", "success");
    }
  } catch (error) {
    blockError.textContent = error.message;
    blockError.classList.remove("hidden");
  } finally {
    blockSubmitBtn.disabled = false;
    blockSubmitBtn.textContent = "Blokkeren";
  }
});

async function fetchAppointments() {
  try {
    const response = await fetch(`${API_BASE_URL}/api/admin/appointments`);

    if (response.status === 401) {
      window.location.href = "admin-login.html";
      return;
    }

    const data = await response.json();
    if (!response.ok || !data.success) {
      throw new Error(data.error || "Kon afspraken niet laden.");
    }

    loadingState.classList.add("hidden");
    allAppointments = data.data;
    renderCurrentView();
    renderRefundReminder();
    lastUpdated.textContent = `Laatst bijgewerkt: ${new Date().toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })}`;
  } catch (error) {
    loadingState.textContent = error.message;
  }
}

function openCancelModal(appointmentId) {
  const appointment = allAppointments.find((a) => a._id === appointmentId);
  if (!appointment) return;

  pendingCancelId = appointmentId;
  cancelModalText.textContent = `Weet je zeker dat je de afspraak van ${appointment.customerName} op ${appointment.date} om ${appointment.time} wilt annuleren? De klant ontvangt hier automatisch een e-mail over.`;
  cancelModal.classList.remove("hidden");
}

function closeCancelModal() {
  cancelModal.classList.add("hidden");
  pendingCancelId = null;
}

cancelModalClose.addEventListener("click", closeCancelModal);

cancelModalConfirm.addEventListener("click", async () => {
  if (!pendingCancelId) return;

  cancelModalConfirm.disabled = true;
  cancelModalConfirm.textContent = "Bezig...";

  try {
    const response = await fetch(`${API_BASE_URL}/api/admin/appointments/${pendingCancelId}/cancel`, {
      method: "POST",
    });
    const data = await response.json();

    if (!response.ok || !data.success) {
      throw new Error(data.error || "Annuleren mislukt.");
    }

    closeCancelModal();
    await fetchAppointments();

    if (data.refundStatus === "refunded") {
      showToast("Afspraak geannuleerd en aanbetaling automatisch terugbetaald.", "success");
    } else if (data.refundStatus === "failed") {
      showToast("Afspraak geannuleerd, maar de terugbetaling is mislukt — betaal de klant handmatig terug via SumUp.", "error");
    } else {
      showToast("Afspraak geannuleerd. Er kon geen automatische terugbetaling worden gevonden — controleer dit handmatig.", "warn");
    }
  } catch (error) {
    cancelModalText.textContent = error.message;
  } finally {
    cancelModalConfirm.disabled = false;
    cancelModalConfirm.textContent = "Ja, Annuleren";
  }
});

let pendingRescheduleId = null;
let rescheduleState = { date: "", time: null };

function updateRescheduleSubmitState() {
  rescheduleSubmitBtn.disabled = !rescheduleState.date || !rescheduleState.time;
}

// Same 14-day, weekday-only window as the public booking page (frontend/appointment.js
// generateDates) — the admin should never be able to pick outside what a customer could ever see.
// Defaults to the appointment's own current date when that still falls in the window, so moving
// it to a different time the same day is a single click; otherwise falls back to the first open
// weekday, same as the public picker does.
function generateRescheduleDates(preferredDate) {
  rescheduleDateContainer.innerHTML = "";

  const today = new Date();
  const rangeEnd = new Date(today);
  rangeEnd.setDate(today.getDate() + 13);
  const startMonth = today.toLocaleDateString("nl-NL", { month: "long" });
  const endMonth = rangeEnd.toLocaleDateString("nl-NL", { month: "long" });
  const startYear = today.getFullYear();
  const endYear = rangeEnd.getFullYear();
  if (startMonth === endMonth && startYear === endYear) {
    rescheduleCalendarMonth.textContent = today.toLocaleDateString("nl-NL", { month: "long", year: "numeric" });
  } else if (startYear === endYear) {
    rescheduleCalendarMonth.textContent = `${startMonth} – ${endMonth} ${endYear}`;
  } else {
    rescheduleCalendarMonth.textContent = `${startMonth} ${startYear} – ${endMonth} ${endYear}`;
  }

  let dayOfWeek = today.getDay();
  let offset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  for (let i = 0; i < offset; i++) {
    rescheduleDateContainer.appendChild(document.createElement("div"));
  }

  const windowDates = [];
  for (let i = 0; i < 14; i++) {
    const dateObj = new Date(today);
    dateObj.setDate(today.getDate() + i);
    const day = dateObj.getDay();
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, "0");
    const d = String(dateObj.getDate()).padStart(2, "0");
    windowDates.push({ fullDate: `${y}-${m}-${d}`, day: dateObj.getDate(), isWeekend: day === 0 || day === 6 });
  }

  const defaultDate =
    preferredDate && windowDates.some((wd) => wd.fullDate === preferredDate && !wd.isWeekend)
      ? preferredDate
      : windowDates.find((wd) => !wd.isWeekend).fullDate;

  windowDates.forEach(({ fullDate, day, isWeekend }) => {
    const div = document.createElement("div");
    div.setAttribute("data-date", fullDate);
    div.setAttribute("data-weekend", isWeekend);

    if (isWeekend) {
      div.className = "reschedule-date-btn text-neutral-700 cursor-not-allowed flex items-center justify-center opacity-30 py-1.5";
      div.textContent = day;
    } else if (fullDate === defaultDate) {
      div.className = "reschedule-date-btn flex justify-center items-center reschedule-active-date cursor-pointer py-1.5";
      div.innerHTML = `<div class="w-7 h-7 rounded-full bg-gradient-to-b from-accent-light via-accent to-accent-dark text-white flex items-center justify-center font-bold text-xs">${day}</div>`;
    } else {
      div.className = "reschedule-date-btn cursor-pointer hover:text-accent flex items-center justify-center py-1.5";
      div.textContent = day;
    }
    rescheduleDateContainer.appendChild(div);
  });

  rescheduleState.date = defaultDate;
  attachRescheduleDateListeners();
}

function attachRescheduleDateListeners() {
  const dateBtns = rescheduleDateContainer.querySelectorAll(".reschedule-date-btn");
  dateBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.getAttribute("data-weekend") === "true") return;

      dateBtns.forEach((d) => {
        d.classList.remove("reschedule-active-date");
        const circle = d.querySelector("div");
        if (circle) {
          d.textContent = circle.textContent.trim();
          if (d.getAttribute("data-weekend") !== "true") d.classList.add("hover:text-accent", "cursor-pointer");
        }
      });

      const dateText = btn.textContent.trim();
      btn.innerHTML = `<div class="w-7 h-7 rounded-full bg-gradient-to-b from-accent-light via-accent to-accent-dark text-white flex items-center justify-center font-bold text-xs">${dateText}</div>`;
      btn.classList.add("reschedule-active-date");
      btn.classList.remove("hover:text-accent", "cursor-pointer");

      rescheduleState.date = btn.getAttribute("data-date");
      rescheduleState.time = null;
      updateRescheduleSubmitState();
      checkRescheduleAvailableTimes(rescheduleState.date);
    });
  });
}

function generateRescheduleTimeSlots() {
  rescheduleTimeContainer.innerHTML = "";
  let currentMin = 11 * 60;
  const endMin = 19 * 60;
  while (currentMin + APPOINTMENT_DURATION_MINUTES <= endMin) {
    const h = Math.floor(currentMin / 60).toString().padStart(2, "0");
    const m = (currentMin % 60).toString().padStart(2, "0");
    const timeStr = `${h}:${m}`;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className =
      "reschedule-time-btn py-2.5 rounded-lg border border-neutral-800 text-xs font-medium hover:border-accent/50 transition text-neutral-400 bg-cardbg";
    btn.setAttribute("data-time", timeStr);
    btn.textContent = timeStr;
    rescheduleTimeContainer.appendChild(btn);

    currentMin += APPOINTMENT_DURATION_MINUTES;
  }
  attachRescheduleTimeListeners();
}

function attachRescheduleTimeListeners() {
  rescheduleTimeContainer.querySelectorAll(".reschedule-time-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.disabled) return;

      rescheduleTimeContainer.querySelectorAll(".reschedule-time-btn").forEach((t) => {
        if (t.disabled) return;
        t.classList.remove("bg-gradient-to-b", "from-accent-light", "via-accent", "to-accent-dark", "text-white", "font-bold");
        t.classList.add("border", "border-neutral-800", "text-neutral-400", "bg-cardbg");
      });
      btn.classList.remove("border", "border-neutral-800", "text-neutral-400", "bg-cardbg");
      btn.classList.add("bg-gradient-to-b", "from-accent-light", "via-accent", "to-accent-dark", "text-white", "font-bold");

      rescheduleState.time = btn.getAttribute("data-time");
      updateRescheduleSubmitState();
    });
  });
}

// Same public endpoint the booking page itself uses for availability, so the admin sees exactly
// the same open/taken slots a customer would. The appointment being moved is excluded from
// "booked" for its own current date/time — two confirmed appointments can never share a
// date+time (the booking flow's own collision check guarantees that), so matching on date+time
// alone is equivalent to matching by id here.
async function checkRescheduleAvailableTimes(selectedDate) {
  const appointment = allAppointments.find((a) => a._id === pendingRescheduleId);

  const [y, m, d] = selectedDate.split("-").map(Number);
  const day = new Date(y, m - 1, d).getDay();
  if (day === 0 || day === 6) {
    rescheduleTimeContainer.innerHTML = `<div class="col-span-full text-center py-6 text-neutral-500 text-xs">Gesloten in het weekend.</div>`;
    return;
  }
  if (rescheduleTimeContainer.children.length === 0 || rescheduleTimeContainer.querySelector(".col-span-full")) {
    generateRescheduleTimeSlots();
  }

  const timeBtns = rescheduleTimeContainer.querySelectorAll(".reschedule-time-btn");
  timeBtns.forEach((btn) => {
    btn.disabled = false;
    btn.classList.remove("line-through", "text-neutral-700", "cursor-not-allowed", "opacity-50", "border-transparent", "bg-neutral-900");
    btn.classList.add("bg-cardbg");
    if (btn.getAttribute("data-time") !== rescheduleState.time) {
      btn.classList.add("border-neutral-800", "text-neutral-400");
    }
  });

  try {
    const response = await fetch(`${API_BASE_URL}/api/appointments?date=${selectedDate}`);
    const result = await response.json();
    if (!result.success) return;

    const bookedTimes = result.data
      .map((a) => a.time)
      .filter((t) => !(appointment && appointment.date === selectedDate && appointment.time === t));
    const blockedRanges = result.blockedRanges || [];

    timeBtns.forEach((btn) => {
      const btnTime = btn.getAttribute("data-time");
      if (bookedTimes.includes(btnTime) || overlapsBlockedRange(btnTime, blockedRanges)) {
        btn.disabled = true;
        btn.classList.remove(
          "hover:border-accent/50", "bg-gradient-to-b", "from-accent-light", "via-accent", "to-accent-dark",
          "text-white", "font-bold", "border-neutral-800", "text-neutral-400", "bg-cardbg",
        );
        btn.classList.add("line-through", "text-neutral-700", "cursor-not-allowed", "opacity-50", "border-transparent", "bg-neutral-900");

        if (rescheduleState.time === btnTime) {
          rescheduleState.time = null;
          updateRescheduleSubmitState();
        }
      }
    });
  } catch (error) {
    console.error("Error fetching reschedule availability:", error);
  }
}

function openRescheduleModal(appointmentId) {
  const appointment = allAppointments.find((a) => a._id === appointmentId);
  if (!appointment) return;

  pendingRescheduleId = appointmentId;
  rescheduleError.classList.add("hidden");
  rescheduleModalText.textContent = `Huidige afspraak: ${appointment.customerName} — ${appointment.date} om ${appointment.time}.${appointment.subscriptionId ? " Let op: dit is een vaste plek (abonnement) — dit verzet alleen deze ene afspraak, niet de terugkerende reeks." : ""}`;

  rescheduleState = { date: "", time: null };
  generateRescheduleDates(appointment.date);
  checkRescheduleAvailableTimes(rescheduleState.date);
  updateRescheduleSubmitState();

  rescheduleModal.classList.remove("hidden");
}

function closeRescheduleModal() {
  rescheduleModal.classList.add("hidden");
  pendingRescheduleId = null;
}

rescheduleModalClose.addEventListener("click", closeRescheduleModal);

rescheduleSubmitBtn.addEventListener("click", async () => {
  if (!pendingRescheduleId || !rescheduleState.date || !rescheduleState.time) return;

  rescheduleError.classList.add("hidden");
  rescheduleSubmitBtn.disabled = true;
  rescheduleSubmitBtn.textContent = "Bezig...";

  try {
    const response = await fetch(`${API_BASE_URL}/api/admin/appointments/${pendingRescheduleId}/reschedule`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: rescheduleState.date, time: rescheduleState.time }),
    });
    const data = await response.json();

    if (!response.ok || !data.success) {
      throw new Error(data.error || "Verzetten mislukt.");
    }

    closeRescheduleModal();
    await fetchAppointments();
    showToast("Afspraak verzet. De klant is per e-mail op de hoogte gebracht.", "success");
  } catch (error) {
    rescheduleError.textContent = error.message;
    rescheduleError.classList.remove("hidden");
    rescheduleSubmitBtn.disabled = false;
  } finally {
    rescheduleSubmitBtn.textContent = "Verzetten";
  }
});

tabButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    activeTab = btn.getAttribute("data-tab");
    renderCurrentView();
  });
});

searchInput.addEventListener("input", renderCurrentView);

refreshBtn.addEventListener("click", () => {
  fetchAppointments();
  fetchBlockedTimes();
  fetchSubscriptions();
  fetchPaymentIssues();
});

logoutBtn.addEventListener("click", async () => {
  await fetch(`${API_BASE_URL}/api/admin/logout`, { method: "POST" });
  window.location.href = "admin-login.html";
});

(async () => {
  const sessionResponse = await fetch(`${API_BASE_URL}/api/admin/session`);
  const sessionData = await sessionResponse.json();
  if (!sessionData.authenticated) {
    window.location.href = "admin-login.html";
    return;
  }

  updateTabStyles();
  scheduleRefundReminderRefresh();
  await Promise.all([fetchAppointments(), fetchBlockedTimes(), fetchSubscriptions(), fetchPaymentIssues()]);
  setInterval(() => {
    fetchAppointments();
    fetchBlockedTimes();
    fetchSubscriptions();
    fetchPaymentIssues();
  }, AUTO_REFRESH_MS);
})();
