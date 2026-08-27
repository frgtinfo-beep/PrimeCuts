// Frontend and backend are deployed as separate Render services on different origins, so API calls
// need the backend's full URL, not a relative path. Update this if the backend ever moves domains.
const API_BASE_URL = "https://primecutsdb.onrender.com";

// --- 1. STATE MANAGEMENT ---
let state = {
  service: "Contour",
  basePrice: 10,
  addons: [],
  addonPrice: 0,
  date: "",
  time: null,
};

// --- 2. UPDATE DOM FUNCTION ---
function updateSummaryBar() {
  const total = state.basePrice + state.addonPrice;
  document.getElementById("summary-service").textContent = state.service;
  document.getElementById("summary-date").textContent = state.date || "...";

  if (state.time) {
    document.getElementById("summary-time").textContent = state.time;
  } else {
    document.getElementById("summary-time").textContent = "Kies tijd";
  }

  document.getElementById("summary-total").textContent = `€${total}`;
}

// --- 3. EVENT LISTENERS: SERVICES ---
const serviceCards = document.querySelectorAll(".service-card");
serviceCards.forEach((card) => {
  card.addEventListener("click", () => {
    serviceCards.forEach((c) => {
      c.classList.remove("border-accent", "active-service");
      c.classList.add("border-transparent");
      c.querySelector(".checkmark").classList.add("hidden");
      c.querySelector(".icon").classList.remove("text-accent");
      c.querySelector(".icon").classList.add("text-neutral-500");
    });

    card.classList.remove("border-transparent");
    card.classList.add("border-accent", "active-service");
    card.querySelector(".checkmark").classList.remove("hidden");
    card.querySelector(".icon").classList.remove("text-neutral-500");
    card.querySelector(".icon").classList.add("text-accent");

    state.service = card.getAttribute("data-service");
    state.basePrice = parseInt(card.getAttribute("data-price"));
    updateSummaryBar();
  });
});

// --- 4. EVENT LISTENERS: ADD-ONS ---
const addonCheckboxes = document.querySelectorAll(".addon-checkbox");
addonCheckboxes.forEach((checkbox) => {
  checkbox.addEventListener("change", (e) => {
    const addonName = e.target.getAttribute("data-addon");
    const price = parseInt(e.target.getAttribute("data-price"));

    if (e.target.checked) {
      state.addons.push(addonName);
      state.addonPrice += price;
    } else {
      state.addons = state.addons.filter((item) => item !== addonName);
      state.addonPrice -= price;
    }
    updateSummaryBar();
  });
});

// --- 5. DYNAMIC GENERATORS (Weekdays only, 11-6, 45min intervals) ---
function generateDates() {
  const container = document.getElementById("dateContainer");
  const monthHeader = document.getElementById("calendarMonth");
  container.innerHTML = "";

  const today = new Date();
  monthHeader.textContent = today.toLocaleDateString("nl-NL", {
    month: "long",
    year: "numeric",
  });

  let dayOfWeek = today.getDay();
  let offset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;

  for (let i = 0; i < offset; i++) {
    const emptyDiv = document.createElement("div");
    container.appendChild(emptyDiv);
  }

  let firstWeekdaySet = false;

  for (let i = 0; i < 7; i++) {
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
      div.className =
        "date-btn flex justify-center items-center active-date cursor-pointer py-2";
      div.innerHTML = `<div class="date-circle w-8 h-8 rounded-full bg-gradient-to-b from-accent-light via-accent to-accent-dark text-white flex items-center justify-center font-bold">${d}</div>`;
      state.date = fullDate;
      firstWeekdaySet = true;
    } else {
      div.className =
        "date-btn cursor-pointer hover:text-accent flex items-center justify-center py-2";
      div.textContent = d;
    }
    container.appendChild(div);
  }

  attachDateListeners();
}

function generateTimeSlots() {
  const container = document.getElementById("timeContainer");
  container.innerHTML = "";

  let currentMin = 11 * 60; // 11:00 AM
  const endMin = 18 * 60; // 6:00 PM
  const interval = 45;

  while (currentMin + interval <= endMin) {
    const h = Math.floor(currentMin / 60)
      .toString()
      .padStart(2, "0");
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

// --- 6. ATTACH DYNAMIC LISTENERS ---
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
      updateSummaryBar();
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
          "bg-gradient-to-b",
          "from-accent-light",
          "via-accent",
          "to-accent-dark",
          "text-white",
          "font-bold",
          "active-time",
        );
        t.classList.add(
          "border",
          "border-neutral-800",
          "text-neutral-400",
          "bg-cardbg",
        );
      });

      btn.classList.remove(
        "border",
        "border-neutral-800",
        "text-neutral-400",
        "bg-cardbg",
      );
      btn.classList.add(
        "bg-gradient-to-b",
        "from-accent-light",
        "via-accent",
        "to-accent-dark",
        "text-white",
        "font-bold",
        "active-time",
      );

      state.time = btn.getAttribute("data-time");
      updateSummaryBar();

      const checkoutBtn = document.getElementById("openCheckoutBtn");
      checkoutBtn.disabled = false;
    });
  });
}

// --- 7. DISABLE BOOKED TIMES LOGIC ---
async function checkAvailableTimes(selectedDate) {
  const container = document.getElementById("timeContainer");

  const [y, m, d] = selectedDate.split("-").map(Number);
  const dateObj = new Date(y, m - 1, d);
  const day = dateObj.getDay();

  if (day === 0 || day === 6) {
    container.innerHTML = `<div class="col-span-full text-center py-8 text-neutral-500 font-medium text-xs">Gesloten in het weekend. Kies een weekdag.</div>`;
    return;
  } else if (
    container.children.length === 0 ||
    container.querySelector(".col-span-full")
  ) {
    generateTimeSlots();
  }

  const timeBtns = document.querySelectorAll(".time-btn");
  timeBtns.forEach((btn) => {
    btn.disabled = false;
    btn.classList.remove(
      "line-through",
      "text-neutral-700",
      "cursor-not-allowed",
      "opacity-50",
      "border-transparent",
      "bg-neutral-900",
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

      timeBtns.forEach((btn) => {
        const btnTime = btn.getAttribute("data-time");
        if (bookedTimes.includes(btnTime)) {
          btn.disabled = true;
          btn.classList.remove(
            "hover:border-accent/50",
            "bg-gradient-to-b",
            "from-accent-light",
            "via-accent",
            "to-accent-dark",
            "text-white",
            "font-bold",
            "active-time",
            "border-neutral-800",
            "text-neutral-400",
            "bg-cardbg",
          );
          btn.classList.add(
            "line-through",
            "text-neutral-700",
            "cursor-not-allowed",
            "opacity-50",
            "border-transparent",
            "bg-neutral-900",
          );

          if (state.time === btnTime) {
            state.time = null;
            updateSummaryBar();
            const checkoutBtn = document.getElementById("openCheckoutBtn");
            checkoutBtn.disabled = true;
          }
        }
      });
    }
  } catch (error) {
    console.error("Error fetching times:", error);
  }
}

// --- 8. CHECKOUT MODAL LOGIC ---
const openCheckoutBtn = document.getElementById("openCheckoutBtn");
const checkoutModal = document.getElementById("checkoutModal");
const closeModal = document.getElementById("closeModal");
const bookingForm = document.getElementById("bookingForm");
const errorMessage = document.getElementById("errorMessage");
const confirmBtn = document.getElementById("confirmBtn");
const bookingContent = document.getElementById("bookingContent");
const successContent = document.getElementById("successContent");
const successText = document.getElementById("successText");
const bookAnotherBtn = document.getElementById("bookAnotherBtn");

async function showPaymentReturnState() {
  const urlParams = new URLSearchParams(window.location.search);
  const paymentState = urlParams.get("payment");
  const appointmentId = urlParams.get("appointmentId");

  if (
    !appointmentId ||
    (paymentState !== "success" &&
      paymentState !== "failed" &&
      paymentState !== "cancelled")
  ) {
    return;
  }

  if (paymentState === "failed" || paymentState === "cancelled") {
    bookingContent.classList.add("hidden");
    successContent.classList.add("hidden");
    checkoutModal.classList.remove("hidden");
    errorMessage.classList.remove("hidden");
    errorMessage.textContent =
      "Betaling geannuleerd of mislukt. Je tijdslot is niet bevestigd.";
    return;
  }

  try {
    const response = await fetch(`${API_BASE_URL}/api/appointments/${appointmentId}`);
    const data = await response.json();

    if (!response.ok || !data.success) {
      throw new Error(data.error || "Appointment not found");
    }

    bookingContent.classList.add("hidden");
    checkoutModal.classList.remove("hidden");

    if (data.data.status === "confirmed") {
      errorMessage.classList.add("hidden");
      successContent.classList.remove("hidden");
      successText.textContent = `Betaling ontvangen. Je afspraak staat vast op ${data.data.date} om ${data.data.time}.`;
      return;
    }

    // Not confirmed yet — SumUp sends the browser back here regardless of outcome, so ask the
    // backend to verify the checkout with SumUp directly and release the hold immediately if the
    // payment actually failed, instead of waiting out the 10-min TTL.
    const cancelResponse = await fetch(`${API_BASE_URL}/api/appointments/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appointmentId }),
    });
    const cancelData = await cancelResponse.json();

    if (cancelData.status === "confirmed") {
      errorMessage.classList.add("hidden");
      successContent.classList.remove("hidden");
      successText.textContent = `Betaling ontvangen. Je afspraak staat vast op ${data.data.date} om ${data.data.time}.`;
    } else if (cancelData.status === "released" || cancelData.status === "collision") {
      successContent.classList.add("hidden");
      errorMessage.classList.remove("hidden");
      errorMessage.textContent = "Betaling mislukt of geannuleerd. Je tijdslot is niet bevestigd.";
    } else {
      errorMessage.classList.add("hidden");
      successContent.classList.remove("hidden");
      successText.textContent = `Betaling voor ${data.data.date} om ${data.data.time} wordt nog verwerkt.`;
    }
  } catch (error) {
    bookingContent.classList.add("hidden");
    errorMessage.classList.add("hidden");
    successContent.classList.remove("hidden");
    checkoutModal.classList.remove("hidden");
    successText.textContent = "Betaling ontvangen. Je afspraak wordt verwerkt.";
  }
}

openCheckoutBtn.addEventListener("click", () => {
  if (!state.time) return;
  document.getElementById("modalService").textContent = state.service;
  document.getElementById("modalPrice").textContent =
    `€${state.basePrice + state.addonPrice}`;

  bookingContent.classList.remove("hidden");
  successContent.classList.add("hidden");
  errorMessage.classList.add("hidden");
  bookingForm.reset();

  checkoutModal.classList.remove("hidden");
});

closeModal.addEventListener("click", () => {
  checkoutModal.classList.add("hidden");
});

bookAnotherBtn.addEventListener("click", () => {
  checkoutModal.classList.add("hidden");
  window.location.reload();
});

bookingForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  confirmBtn.disabled = true;
  confirmBtn.textContent = "Bezig met boeken...";
  errorMessage.classList.add("hidden");

  // Re-derive the price straight from the DOM (selected service card + checked add-on boxes) and
  // cross-check it against both state and the number the modal is actually showing the customer,
  // so a stale/tampered state object can't sneak a different price into what gets sent to checkout.
  const selectedCard = document.querySelector(".service-card.active-service");
  const checkedAddonBoxes = document.querySelectorAll(
    ".addon-checkbox:checked",
  );
  const verifiedBasePrice = selectedCard
    ? parseInt(selectedCard.getAttribute("data-price"))
    : NaN;
  const verifiedAddonPrice = Array.from(checkedAddonBoxes).reduce(
    (sum, box) => sum + parseInt(box.getAttribute("data-price")),
    0,
  );
  const verifiedTotal = verifiedBasePrice + verifiedAddonPrice;
  const modalDisplayedTotal = parseInt(
    document.getElementById("modalPrice").textContent.replace("€", ""),
  );

  if (
    !Number.isFinite(verifiedTotal) ||
    verifiedTotal !== state.basePrice + state.addonPrice ||
    verifiedTotal !== modalDisplayedTotal
  ) {
    errorMessage.textContent =
      "Prijs kon niet worden geverifieerd. Vernieuw de pagina en probeer opnieuw.";
    errorMessage.classList.remove("hidden");
    confirmBtn.disabled = false;
    confirmBtn.textContent = "Bevestig Afspraak";
    return;
  }

  const payload = {
    customerName: document.getElementById("customerName").value,
    customerEmail: document.getElementById("customerEmail").value,
    customerPhone: document.getElementById("customerPhone").value,
    service: state.service,
    addons: state.addons,
    date: state.date,
    time: state.time,
    totalPrice: verifiedTotal,
  };

  try {
    const response = await fetch(`${API_BASE_URL}/api/appointments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (!response.ok) throw new Error(data.error || "Er is iets misgegaan");

    if (data.paymentUrl) {
      window.location.href = data.paymentUrl;
      return;
    }

    successText.textContent = `Tot ziens op ${state.date} om ${state.time}.`;
    bookingContent.classList.add("hidden");
    successContent.classList.remove("hidden");
  } catch (error) {
    errorMessage.textContent = error.message;
    errorMessage.classList.remove("hidden");
    confirmBtn.disabled = false;
    confirmBtn.textContent = "Bevestig Afspraak";
  }
});

// --- 9. MOBILE MENU TOGGLE ---
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

window.addEventListener("resize", () => {
  if (window.innerWidth >= 768) {
    mobileMenu.classList.remove("is-open");
    hamburgerBtn.classList.remove("is-open");
    hamburgerBtn.setAttribute("aria-expanded", "false");
  }
});

// --- 10. INITIALIZE PAGE ON LOAD ---
window.addEventListener("DOMContentLoaded", () => {
  generateDates();
  generateTimeSlots();

  const urlParams = new URLSearchParams(window.location.search);
  const requestedService = urlParams.get("service");

  if (requestedService) {
    const targetCard = Array.from(serviceCards).find(
      (card) =>
        card.getAttribute("data-service").toLowerCase() ===
        requestedService.toLowerCase(),
    );
    if (targetCard) targetCard.click();
  }

  updateSummaryBar();
  checkAvailableTimes(state.date);
  showPaymentReturnState();
});
