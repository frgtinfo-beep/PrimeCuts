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

const cancelModal = document.getElementById("cancelModal");
const cancelModalText = document.getElementById("cancelModalText");
const cancelModalClose = document.getElementById("cancelModalClose");
const cancelModalConfirm = document.getElementById("cancelModalConfirm");
const toast = document.getElementById("toast");

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
let activeTab = "active"; // "active" | "past" | "availability"
let pendingCancelId = null;

function formatEuro(amount) {
  return Number(amount).toFixed(2).replace(".", ",");
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

  return `<button type="button" data-cancel-id="${appointment._id}"
      class="cancel-btn inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-red-900 text-red-400 hover:bg-red-900/20 transition text-xs font-semibold uppercase tracking-wide">
    <i class="fa-solid fa-xmark"></i> Annuleren
  </button>`;
}

function appointmentCard(appointment) {
  const addonsText = appointment.addons && appointment.addons.length > 0 ? ` + ${appointment.addons.join(", ")}` : "";
  // Bookings made before the deposit split existed have no depositAmount on record.
  const hasDeposit = typeof appointment.depositAmount === "number";
  const depositText = hasDeposit ? `€${formatEuro(appointment.depositAmount)}` : "—";
  const remainingText = hasDeposit ? `€${formatEuro(appointment.totalPrice - appointment.depositAmount)}` : "—";
  const cancelledStyle = appointment.status === "cancelled" ? "opacity-50" : "";

  return `
    <div class="bg-cardbg border border-neutral-800 rounded-2xl p-6 ${cancelledStyle}">
      <div class="flex flex-wrap justify-between items-start gap-4">
        <div>
          <div class="flex items-center gap-3 mb-1">
            <i class="fa-solid fa-calendar text-accent"></i>
            <span class="font-bebas text-xl tracking-wide">${appointment.date} — ${appointment.time}</span>
          </div>
          <p class="text-neutral-400 text-sm">${appointment.service}${addonsText}</p>
        </div>
        ${statusBadge(appointment)}
      </div>

      <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6 pt-6 border-t border-neutral-800">
        <div>
          <p class="text-[10px] uppercase tracking-widest text-neutral-500 mb-1 font-mono">Klant</p>
          <p class="text-sm font-semibold">${appointment.customerName}</p>
        </div>
        <div>
          <p class="text-[10px] uppercase tracking-widest text-neutral-500 mb-1 font-mono">Contact</p>
          <p class="text-sm">${appointment.customerPhone}</p>
          <p class="text-sm text-neutral-400">${appointment.customerEmail}</p>
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
            <span class="block font-semibold ${checked ? "line-through" : ""}">${a.customerName}</span>
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
  appointmentsView.classList.toggle("hidden", isAvailability);
  availabilityView.classList.toggle("hidden", !isAvailability);
  searchWrap.classList.toggle("hidden", isAvailability);

  if (isAvailability) {
    renderBlockedTimes();
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
}

function blockedTimeCard(blockedTime) {
  const reasonText = blockedTime.reason ? ` — ${blockedTime.reason}` : "";
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
  await Promise.all([fetchAppointments(), fetchBlockedTimes()]);
  setInterval(() => {
    fetchAppointments();
    fetchBlockedTimes();
  }, AUTO_REFRESH_MS);
})();
