// Frontend and backend are served from the same Render service, so API calls can use a relative
// path and stay same-origin regardless of custom domain (see primecuts-backend/src/app.js).
const API_BASE_URL = "";

let state = {
  plan: null,
  date: "",
  time: null,
  // Result of /subscriptions/preview for the current plan+date+time: { upcoming, conflictDate }.
  preview: null,
  previewLoading: false,
  submitting: false,
};

// Plans and prices come from the backend (primecuts-backend/src/config/subscriptionPlans.js), so a
// price change there shows up here without touching this file.
let plans = [];

const formatEuro = (amount) => amount.toFixed(2).replace(".", ",");
const pad2 = (n) => String(n).padStart(2, "0");
const toDateStr = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const parseDateStr = (str) => {
  const [y, m, d] = str.split("-").map(Number);
  return new Date(y, m - 1, d);
};
// "vr 30 okt"
const shortDate = (str) =>
  parseDateStr(str).toLocaleDateString("nl-NL", { weekday: "short", day: "numeric", month: "short" });
const weekdayName = (str) => parseDateStr(str).toLocaleDateString("nl-NL", { weekday: "long" });

function scheduleText(planId, dateStr, time) {
  if (!planId || !dateStr || !time) return null;
  if (planId === "weekly") return `Elke ${weekdayName(dateStr)} om ${time}`;
  if (planId === "biweekly") return `Om de week op ${weekdayName(dateStr)} om ${time}`;
  return `Elke maand rond de ${parseDateStr(dateStr).getDate()}e om ${time}`;
}

const RECURRENCE_TEXT = { weekly: "elke week", biweekly: "om de week", monthly: "elke maand" };

// Every async refresh (times, preview) is tagged so a slow response for a date/time the customer
// already clicked away from can never overwrite the newer one.
let timesRequestId = 0;
let previewRequestId = 0;

// ---------------------------------------------------------------- STEP 1: PLAN
async function loadPlans() {
  const container = document.getElementById("planOptions");
  try {
    const response = await fetch(`${API_BASE_URL}/api/appointments/subscriptions/plans`);
    const result = await response.json();
    if (!response.ok || !result.success || !result.data.length) throw new Error();
    plans = result.data;
  } catch (error) {
    container.innerHTML = `<p class="text-red-300 text-sm col-span-full">Abonnementen konden niet geladen worden. Ververs de pagina of probeer het later opnieuw.</p>`;
    render();
    return;
  }

  container.innerHTML = "";
  plans.forEach((plan) => {
    const label = document.createElement("label");
    label.className =
      "plan-card relative block bg-cardbg border border-neutral-800 hover:border-neutral-600 rounded-2xl p-4 cursor-pointer";
    label.innerHTML = `
      <input type="radio" name="plan" class="sr-only">
      <span class="plan-check absolute top-3 right-3 w-5 h-5 rounded-full bg-accent text-white inline-flex items-center justify-center">
        <i class="fa-solid fa-check text-[10px]"></i>
      </span>
      <span class="plan-label block font-semibold pr-6"></span>
      <span class="plan-description block text-neutral-500 text-xs mt-1 leading-snug"></span>
      <span class="block mt-3 font-bebas text-2xl tracking-wide">&euro;${formatEuro(plan.monthlyPrice)}<span class="font-sans text-neutral-500 text-xs"> / maand</span></span>`;
    const input = label.querySelector("input");
    input.value = plan.id;
    label.querySelector(".plan-label").textContent = plan.label;
    label.querySelector(".plan-description").textContent = plan.description;
    input.addEventListener("change", () => {
      state.plan = plan.id;
      refreshPreview();
      render();
    });
    container.appendChild(label);
  });

  // Coming back from the homepage or SumUp with a plan in the URL keeps that choice.
  const fromUrl = new URLSearchParams(window.location.search).get("plan");
  const initial = plans.find((p) => p.id === fromUrl) || plans[0];
  container.querySelector(`input[value="${initial.id}"]`).checked = true;
  state.plan = initial.id;
  refreshPreview();
  render();
}

// ---------------------------------------------------------------- STEP 2: DAY + TIME
// Must match the slot grid in primecuts-backend/src/utils/timeOverlap.js (isBookableSlotTime).
const OPENING_MINUTES = 11 * 60;
const CLOSING_MINUTES = 19 * 60;
const APPOINTMENT_DURATION_MINUTES = 35;
const DAYS_SHOWN = 14;

const timeToMinutes = (hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

function allSlotTimes() {
  const times = [];
  for (let min = OPENING_MINUTES; min + APPOINTMENT_DURATION_MINUTES <= CLOSING_MINUTES; min += APPOINTMENT_DURATION_MINUTES) {
    times.push(`${pad2(Math.floor(min / 60))}:${pad2(min % 60)}`);
  }
  return times;
}

// Slots that have already started today aren't offered at all (the server refuses them too).
function isPastSlot(dateStr, time) {
  const now = new Date();
  if (dateStr !== toDateStr(now)) return false;
  return timeToMinutes(time) <= now.getHours() * 60 + now.getMinutes();
}

const isWeekend = (date) => date.getDay() === 0 || date.getDay() === 6;

function generateDates() {
  const container = document.getElementById("dateContainer");
  container.innerHTML = "";

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const last = new Date(today);
  last.setDate(today.getDate() + DAYS_SHOWN - 1);

  const fmtMonth = (d) => d.toLocaleDateString("nl-NL", { month: "long" });
  document.getElementById("calendarMonth").textContent =
    today.getMonth() === last.getMonth()
      ? `${fmtMonth(today)} ${today.getFullYear()}`
      : `${fmtMonth(today)} – ${fmtMonth(last)} ${last.getFullYear()}`;

  const offset = today.getDay() === 0 ? 6 : today.getDay() - 1;
  for (let i = 0; i < offset; i++) container.appendChild(document.createElement("div"));

  let firstSelectable = null;
  for (let i = 0; i < DAYS_SHOWN; i++) {
    const date = new Date(today);
    date.setDate(today.getDate() + i);
    const dateStr = toDateStr(date);
    // A weekday whose every slot is already over (e.g. today after closing) can't be picked either.
    const hasTimeLeft = allSlotTimes().some((t) => !isPastSlot(dateStr, t));
    const selectable = !isWeekend(date) && hasTimeLeft;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.dataset.date = dateStr;
    btn.textContent = date.getDate();
    btn.setAttribute(
      "aria-label",
      date.toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long" }),
    );
    btn.className =
      "date-btn pressable h-10 rounded-full text-sm font-medium flex items-center justify-center mx-auto w-10";
    if (!selectable) {
      btn.disabled = true;
      btn.classList.add("text-neutral-700", "cursor-not-allowed");
    } else {
      btn.classList.add("text-neutral-300", "hover:bg-neutral-800");
      btn.addEventListener("click", () => selectDate(dateStr));
      if (!firstSelectable) firstSelectable = dateStr;
    }
    container.appendChild(btn);
  }

  if (firstSelectable) selectDate(firstSelectable);
}

function selectDate(dateStr) {
  state.date = dateStr;
  state.time = null;
  state.preview = null;
  document.querySelectorAll(".date-btn").forEach((btn) => {
    const isSelected = btn.dataset.date === dateStr;
    btn.setAttribute("aria-pressed", isSelected ? "true" : "false");
    btn.classList.toggle("bg-gradient-to-b", isSelected);
    btn.classList.toggle("from-accent-light", isSelected);
    btn.classList.toggle("via-accent", isSelected);
    btn.classList.toggle("to-accent-dark", isSelected);
    btn.classList.toggle("text-white", isSelected);
    btn.classList.toggle("font-bold", isSelected);
  });
  loadTimes(dateStr);
  render();
}

// Every slot starts disabled until availability for this date has actually loaded — otherwise a
// quick tap could pick a time that turns out to be taken a moment later.
async function loadTimes(dateStr) {
  const requestId = ++timesRequestId;
  const container = document.getElementById("timeContainer");
  const status = document.getElementById("timeStatus");
  status.textContent = "Beschikbare tijden laden…";
  container.innerHTML = "";

  // Slots that already started today aren't shown at all — striking them through would read as
  // "taken", which they're not.
  const times = allSlotTimes().filter((time) => !isPastSlot(dateStr, time));
  times.forEach((time) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.dataset.time = time;
    btn.textContent = time;
    btn.disabled = true;
    btn.setAttribute("aria-pressed", "false");
    btn.className =
      "slot pressable is-loading py-3 rounded-xl border border-neutral-800 bg-cardbg text-sm text-neutral-300 hover:border-accent/60";
    btn.addEventListener("click", () => selectTime(time));
    container.appendChild(btn);
  });

  let taken = new Set();
  try {
    const response = await fetch(`${API_BASE_URL}/api/appointments?date=${dateStr}`);
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error();
    if (requestId !== timesRequestId) return;
    const blockedRanges = result.blockedRanges || [];
    taken = new Set(result.data.map((a) => a.time));
    times.forEach((time) => {
      const start = timeToMinutes(time);
      const end = start + APPOINTMENT_DURATION_MINUTES;
      const blocked = blockedRanges.some(
        (r) => start < timeToMinutes(r.endTime) && end > timeToMinutes(r.startTime),
      );
      if (blocked) taken.add(time);
    });
  } catch (error) {
    if (requestId !== timesRequestId) return;
    status.textContent = "Tijden konden niet geladen worden. Kies de dag opnieuw om het nog eens te proberen.";
    return;
  }

  let openCount = 0;
  container.querySelectorAll(".slot").forEach((btn) => {
    btn.classList.remove("is-loading");
    const unavailable = taken.has(btn.dataset.time);
    btn.disabled = unavailable;
    if (unavailable) btn.setAttribute("aria-label", `${btn.dataset.time} — bezet`);
    else openCount++;
  });

  status.textContent = !openCount
    ? "Deze dag is helemaal vol. Kies een andere dag."
    : openCount < times.length
    ? "Doorgestreepte tijden zijn al bezet."
    : "";

  if (state.time && taken.has(state.time)) {
    state.time = null;
    state.preview = null;
    render();
  }
}

function selectTime(time) {
  state.time = time;
  document.querySelectorAll(".slot").forEach((btn) => {
    btn.setAttribute("aria-pressed", btn.dataset.time === time ? "true" : "false");
  });
  refreshPreview();
  render();
}

// ---------------------------------------------------------------- PREVIEW (next dates + clashes)
async function refreshPreview() {
  const requestId = ++previewRequestId;
  state.preview = null;
  if (!state.plan || !state.date || !state.time) {
    state.previewLoading = false;
    return;
  }
  state.previewLoading = true;
  render();

  try {
    const params = new URLSearchParams({ date: state.date, time: state.time, frequency: state.plan });
    const response = await fetch(`${API_BASE_URL}/api/appointments/subscriptions/preview?${params}`);
    const result = await response.json();
    if (requestId !== previewRequestId) return;
    state.preview = response.ok && result.success ? result.data : { error: result.error || "Kon niet controleren." };
  } catch (error) {
    if (requestId !== previewRequestId) return;
    state.preview = { error: "Kon niet controleren of deze plek elke keer vrij is. Probeer het opnieuw." };
  }
  state.previewLoading = false;
  render();
}

// ---------------------------------------------------------------- STEP 3: DETAILS
const fields = {
  name: document.getElementById("customerName"),
  email: document.getElementById("customerEmail"),
  phone: document.getElementById("customerPhone"),
};
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Common typos that would silently send the confirmation into the void.
const EMAIL_DOMAIN_FIXES = {
  "gmial.com": "gmail.com", "gmal.com": "gmail.com", "gmai.com": "gmail.com", "gamil.com": "gmail.com",
  "gmail.co": "gmail.com", "gmail.nl": "gmail.com", "gmail.con": "gmail.com",
  "hotmial.com": "hotmail.com", "hotmal.com": "hotmail.com", "hotmai.com": "hotmail.com", "hotmail.con": "hotmail.com",
  "hotmial.nl": "hotmail.nl", "hotmal.nl": "hotmail.nl",
  "outlok.com": "outlook.com", "outloo.com": "outlook.com", "outlook.con": "outlook.com",
  "icloud.co": "icloud.com", "iclod.com": "icloud.com", "live.nll": "live.nl",
};

const validators = {
  name: (v) => (v.trim().length >= 2 ? null : "Vul je volledige naam in."),
  email: (v) => (EMAIL_REGEX.test(v.trim()) ? null : "Vul een geldig e-mailadres in, bijv. naam@gmail.com."),
  phone: (v) => {
    const digits = v.replace(/\D/g, "");
    if (!/^[0-9+\-\s()]*$/.test(v.trim())) return "Gebruik alleen cijfers, spaties en +.";
    return digits.length >= 9 && digits.length <= 15 ? null : "Vul een geldig telefoonnummer in, bijv. 06 12345678.";
  },
};

// Errors appear once a field has been left (or on submit) — not while someone is still typing.
const touched = { name: false, email: false, phone: false };

function showFieldError(key) {
  const input = fields[key];
  const errorEl = document.getElementById(`${input.id}Error`);
  const error = validators[key](input.value);
  const visible = touched[key] && error;
  input.setAttribute("aria-invalid", visible ? "true" : "false");
  errorEl.textContent = visible ? error : "";
  errorEl.classList.toggle("hidden", !visible);
}

function updateEmailHint() {
  const hint = document.getElementById("customerEmailHint");
  const value = fields.email.value.trim().toLowerCase();
  const domain = value.split("@")[1];
  const fix = domain && EMAIL_DOMAIN_FIXES[domain];
  if (!fix) {
    hint.classList.add("hidden");
    return;
  }
  const suggestion = `${value.split("@")[0]}@${fix}`;
  hint.innerHTML = "";
  hint.append("Bedoel je ");
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "underline font-semibold";
  btn.textContent = suggestion;
  btn.addEventListener("click", () => {
    fields.email.value = suggestion;
    hint.classList.add("hidden");
    showFieldError("email");
    render();
  });
  hint.append(btn, "?");
  hint.classList.remove("hidden");
}

Object.entries(fields).forEach(([key, input]) => {
  input.addEventListener("blur", () => {
    touched[key] = true;
    showFieldError(key);
    if (key === "email") updateEmailHint();
  });
  input.addEventListener("input", () => {
    if (touched[key]) showFieldError(key);
    if (key === "email") updateEmailHint();
    render();
  });
});

// ---------------------------------------------------------------- SUMMARY + SUBMIT
const confirmBtn = document.getElementById("confirmBtn");
const errorMessage = document.getElementById("errorMessage");

const consentCheckbox = document.getElementById("consentCheckbox");
consentCheckbox.addEventListener("change", render);

// "november"
const monthName = (dateStr) => parseDateStr(dateStr).toLocaleDateString("nl-NL", { month: "long" });
// "1 december"
const dayMonth = (dateStr) => parseDateStr(dateStr).toLocaleDateString("nl-NL", { day: "numeric", month: "long" });

function missingItems() {
  const missing = [];
  if (!state.plan) missing.push("plan");
  if (!state.date || !state.time) missing.push("tijd");
  if (validators.name(fields.name.value)) missing.push("naam");
  if (validators.email(fields.email.value)) missing.push("e-mail");
  if (validators.phone(fields.phone.value)) missing.push("telefoonnummer");
  if (!consentCheckbox.checked) missing.push("toestemming");
  return missing;
}

function render() {
  const plan = plans.find((p) => p.id === state.plan);
  const preview = state.preview;

  document.getElementById("summaryPlan").textContent = plan ? plan.label : "—";
  document.getElementById("summarySchedule").textContent = scheduleText(state.plan, state.date, state.time) || "Kies een dag en tijd";
  document.getElementById("summaryMonthly").innerHTML = plan ? `&euro;${formatEuro(plan.monthlyPrice)}` : "—";

  // What's charged now depends on the visits left in the first month — only known once the preview
  // for the chosen day is in.
  if (preview?.firstMonthAmount !== undefined && state.date) {
    const month = monthName(state.date);
    document.getElementById("summaryPayNowLabel").textContent = `Nu betalen (${month})`;
    document.getElementById("summaryPayNow").innerHTML = `&euro;${formatEuro(preview.firstMonthAmount)}`;
    const visits = preview.visitsInFirstMonth;
    document.getElementById("summaryAfter").textContent =
      `Voor je ${visits === 1 ? "afspraak" : `${visits} afspraken`} in ${month}. Vanaf ${dayMonth(preview.nextChargeDate)} wordt elke 1e van de maand automatisch €${formatEuro(preview.monthlyPrice)} van je kaart afgeschreven.`;
  } else {
    document.getElementById("summaryPayNowLabel").textContent = "Nu betalen";
    document.getElementById("summaryPayNow").innerHTML = "—";
    document.getElementById("summaryAfter").textContent = plan
      ? `Elke 1e van de maand wordt automatisch €${formatEuro(plan.monthlyPrice)} van je kaart afgeschreven.`
      : "";
  }
  document.getElementById("consentText").textContent = plan
    ? `Ik geef PrimeCuts toestemming om elke 1e van de maand automatisch €${formatEuro(plan.monthlyPrice)} van mijn kaart af te schrijven, tot ik opzeg.`
    : "Ik geef PrimeCuts toestemming om elke 1e van de maand automatisch het maandbedrag van mijn kaart af te schrijven, tot ik opzeg.";

  const upcomingWrap = document.getElementById("summaryUpcomingWrap");
  const upcomingList = document.getElementById("summaryUpcoming");
  const conflictBox = document.getElementById("summaryConflict");

  if (state.previewLoading) {
    upcomingWrap.classList.remove("hidden");
    upcomingList.innerHTML = `<li class="text-neutral-500">Controleren of deze plek elke keer vrij is…</li>`;
    conflictBox.classList.add("hidden");
  } else if (preview?.upcoming) {
    upcomingWrap.classList.remove("hidden");
    upcomingList.innerHTML = preview.upcoming
      .map((date) => `<li class="flex justify-between"><span class="capitalize">${shortDate(date)}</span><span class="text-neutral-500">${state.time}</span></li>`)
      .join("");
    if (preview.conflictDate) {
      conflictBox.textContent = `Deze plek is niet elke keer vrij: op ${shortDate(preview.conflictDate)} om ${state.time} is hij al bezet. Kies een andere tijd of dag.`;
      conflictBox.classList.remove("hidden");
    } else {
      conflictBox.classList.add("hidden");
    }
  } else if (preview?.error) {
    upcomingWrap.classList.add("hidden");
    conflictBox.textContent = preview.error;
    conflictBox.classList.remove("hidden");
  } else {
    upcomingWrap.classList.add("hidden");
    conflictBox.classList.add("hidden");
  }

  const missing = missingItems();
  const previewOk = preview?.upcoming && !preview.conflictDate;
  confirmBtn.disabled = state.submitting || missing.length > 0 || !previewOk;
  confirmBtn.textContent = state.submitting ? "Even geduld…" : "Verder naar betalen";

  const hint = document.getElementById("missingHint");
  if (missing.length) hint.textContent = `Nog nodig: ${missing.join(", ")}`;
  else if (state.previewLoading) hint.textContent = "Even controleren…";
  else if (preview?.conflictDate) hint.textContent = "Kies een tijd die elke keer vrij is.";
  else hint.textContent = "";

  const destination = document.getElementById("emailDestination");
  const email = fields.email.value.trim();
  const showDestination = !validators.email(email);
  destination.textContent = showDestination ? `Bevestiging gaat naar ${email}` : "";
  destination.classList.toggle("hidden", !showDestination);
}

document.getElementById("subscriptionForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (state.submitting) return;
  errorMessage.classList.add("hidden");

  // Surface every field problem at once and put the cursor on the first one.
  Object.keys(fields).forEach((key) => {
    touched[key] = true;
    showFieldError(key);
  });
  const firstInvalid = Object.keys(fields).find((key) => validators[key](fields[key].value));
  if (firstInvalid) {
    fields[firstInvalid].focus();
    render();
    return;
  }
  if (!consentCheckbox.checked) {
    consentCheckbox.focus();
    render();
    return;
  }
  if (confirmBtn.disabled) return;

  state.submitting = true;
  render();

  try {
    const response = await fetch(`${API_BASE_URL}/api/appointments/subscriptions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customerName: fields.name.value.trim(),
        customerEmail: fields.email.value.trim(),
        customerPhone: fields.phone.value.trim(),
        date: state.date,
        time: state.time,
        frequency: state.plan,
        agreedToMonthlyCharge: consentCheckbox.checked,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      // Someone else got there first (or a clash appeared) since the times were loaded — refresh so
      // the customer isn't left picking from a stale list. Their own unfinished signup (409) keeps
      // the selection, since that slot is theirs.
      if (response.status !== 409) {
        state.time = null;
        state.preview = null;
        loadTimes(state.date);
      }
      throw new Error(data.error || "Er is iets misgegaan. Probeer het opnieuw.");
    }

    openPayment(data);
  } catch (error) {
    errorMessage.textContent =
      error instanceof TypeError ? "Geen verbinding. Controleer je internet en probeer het opnieuw." : error.message;
    errorMessage.classList.remove("hidden");
    state.submitting = false;
    render();
  }
});

// ---------------------------------------------------------------- CARD PAYMENT (SumUp card form)
// SumUp's own card form, embedded in a modal: card details go straight to SumUp, never through our
// server. It handles 3D Secure itself. On success, the backend saves the card and charges the first
// month (POST …/complete).
const SUMUP_SDK_URL = "https://gateway.sumup.com/gateway/ecom/card/v2/sdk.js";
const paymentModal = document.getElementById("paymentModal");
const paymentStatus = document.getElementById("paymentStatus");
const paymentCancelBtn = document.getElementById("paymentCancelBtn");
let activeSignup = null; // { subscriptionId, checkoutId, firstMonthAmount, monthlyPrice }
let completing = false;

function loadSumUpSdk() {
  if (window.SumUpCard) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SUMUP_SDK_URL;
    script.onload = () => (window.SumUpCard ? resolve() : reject(new Error("SumUp niet geladen")));
    script.onerror = () => reject(new Error("SumUp niet geladen"));
    document.head.appendChild(script);
  });
}

async function openPayment(signup) {
  activeSignup = signup;
  completing = false;
  document.getElementById("paymentIntro").textContent =
    `Je betaalt nu €${formatEuro(signup.firstMonthAmount)}. Je kaart wordt veilig bij SumUp opgeslagen voor de maandelijkse afschrijving van €${formatEuro(signup.monthlyPrice)}. SumUp controleert je kaart met €1, dat bedrag krijg je direct terug.`;
  paymentStatus.textContent = "Betaalformulier laden…";
  paymentStatus.className = "text-sm mt-4 text-neutral-400";
  paymentCancelBtn.disabled = false;
  document.getElementById("sumup-card").innerHTML = "";
  paymentModal.classList.remove("hidden");

  try {
    await loadSumUpSdk();
    paymentStatus.textContent = "";
    window.SumUpCard.mount({
      id: "sumup-card",
      checkoutId: signup.checkoutId,
      locale: "nl-NL",
      onResponse: (type, body) => {
        if (type === "success") completeSignup();
        else if (type === "fail" || type === "error") {
          // The form stays usable — the customer can fix a typo or try another card right there.
          paymentStatus.textContent = "Betaling niet gelukt. Controleer je kaartgegevens of probeer een andere kaart.";
          paymentStatus.className = "text-sm mt-4 text-red-300";
          console.error("SumUp card form:", type, body);
        }
      },
    });
  } catch (error) {
    paymentStatus.textContent = "Het betaalformulier kon niet geladen worden. Controleer je internet en probeer het opnieuw.";
    paymentStatus.className = "text-sm mt-4 text-red-300";
  }
}

// Asks the backend to save the card and charge the first month. It can briefly report "pending"
// while SumUp finalises the card check, so this polls for a little while before giving up — the
// background sweep finishes it either way, so "processing" is an honest answer, not a failure.
async function completeSignup() {
  if (completing || !activeSignup) return;
  completing = true;
  paymentCancelBtn.disabled = true;
  paymentStatus.textContent = "Betaling verwerken…";
  paymentStatus.className = "text-sm mt-4 text-neutral-300";

  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const response = await fetch(`${API_BASE_URL}/api/appointments/subscriptions/${activeSignup.subscriptionId}/complete`, { method: "POST" });
      const data = await response.json();
      if (data.status === "active") return finishSignup("confirmed", data.data);
      if (data.status === "failed") return finishSignup("failed", null, data.error);
    } catch (error) {
      // Network blip — keep trying.
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  finishSignup("processing");
}

paymentCancelBtn.addEventListener("click", async () => {
  if (!activeSignup || completing) return;
  paymentCancelBtn.disabled = true;
  paymentStatus.textContent = "Annuleren…";
  try {
    const response = await fetch(`${API_BASE_URL}/api/appointments/subscriptions/${activeSignup.subscriptionId}/abandon`, { method: "POST" });
    const data = await response.json();
    // The card step had in fact just gone through — show the real outcome instead of "cancelled".
    if (data.status === "active") return completeSignup();
  } catch (error) {
    // The seat frees itself after the signup timeout anyway.
  }
  paymentModal.classList.add("hidden");
  activeSignup = null;
  state.submitting = false;
  loadTimes(state.date);
  refreshPreview();
  render();
});

function finishSignup(kind, details, error) {
  paymentModal.classList.add("hidden");
  if (kind === "confirmed") {
    const card = details.cardLast4 ? `je kaart eindigend op ${details.cardLast4}` : "je kaart";
    setReturnState(
      "confirmed",
      `Je vaste plek staat vast — ${RECURRENCE_TEXT[details.frequency] || "elke maand"} op ${weekdayName(details.startDate)} om ${details.time}. Je hebt €${formatEuro(details.firstMonthAmount)} betaald; vanaf ${dayMonth(details.nextChargeDate)} wordt elke maand €${formatEuro(details.monthlyPrice)} van ${card} afgeschreven. Je krijgt een bevestiging per e-mail.`,
    );
  } else if (kind === "failed") {
    setReturnState("failed", error || "De betaling is niet gelukt, dus je abonnement is niet gestart.");
  } else {
    setReturnState("processing", "Je betaling wordt nog verwerkt. Je ontvangt een bevestiging per e-mail zodra alles rond is — je hoeft niets opnieuw te doen.");
  }
  activeSignup = null;
  state.submitting = false;
  successModal.classList.remove("hidden");
  (retryBtn.classList.contains("hidden") ? document.getElementById("goHomeBtn") : retryBtn).focus();
}

// Pressing "back" restores this page from the browser cache — reset and refresh availability so
// nothing stale is shown.
window.addEventListener("pageshow", (event) => {
  if (!event.persisted) return;
  state.submitting = false;
  if (state.date) loadTimes(state.date);
  refreshPreview();
  render();
});

// ---------------------------------------------------------------- RESULT
const successModal = document.getElementById("successModal");
const successText = document.getElementById("successText");
const successTitle = document.getElementById("successTitle");
const successIcon = document.getElementById("successIcon");
const retryBtn = document.getElementById("retryBtn");

document.getElementById("goHomeBtn").addEventListener("click", () => {
  window.location.href = "/";
});
retryBtn.addEventListener("click", () => {
  successModal.classList.add("hidden");
  history.replaceState(null, "", window.location.pathname + (state.plan ? `?plan=${state.plan}` : ""));
  if (state.date) loadTimes(state.date);
  refreshPreview();
  render();
});

function setReturnState(kind, text) {
  const looks = {
    confirmed: { title: "Abonnement Gestart!", icon: "fa-check", color: "bg-green-500/20 text-green-400" },
    failed: { title: "Betaling Mislukt", icon: "fa-xmark", color: "bg-red-500/20 text-red-400" },
    processing: { title: "Betaling Wordt Verwerkt", icon: "fa-clock", color: "bg-yellow-500/20 text-yellow-400" },
  };
  const look = looks[kind];
  successTitle.textContent = look.title;
  successIcon.className = `w-20 h-20 rounded-full ${look.color} flex items-center justify-center mx-auto mb-6`;
  successIcon.innerHTML = `<i class="fa-solid ${look.icon} text-4xl"></i>`;
  successText.textContent = text;
  retryBtn.classList.toggle("hidden", kind !== "failed");
}

// Coming back from the pay link in a "betaling mislukt" email (?billing=paid). The backend checks
// that payment itself on its next run and emails a receipt — this just tells the customer so.
function showBillingReturnState() {
  if (new URLSearchParams(window.location.search).get("billing") !== "paid") return;
  setReturnState("processing", "Bedankt! We verwerken je betaling en sturen je een bevestiging per e-mail. Je vaste plek blijft gewoon staan.");
  successTitle.textContent = "Bedankt Voor Je Betaling";
  successModal.classList.remove("hidden");
  history.replaceState(null, "", window.location.pathname);
}

// ---------------------------------------------------------------- MOBILE MENU
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

// ---------------------------------------------------------------- INIT
window.addEventListener("DOMContentLoaded", () => {
  loadPlans();
  generateDates();
  render();
  showBillingReturnState();
});
