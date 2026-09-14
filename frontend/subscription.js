// Frontend and backend are served from the same Render service, so API calls can use a relative
// path and stay same-origin regardless of custom domain (see primecuts-backend/src/app.js).
const API_BASE_URL = "";

let state = {
  date: "",
  time: null,
  plan: "monthly",
};

// Must match SUBSCRIPTION_PRICES in primecuts-backend/src/controllers/appointmentController.js.
const PLAN_PRICES = { monthly: "32,50", weekly: "35,00" };
const PLAN_NOTES = {
  monthly:
    "Je betaalt nu de eerste knipbeurt. Daarna staat je plek elke maand automatisch vast — betaling doe je in de winkel.",
  weekly:
    "Je betaalt nu de eerste knipbeurt. Daarna staat je plek elke week automatisch vast — betaling doe je in de winkel.",
};
const RECURRENCE_NOTES = {
  monthly:
    "Elke maand rond dezelfde datum wordt automatisch dezelfde tijd voor je vastgelegd. Valt die datum een maand op een weekend, dan schuift 'm door naar de eerstvolgende maandag.",
  weekly: "Elke week wordt automatisch dezelfde dag en tijd voor je vastgelegd.",
};

document.querySelectorAll('input[name="plan"]').forEach((input) => {
  input.addEventListener("change", () => {
    state.plan = input.value;

    document.querySelectorAll(".plan-option").forEach((label) => {
      const isSelected = label.querySelector('input[name="plan"]').checked;
      label.classList.toggle("border-accent", isSelected);
      label.classList.toggle("border-transparent", !isSelected);
    });

    document.getElementById("planPrice").innerHTML = `&euro;${PLAN_PRICES[state.plan]}`;
    document.getElementById("planNote").textContent = PLAN_NOTES[state.plan];
    document.getElementById("recurrenceNote").textContent = RECURRENCE_NOTES[state.plan];
  });
});

// --- DATE + TIME PICKER (same weekday-only, 35min-interval pattern as appointment.js) ---
function generateDates() {
  const container = document.getElementById("dateContainer");
  const monthHeader = document.getElementById("calendarMonth");
  container.innerHTML = "";

  const today = new Date();
  monthHeader.textContent = today.toLocaleDateString("nl-NL", { month: "long", year: "numeric" });

  let dayOfWeek = today.getDay();
  let offset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;

  for (let i = 0; i < offset; i++) {
    container.appendChild(document.createElement("div"));
  }

  let firstWeekdaySet = false;

  for (let i = 0; i < 14; i++) {
    const dateObj = new Date(today);
    dateObj.setDate(today.getDate() + i);

    const day = dateObj.getDay();
    const isWeekend = day === 0 || day === 6;

    const d = dateObj.getDate();
    const m = String(dateObj.getMonth() + 1).padStart(2, "0");
    const y = dateObj.getFullYear();
    const fullDate = `${y}-${m}-${String(d).padStart(2, "0")}`;

    const div = document.createElement("div");
    div.setAttribute("data-date", fullDate);
    div.setAttribute("data-weekend", isWeekend);

    if (isWeekend) {
      div.className =
        "date-btn text-neutral-700 cursor-not-allowed flex items-center justify-center opacity-30 py-2";
      div.textContent = d;
    } else if (!firstWeekdaySet) {
      div.className = "date-btn flex justify-center items-center active-date cursor-pointer py-2";
      div.innerHTML = `<div class="date-circle w-8 h-8 rounded-full bg-gradient-to-b from-accent-light via-accent to-accent-dark text-white flex items-center justify-center font-bold">${d}</div>`;
      state.date = fullDate;
      firstWeekdaySet = true;
    } else {
      div.className = "date-btn cursor-pointer hover:text-accent flex items-center justify-center py-2";
      div.textContent = d;
    }
    container.appendChild(div);
  }

  attachDateListeners();
}

function generateTimeSlots() {
  const container = document.getElementById("timeContainer");
  container.innerHTML = "";

  let currentMin = 11 * 60;
  const endMin = 19 * 60;
  const interval = 35;

  while (currentMin + interval <= endMin) {
    const h = Math.floor(currentMin / 60).toString().padStart(2, "0");
    const m = (currentMin % 60).toString().padStart(2, "0");
    const timeStr = `${h}:${m}`;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className =
      "time-btn py-3 rounded-xl border border-neutral-800 text-xs font-medium hover:border-accent/50 transition text-neutral-400 bg-cardbg";
    btn.setAttribute("data-time", timeStr);
    btn.textContent = timeStr;
    container.appendChild(btn);

    currentMin += interval;
  }

  attachTimeListeners();
}

function attachDateListeners() {
  const dateBtns = document.querySelectorAll(".date-btn");
  dateBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.getAttribute("data-weekend") === "true") return;

      dateBtns.forEach((d) => {
        d.classList.remove("active-date");
        const circle = d.querySelector(".date-circle");
        if (circle) {
          d.textContent = circle.textContent.trim();
          if (d.getAttribute("data-weekend") !== "true") {
            d.classList.add("hover:text-accent", "cursor-pointer");
          }
        }
      });

      const dateText = btn.textContent.trim();
      btn.innerHTML = `<div class="date-circle w-8 h-8 rounded-full bg-gradient-to-b from-accent-light via-accent to-accent-dark text-white flex items-center justify-center font-bold">${dateText}</div>`;
      btn.classList.add("active-date");
      btn.classList.remove("hover:text-accent", "cursor-pointer");

      state.date = btn.getAttribute("data-date");
      state.time = null;
      updateSubmitState();
      checkAvailableTimes(state.date);
    });
  });
}

function attachTimeListeners() {
  const timeBtns = document.querySelectorAll(".time-btn");
  timeBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.disabled) return;

      timeBtns.forEach((t) => {
        if (t.disabled) return;
        t.classList.remove(
          "bg-gradient-to-b", "from-accent-light", "via-accent", "to-accent-dark",
          "text-white", "font-bold", "active-time",
        );
        t.classList.add("border", "border-neutral-800", "text-neutral-400", "bg-cardbg");
      });

      btn.classList.remove("border", "border-neutral-800", "text-neutral-400", "bg-cardbg");
      btn.classList.add(
        "bg-gradient-to-b", "from-accent-light", "via-accent", "to-accent-dark",
        "text-white", "font-bold", "active-time",
      );

      state.time = btn.getAttribute("data-time");
      updateSubmitState();
    });
  });
}

// Matches APPOINTMENT_DURATION_MINUTES in primecuts-backend/src/utils/timeOverlap.js.
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

async function checkAvailableTimes(selectedDate) {
  const container = document.getElementById("timeContainer");

  const [y, m, d] = selectedDate.split("-").map(Number);
  const dateObj = new Date(y, m - 1, d);
  const day = dateObj.getDay();

  if (day === 0 || day === 6) {
    container.innerHTML = `<div class="col-span-full text-center py-8 text-neutral-500 font-medium text-xs">Gesloten in het weekend. Kies een weekdag.</div>`;
    return;
  } else if (container.children.length === 0 || container.querySelector(".col-span-full")) {
    generateTimeSlots();
  }

  const timeBtns = document.querySelectorAll(".time-btn");
  timeBtns.forEach((btn) => {
    btn.disabled = false;
    btn.classList.remove(
      "line-through", "text-neutral-700", "cursor-not-allowed", "opacity-50",
      "border-transparent", "bg-neutral-900",
    );
    btn.classList.add("bg-cardbg");
    if (btn.getAttribute("data-time") !== state.time) {
      btn.classList.add("border-neutral-800", "text-neutral-400");
    }
  });

  try {
    const response = await fetch(`${API_BASE_URL}/api/appointments?date=${selectedDate}`);
    const result = await response.json();

    if (result.success) {
      const bookedTimes = result.data.map((app) => app.time);
      const blockedRanges = result.blockedRanges || [];

      timeBtns.forEach((btn) => {
        const btnTime = btn.getAttribute("data-time");
        const isBooked = bookedTimes.includes(btnTime);
        const isBlocked = overlapsBlockedRange(btnTime, blockedRanges);
        if (isBooked || isBlocked) {
          btn.disabled = true;
          btn.classList.remove(
            "hover:border-accent/50", "bg-gradient-to-b", "from-accent-light", "via-accent",
            "to-accent-dark", "text-white", "font-bold", "active-time",
            "border-neutral-800", "text-neutral-400", "bg-cardbg",
          );
          btn.classList.add(
            "line-through", "text-neutral-700", "cursor-not-allowed", "opacity-50",
            "border-transparent", "bg-neutral-900",
          );

          if (state.time === btnTime) {
            state.time = null;
            updateSubmitState();
          }
        }
      });
    }
  } catch (error) {
    console.error("Error fetching times:", error);
  }
}

// --- FORM ---
const subscriptionForm = document.getElementById("subscriptionForm");
const confirmBtn = document.getElementById("confirmBtn");
const errorMessage = document.getElementById("errorMessage");

function updateSubmitState() {
  confirmBtn.disabled = !state.date || !state.time;
}

subscriptionForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorMessage.classList.add("hidden");

  if (!state.date || !state.time) {
    errorMessage.textContent = "Kies eerst een datum en tijd.";
    errorMessage.classList.remove("hidden");
    return;
  }

  confirmBtn.disabled = true;
  confirmBtn.textContent = "Bezig...";

  try {
    const response = await fetch(`${API_BASE_URL}/api/appointments/subscriptions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customerName: document.getElementById("customerName").value,
        customerEmail: document.getElementById("customerEmail").value,
        customerPhone: document.getElementById("customerPhone").value,
        date: state.date,
        time: state.time,
        frequency: state.plan,
      }),
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Er is iets misgegaan");

    if (data.paymentUrl) {
      window.location.href = data.paymentUrl;
      return;
    }

    throw new Error("Geen betaallink ontvangen.");
  } catch (error) {
    errorMessage.textContent = error.message;
    errorMessage.classList.remove("hidden");
    confirmBtn.disabled = false;
    confirmBtn.textContent = "Abonneren";
  }
});

// --- PAYMENT RETURN (SumUp redirects back here after the first month's checkout) ---
const successModal = document.getElementById("successModal");
const successText = document.getElementById("successText");
const goHomeBtn = document.getElementById("goHomeBtn");

goHomeBtn.addEventListener("click", () => {
  window.location.href = "/";
});

async function showPaymentReturnState() {
  const urlParams = new URLSearchParams(window.location.search);
  const paymentState = urlParams.get("payment");
  const appointmentId = urlParams.get("appointmentId");
  const plan = urlParams.get("plan");

  if (!appointmentId || paymentState !== "success") return;

  try {
    const response = await fetch(`${API_BASE_URL}/api/appointments/${appointmentId}`);
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.error || "Abonnement niet gevonden");

    // This is a fresh page load after the SumUp redirect, so `state.plan` is back to its default —
    // the actual plan the customer picked travels back via this URL param instead (see
    // getPaymentRedirectUrl in appointmentController.js), not via in-memory state that just reset.
    const recurrenceText = plan === "weekly" ? "elke week op deze dag" : "elke maand op deze dag";

    if (data.data.status === "confirmed") {
      successText.textContent = `Je vaste plek staat vast — ${recurrenceText} om ${data.data.time}.`;
    } else {
      // Not confirmed yet — ask the backend to verify with SumUp directly and release the hold
      // immediately if payment actually failed, instead of waiting for the reconciliation sweep.
      const cancelResponse = await fetch(`${API_BASE_URL}/api/appointments/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appointmentId }),
      });
      const cancelData = await cancelResponse.json();

      if (cancelData.status === "confirmed") {
        successText.textContent = `Je vaste plek staat vast — ${recurrenceText} om ${data.data.time}.`;
      } else if (cancelData.status === "released" || cancelData.status === "collision") {
        successText.textContent = "Betaling mislukt of geannuleerd. Je abonnement is niet bevestigd.";
      } else {
        successText.textContent = "Betaling wordt nog verwerkt. Je ontvangt een bevestiging per e-mail.";
      }
    }

    successModal.classList.remove("hidden");
  } catch (error) {
    console.error("Error resolving subscription payment:", error);
  }
}

// --- MOBILE MENU ---
const hamburgerBtn = document.getElementById("hamburgerBtn");
const mobileMenu = document.getElementById("mobileMenu");

hamburgerBtn.addEventListener("click", () => {
  const isOpen = mobileMenu.classList.toggle("is-open");
  hamburgerBtn.classList.toggle("is-open", isOpen);
  hamburgerBtn.setAttribute("aria-expanded", isOpen ? "true" : "false");
});

mobileMenu.querySelectorAll("a").forEach((link) => {
  link.addEventListener("click", () => {
    mobileMenu.classList.remove("is-open");
    hamburgerBtn.classList.remove("is-open");
    hamburgerBtn.setAttribute("aria-expanded", "false");
  });
});

// --- INIT ---
window.addEventListener("DOMContentLoaded", () => {
  generateDates();
  generateTimeSlots();
  updateSubmitState();
  checkAvailableTimes(state.date);
  showPaymentReturnState();
});
