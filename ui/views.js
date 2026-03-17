import { createEmptyAppData } from "../data/schema.js";
import { setupSecurity, unlockWithPIN } from "../security/auth.js";
import { getRemainingLockoutMs } from "../security/lock.js";
import {
  getCryptoMeta,
  getSecurityState,
  setRuntimeSession,
  setSecurityState,
  clearRuntimeSession,
  getRuntimeData,
  setCurrentView,
  getCurrentView,
  getCurrentContext
} from "../core/app-core.js";
import { loadEncryptedAppData } from "../storage/secure-store.js";
import { logSecurityEvent } from "../security/security-log.js";
import { queuePersistRuntimeData } from "../core/app-core.js";
import {
  createHome,
  createPatient,
  updatePatient,
  updateHomeAddress,
  createRezept,
  updateRezept,
  createRezeptEntry,
  updateRezeptEntry,
  getHomeById,
  getPatientById,
  getRezeptById,
  rezeptSummary,
  searchPatientsInHome,
  buildAbgabeRows,
  filterAbgabeRows,
  buildNachbestellRows,
  filterNachbestellRows,
  getDoctorList,
  saveAbgabeHistory,
  saveNachbestellHistory,
  buildAbgabeTree,
  buildNachbestellTree,
  createRezeptTimeEntry,
  getRezeptTimeEntries,
  getRezeptTimeSummary,
  getPendingKilometerContext,
  saveKilometerStartPoint,
  saveKnownKilometerRoute,
  getKilometerOverview,
  getKilometerPointOptions,
  addManualKilometerTravel,
  getKilometerPeriodSummary
} from "../modules/homes.js";
import { getRezeptFristInfo } from "../modules/fristen.js";
import { exportBackup, importBackup, downloadBlob, validateBackupZip } from "../modules/backup.js";
import { mutateRuntimeData } from "../core/app-core.js";

const app = document.getElementById("app");
const lockBtn = document.getElementById("lockBtn");

const collatorDE = new Intl.Collator("de", {
  sensitivity: "base",
  numeric: true
});

function sortHomesAlpha(homes) {
  return [...(homes || [])].sort((a, b) =>
    collatorDE.compare(String(a?.name || ""), String(b?.name || ""))
  );
}

function sortPatientsAlpha(patients) {
  return [...(patients || [])].sort((a, b) => {
    const aName = `${a?.lastName || ""} ${a?.firstName || ""}`.trim();
    const bName = `${b?.lastName || ""} ${b?.firstName || ""}`.trim();
    return collatorDE.compare(aName, bName);
  });
}

function sortRezepteForDisplay(rezepte) {
  return [...(rezepte || [])].sort((a, b) => {
    const aDate = String(a?.ausstell || "");
    const bDate = String(b?.ausstell || "");
    return collatorDE.compare(bDate, aDate);
  });
}

function getStatusPillClass(status) {
  if (status === "Abgegeben") return "pill-gray";
  if (status === "Abgeschlossen") return "pill-blue";
  if (status === "Pausiert") return "pill-orange";
  return "pill-green";
}

function renderRezeptMarkerLine(rezept, frist) {
  const blanko = (rezept.items || []).some((i) => i.type === "Blanko");

  const trafficClass =
    frist.traffic === "red"
      ? "pill-red"
      : frist.traffic === "orange"
        ? "pill-orange"
        : "pill-green";

  return `
    <div style="margin-bottom:8px;">
      <span class="${getStatusPillClass(rezept.status || "Aktiv")}">${escapeHtml(rezept.status || "Aktiv")}</span>
      ${rezept.bg ? `<span class="pill">BG</span>` : ""}
      ${rezept.dt ? `<span class="pill">DT</span>` : ""}
      ${blanko ? `<span class="pill">Blanko</span>` : ""}
      <span class="${trafficClass}">${escapeHtml(frist.statusText || "Frist")}</span>
    </div>
  `;
}

function formatMinutesLabel(minutes) {
  const total = Number(minutes) || 0;
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (!h) return `${m} Min.`;
  if (!m) return `${h} Std.`;
  return `${h} Std. ${m} Min.`;
}

function getTotalTrackedMinutes(data) {
  let total = 0;

  (data?.homes || []).forEach((home) => {
    (home?.patients || []).forEach((patient) => {
      (patient?.rezepte || []).forEach((rezept) => {
        (rezept?.timeEntries || []).forEach((entry) => {
          const minutes = Number(entry?.minutes || 0);
          if (Number.isFinite(minutes)) total += minutes;
        });
      });
    });
  });

  return total;
}


function getTimeTypeLabel(type) {
  if (type === "besprechung") return "Besprechung";
  if (type === "dokumentation") return "Dokumentation";
  return "Behandlung";
}

function formatKm(value) {
  const km = Number(value || 0);
  return `${km.toLocaleString("de-DE", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} km`;
}

function formatEuro(value) {
  const amount = Number(value || 0);
  return `${amount.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

function formatCurrentDateLong(date = new Date()) {
  return date.toLocaleDateString("de-DE", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  });
}

function formatCurrentDateShort(date = new Date()) {
  return date.toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  });
}

const REZEPT_ITEM_OPTIONS = ["KG", "MT", "KG-ZNS", "MLD30", "MLD45", "MLD60", "Blanko"];

function getKnownDoctorNames(data) {
  return getDoctorList(data).filter(Boolean);
}

function bindDateAutoFormat(input) {
  if (!input) return;
  input.setAttribute("inputmode", "numeric");
  input.addEventListener("input", () => {
    const digits = input.value.replace(/\D/g, "").slice(0, 8);
    let formatted = digits;
    if (digits.length > 2) formatted = `${digits.slice(0, 2)}.${digits.slice(2)}`;
    if (digits.length > 4) formatted = `${digits.slice(0, 2)}.${digits.slice(2, 4)}.${digits.slice(4)}`;
    input.value = formatted;
  });
}

function renderRezeptItemRows(items) {
  const safe = Array.isArray(items) ? items : [];
  return [0,1,2].map((idx) => {
    const item = safe[idx] || {};
    return `
      <div class="row" style="gap:12px; align-items:end;">
        <div style="flex:1; min-width:0;">
          <label for="item${idx+1}Type">Leistung ${idx+1}</label>
          <select id="item${idx+1}Type">
            <option value="">Bitte wählen</option>
            ${REZEPT_ITEM_OPTIONS.map(opt => `<option value="${escapeHtml(opt)}" ${String(item.type||'')===opt?'selected':''}>${escapeHtml(opt)}</option>`).join('')}
          </select>
        </div>
        <div style="width:120px;">
          <label for="item${idx+1}Count">Anzahl</label>
          <input id="item${idx+1}Count" type="number" inputmode="numeric" min="0" step="1" value="${escapeHtml(item.count || '')}" placeholder="z.B. 6">
        </div>
      </div>
    `;
  }).join('');
}

function collectRezeptItemsFromForm() {
  return [1,2,3].map((n) => ({
    type: document.getElementById(`item${n}Type`).value.trim(),
    count: document.getElementById(`item${n}Count`).value.trim()
  })).filter((item) => item.type);
}

function render(html) {
  app.innerHTML = html;
}

function printHtml(title, bodyHtml) {
  const win = window.open("", "_blank", "width=900,height=700");
  if (!win) {
    alert("Druckfenster konnte nicht geöffnet werden.");
    return;
  }

  win.document.write(`
    <!DOCTYPE html>
    <html lang="de">
    <head>
      <meta charset="UTF-8">
      <title>${escapeHtml(title)}</title>
      <style>
        body{
          font-family: Arial, sans-serif;
          padding: 24px;
          color:#111827;
        }
        h1{
          font-size: 22px;
          margin-bottom: 18px;
        }
        .row{
          border-bottom:1px solid #d1d5db;
          padding:10px 0;
        }
        .muted{
          color:#6b7280;
          font-size:12px;
        }
      </style>
    </head>
    <body>
      <h1>${escapeHtml(title)}</h1>
      ${bodyHtml}
    </body>
    </html>
  `);

  win.document.close();
  win.focus();
  win.print();
}

async function wipeAllAppData() {
  clearRuntimeSession();
  await new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase("fast_doku_db");
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error || new Error("Datenbank konnte nicht gelöscht werden."));
    req.onblocked = () => reject(new Error("Datenbank-Löschung ist blockiert. Bitte andere Tabs schließen."));
  });
}

export function bindLockButton(onLock) {
  lockBtn.style.display = "inline-block";
  lockBtn.onclick = onLock;
}

export function hideLockButton() {
  lockBtn.style.display = "none";
  lockBtn.onclick = null;
}

export function showSetupView({ onSuccess }) {
  hideLockButton();

  render(`
    <div class="card">
      <h2>Ersteinrichtung</h2>
      <p class="muted">FaSt-Doku wird jetzt mit Praxispasswort und Workflow-PIN abgesichert.</p>

      <label for="therapistName">Therapeutenname</label>
      <input id="therapistName" type="text" autocomplete="off">

      <label for="therapistFax">Faxnummer</label>
      <input id="therapistFax" type="tel" inputmode="numeric" autocomplete="off">

      <label for="practicePassword">Praxispasswort</label>
      <input id="practicePassword" type="password" autocomplete="new-password">

      <label for="workflowPin">Workflow-PIN (mindestens 6 Zeichen)</label>
      <input id="workflowPin" type="password" inputmode="numeric" autocomplete="new-password">

      <label for="workflowPinRepeat">Workflow-PIN wiederholen</label>
      <input id="workflowPinRepeat" type="password" inputmode="numeric" autocomplete="new-password">

      <button id="saveSetupBtn">Einrichtung abschließen</button>
      <div id="setupMessage"></div>
    </div>
  `);

  document.getElementById("saveSetupBtn").onclick = async () => {
    const therapistName = document.getElementById("therapistName").value.trim();
    const therapistFax = document.getElementById("therapistFax").value.trim();
    const password = document.getElementById("practicePassword").value;
    const pin = document.getElementById("workflowPin").value;
    const pinRepeat = document.getElementById("workflowPinRepeat").value;
    const msg = document.getElementById("setupMessage");

    msg.className = "error";
    msg.textContent = "";

    if (!password || password.length < 8) {
      msg.textContent = "Das Praxispasswort muss mindestens 8 Zeichen haben.";
      return;
    }

    if (!pin || pin.length < 6) {
      msg.textContent = "Die Workflow-PIN muss mindestens 6 Zeichen haben.";
      return;
    }

    if (pin !== pinRepeat) {
      msg.textContent = "Die Workflow-PIN stimmt nicht überein.";
      return;
    }

    try {
      const initialAppData = createEmptyAppData();
      initialAppData.settings.therapistName = therapistName;
      initialAppData.settings.therapistFax = therapistFax;

      const session = await setupSecurity({
        password,
        pin,
        initialAppData
      });

      session.runtimeData = logSecurityEvent(session.runtimeData, "setup", {
        status: "success",
        method: "password+pin",
        message: "Ersteinrichtung erfolgreich abgeschlossen"
      });

      setRuntimeSession(session);
      await queuePersistRuntimeData();
      onSuccess();
    } catch (err) {
      console.error(err);
      msg.textContent = "Einrichtung konnte nicht gespeichert werden.";
    }
  };
}

export function showLoginView({ onSuccess }) {
  hideLockButton();

  const securityState = getSecurityState();
  const remainingMs = getRemainingLockoutMs(securityState);

  render(`
    <div class="card">
      <h2>Workflow-PIN Login</h2>
      <p class="muted">Bitte PIN eingeben, um FaSt-Doku zu entsperren.</p>

      <label for="loginPin">Workflow-PIN</label>
      <input id="loginPin" type="password" inputmode="numeric" autocomplete="current-password">

      <button id="loginBtn">Entsperren</button>

      <div id="loginMessage" class="${remainingMs > 0 ? "error" : ""}">
        ${remainingMs > 0 ? `Sperre aktiv. Noch ${Math.ceil(remainingMs / 1000)} Sekunden.` : ""}
      </div>
    </div>
  `);

  document.getElementById("loginBtn").onclick = async () => {
    const pin = document.getElementById("loginPin").value;
    const msg = document.getElementById("loginMessage");

    msg.className = "error";
    msg.textContent = "";

    try {
      const cryptoMeta = getCryptoMeta();
      const currentSecurityState = getSecurityState();
      const encryptedAppData = await loadEncryptedAppData();

      const session = await unlockWithPIN({
        pin,
        cryptoMeta,
        encryptedAppData,
        securityState: currentSecurityState
      });

      session.runtimeData = logSecurityEvent(session.runtimeData, "unlock", {
        status: "success",
        method: "pin",
        message: "App erfolgreich entsperrt"
      });

      setRuntimeSession({
        ...session,
        cryptoMeta
      });

      await queuePersistRuntimeData();
      onSuccess();
    } catch (err) {
      console.error(err);

      if (err.securityState) {
        setSecurityState(err.securityState);
      }

      if (err.code === "LOCKED_OUT") {
        msg.textContent = "Sperre aktiv. Bitte warten.";
        return;
      }

      if (err.code === "INVALID_PIN") {
        const remaining = getRemainingLockoutMs(err.securityState);
        msg.textContent = remaining > 0
          ? `PIN falsch. Sperre aktiv für ${Math.ceil(remaining / 1000)} Sekunden.`
          : "PIN ist falsch.";
        return;
      }

      msg.textContent = "Login fehlgeschlagen.";
    }
  };
}

export function showDashboardView({ onLock }) {
  bindLockButton(onLock);
  setCurrentView("dashboard");

  const runtimeData = getRuntimeData();
  const homes = runtimeData?.homes || [];
  const therapistName = runtimeData?.settings?.therapistName || "—";
  const lastBackupAt = runtimeData?.ui?.lastBackupAt || "";
  const totalTrackedMinutes = getTotalTrackedMinutes(runtimeData);

  render(`
    <div class="card">
      <h2>Dashboard</h2>
      <p class="muted">${escapeHtml(formatCurrentDateLong())}</p>
      <p>Willkommen, ${escapeHtml(therapistName)}.</p>
    </div>

    <details class="accordion">
      <summary>
        <span>Überblick</span>
        <span class="muted">Heime & Stunden</span>
      </summary>
      <div class="accordion-body">
        <div class="row">
          <div class="compact-card">
            <div style="font-weight:700;">Heime</div>
            <div class="compact-meta">${homes.length}</div>
          </div>
          <div class="compact-card">
            <div style="font-weight:700;">Stunden</div>
            <div class="compact-meta">${escapeHtml(formatMinutesLabel(totalTrackedMinutes))}</div>
          </div>
        </div>
      </div>
    </details>

    <div class="card">
      <h3>Bereiche</h3>
      <div class="row">
        <button id="openHomesBtn">Einrichtungen</button>
        <button id="openAbgabeBtn" class="secondary">Abgabeliste</button>
      </div>
      <div class="row">
        <button id="openNachbestellBtn" class="secondary">Nachbestellung</button>
        <button id="openKilometerBtn" class="secondary">Kilometer</button>
      </div>
      <div class="row">
        <button id="lockNowBtn" class="secondary">Jetzt sperren</button>
      </div>
    </div>

    <details class="accordion">
      <summary>
        <span>Backup</span>
        <span class="muted">Export / Import</span>
      </summary>
      <div class="accordion-body">
        <p class="muted">Lokales ZIP-Backup für Export, Import und spätere Viewer-Kompatibilität.</p>
        <div class="row">
          <button id="exportBackupBtn">Backup exportieren</button>
          <button id="importBackupBtn" class="secondary">Backup importieren</button>
        </div>
        <input id="backupImportInput" type="file" accept=".zip" style="display:none;">
        <div id="backupMsg" class="muted" style="margin-top:12px;">${escapeHtml(lastBackupAt ? `Letztes Backup: ${lastBackupAt}` : "Noch kein Backup exportiert.")}</div>
      </div>
    </details>

    <details class="accordion">
      <summary>
        <span>App zurücksetzen</span>
        <span class="muted">Alle Daten löschen</span>
      </summary>
      <div class="accordion-body">
        <p class="muted">Löscht alle Daten, Passwörter und Einstellungen und startet die App neu.</p>
        <button id="resetAppBtn" class="danger">Alles löschen und neu starten</button>
        <div id="resetMsg"></div>
      </div>
    </details>
  `);

  document.getElementById("openHomesBtn").onclick = () => showHomesView({ onLock });
  document.getElementById("openAbgabeBtn").onclick = () => showAbgabeView({ onLock });
  document.getElementById("openNachbestellBtn").onclick = () => showNachbestellungView({ onLock });
  document.getElementById("openKilometerBtn").onclick = () => showKilometerView({ onLock });
  document.getElementById("lockNowBtn").onclick = onLock;

  document.getElementById("exportBackupBtn").onclick = async () => {
    const msg = document.getElementById("backupMsg");
    msg.className = "muted";
    msg.textContent = "Backup wird erstellt...";

    try {
      const now = new Date().toISOString();
      mutateRuntimeData((data) => {
        data.exportTimestamp = now;
        data.ui.lastBackupAt = now;
        (data.homes || []).forEach((home) => {
          (home.patients || []).forEach((patient) => {
            (patient.rezepte || []).forEach((rezept) => {
              if (!rezept.exportMeta || typeof rezept.exportMeta !== "object") {
                rezept.exportMeta = { exportReady: true, viewerLabel: "", lastExportAt: "" };
              }
              rezept.exportMeta.lastExportAt = now;
            });
          });
        });
      });
      await queuePersistRuntimeData();

      const result = await exportBackup(getRuntimeData());
      downloadBlob(result.blob, result.filename);
      msg.className = "success";
      msg.textContent = `Backup exportiert: ${result.filename}`;
    } catch (err) {
      console.error(err);
      msg.className = "error";
      msg.textContent = `Backup-Export fehlgeschlagen: ${err.message || err}`;
    }
  };

  document.getElementById("importBackupBtn").onclick = () => {
    document.getElementById("backupImportInput").click();
  };

  document.getElementById("backupImportInput").onchange = async (event) => {
    const file = event.target.files?.[0];
    const msg = document.getElementById("backupMsg");
    if (!file) return;

    msg.className = "muted";
    msg.textContent = "Backup wird geprüft...";

    try {
      const preview = await validateBackupZip(file);
      msg.className = "muted";
      msg.textContent = `Backup geprüft: ${preview.meta?.therapistName || "FaSt-Doku"} · Export ${preview.meta?.exportTimestamp || ""}`;

      const result = await importBackup(file);
      clearRuntimeSession();
      msg.className = "success";
      msg.textContent = `Backup importiert: ${result.meta?.therapistName || "FaSt-Doku"}`;
      setTimeout(() => {
        window.location.reload();
      }, 600);
    } catch (err) {
      console.error(err);
      msg.className = "error";
      msg.textContent = `Backup-Import fehlgeschlagen: ${err.message || err}`;
    } finally {
      event.target.value = "";
    }
  };

  document.getElementById("resetAppBtn").onclick = async () => {
    const msg = document.getElementById("resetMsg");
    msg.className = "error";
    msg.textContent = "";

    const confirmed = window.confirm("Wirklich alle Daten löschen? Dieser Vorgang kann nicht rückgängig gemacht werden.");
    if (!confirmed) return;

    try {
      await wipeAllAppData();
      window.location.reload();
    } catch (err) {
      console.error(err);
      msg.textContent = err?.message || "Daten konnten nicht gelöscht werden.";
    }
  };
}

export function showHomesView({ onLock, searchText = "" }) {
  bindLockButton(onLock);
  setCurrentView("homes", { searchText });

  const runtimeData = getRuntimeData();
  const homes = sortHomesAlpha(runtimeData?.homes || []);

  render(`
    <div class="card">
      <h2>Einrichtungen</h2>
      <button id="backDashboardBtn" class="secondary">Zurück zum Dashboard</button>
    </div>

    <div class="card">
      <h3>Heimübersicht</h3>

      <div class="list-stack">
        ${homes.length === 0 ? `<p class="muted">Noch keine Einrichtungen vorhanden.</p>` : ""}
        ${homes.map(home => `
          <div class="compact-card home-open-card" data-home-id="${home.homeId}" style="cursor:pointer;">
            <div class="row" style="align-items:center; justify-content:space-between; gap:8px;">
              <div style="flex:1; min-width:0;">
                <div style="font-weight:700;">${escapeHtml(home.name || "Ohne Name")}</div>
                <div class="compact-meta">${escapeHtml(home.adresse || "Keine Adresse")}</div>
                <div class="compact-meta">${home.patients?.length || 0} Patient(en)</div>
              </div>
              <button class="secondary editHomeToggleBtn" data-home-id="${home.homeId}" title="Heim bearbeiten" aria-label="Heim bearbeiten" style="width:auto; padding:8px 10px;">✎</button>
            </div>
            <div class="edit-home-panel" id="edit-home-panel-${home.homeId}" style="display:none; margin-top:12px;">
              <label for="edit-home-name-${home.homeId}">Heimname</label>
              <input id="edit-home-name-${home.homeId}" type="text" value="${escapeHtml(home.name || "")}">

              <label for="edit-home-address-${home.homeId}">Heimadresse</label>
              <input id="edit-home-address-${home.homeId}" type="text" value="${escapeHtml(home.adresse || "")}">

              <div class="row">
                <button class="saveHomeEditBtn" data-home-id="${home.homeId}">Speichern</button>
              </div>
              <div id="home-edit-msg-${home.homeId}"></div>
            </div>
          </div>
        `).join("")}
      </div>

      <details class="accordion" style="margin-top:12px;">
        <summary>
          <span>Neues Heim anlegen</span>
          <span class="muted">Name + Adresse</span>
        </summary>
        <div class="accordion-body">
          <label for="homeName">Name</label>
          <input id="homeName" type="text">

          <label for="homeAddress">Adresse</label>
          <input id="homeAddress" type="text">

          <button id="createHomeBtn">Heim speichern</button>
          <div id="homeMsg"></div>
        </div>
      </details>
    </div>
  `);

  document.getElementById("backDashboardBtn").onclick = () => {
    showDashboardView({ onLock });
  };

  document.getElementById("createHomeBtn").onclick = async () => {
    const name = document.getElementById("homeName").value.trim();
    const adresse = document.getElementById("homeAddress").value.trim();
    const msg = document.getElementById("homeMsg");

    msg.className = "error";
    msg.textContent = "";

    if (!name) {
      msg.textContent = "Bitte einen Heimnamen eingeben.";
      return;
    }

    try {
      createHome({ name, adresse });
      await queuePersistRuntimeData();
      showHomesView({ onLock });
    } catch (err) {
      console.error(err);
      msg.textContent = "Heim konnte nicht gespeichert werden.";
    }
  };

  document.querySelectorAll(".home-open-card").forEach((card) => {
    card.onclick = (event) => {
      if (event.target.closest(".editHomeToggleBtn") || event.target.closest(".saveHomeEditBtn") || event.target.closest(".edit-home-panel")) {
        return;
      }
      showHomeDetailView({ onLock, homeId: card.dataset.homeId });
    };
  });

  document.querySelectorAll(".editHomeToggleBtn").forEach((btn) => {
    btn.onclick = (event) => {
      event.stopPropagation();
      const panel = document.getElementById(`edit-home-panel-${btn.dataset.homeId}`);
      if (panel) {
        panel.style.display = panel.style.display === "none" ? "block" : "none";
      }
    };
  });

  document.querySelectorAll(".saveHomeEditBtn").forEach((btn) => {
    btn.onclick = async (event) => {
      event.stopPropagation();
      const homeId = btn.dataset.homeId;
      const name = document.getElementById(`edit-home-name-${homeId}`).value.trim();
      const adresse = document.getElementById(`edit-home-address-${homeId}`).value.trim();
      const msg = document.getElementById(`home-edit-msg-${homeId}`);

      msg.className = "error";
      msg.textContent = "";

      if (!name) {
        msg.textContent = "Bitte einen Heimnamen eingeben.";
        return;
      }

      try {
        mutateRuntimeData((data) => {
          const home = getHomeById(data, homeId);
          if (!home) throw new Error("Heim nicht gefunden");
          home.name = name;
          home.adresse = adresse;
        });
        await queuePersistRuntimeData();
        showHomesView({ onLock });
      } catch (err) {
        console.error(err);
        msg.textContent = "Heim konnte nicht aktualisiert werden.";
      }
    };
  });
}

export function showHomeDetailView({ onLock, homeId, searchText = "" }) {
  bindLockButton(onLock);
  setCurrentView("home-detail", { homeId, searchText });

  const runtimeData = getRuntimeData();
  const home = getHomeById(runtimeData, homeId);

  if (!home) {
    showHomesView({ onLock });
    return;
  }

  const filteredPatients = sortPatientsAlpha(searchPatientsInHome(home, searchText));

  render(`
    <div class="card">
      <h2>${escapeHtml(home.name || "Einrichtung")}</h2>
      <p class="muted">${escapeHtml(home.adresse || "Keine Adresse")}</p>
      <button id="backHomesBtn" class="secondary">Zurück zu Einrichtungen</button>
    </div>

    <div class="card">
      <h3>Patientenübersicht</h3>

      <details class="accordion">
        <summary>
          <span>Suche und Patient anlegen</span>
          <span class="muted">Suche + neuer Patient</span>
        </summary>
        <div class="accordion-body">
          <label for="patientSearch">Suche nach Name oder Geburtsdatum</label>
          <input id="patientSearch" type="text" value="${escapeHtml(searchText)}" placeholder="z.B. Müller oder 01.01.1950">

          <div class="row">
            <button id="runPatientSearchBtn" class="secondary">Suchen</button>
            <button id="clearPatientSearchBtn" class="secondary">Suche löschen</button>
          </div>

          <label for="firstName">Vorname</label>
          <input id="firstName" type="text">

          <label for="lastName">Nachname</label>
          <input id="lastName" type="text">

          <label for="birthDate">Geburtsdatum</label>
          <input id="birthDate" type="text" placeholder="DD.MM.YYYY" inputmode="numeric">

          <div class="row">
            <label><input id="befreit" type="checkbox" style="width:auto;"> Befreit</label>
            <label><input id="hb" type="checkbox" style="width:auto;"> Hausbesuch</label>
            <label><input id="verstorben" type="checkbox" style="width:auto;"> Verstorben</label>
          </div>

          <button id="createPatientBtn">Patient speichern</button>
          <div id="patientMsg"></div>
        </div>
      </details>

      <div class="list-stack" style="margin-top:12px;">
        ${filteredPatients.length === 0 ? `<p class="muted">Keine passenden Patienten gefunden.</p>` : ""}
        ${filteredPatients.map(patient => {
          const rezepte = sortRezepteForDisplay(patient.rezepte || []);
          return `
            <details class="accordion">
              <summary>
                <span>${escapeHtml(`${patient.lastName || ""}, ${patient.firstName || ""}`.replace(/^,\s*/, "").trim() || "Ohne Namen")}</span>
                <span class="muted">${rezepte.length} Rezept(e)</span>
              </summary>
              <div class="accordion-body">
                <div style="margin-bottom:10px;">
                  ${patient.befreit ? `<span class="pill">Befreit</span>` : ""}
                  ${patient.hb ? `<span class="pill">HB</span>` : ""}
                  ${patient.verstorben ? `<span class="pill-red">Verstorben</span>` : ""}
                </div>

                <div class="row" style="margin-bottom:10px;">
                  <button class="patientSectionBtn secondary" data-target="patient-rezepte-${patient.patientId}">Rezept</button>
                  <button class="patientSectionBtn secondary" data-target="patient-stammdaten-${patient.patientId}">Stammdaten</button>
                </div>
                <div class="row" style="margin-bottom:12px;">
                  <button class="patientSectionBtn secondary" data-target="patient-schnelldoku-${patient.patientId}">SchnellDoku</button>
                </div>

                <div id="patient-rezepte-${patient.patientId}" class="patient-inline-section" style="display:none; margin-bottom:12px;">
                  <div class="row" style="margin-bottom:10px;">
                    <button class="createRezeptInlineBtn" data-patient-id="${patient.patientId}">Neues Rezept anlegen</button>
                  </div>

                  ${rezepte.length === 0 ? `<p class="muted">Noch keine Rezepte vorhanden.</p>` : `
                    <div class="list-stack">
                      ${rezepte.map(rezept => {
                        const frist = getRezeptFristInfo(rezept);
                        return `
                          <details class="accordion" style="margin-bottom:8px;">
                            <summary>
                              <span>${escapeHtml(rezeptSummary(rezept))}</span>
                              <span class="muted">${escapeHtml(formatMinutesLabel(getRezeptTimeSummary(rezept).totalMinutes))}</span>
                            </summary>
                            <div class="accordion-body">
                              ${renderRezeptMarkerLine(rezept, frist)}
                              <div class="compact-meta">
                                Arzt: ${escapeHtml(rezept.arzt || "—")}<br>
                                Ausstellung: ${escapeHtml(rezept.ausstell || "—")}<br>
                                Hinweis: ${escapeHtml(frist.detailsText || "—")}<br>
                                Doku-Einträge: ${rezept.entries?.length || 0}<br>
                                Zeit gesamt: ${escapeHtml(formatMinutesLabel(getRezeptTimeSummary(rezept).totalMinutes))}
                              </div>
                              <div class="row" style="margin-top:10px;">
                                <button class="openRezeptBtn" data-patient-id="${patient.patientId}" data-rezept-id="${rezept.rezeptId}">Dokumentieren</button>
                                <button class="editRezeptBtn secondary" data-patient-id="${patient.patientId}" data-rezept-id="${rezept.rezeptId}">Bearbeiten</button>
                              </div>
                            </div>
                          </details>
                        `;
                      }).join("")}
                    </div>
                  `}
                </div>

                <div id="patient-schnelldoku-${patient.patientId}" class="patient-inline-section" style="display:none; margin-bottom:12px;">
                  <div class="compact-meta" style="margin-bottom:10px;">Datum wird automatisch gesetzt: ${escapeHtml(formatCurrentDateShort())}</div>
                  ${rezepte.length === 0 ? `<p class="muted">Keine Rezepte für SchnellDoku vorhanden.</p>` : rezepte.length === 1 ? `
                    <div class="compact-card" style="margin-bottom:10px;">
                      <div style="font-weight:600; margin-bottom:6px;">Zielrezept</div>
                      <div class="compact-meta">${escapeHtml(rezeptSummary(rezepte[0]))}</div>
                    </div>
                  ` : `
                    <div class="compact-card" style="margin-bottom:10px;">
                      <div style="font-weight:600; margin-bottom:6px;">Rezept auswählen</div>
                      <div class="list-stack">
                        ${rezepte.map(rezept => `
                          <label style="display:flex; gap:10px; align-items:flex-start; font-weight:normal;">
                            <input class="quickDocRezeptCheck" type="checkbox" data-patient-id="${patient.patientId}" data-rezept-id="${rezept.rezeptId}" style="width:auto; margin-top:3px;">
                            <span>
                              <strong>${escapeHtml(rezeptSummary(rezept))}</strong><br>
                              <span class="muted">Arzt: ${escapeHtml(rezept.arzt || "—")}</span>
                            </span>
                          </label>
                        `).join("")}
                      </div>
                    </div>
                  `}

                  <label for="quickDocText-${patient.patientId}">Dokumentation</label>
                  <div class="compact-card" style="margin-bottom:10px; padding:14px;">
                    <textarea id="quickDocText-${patient.patientId}" rows="4" placeholder="Dokumentation direkt zum Rezept speichern" style="width:100%; border:none; outline:none; resize:vertical; background:transparent; font:inherit; color:inherit; min-height:96px;"></textarea>
                  </div>
                  <button class="saveQuickDocBtn" data-patient-id="${patient.patientId}" ${rezepte.length===0?'disabled':''}>SchnellDoku speichern</button>
                  <div id="quickDocMsg-${patient.patientId}"></div>
                </div>

                <div id="patient-stammdaten-${patient.patientId}" class="patient-inline-section" style="display:none;">
                  <label for="edit-firstName-${patient.patientId}">Vorname</label>
                  <input id="edit-firstName-${patient.patientId}" type="text" value="${escapeHtml(patient.firstName || "")}">

                  <label for="edit-lastName-${patient.patientId}">Nachname</label>
                  <input id="edit-lastName-${patient.patientId}" type="text" value="${escapeHtml(patient.lastName || "")}">

                  <label for="edit-birthDate-${patient.patientId}">Geburtsdatum</label>
                  <input id="edit-birthDate-${patient.patientId}" type="text" value="${escapeHtml(patient.birthDate || "")}" inputmode="numeric" placeholder="DD.MM.YYYY">

                  <div class="row">
                    <label><input id="edit-befreit-${patient.patientId}" type="checkbox" style="width:auto;" ${patient.befreit ? "checked" : ""}> Befreit</label>
                    <label><input id="edit-hb-${patient.patientId}" type="checkbox" style="width:auto;" ${patient.hb ? "checked" : ""}> Hausbesuch</label>
                    <label><input id="edit-verstorben-${patient.patientId}" type="checkbox" style="width:auto;" ${patient.verstorben ? "checked" : ""}> Verstorben</label>
                  </div>

                  <button class="savePatientDataBtn" data-patient-id="${patient.patientId}">Stammdaten speichern</button>
                  <div id="patient-edit-msg-${patient.patientId}"></div>
                </div>
              </div>
            </details>
          `;
        }).join("")}
      </div>
    </div>
  `);

  document.getElementById("backHomesBtn").onclick = () => showHomesView({ onLock });

  document.getElementById("runPatientSearchBtn").onclick = () => {
    const value = document.getElementById("patientSearch").value;
    showHomeDetailView({ onLock, homeId, searchText: value });
  };

  document.getElementById("clearPatientSearchBtn").onclick = () => {
    showHomeDetailView({ onLock, homeId, searchText: "" });
  };

  bindDateAutoFormat(document.getElementById("birthDate"));
  document.querySelectorAll('[id^="edit-birthDate-"]').forEach((el) => bindDateAutoFormat(el));

  document.getElementById("createPatientBtn").onclick = async () => {
    const firstName = document.getElementById("firstName").value.trim();
    const lastName = document.getElementById("lastName").value.trim();
    const birthDate = document.getElementById("birthDate").value.trim();
    const befreit = document.getElementById("befreit").checked;
    const hb = document.getElementById("hb").checked;
    const verstorben = document.getElementById("verstorben").checked;
    const msg = document.getElementById("patientMsg");

    msg.className = "error";
    msg.textContent = "";

    if (!firstName && !lastName) {
      msg.textContent = "Bitte mindestens einen Namen eingeben.";
      return;
    }

    try {
      createPatient(homeId, {
        firstName,
        lastName,
        birthDate,
        befreit,
        hb,
        verstorben
      });
      await queuePersistRuntimeData();
      showHomeDetailView({ onLock, homeId, searchText });
    } catch (err) {
      console.error(err);
      msg.textContent = "Patient konnte nicht gespeichert werden.";
    }
  };

  document.querySelectorAll('.patientSectionBtn').forEach((btn) => {
    btn.onclick = () => {
      const body = btn.closest('.accordion-body');
      body.querySelectorAll('.patient-inline-section').forEach((section) => {
        section.style.display = 'none';
      });
      const target = document.getElementById(btn.dataset.target);
      if (target) target.style.display = 'block';
    };
  });

  document.querySelectorAll('.createRezeptInlineBtn').forEach((btn) => {
    btn.onclick = () => {
      showCreateRezeptView({ onLock, homeId, patientId: btn.dataset.patientId });
    };
  });

  document.querySelectorAll('.openRezeptBtn').forEach((btn) => {
    btn.onclick = () => {
      showRezeptDetailView({
        onLock,
        homeId,
        patientId: btn.dataset.patientId,
        rezeptId: btn.dataset.rezeptId
      });
    };
  });

  document.querySelectorAll('.editRezeptBtn').forEach((btn) => {
    btn.onclick = () => {
      showEditRezeptView({
        onLock,
        homeId,
        patientId: btn.dataset.patientId,
        rezeptId: btn.dataset.rezeptId
      });
    };
  });

  document.querySelectorAll('.quickDocRezeptCheck').forEach((check) => {
    check.addEventListener('change', () => {
      if (!check.checked) return;
      const patientId = check.dataset.patientId;
      document.querySelectorAll(`.quickDocRezeptCheck[data-patient-id="${patientId}"]`).forEach((other) => {
        if (other !== check) other.checked = false;
      });
    });
  });

  document.querySelectorAll('.saveQuickDocBtn').forEach((btn) => {
    btn.onclick = async () => {
      const patientId = btn.dataset.patientId;
      const patient = getPatientById(home, patientId);
      const rezepte = sortRezepteForDisplay(patient?.rezepte || []);
      const msg = document.getElementById(`quickDocMsg-${patientId}`);
      const text = document.getElementById(`quickDocText-${patientId}`).value.trim();

      msg.className = 'error';
      msg.textContent = '';

      if (!text) {
        msg.textContent = 'Bitte einen Dokumentationstext eingeben.';
        return;
      }

      let targetRezeptId = '';
      if (rezepte.length === 1) {
        targetRezeptId = rezepte[0].rezeptId;
      } else {
        const checked = document.querySelector(`.quickDocRezeptCheck[data-patient-id="${patientId}"]:checked`);
        if (!checked) {
          msg.textContent = 'Bitte genau ein Rezept auswählen.';
          return;
        }
        targetRezeptId = checked.dataset.rezeptId;
      }

      try {
        createRezeptEntry(homeId, patientId, targetRezeptId, {
          date: formatCurrentDateShort(),
          text
        });
        await queuePersistRuntimeData();
        showHomeDetailView({ onLock, homeId, searchText });
      } catch (err) {
        console.error(err);
        msg.textContent = 'SchnellDoku konnte nicht gespeichert werden.';
      }
    };
  });

  document.querySelectorAll('.savePatientDataBtn').forEach((btn) => {
    btn.onclick = async () => {
      const patientId = btn.dataset.patientId;
      const msg = document.getElementById(`patient-edit-msg-${patientId}`);
      msg.className = 'error';
      msg.textContent = '';

      try {
        updatePatient(homeId, patientId, {
          firstName: document.getElementById(`edit-firstName-${patientId}`).value.trim(),
          lastName: document.getElementById(`edit-lastName-${patientId}`).value.trim(),
          birthDate: document.getElementById(`edit-birthDate-${patientId}`).value.trim(),
          befreit: document.getElementById(`edit-befreit-${patientId}`).checked,
          hb: document.getElementById(`edit-hb-${patientId}`).checked,
          verstorben: document.getElementById(`edit-verstorben-${patientId}`).checked
        });
        await queuePersistRuntimeData();
        showHomeDetailView({ onLock, homeId, searchText });
      } catch (err) {
        console.error(err);
        msg.textContent = 'Stammdaten konnten nicht gespeichert werden.';
      }
    };
  });
}

export function showPatientDetailView({ onLock, homeId, patientId }) {
  bindLockButton(onLock);
  setCurrentView("patient-detail", { homeId, patientId });

  const runtimeData = getRuntimeData();
  const home = getHomeById(runtimeData, homeId);
  const patient = getPatientById(home, patientId);

  if (!home || !patient) {
    showHomeDetailView({ onLock, homeId });
    return;
  }

  const rezepte = sortRezepteForDisplay(patient.rezepte || []);

  render(`
    <div class="card">
      <h2>${escapeHtml(`${patient.firstName} ${patient.lastName}`.trim() || "Patient")}</h2>
      <p class="muted">Heim: ${escapeHtml(home.name || "—")}</p>
      <button id="backHomeDetailBtn" class="secondary">Zurück zum Heim</button>
    </div>

    <div class="card">
      <h3>Rezepte</h3>
      <button id="openCreateRezeptBtn">Neues Rezept anlegen</button>

      <div class="list-stack" style="margin-top:14px;">
        ${rezepte.length === 0 ? `<p class="muted">Noch keine Rezepte vorhanden.</p>` : ""}
        ${rezepte.map(rezept => {
          const frist = getRezeptFristInfo(rezept);
          return `
            <details class="accordion">
              <summary>
                <span>${escapeHtml(rezeptSummary(rezept))}</span>
                <span class="muted">${escapeHtml(formatMinutesLabel(getRezeptTimeSummary(rezept).totalMinutes))}</span>
              </summary>
              <div class="accordion-body">
                ${renderRezeptMarkerLine(rezept, frist)}
                <div class="compact-meta">
                  Arzt: ${escapeHtml(rezept.arzt || "—")}<br>
                  Ausstellung: ${escapeHtml(rezept.ausstell || "—")}<br>
                  Hinweis: ${escapeHtml(frist.detailsText || "—")}<br>
                  Doku-Einträge: ${rezept.entries?.length || 0}<br>
                  Zeit gesamt: ${escapeHtml(formatMinutesLabel(getRezeptTimeSummary(rezept).totalMinutes))}
                </div>
                <div class="row" style="margin-top:10px;">
                  <button class="openRezeptBtn" data-rezept-id="${rezept.rezeptId}">Rezept öffnen</button>
                  <button class="editRezeptBtn secondary" data-rezept-id="${rezept.rezeptId}">Bearbeiten</button>
                </div>
              </div>
            </details>
          `;
        }).join("")}
      </div>
    </div>

    <details class="accordion">
      <summary>
        <span>Stammdaten</span>
        <span class="muted">anzeigen</span>
      </summary>
      <div class="accordion-body">
        <p><strong>Vorname:</strong> ${escapeHtml(patient.firstName || "—")}</p>
        <p><strong>Nachname:</strong> ${escapeHtml(patient.lastName || "—")}</p>
        <p><strong>Geburtsdatum:</strong> ${escapeHtml(patient.birthDate || "—")}</p>
        <p><strong>Befreit:</strong> ${patient.befreit ? "Ja" : "Nein"}</p>
        <p><strong>Hausbesuch:</strong> ${patient.hb ? "Ja" : "Nein"}</p>
        <p><strong>Verstorben:</strong> ${patient.verstorben ? "Ja" : "Nein"}</p>
      </div>
    </details>
  `);

  document.getElementById("backHomeDetailBtn").onclick = () => {
    showHomeDetailView({ onLock, homeId });
  };

  document.getElementById("openCreateRezeptBtn").onclick = () => {
    showCreateRezeptView({ onLock, homeId, patientId });
  };

  document.querySelectorAll(".openRezeptBtn").forEach((btn) => {
    btn.onclick = () => {
      showRezeptDetailView({
        onLock,
        homeId,
        patientId,
        rezeptId: btn.dataset.rezeptId
      });
    };
  });

  document.querySelectorAll(".editRezeptBtn").forEach((btn) => {
    btn.onclick = () => {
      showEditRezeptView({
        onLock,
        homeId,
        patientId,
        rezeptId: btn.dataset.rezeptId
      });
    };
  });
}

export function showCreateRezeptView({ onLock, homeId, patientId }) {
  bindLockButton(onLock);
  setCurrentView("rezept-create", { homeId, patientId });

  render(`
    <div class="card">
      <h2>Neues Rezept</h2>
      <button id="backPatientBtn" class="secondary">Zurück zum Patienten</button>
    </div>

    <div class="card">
      <label for="arzt">Arzt</label>
      <input id="arzt" type="text" list="doctorSuggestions" autocomplete="off">
      <datalist id="doctorSuggestions">
        ${getKnownDoctorNames(getRuntimeData()).map((name) => `<option value="${escapeHtml(name)}"></option>`).join("")}
      </datalist>

      <label for="ausstell">Ausstellungsdatum</label>
      <input id="ausstell" type="text" placeholder="DD.MM.YYYY" inputmode="numeric">

      <label for="status">Status</label>
      <select id="status">
        <option value="Aktiv" selected>Aktiv</option>
        <option value="Pausiert">Pausiert</option>
        <option value="Abgeschlossen">Abgeschlossen</option>
        <option value="Abgegeben">Abgegeben</option>
      </select>

      <div class="row">
        <label><input id="bg" type="checkbox" style="width:auto;"> BG</label>
        <label><input id="dt" type="checkbox" style="width:auto;"> Doppeltermin</label>
      </div>

      <h3 style="margin-top:20px;">Leistungen</h3>
      ${renderRezeptItemRows([])}

      <button id="saveRezeptBtn">Rezept speichern</button>
      <div id="rezeptMsg"></div>
    </div>
  `);

  document.getElementById("backPatientBtn").onclick = () => {
    showPatientDetailView({ onLock, homeId, patientId });
  };

  bindDateAutoFormat(document.getElementById("ausstell"));

  document.getElementById("saveRezeptBtn").onclick = async () => {
    const msg = document.getElementById("rezeptMsg");
    msg.className = "error";
    msg.textContent = "";

    const items = collectRezeptItemsFromForm();

    if (items.length === 0) {
      msg.textContent = "Bitte mindestens eine Leistung angeben.";
      return;
    }

    try {
      createRezept(homeId, patientId, {
        arzt: document.getElementById("arzt").value.trim(),
        ausstell: document.getElementById("ausstell").value.trim(),
        status: document.getElementById("status").value || "Aktiv",
        bg: document.getElementById("bg").checked,
        dt: document.getElementById("dt").checked,
        items
      });

      await queuePersistRuntimeData();
      showPatientDetailView({ onLock, homeId, patientId });
    } catch (err) {
      console.error(err);
      msg.textContent = "Rezept konnte nicht gespeichert werden.";
    }
  };
}

export function showEditRezeptView({ onLock, homeId, patientId, rezeptId }) {
  bindLockButton(onLock);
  setCurrentView("rezept-edit", { homeId, patientId, rezeptId });

  const runtimeData = getRuntimeData();
  const home = getHomeById(runtimeData, homeId);
  const patient = getPatientById(home, patientId);
  const rezept = getRezeptById(patient, rezeptId);

  if (!home || !patient || !rezept) {
    showPatientDetailView({ onLock, homeId, patientId });
    return;
  }

  const items = rezept.items || [];

  render(`
    <div class="card">
      <h2>Rezept bearbeiten</h2>
      <button id="backPatientBtn" class="secondary">Zurück zum Patienten</button>
    </div>

    <div class="card">
      <label for="arzt">Arzt</label>
      <input id="arzt" type="text" list="doctorSuggestions" autocomplete="off" value="${escapeHtml(rezept.arzt || "")}">
      <datalist id="doctorSuggestions">
        ${getKnownDoctorNames(getRuntimeData()).map((name) => `<option value="${escapeHtml(name)}"></option>`).join("")}
      </datalist>

      <label for="ausstell">Ausstellungsdatum</label>
      <input id="ausstell" type="text" inputmode="numeric" value="${escapeHtml(rezept.ausstell || "")}">

      <label for="status">Status</label>
      <select id="status">
        <option value="Aktiv" ${rezept.status === "Aktiv" ? "selected" : ""}>Aktiv</option>
        <option value="Pausiert" ${rezept.status === "Pausiert" ? "selected" : ""}>Pausiert</option>
        <option value="Abgeschlossen" ${rezept.status === "Abgeschlossen" ? "selected" : ""}>Abgeschlossen</option>
        <option value="Abgegeben" ${rezept.status === "Abgegeben" ? "selected" : ""}>Abgegeben</option>
      </select>

      <div class="row">
        <label><input id="bg" type="checkbox" style="width:auto;" ${rezept.bg ? "checked" : ""}> BG</label>
        <label><input id="dt" type="checkbox" style="width:auto;" ${rezept.dt ? "checked" : ""}> Doppeltermin</label>
      </div>

      <h3 style="margin-top:20px;">Leistungen</h3>
      ${renderRezeptItemRows(items)}

      <button id="updateRezeptBtn">Änderungen speichern</button>
      <div id="rezeptMsg"></div>
    </div>
  `);

  document.getElementById("backPatientBtn").onclick = () => {
    showPatientDetailView({ onLock, homeId, patientId });
  };

  bindDateAutoFormat(document.getElementById("ausstell"));

  document.getElementById("updateRezeptBtn").onclick = async () => {
    const msg = document.getElementById("rezeptMsg");
    msg.className = "error";
    msg.textContent = "";

    const nextItems = collectRezeptItemsFromForm().map((item, idx) => ({
      itemId: rezept.items?.[idx]?.itemId,
      ...item
    }));

    if (nextItems.length === 0) {
      msg.textContent = "Bitte mindestens eine Leistung angeben.";
      return;
    }

    try {
      updateRezept(homeId, patientId, rezeptId, {
        arzt: document.getElementById("arzt").value.trim(),
        ausstell: document.getElementById("ausstell").value.trim(),
        status: document.getElementById("status").value || "Aktiv",
        bg: document.getElementById("bg").checked,
        dt: document.getElementById("dt").checked,
        items: nextItems
      });

      await queuePersistRuntimeData();
      showPatientDetailView({ onLock, homeId, patientId });
    } catch (err) {
      console.error(err);
      msg.textContent = "Rezept konnte nicht aktualisiert werden.";
    }
  };
}

export function showRezeptDetailView({ onLock, homeId, patientId, rezeptId }) {
  bindLockButton(onLock);
  setCurrentView("rezept-detail", { homeId, patientId, rezeptId });

  const runtimeData = getRuntimeData();
  const home = getHomeById(runtimeData, homeId);
  const patient = getPatientById(home, patientId);
  const rezept = getRezeptById(patient, rezeptId);

  if (!home || !patient || !rezept) {
    showPatientDetailView({ onLock, homeId, patientId });
    return;
  }

  const frist = getRezeptFristInfo(rezept);
  const timeEntries = getRezeptTimeEntries(rezept);
  const timeSummary = getRezeptTimeSummary(rezept);

  render(`
    <div class="card">
      <h2>Rezept</h2>
      <p><strong>Patient:</strong> ${escapeHtml(`${patient.firstName} ${patient.lastName}`.trim() || "—")}</p>
      <button id="backPatientBtn" class="secondary">Zurück zum Patienten</button>
    </div>

    <div class="card">
      <h3>Rezeptdaten</h3>
      <p><strong>Leistungen:</strong> ${escapeHtml(rezeptSummary(rezept))}</p>
      <p><strong>Arzt:</strong> ${escapeHtml(rezept.arzt || "—")}</p>
      <p><strong>Ausstellungsdatum:</strong> ${escapeHtml(rezept.ausstell || "—")}</p>
      <p><strong>Status:</strong> ${escapeHtml(rezept.status || "Aktiv")}</p>
      <p><strong>BG:</strong> ${rezept.bg ? "Ja" : "Nein"}</p>
      <p><strong>Doppeltermin:</strong> ${rezept.dt ? "Ja" : "Nein"}</p>
      <p><strong>Zeit gesamt:</strong> ${escapeHtml(formatMinutesLabel(timeSummary.totalMinutes))}</p>
      <p><strong>Zeit-Einträge:</strong> ${timeSummary.totalEntries}</p>
    </div>

    <div class="card">
      <h3>Fristenhinweis</h3>
      <p><strong>Status:</strong> ${escapeHtml(frist.statusText || "—")}</p>
      <p><strong>Hinweis:</strong> ${escapeHtml(frist.detailsText || "—")}</p>
      <p><strong>Spätester Beginn:</strong> ${escapeHtml(frist.latestStartText || "—")}</p>
      <p><strong>Gültig bis:</strong> ${escapeHtml(frist.validUntilText || "—")}</p>
    </div>

    <div class="card">
      <h3>Zeit-Anbindung aktiv</h3>
      <p class="muted">Behandlungszeit wird automatisch aus dem Rezept bei jeder Dokumentation gutgeschrieben.</p>
      <p class="muted"><strong>Rezept-ID:</strong> ${escapeHtml(rezept.rezeptId)}</p>
    </div>

    <div class="card">
      <h3>Dokumentation zu diesem Rezept</h3>
      <label for="entryDate">Datum</label>
      <input id="entryDate" type="text" placeholder="DD.MM.YYYY" inputmode="numeric">

      <label for="entryText">Dokumentation</label>
      <input id="entryText" type="text" placeholder="Behandlung / Verlauf / Besonderheiten">

      <p class="muted">Beim Speichern wird die Zeit automatisch aus der Rezeptleistung berechnet.</p>

      <button id="saveEntryBtn">Dokumentation speichern</button>
      <div id="entryMsg"></div>
    </div>

    <div class="card">
      <h3>Besprechungszeit</h3>
      <p class="muted">Nur Besprechung darf manuell erfasst werden und benötigt die PIN des Abteilungsleiters.</p>

      <label for="timeDate">Datum</label>
      <input id="timeDate" type="text" placeholder="DD.MM.YYYY">

      <label for="timeMinutes">Minuten</label>
      <input id="timeMinutes" type="number" min="1" step="1" placeholder="z.B. 60 oder 120">

      <label for="timeNote">Notiz</label>
      <input id="timeNote" type="text" placeholder="optional">

      <button id="saveTimeBtn">Besprechung speichern</button>
      <div id="timeMsg"></div>
    </div>

    <div class="card">
      <h3>Vorhandene Einträge</h3>
      ${rezept.entries.length === 0 ? `<p class="muted">Noch keine Dokumentation zu diesem Rezept.</p>` : ""}
      ${rezept.entries.map(entry => `
        <div class="card" style="margin-bottom:12px;padding:16px;">
          <p><strong>${escapeHtml(entry.date || "Ohne Datum")}</strong></p>
          <p>${escapeHtml(entry.text || "")}</p>
          <p class="muted">Automatische Zeit: ${escapeHtml(formatMinutesLabel(entry.autoTimeMinutes || 0))}</p>
          <button class="editEntryBtn secondary" data-entry-id="${entry.entryId}">Eintrag bearbeiten</button>
        </div>
      `).join("")}
    </div>

    <div class="card">
      <h3>Zeit-Einträge</h3>
      <p class="muted">Gesamtzeit: ${escapeHtml(formatMinutesLabel(timeSummary.totalMinutes))}</p>
      ${timeEntries.length === 0 ? `<p class="muted">Noch keine Zeit zu diesem Rezept erfasst.</p>` : ""}
      ${timeEntries.map(item => `
        <div class="card" style="margin-bottom:12px;padding:16px;">
          <p><strong>${escapeHtml(item.date || "Ohne Datum")}</strong> · ${escapeHtml(formatMinutesLabel(item.minutes))}</p>
          <p class="muted">Typ: ${escapeHtml(getTimeTypeLabel(item.type))}</p>
          <p class="muted">Status: ${item.confirmed ? "Bestätigt" : "Offen"}</p>
          ${item.note ? `<p>${escapeHtml(item.note)}</p>` : ""}
        </div>
      `).join("")}
    </div>
  `);

  document.getElementById("backPatientBtn").onclick = () => {
    showPatientDetailView({ onLock, homeId, patientId });
  };

  bindDateAutoFormat(document.getElementById("entryDate"));

  document.getElementById("saveEntryBtn").onclick = async () => {
    const date = document.getElementById("entryDate").value.trim();
    const text = document.getElementById("entryText").value.trim();
    const msg = document.getElementById("entryMsg");

    msg.className = "error";
    msg.textContent = "";

    if (!text) {
      msg.textContent = "Bitte einen Dokumentationstext eingeben.";
      return;
    }

    try {
      const pendingKm = getPendingKilometerContext(homeId, patientId, date);
      if (pendingKm.needsKmInput) {
        const entered = window.prompt(`Bitte Entfernung eingeben:
${pendingKm.fromLabel} → ${pendingKm.toLabel}`, "");
        if (entered === null) {
          msg.textContent = "Dokumentation abgebrochen, da die Kilometer nicht eingegeben wurden.";
          return;
        }
        const kmValue = Number(String(entered).replace(",", "."));
        if (!Number.isFinite(kmValue) || kmValue <= 0) {
          msg.textContent = "Bitte gültige Kilometer für die neue Strecke eingeben.";
          return;
        }
        saveKnownKilometerRoute({
          fromPointId: pendingKm.fromPointId,
          toPointId: pendingKm.toPointId,
          fromLabel: pendingKm.fromLabel,
          toLabel: pendingKm.toLabel,
          km: kmValue
        });
      }

      createRezeptEntry(homeId, patientId, rezeptId, {
        date,
        text
      });
      await queuePersistRuntimeData();
      showRezeptDetailView({ onLock, homeId, patientId, rezeptId });
    } catch (err) {
      console.error(err);
      msg.textContent = err?.message || "Dokumentation konnte nicht gespeichert werden.";
    }
  };

  document.getElementById("saveTimeBtn").onclick = async () => {
    const date = document.getElementById("timeDate").value.trim();
    const minutesValue = document.getElementById("timeMinutes").value.trim();
    const note = document.getElementById("timeNote").value.trim();
    const msg = document.getElementById("timeMsg");

    msg.className = "error";
    msg.textContent = "";

    const minutes = Number(minutesValue);
    if (!Number.isFinite(minutes) || minutes <= 0) {
      msg.textContent = "Bitte gültige Minuten für die Besprechung eingeben.";
      return;
    }

    const approvalPin = window.prompt("Bitte PIN vom Abteilungsleiter eingeben:", "");
    if (approvalPin !== "98918072") {
      msg.textContent = "PIN vom Abteilungsleiter ist falsch.";
      return;
    }

    try {
      createRezeptTimeEntry(homeId, patientId, rezeptId, {
        date,
        minutes,
        note,
        confirmed: true
      });
      await queuePersistRuntimeData();
      showRezeptDetailView({ onLock, homeId, patientId, rezeptId });
    } catch (err) {
      console.error(err);
      msg.textContent = "Besprechungszeit konnte nicht gespeichert werden.";
    }
  };

  document.querySelectorAll(".editEntryBtn").forEach((btn) => {
    btn.onclick = () => {
      showEditRezeptEntryView({
        onLock,
        homeId,
        patientId,
        rezeptId,
        entryId: btn.dataset.entryId
      });
    };
  });
}
export function showEditRezeptEntryView({ onLock, homeId, patientId, rezeptId, entryId }) {
  bindLockButton(onLock);
  setCurrentView("entry-edit", { homeId, patientId, rezeptId, entryId });

  const runtimeData = getRuntimeData();
  const home = getHomeById(runtimeData, homeId);
  const patient = getPatientById(home, patientId);
  const rezept = getRezeptById(patient, rezeptId);
  const entry = (rezept?.entries || []).find((item) => item.entryId === entryId);

  if (!home || !patient || !rezept || !entry) {
    showRezeptDetailView({ onLock, homeId, patientId, rezeptId });
    return;
  }

  render(`
    <div class="card">
      <h2>Dokumentation bearbeiten</h2>
      <button id="backRezeptBtn" class="secondary">Zurück zum Rezept</button>
    </div>

    <div class="card">
      <label for="entryDate">Datum</label>
      <input id="entryDate" type="text" value="${escapeHtml(entry.date || "")}" inputmode="numeric">

      <label for="entryText">Dokumentation</label>
      <input id="entryText" type="text" value="${escapeHtml(entry.text || "")}">

      <button id="updateEntryBtn">Änderungen speichern</button>
      <div id="entryMsg"></div>
    </div>
  `);

  document.getElementById("backRezeptBtn").onclick = () => {
    showRezeptDetailView({ onLock, homeId, patientId, rezeptId });
  };

  bindDateAutoFormat(document.getElementById("entryDate"));

  document.getElementById("updateEntryBtn").onclick = async () => {
    const msg = document.getElementById("entryMsg");
    msg.className = "error";
    msg.textContent = "";

    const date = document.getElementById("entryDate").value.trim();
    const text = document.getElementById("entryText").value.trim();

    if (!text) {
      msg.textContent = "Bitte einen Dokumentationstext eingeben.";
      return;
    }

    try {
      updateRezeptEntry(homeId, patientId, rezeptId, entryId, { date, text });
      await queuePersistRuntimeData();
      showRezeptDetailView({ onLock, homeId, patientId, rezeptId });
    } catch (err) {
      console.error(err);
      msg.textContent = "Eintrag konnte nicht aktualisiert werden.";
    }
  };
}

export function showAbgabeView({ onLock, searchText = "", selectedIds = [] }) {
  bindLockButton(onLock);
  setCurrentView("abgabe", { searchText, selectedIds });

  const data = getRuntimeData();
  const tree = buildAbgabeTree(data);
  const allRows = buildAbgabeRows(data);
  const filteredRows = filterAbgabeRows(allRows, searchText);
  const allowedIds = new Set(filteredRows.map((row) => row.rowId));
  const selected = new Set(selectedIds);

  render(`
    <div class="card">
      <h2>Abgabeliste</h2>
      <button id="backDashboardBtn" class="secondary">Zurück zum Dashboard</button>
    </div>

    <details class="accordion" open>
      <summary>
        <span>Suche</span>
        <span class="muted">Filter</span>
      </summary>
      <div class="accordion-body">
        <input id="abgabeSearch" type="text" value="${escapeHtml(searchText)}" placeholder="Patient, Heim, Leistung, Arzt, Status">
        <div class="row">
          <button id="runAbgabeSearchBtn" class="secondary">Suchen</button>
          <button id="clearAbgabeSearchBtn" class="secondary">Suche löschen</button>
        </div>
      </div>
    </details>

    <div class="card">
      <h3>Abgabe-Auswahl</h3>

      ${tree.length === 0 ? `<p class="muted">Noch keine Rezeptdaten vorhanden.</p>` : `
        <div class="list-stack">
          ${tree.map(home => {
            const patientBlocks = home.patients.map(patient => {
              const rezeptRows = patient.rezepte.filter((row) => !searchText || allowedIds.has(row.rowId));
              if (rezeptRows.length === 0) return "";

              return `
                <details class="accordion" style="margin-bottom:10px;">
                  <summary>
                    <span>${escapeHtml(patient.patientName || "Patient")}</span>
                    <span class="muted">${rezeptRows.length} Rezeptzeile(n)</span>
                  </summary>
                  <div class="accordion-body">
                    <div class="compact-meta" style="margin-bottom:10px;">
                      Geburt: ${escapeHtml(patient.geb || "—")}
                    </div>

                    ${rezeptRows.map(row => `
                      <div class="compact-card">
                        <label style="display:flex; gap:10px; align-items:flex-start; font-weight:normal;">
                          <input class="abgabeCheck" type="checkbox" data-row-id="${row.rowId}" style="width:auto;" ${selected.has(row.rowId) ? "checked" : ""}>
                          <span>
                            <strong>${escapeHtml(row.leistung || "—")} ${escapeHtml(row.anzahl || "")}</strong><br>
                            <span class="muted">Arzt: ${escapeHtml(row.arzt || "—")}</span><br>
                            <span class="muted">Ausstellung: ${escapeHtml(row.ausstell || "—")}</span><br>
                            <span class="muted">Status: ${escapeHtml(row.status || "—")}</span>
                          </span>
                        </label>
                      </div>
                    `).join("")}
                  </div>
                </details>
              `;
            }).filter(Boolean).join("");

            if (!patientBlocks) return "";

            return `
              <details class="accordion">
                <summary>
                  <span>${escapeHtml(home.homeName || "Heim")}</span>
                  <span class="muted">${home.patients.length} Patient(en)</span>
                </summary>
                <div class="accordion-body">
                  ${patientBlocks}
                </div>
              </details>
            `;
          }).join("")}
        </div>
      `}

      <div class="row" style="margin-top:12px;">
        <button id="saveAbgabeSelectionBtn">Auswahl speichern</button>
        <button id="printAbgabeSelectionBtn" class="secondary">Auswahl drucken</button>
      </div>

      <div id="abgabeMsg"></div>
    </div>

    <details class="accordion">
      <summary>
        <span>Abgabe-Historie</span>
        <span class="muted">${(data.abgabeHistory || []).length}</span>
      </summary>
      <div class="accordion-body">
        ${((data.abgabeHistory || []).length === 0) ? `<p class="muted">Noch keine gespeicherten Listen.</p>` : ""}
        ${(data.abgabeHistory || []).slice(0, 8).map(item => `
          <div class="compact-card">
            <div style="font-weight:600;">${escapeHtml(item.title || "Abgabeliste")}</div>
            <div class="compact-meta">
              ${escapeHtml(item.createdAt || "")}<br>
              ${item.rows?.length || 0} Zeile(n)
            </div>
          </div>
        `).join("")}
      </div>
    </details>
  `);

  document.getElementById("backDashboardBtn").onclick = () => showDashboardView({ onLock });

  document.getElementById("runAbgabeSearchBtn").onclick = () => {
    const value = document.getElementById("abgabeSearch").value;
    const nextSelected = Array.from(document.querySelectorAll(".abgabeCheck:checked")).map((el) => el.dataset.rowId);
    showAbgabeView({ onLock, searchText: value, selectedIds: nextSelected });
  };

  document.getElementById("clearAbgabeSearchBtn").onclick = () => {
    showAbgabeView({ onLock, searchText: "", selectedIds: [] });
  };

  document.getElementById("saveAbgabeSelectionBtn").onclick = async () => {
    const msg = document.getElementById("abgabeMsg");
    msg.className = "error";
    msg.textContent = "";

    const chosenIds = Array.from(document.querySelectorAll(".abgabeCheck:checked")).map((el) => el.dataset.rowId);
    const chosenRows = allRows.filter((row) => chosenIds.includes(row.rowId));

    if (chosenRows.length === 0) {
      msg.textContent = "Bitte mindestens einen Eintrag auswählen.";
      return;
    }

    try {
      saveAbgabeHistory(`Abgabeliste ${new Date().toLocaleString("de-DE")}`, chosenRows);
      await queuePersistRuntimeData();
      showAbgabeView({ onLock, searchText, selectedIds: [] });
    } catch (err) {
      console.error(err);
      msg.textContent = "Abgabe-Historie konnte nicht gespeichert werden.";
    }
  };

  document.getElementById("printAbgabeSelectionBtn").onclick = () => {
    const chosenIds = Array.from(document.querySelectorAll(".abgabeCheck:checked")).map((el) => el.dataset.rowId);
    const chosenRows = allRows.filter((row) => chosenIds.includes(row.rowId));

    if (chosenRows.length === 0) {
      alert("Bitte mindestens einen Eintrag auswählen.");
      return;
    }

    printHtml(
      "Abgabeliste",
      chosenRows.map((row) => `
        <div class="row">
          <strong>${escapeHtml(row.patient || "—")}</strong> · ${escapeHtml(row.heim || "—")}<br>
          <span class="muted">Arzt: ${escapeHtml(row.arzt || "—")}</span><br>
          <span class="muted">Ausstellung: ${escapeHtml(row.ausstell || "—")}</span><br>
          <span class="muted">Leistung: ${escapeHtml(row.leistung || "—")} ${escapeHtml(row.anzahl || "")}</span><br>
          <span class="muted">Status: ${escapeHtml(row.status || "—")}</span>
        </div>
      `).join("")
    );
  };
}

export function showNachbestellungView({ onLock, doctorFilter = "", textFilter = "", selectedIds = [] }) {
  bindLockButton(onLock);
  setCurrentView("nachbestellung", { doctorFilter, textFilter, selectedIds });

  const data = getRuntimeData();
  const doctors = getDoctorList(data);
  const allRows = buildNachbestellRows(data);
  const filteredRows = filterNachbestellRows(allRows, doctorFilter, textFilter);
  const tree = buildNachbestellTree(data, doctorFilter, textFilter);
  const selected = new Set(selectedIds);

  render(`
    <div class="card">
      <h2>Nachbestellung</h2>
      <button id="backDashboardBtn" class="secondary">Zurück zum Dashboard</button>
    </div>

    <details class="accordion" open>
      <summary>
        <span>Filter</span>
        <span class="muted">Arzt / Suche</span>
      </summary>
      <div class="accordion-body">
        <label for="doctorFilter">Arzt</label>
        <input id="doctorFilter" list="doctorList" value="${escapeHtml(doctorFilter)}" placeholder="Arztname eingeben oder wählen">
        <datalist id="doctorList">
          ${doctors.map((doctor) => `<option value="${escapeHtml(doctor)}"></option>`).join("")}
        </datalist>

        <label for="nachbestellTextFilter">Zusätzliche Suche</label>
        <input id="nachbestellTextFilter" type="text" value="${escapeHtml(textFilter)}" placeholder="Patient, Heim, Status, Text">

        <div class="row">
          <button id="runDoctorFilterBtn" class="secondary">Filtern</button>
          <button id="clearDoctorFilterBtn" class="secondary">Filter löschen</button>
        </div>
      </div>
    </details>

    <div class="card">
      <h3>Nachbestell-Auswahl</h3>

      ${tree.length === 0 ? `<p class="muted">Keine passenden Einträge vorhanden.</p>` : `
        <div class="list-stack">
          ${tree.map((group) => `
            <details class="accordion">
              <summary>
                <span>${escapeHtml(group.doctor || "Ohne Arzt")}</span>
                <span class="muted">${group.patients.length} Patient(en)</span>
              </summary>
              <div class="accordion-body">
                ${group.patients.map((patient) => `
                  <details class="accordion" style="margin-bottom:10px;">
                    <summary>
                      <span>${escapeHtml(patient.patient || "Patient")}</span>
                      <span class="muted">${patient.rows.length} Rezept(e)</span>
                    </summary>
                    <div class="accordion-body">
                      <div class="compact-meta" style="margin-bottom:10px;">
                        Heim: ${escapeHtml(patient.heim || "—")}<br>
                        Geburt: ${escapeHtml(patient.geb || "—")}
                      </div>

                      ${patient.rows.map((row) => `
                        <div class="compact-card">
                          <label style="display:flex; gap:10px; align-items:flex-start; font-weight:normal;">
                            <input class="nachbestellCheck" type="checkbox" data-row-id="${row.rowId}" style="width:auto;" ${selected.has(row.rowId) ? "checked" : ""}>
                            <span>
                              <strong>${escapeHtml(row.text || "—")}</strong><br>
                              <span class="muted">Status: ${escapeHtml(row.status || "—")}</span>
                            </span>
                          </label>
                        </div>
                      `).join("")}
                    </div>
                  </details>
                `).join("")}
              </div>
            </details>
          `).join("")}
        </div>
      `}

      <div class="row" style="margin-top:12px;">
        <button id="saveNachbestellSelectionBtn">Auswahl speichern</button>
        <button id="printNachbestellSelectionBtn" class="secondary">Auswahl drucken</button>
      </div>

      <div id="nachbestellMsg"></div>
    </div>

    <details class="accordion">
      <summary>
        <span>Nachbestell-Historie</span>
        <span class="muted">${(data.nachbestellHistory || []).length}</span>
      </summary>
      <div class="accordion-body">
        ${((data.nachbestellHistory || []).length === 0) ? `<p class="muted">Noch keine gespeicherten Listen.</p>` : ""}
        ${(data.nachbestellHistory || []).slice(0, 8).map((item) => `
          <div class="compact-card">
            <div style="font-weight:600;">${escapeHtml(item.title || "Nachbestellung")}</div>
            <div class="compact-meta">
              Arzt: ${escapeHtml(item.doctor || "—")}<br>
              ${escapeHtml(item.createdAt || "")}<br>
              ${item.lines?.length || 0} Zeile(n)
            </div>
          </div>
        `).join("")}
      </div>
    </details>
  `);

  document.getElementById("backDashboardBtn").onclick = () => showDashboardView({ onLock });

  document.getElementById("runDoctorFilterBtn").onclick = () => {
    const doctorValue = document.getElementById("doctorFilter").value;
    const textValue = document.getElementById("nachbestellTextFilter").value;
    const nextSelected = Array.from(document.querySelectorAll(".nachbestellCheck:checked")).map((el) => el.dataset.rowId);

    showNachbestellungView({
      onLock,
      doctorFilter: doctorValue,
      textFilter: textValue,
      selectedIds: nextSelected
    });
  };

  document.getElementById("clearDoctorFilterBtn").onclick = () => {
    showNachbestellungView({
      onLock,
      doctorFilter: "",
      textFilter: "",
      selectedIds: []
    });
  };

  document.getElementById("saveNachbestellSelectionBtn").onclick = async () => {
    const msg = document.getElementById("nachbestellMsg");
    msg.className = "error";
    msg.textContent = "";

    const chosenIds = Array.from(document.querySelectorAll(".nachbestellCheck:checked")).map((el) => el.dataset.rowId);
    const chosenRows = filteredRows.filter((row) => chosenIds.includes(row.rowId));

    if (chosenRows.length === 0) {
      msg.textContent = "Bitte mindestens einen Eintrag auswählen.";
      return;
    }

    try {
      saveNachbestellHistory(
        `Nachbestellung ${new Date().toLocaleString("de-DE")}`,
        doctorFilter,
        chosenRows
      );
      await queuePersistRuntimeData();
      showNachbestellungView({
        onLock,
        doctorFilter,
        textFilter,
        selectedIds: []
      });
    } catch (err) {
      console.error(err);
      msg.textContent = "Nachbestell-Historie konnte nicht gespeichert werden.";
    }
  };

  document.getElementById("printNachbestellSelectionBtn").onclick = () => {
    const chosenIds = Array.from(document.querySelectorAll(".nachbestellCheck:checked")).map((el) => el.dataset.rowId);
    const chosenRows = filteredRows.filter((row) => chosenIds.includes(row.rowId));

    if (chosenRows.length === 0) {
      alert("Bitte mindestens einen Eintrag auswählen.");
      return;
    }

    printHtml(
      "Nachbestellung",
      chosenRows.map((row) => `
        <div class="row">
          <strong>Arzt:</strong> ${escapeHtml(row.doctor || "—")}<br>
          ${escapeHtml(row.patient || "—")} · ${escapeHtml(row.heim || "—")}<br>
          <span class="muted">Geburt: ${escapeHtml(row.geb || "—")}</span><br>
          <span class="muted">${escapeHtml(row.text || "—")}</span><br>
          <span class="muted">Status: ${escapeHtml(row.status || "—")}</span>
        </div>
      `).join("")
    );
  };
}

export function showKilometerView({ onLock, summaryFrom = "", summaryTo = "" }) {
  bindLockButton(onLock);
  setCurrentView("kilometer", { summaryFrom, summaryTo });

  const overview = getKilometerOverview();
  const pointOptions = getKilometerPointOptions();
  const summary = getKilometerPeriodSummary(summaryFrom, summaryTo);

  const travelLog = [...(overview.travelLog || [])].sort((a, b) =>
    collatorDE.compare(`${b.date} ${b.createdAt || ""}`, `${a.date} ${a.createdAt || ""}`)
  );

  render(`
    <div class="card">
      <h2>Kilometer</h2>
      <button id="backDashboardBtn" class="secondary">Zurück zum Dashboard</button>
    </div>

    <div class="card">
      <h3>Manuelle Fahrt ergänzen</h3>
      <p class="muted">Für Ausnahmefälle wie zusätzliche Wechsel zwischen Einrichtungen. Begründung ist Pflicht.</p>

      <label for="manualKmDate">Datum</label>
      <input id="manualKmDate" type="text" value="${escapeHtml(summaryTo || summaryFrom || "")}" placeholder="DD.MM.YYYY">

      <label for="manualKmFrom">Von</label>
      <select id="manualKmFrom">
        <option value="">Bitte wählen</option>
        ${pointOptions.map((point) => `<option value="${escapeHtml(point.pointId)}">${escapeHtml(point.label)}${point.address ? ` – ${escapeHtml(point.address)}` : ""}</option>`).join("")}
      </select>

      <label for="manualKmTo">Nach</label>
      <select id="manualKmTo">
        <option value="">Bitte wählen</option>
        ${pointOptions.map((point) => `<option value="${escapeHtml(point.pointId)}">${escapeHtml(point.label)}${point.address ? ` – ${escapeHtml(point.address)}` : ""}</option>`).join("")}
      </select>

      <label for="manualKmValue">Kilometer</label>
      <input id="manualKmValue" type="number" min="0" step="0.1" placeholder="z.B. 7.5">

      <label for="manualKmReason">Begründung</label>
      <input id="manualKmReason" type="text" placeholder="z.B. viele Ausfälle, Patienten später, Krankenhaus">

      <button id="saveManualKmBtn">Manuelle Fahrt speichern</button>
      <div id="manualKmMsg"></div>
    </div>

    <details class="accordion" open>
      <summary>
        <span>Fahrtenprotokoll</span>
        <span class="muted">${travelLog.length}</span>
      </summary>
      <div class="accordion-body">
        ${travelLog.length === 0 ? `<p class="muted">Noch keine Fahrten protokolliert.</p>` : ""}
        ${travelLog.map((item) => `
          <div class="compact-card">
            <div style="font-weight:600;">${escapeHtml(item.date || "Ohne Datum")} · ${escapeHtml(formatKm(item.km || 0))}</div>
            <div class="compact-meta">${escapeHtml(item.fromLabel || "—")} → ${escapeHtml(item.toLabel || "—")}</div>
            <div class="compact-meta">Typ: ${item.source === "auto" ? "Automatisch" : "Manuell"}</div>
            ${item.note ? `<div class="compact-meta">${escapeHtml(item.note)}</div>` : ""}
          </div>
        `).join("")}
      </div>
    </details>

    <details class="accordion">
      <summary>
        <span>Startpunkt</span>
        <span class="muted">${escapeHtml(overview.startPoint?.label || "nicht gesetzt")}</span>
      </summary>
      <div class="accordion-body">
        <label for="kmStartLabel">Bezeichnung</label>
        <input id="kmStartLabel" type="text" value="${escapeHtml(overview.startPoint?.label || "Startpunkt")}">

        <label for="kmStartAddress">Adresse</label>
        <input id="kmStartAddress" type="text" value="${escapeHtml(overview.startPoint?.address || "")}" placeholder="z.B. Musterstraße 1, Ingolstadt">

        <button id="saveStartPointBtn">Startpunkt speichern</button>
        <div id="kilometerMsg"></div>
      </div>
    </details>

    <details class="accordion">
      <summary>
        <span>Zeitraum-Auswertung</span>
        <span class="muted">${escapeHtml(formatKm(summary.totalKm))} · ${escapeHtml(formatEuro(summary.totalAmount))}</span>
      </summary>
      <div class="accordion-body">
        <label for="kmSummaryFrom">Von</label>
        <input id="kmSummaryFrom" type="text" value="${escapeHtml(summaryFrom)}" placeholder="DD.MM.YYYY">

        <label for="kmSummaryTo">Bis</label>
        <input id="kmSummaryTo" type="text" value="${escapeHtml(summaryTo)}" placeholder="DD.MM.YYYY">

        <div class="row">
          <button id="runKmSummaryBtn">Auswertung anzeigen</button>
          <button id="printKmSummaryBtn" class="secondary">Kilometerzettel drucken</button>
        </div>

        <div class="compact-card" style="margin-top:12px;">
          <div style="font-weight:600;">Kilometerkonto</div>
          <div class="compact-meta">Gesamtkilometer: ${escapeHtml(formatKm(summary.totalKm))}</div>
          <div class="compact-meta">Vergütung: ${escapeHtml(formatEuro(summary.totalAmount))}</div>
          <div class="compact-meta">Zeitraum: ${escapeHtml(summary.fromDate || "—")} bis ${escapeHtml(summary.toDate || "—")}</div>
        </div>

        ${summary.rows.length === 0 ? `<p class="muted" style="margin-top:10px;">Keine Fahrten im gewählten Zeitraum.</p>` : ""}
        ${summary.rows.map((item) => `
          <div class="compact-card">
            <div style="font-weight:600;">${escapeHtml(item.date || "Ohne Datum")} · ${escapeHtml(formatKm(item.km || 0))}</div>
            <div class="compact-meta">${escapeHtml(item.fromLabel || "—")} → ${escapeHtml(item.toLabel || "—")}</div>
            <div class="compact-meta">Typ: ${item.source === "manual" ? "Manuell" : "Automatisch"}</div>
            ${item.note ? `<div class="compact-meta">Begründung: ${escapeHtml(item.note)}</div>` : ""}
          </div>
        `).join("")}
      </div>
    </details>
  `);

  document.getElementById("backDashboardBtn").onclick = () => showDashboardView({ onLock });

  document.getElementById("saveStartPointBtn").onclick = async () => {
    const label = document.getElementById("kmStartLabel").value.trim() || "Startpunkt";
    const address = document.getElementById("kmStartAddress").value.trim();
    const msg = document.getElementById("kilometerMsg");

    msg.className = "error";
    msg.textContent = "";

    if (!address) {
      msg.textContent = "Bitte eine Startadresse eingeben.";
      return;
    }

    try {
      saveKilometerStartPoint({ label, address });
      await queuePersistRuntimeData();
      showKilometerView({ onLock, summaryFrom, summaryTo });
    } catch (err) {
      console.error(err);
      msg.textContent = "Startpunkt konnte nicht gespeichert werden.";
    }
  };

  document.getElementById("runKmSummaryBtn").onclick = () => {
    const fromValue = document.getElementById("kmSummaryFrom").value.trim();
    const toValue = document.getElementById("kmSummaryTo").value.trim();
    showKilometerView({ onLock, summaryFrom: fromValue, summaryTo: toValue });
  };

  document.getElementById("printKmSummaryBtn").onclick = () => {
    const fromValue = document.getElementById("kmSummaryFrom").value.trim();
    const toValue = document.getElementById("kmSummaryTo").value.trim();
    const currentSummary = getKilometerPeriodSummary(fromValue, toValue);

    printHtml(
      "Kilometerzettel",
      `
        <div class="row"><strong>Zeitraum:</strong> ${escapeHtml(fromValue || "—")} bis ${escapeHtml(toValue || "—")}</div>
        <div class="row"><strong>Gesamtkilometer:</strong> ${escapeHtml(formatKm(currentSummary.totalKm))}</div>
        <div class="row"><strong>Vergütung:</strong> ${escapeHtml(formatEuro(currentSummary.totalAmount))}</div>
        ${currentSummary.rows.map((item) => `
          <div class="row">
            <strong>${escapeHtml(item.date || "Ohne Datum")}</strong> · ${escapeHtml(formatKm(item.km || 0))}<br>
            <span class="muted">${escapeHtml(item.fromLabel || "—")} → ${escapeHtml(item.toLabel || "—")}</span><br>
            <span class="muted">Typ: ${item.source === "manual" ? "Manuell" : "Automatisch"}</span>
            ${item.note ? `<br><span class="muted">Begründung: ${escapeHtml(item.note)}</span>` : ""}
          </div>
        `).join("")}
      `
    );
  };

  document.getElementById("saveManualKmBtn").onclick = async () => {
    const msg = document.getElementById("manualKmMsg");
    msg.className = "error";
    msg.textContent = "";

    try {
      addManualKilometerTravel({
        date: document.getElementById("manualKmDate").value.trim(),
        fromPointId: document.getElementById("manualKmFrom").value,
        toPointId: document.getElementById("manualKmTo").value,
        km: document.getElementById("manualKmValue").value,
        note: document.getElementById("manualKmReason").value.trim()
      });
      await queuePersistRuntimeData();
      showKilometerView({ onLock, summaryFrom, summaryTo });
    } catch (err) {
      console.error(err);
      msg.textContent = err?.message || "Manuelle Fahrt konnte nicht gespeichert werden.";
    }
  };
}

export function performLock({ onLocked }) {
  clearRuntimeSession();
  onLocked();
}

export function resumeCurrentView({ onLock }) {
  const view = getCurrentView();
  const context = getCurrentContext();

  if (view === "homes") {
    return showHomesView({ onLock, searchText: context.searchText || "" });
  }

  if (view === "home-detail") {
    return showHomeDetailView({
      onLock,
      homeId: context.homeId,
      searchText: context.searchText || ""
    });
  }

  if (view === "patient-detail") {
    return showPatientDetailView({
      onLock,
      homeId: context.homeId,
      patientId: context.patientId
    });
  }

  if (view === "rezept-create") {
    return showCreateRezeptView({
      onLock,
      homeId: context.homeId,
      patientId: context.patientId
    });
  }

  if (view === "rezept-edit") {
    return showEditRezeptView({
      onLock,
      homeId: context.homeId,
      patientId: context.patientId,
      rezeptId: context.rezeptId
    });
  }

  if (view === "rezept-detail") {
    return showRezeptDetailView({
      onLock,
      homeId: context.homeId,
      patientId: context.patientId,
      rezeptId: context.rezeptId
    });
  }

  if (view === "entry-edit") {
    return showEditRezeptEntryView({
      onLock,
      homeId: context.homeId,
      patientId: context.patientId,
      rezeptId: context.rezeptId,
      entryId: context.entryId
    });
  }

  if (view === "abgabe") {
    return showAbgabeView({
      onLock,
      searchText: context.searchText || "",
      selectedIds: context.selectedIds || []
    });
  }

  if (view === "nachbestellung") {
    return showNachbestellungView({
      onLock,
      doctorFilter: context.doctorFilter || "",
      textFilter: context.textFilter || "",
      selectedIds: context.selectedIds || []
    });
  }

  if (view === "kilometer") {
    return showKilometerView({ onLock, summaryFrom: context.summaryFrom || "", summaryTo: context.summaryTo || "" });
  }

  showDashboardView({ onLock });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}