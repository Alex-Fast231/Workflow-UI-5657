import { normalizeAppData } from "../data/normalization.js";
import { encryptJSON } from "../crypto/crypto-engine.js";
import { saveEncryptedAppData } from "../storage/secure-store.js";

let runtimeKey = null;
let runtimeData = null;
let cryptoMeta = null;
let securityState = null;
let currentView = "boot";
let currentContext = {};
let persistPromise = null;

export function setRuntimeSession(session) {
  runtimeKey = session.runtimeKey ?? null;
  runtimeData = session.runtimeData ? normalizeAppData(session.runtimeData) : null;
  cryptoMeta = session.cryptoMeta ?? cryptoMeta;
  securityState = session.securityState ?? securityState;
}

export function clearRuntimeSession() {
  runtimeKey = null;
  runtimeData = null;
  currentContext = {};
}

export function setCryptoMeta(value) {
  cryptoMeta = value;
}

export function setSecurityState(value) {
  securityState = value;
}

export function getRuntimeData() {
  return runtimeData;
}

export function getRuntimeKey() {
  return runtimeKey;
}

export function getCryptoMeta() {
  return cryptoMeta;
}

export function getSecurityState() {
  return securityState;
}

export function setCurrentView(viewName, context = {}) {
  currentView = viewName;
  currentContext = context;
}

export function getCurrentView() {
  return currentView;
}

export function getCurrentContext() {
  return currentContext;
}

export function mutateRuntimeData(mutatorFn, { silent = false } = {}) {
  if (!runtimeData) {
    throw new Error("Kein runtimeData Zustand vorhanden");
  }

  mutatorFn(runtimeData);

  // Zentraler Änderungszeitstempel - mutateRuntimeData() ist die EINZIGE
  // Stelle, über die jede inhaltliche Änderung an den App-Daten läuft
  // (Doku, Zeiterfassung, Rezepte, Einstellungen, FaSti-Aktionen, ...),
  // deshalb reicht dieser eine Punkt, um "gibt es seit dem letzten
  // Auto-Backup neue, noch nicht gesicherte Daten?" zuverlässig zu
  // beantworten (siehe isAutoBackupDownloadDue() in
  // modules/backupReminder.js), ohne dass jede einzelne Aufrufstelle im
  // Code selbst daran denken müsste. `silent: true` ist NUR für reine
  // Backup-/Anzeige-Buchhaltung gedacht (z.B. "Backup-Erinnerung erledigt"),
  // die selbst keine neuen Praxisdaten darstellt - würde so ein Aufruf den
  // Zeitstempel mit hochziehen, würde er sich selbst sofort wieder als
  // "neue ungesicherte Daten vorhanden" melden (Endlosschleife).
  if (!silent) {
    runtimeData.ui = runtimeData.ui || {};
    runtimeData.ui.lastDataChangeAt = new Date().toISOString();
  }

  runtimeData = normalizeAppData(runtimeData);
  return runtimeData;
}

export async function persistRuntimeData() {
  if (!runtimeKey || !runtimeData) {
    throw new Error("Runtime Session ist nicht entsperrt");
  }

  // Der Schlüssel wird hier als Wert für encryptJSON übergeben, ist also
  // auch dann noch korrekt, wenn runtimeKey währenddessen extern auf null
  // gesetzt wird (z.B. durch einen Lock). Der Speichervorgang selbst ist
  // damit sicher und wird nicht abgebrochen.
  const keyForThisWrite = runtimeKey;
  const dataAtStart = runtimeData;
  const normalized = normalizeAppData(runtimeData);
  const encrypted = await encryptJSON(normalized, keyForThisWrite);
  await saveEncryptedAppData(encrypted);

  // Nur dann den entschlüsselten Stand wieder im Speicher ablegen, wenn
  // die Session währenddessen NICHT gesperrt wurde (sonst würde ein Lock,
  // der genau während dieses Speichervorgangs passiert, die entschlüsselten
  // Daten direkt wieder zurück in den Speicher schreiben) UND wenn
  // runtimeData sich seit Beginn dieses Aufrufs nicht bereits durch eine
  // andere, zwischenzeitlich abgelaufene mutateRuntimeData()-Änderung
  // weiterbewegt hat - sonst würde diese neuere Änderung hier mit dem
  // veralteten Stand überschrieben und wäre komplett verloren (nicht nur
  // ungespeichert, sondern auch aus dem Arbeitsspeicher entfernt).
  if (runtimeKey === keyForThisWrite && runtimeData === dataAtStart) {
    runtimeData = normalized;
  }
}

// Reiht Speicheraufrufe so, dass keine zwischenzeitliche Änderung verloren
// geht: läuft bereits ein persist(), wird nach dessen Abschluss automatisch
// ein weiterer Durchlauf angehängt, falls währenddessen erneut mutiert
// wurde - der zurückgegebene Promise löst sich erst auf, wenn wirklich
// alle bis dahin angeforderten Änderungen gespeichert sind.
let persistAgainRequested = false;

export function queuePersistRuntimeData() {
  if (persistPromise) {
    persistAgainRequested = true;
    return persistPromise;
  }

  persistPromise = (async () => {
    try {
      do {
        persistAgainRequested = false;
        await persistRuntimeData();
      } while (persistAgainRequested);
    } finally {
      persistPromise = null;
    }
  })();

  return persistPromise;
}