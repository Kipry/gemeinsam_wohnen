// Code steht in der Adresse: /join/?code=ABC123
const code = (new URLSearchParams(location.search).get("code") || "")
  .toUpperCase()
  .replace(/[^A-Z0-9]/g, "")
  .slice(0, 6);

if (code.length === 6) {
  document.getElementById("code").textContent = code;
  document.getElementById("open-app").href = "gemeinsamwohnen://join?code=" + code;
  document.getElementById("code-card").hidden = false;
} else {
  document.getElementById("title").textContent = "Gemeinsam Wohnen";
  document.getElementById("lead").textContent =
    "Die App für WGs: Putzplan mit Rotation, Einkaufsliste, Kostenaufteilung, Kalender und Pinnwand.";
}

document.getElementById("copy").addEventListener("click", async (event) => {
  try {
    await navigator.clipboard.writeText(code);
    event.target.textContent = "Code kopiert";
  } catch {
    event.target.textContent = "Code: " + code;
  }
});
