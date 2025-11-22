document.addEventListener("DOMContentLoaded", () => {
  const counterEl = document.getElementById("visit-count");
  if (!counterEl) return;

  const workerUrl = window.QPR_CONFIG?.WORKER_URL;
  if (!workerUrl) {
    counterEl.textContent = "N/A";
    counterEl.title = "Worker URL not configured";
    return;
  }

  fetch(`${workerUrl}/api/pageview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      counter: window.QPR_CONFIG?.PAGE_VIEW_COUNTER_KEY || "site:index",
      path: window.location.pathname,
    }),
  })
    .then((response) => {
      if (!response.ok) {
        throw new Error(`Unexpected status: ${response.status}`);
      }
      return response.json();
    })
    .then((data) => {
      if (data.disabled) {
        counterEl.textContent = "Disabled";
        counterEl.title = "Page view tracking disabled";
        return;
      }

      const total = Number(data.total);
      if (Number.isFinite(total)) {
        counterEl.textContent = total.toLocaleString();
        counterEl.title = "Total visits recorded";
      } else {
        counterEl.textContent = "—";
      }
    })
    .catch((error) => {
      console.warn("Visit counter failed:", error);
      counterEl.textContent = "—";
      counterEl.title = "Unable to load visit count";
    });
});

