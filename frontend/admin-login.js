const API_BASE_URL = "";

const loginForm = document.getElementById("loginForm");
const loginBtn = document.getElementById("loginBtn");
const errorMessage = document.getElementById("errorMessage");

// If already logged in, skip straight to the portal.
(async () => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/admin/session`);
    const data = await response.json();
    if (data.authenticated) {
      window.location.href = "admin.html";
    }
  } catch (error) {
    // Ignore — just show the login form as normal.
  }
})();

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorMessage.classList.add("hidden");
  loginBtn.disabled = true;
  loginBtn.textContent = "Bezig...";

  try {
    const response = await fetch(`${API_BASE_URL}/api/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: document.getElementById("email").value,
        password: document.getElementById("password").value,
      }),
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      throw new Error(data.error || "Inloggen mislukt.");
    }

    window.location.href = "admin.html";
  } catch (error) {
    errorMessage.textContent = error.message;
    errorMessage.classList.remove("hidden");
    loginBtn.disabled = false;
    loginBtn.textContent = "Inloggen";
  }
});
