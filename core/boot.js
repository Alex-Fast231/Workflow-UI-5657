import { openDatabase } from "../storage/indexeddb.js";
import { hasSecuritySetup, loadCryptoMeta, loadSecurityState } from "../storage/secure-store.js";
import { setCryptoMeta, setSecurityState, getRuntimeData, queuePersistRuntimeData } from "./app-core.js";
import { createAutoLockController } from "../security/lock.js";
import { APP_VERSION } from "../data/schema.js";
import { isBackupReminderDue, isAutoBackupDownloadDue } from "../modules/backupReminder.js";
import { buildFastiNotices, markWeeklySummaryShown } from "../modules/fasti.js";
import {
  showSetupView,
  showLoginView,
  showDashboardView,
  performLock,
  resumeCurrentView,
  showBackupReminderModal,
  triggerAutomaticBackupDownload,
  showFastiNotices,
  hideFastiWidget,
  setFastiOnLock
} from "../ui/views.js";

let autoLockController = null;

// Ergebnis der Speicherschutz-Anfrage aus bootstrapApp() - wird hier
// gemerkt, damit initiateFasti() (läuft erst NACH dem Login) den Nutzer
// aktiv warnen kann, statt dass die Information nur im (für den
// Therapeuten unsichtbaren) Entwickler-Log landet.
let persistentStorageGranted = true;

// Die App ist kein Offline-PWA mehr (Service Worker wurde entfernt, App
// funktioniert nur mit aktiver Internetverbindung). Bei Geräten, auf denen
// noch ein alter Service Worker aus einer früheren Version installiert ist,
// wird dieser hier deaktiviert, damit keine veralteten Dateien mehr aus
// einem Cache ausgeliefert werden.
async function removeLegacyServiceWorker() {
  try {
    if ("serviceWorker" in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));
    }
    if ("caches" in window) {
      const cacheKeys = await caches.keys();
      await Promise.all(cacheKeys.map((key) => caches.delete(key)));
    }
  } catch (err) {
    console.error("Alter Service Worker konnte nicht entfernt werden:", err);
  }
}

function showVersionLabel() {
  const versionLabel = document.getElementById("appVersionLabel");
  if (versionLabel) {
    versionLabel.textContent = APP_VERSION;
  }
}

async function ensurePersistentStorage() {
  try {
    if (!navigator.storage || typeof navigator.storage.persist !== "function") {
      return { supported: false, persisted: false };
    }

    const alreadyPersisted = typeof navigator.storage.persisted === "function"
      ? await navigator.storage.persisted()
      : false;

    if (alreadyPersisted) {
      return { supported: true, persisted: true };
    }

    const granted = await navigator.storage.persist();
    return { supported: true, persisted: granted };
  } catch (err) {
    console.error("Persistent Storage Anfrage fehlgeschlagen:", err);
    return { supported: true, persisted: false, error: err };
  }
}

async function determineStartupState() {
  const setupExists = await hasSecuritySetup();
  return setupExists ? "login" : "setup";
}

function lockApp() {
  if (autoLockController) {
    autoLockController.stop();
  }

  hideFastiWidget();

  performLock({
    onLocked: async () => {
      const state = await loadSecurityState();
      setSecurityState(state);
      showLoginView({ onSuccess: handleUnlocked });
    }
  });
}

function ensureAutoLock() {
  if (!autoLockController) {
    autoLockController = createAutoLockController(() => lockApp());
    autoLockController.bindActivityEvents();
  }
  autoLockController.start();
}

function handleUnlocked() {
  ensureAutoLock();
  resumeCurrentView({ onLock: lockApp });
  maybeRunBackupRoutines();
  initiateFasti();
}

// Läuft einmalig nach jedem Entsperren: berechnet die Hinweise aus allen 5
// FaSti-Bereichen (siehe modules/fasti.js) und zeigt sie gebündelt im
// Chat-Panel an. Die Montags-Zusammenfassung markiert sich dabei selbst als
// "angezeigt" (data.ui.lastFastiWeeklySummaryAt), damit sie am selben Tag
// nicht erneut erscheint.
function initiateFasti() {
  setFastiOnLock(lockApp);

  const runtimeData = getRuntimeData();
  if (!runtimeData) {
    console.warn("FaSti: übersprungen, da beim Entsperren keine App-Daten im Speicher waren (runtimeData ist leer).");
    return;
  }

  // Einstellungen -> "FaSti An/Aus" (Standard: an). Bei "aus" wird das
  // Widget nicht einmal aufgebaut/angezeigt - nicht nur das Panel verborgen.
  if (runtimeData.settings?.fastiEnabled === false) {
    hideFastiWidget();
    return;
  }

  const notices = buildFastiNotices(runtimeData);
  if (notices.some((notice) => notice.markShownOnDisplay)) {
    markWeeklySummaryShown();
    queuePersistRuntimeData();
  }

  // Ohne dauerhaften Speicherschutz kann der Browser/das Betriebssystem die
  // komplette App-Datenbank JEDERZEIT ohne Zutun des Nutzers löschen (z.B.
  // bei Speicherplatzdruck) - vorher stand das nur als console.warn() in
  // bootstrapApp(), also komplett unsichtbar für den Therapeuten. Wird bei
  // JEDEM Login neu geprüft und erscheint deshalb so lange wieder, bis der
  // Browser den Speicherschutz tatsächlich gewährt (unabhängig davon, ob
  // die Meldung zwischenzeitlich ignoriert wurde - FaSti-Meldungen werden
  // nie dauerhaft gespeichert, sondern bei jedem Login neu ermittelt).
  if (!persistentStorageGranted) {
    notices.unshift({
      id: "kein-dauerhafter-speicherschutz",
      bereich: "system",
      priority: "rot",
      text: "Wichtig: Der Browser hat keinen dauerhaften Speicherschutz für FaSt App gewährt. Dadurch können ALLE App-Daten ohne Vorwarnung verloren gehen (z.B. bei wenig Speicherplatz auf dem Gerät). Bitte regelmäßig ein Backup exportieren und die App zum Startbildschirm hinzufügen, um das Risiko zu senken.",
      action: null
    });
  }

  showFastiNotices(notices);
}

// Läuft nach jedem Entsperren zwei UNABHÄNGIGE Backup-Routinen (siehe
// modules/backupReminder.js): (1) der stille, automatische Download alle 5
// Tage bzw. sofort bei neuen Änderungen - kein Klick nötig, erzeugt das
// VOLLSTÄNDIGE, über "Backup wiederherstellen" rückspielbare Backup (nicht
// nur die reine Viewer-Datei) und landet im Downloads-Ordner des Geräts,
// damit auch ohne jedes Zutun regelmäßig eine Sicherung außerhalb des von
// Browser-Eviction betroffenen App-Speichers existiert (Vorgabe des
// Nutzers, u.a. wegen der auf Betriebshandys unkritischen ZIP-Ansammlung);
// (2) die bestehende, klickbasierte "Bitte senden"-Erinnerung alle 14 Tage,
// damit der separate Offline-Viewer regelmäßig aktualisiert wird. Beide
// können am selben Tag unabhängig voneinander fällig sein.
function maybeRunBackupRoutines() {
  const runtimeData = getRuntimeData();
  if (!runtimeData) {
    console.warn("Backup-Routinen: übersprungen, da beim Entsperren keine App-Daten im Speicher waren (runtimeData ist leer).");
    return;
  }

  if (isAutoBackupDownloadDue(runtimeData)) {
    triggerAutomaticBackupDownload(runtimeData);
  }

  if (isBackupReminderDue(runtimeData)) {
    // Das Modal blockiert währenddessen jede Interaktion mit der
    // dahinterliegenden Ansicht (volle Bildschirmüberdeckung), daher kann
    // sich dort in der Zwischenzeit nichts geändert haben - ein erneutes
    // resumeCurrentView() nach dem Schließen ist somit gefahrlos möglich.
    showBackupReminderModal({ onDone: () => resumeCurrentView({ onLock: lockApp }) });
  }
}

async function bootstrapApp() {
  showVersionLabel();
  await removeLegacyServiceWorker();

  const persistResult = await ensurePersistentStorage();
  if (persistResult.supported && !persistResult.persisted) {
    console.warn(
      "Persistenter Speicher wurde vom Browser nicht gewährt. " +
      "Die App-Daten könnten bei Speicherdruck vom System gelöscht werden. " +
      "Regelmäßige Backups werden dringend empfohlen."
    );
    // Nicht nur ins (für den Therapeuten unsichtbare) Entwickler-Log
    // schreiben - initiateFasti() zeigt dafür bei jedem Login eine
    // sichtbare FaSti-Meldung, solange dieser Wert false bleibt.
    persistentStorageGranted = false;
  }

  await openDatabase();

  const startupState = await determineStartupState();

  if (startupState === "setup") {
    showSetupView({
      onSuccess: handleUnlocked
    });
    return;
  }

  const cryptoMeta = await loadCryptoMeta();
  const securityState = await loadSecurityState();

  setCryptoMeta(cryptoMeta);
  setSecurityState(securityState);

  showLoginView({
    onSuccess: handleUnlocked
  });
}

bootstrapApp().catch((err) => {
  console.error(err);
  document.getElementById("app").innerHTML = `
    <div class="card">
      <h2>Startfehler</h2>
      <p>Die App konnte nicht gestartet werden.</p>
      <p class="error">${String(err?.message || err)}</p>
    </div>
  `;
});