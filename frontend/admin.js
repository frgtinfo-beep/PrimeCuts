const API_BASE_URL = "";
const AUTO_REFRESH_MS = 15 * 60 * 1000; // 15 minutes

const loadingState = document.getElementById("loadingState");
const emptyState = document.getElementById("emptyState");
const appointmentList = document.getElementById("appointmentList");
const lastUpdated = document.getElementById("lastUpdated");
const refreshBtn = document.getElementById("refreshBtn");
const logoutBtn = document.getElementById("logoutBtn");
const searchInput = document.getElementById("searchInput");
const tabButtons = document.querySelectorAll(".tab-btn");

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
let activeTab = "active"; // "active" = date still upcoming, "past" = date already passed
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

refreshBtn.addEventListener("click", fetchAppointments);

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
  await fetchAppointments();
  setInterval(fetchAppointments, AUTO_REFRESH_MS);
})();
