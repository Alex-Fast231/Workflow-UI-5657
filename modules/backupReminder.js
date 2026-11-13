import { finalizeAppStructure } from "../data/normalization.js";
import { mutateRuntimeData, queuePersistRuntimeData } from "../core/app-core.js";

// Regelmäßige Sicherung/Erinnerung rund um das Viewer-Backup. Vorher (bis
// inkl. Session 7) wurde die Backup-ZIP automatisch im Hintergrund per
// EmailJS verschickt - das ließ sich aus der Entwicklungsumgebung heraus nie
// gegen den echten EmailJS-Dienst verifizieren und blieb bei echten
// Fehlschlägen für den Therapeuten unsichtbar. EmailJS wird nirgends mehr in
// der App verwendet.
//
// Seit dem Stabilitäts-Audit (Meldung "App stürzt ab und verliert Daten",
// Ursache: fehlender dauerhafter Speicherschutz) gibt es zwei UNABHÄNGIGE
// Rhythmen mit jeweils eigenem Zeitstempel:
// 1. Automatischer, stiller Download (kein Klick nötig), primär
//    ÄNDERUNGSBASIERT - sobald seit dem letzten Auto-Download neue,
//    ungesicherte Daten erkannt werden (siehe isAutoBackupDownloadDue()
//    unten) - mit BACKUP_AUTO_DOWNLOAD_INTERVAL_DAYS Tagen als zusätzliche
//    Sicherheitsuntergrenze. Erzeugt (über exportBackup() in modules/backup.js,
//    siehe triggerAutomaticBackupDownload() in ui/views.js) das VOLLSTÄNDIGE,
//    über "Backup wiederherstellen" rückspielbare Backup - nicht nur die
//    reine Viewer-Datei -, damit ein Totalverlust der App auf dem Gerät
//    auch ohne manuellen Export abgefangen werden kann. Landet im normalen
//    Downloads-Ordner des Geräts, also AUSSERHALB des von Browser-Eviction
//    betroffenen App-Speichers. Vorgabe des Nutzers: Betriebshandys, viele
//    angesammelte ZIP-Dateien sind unkritisch.
// 2. Die bisherige, klickbasierte Erinnerung ("Backup-Erinnerung"-Overlay,
//    siehe showBackupReminderModal() in ui/views.js) bleibt zusätzlich
//    bestehen, aber jetzt als reine "Bitte an die Praxis/den Viewer-PC
//    senden"-Erinnerung, damit der separate Offline-Viewer regelmäßig auf
//    den aktuellen Stand gebracht wird - Vorgabe des Nutzers: alle 14 Tage.
const BACKUP_AUTO_DOWNLOAD_INTERVAL_DAYS = 5;
const BACKUP_REMINDER_INTERVAL_DAYS = 14;

// Fallback-Zieladresse für den mailto-Link, falls in den Einstellungen noch
// keine Büro-Mail hinterlegt ist. Der Therapeut kann die Zieladresse im
// geöffneten E-Mail-Programm bei Bedarf noch ändern.
const BACKUP_REMINDER_TARGET_EMAIL = "physio_fast@gmx.de";

// PIN, mit der die heruntergeladene ZIP-Datei im Viewer entsperrt werden
// kann (Vorgabe des Nutzers: PIN 1550) - unverändert aus der vorherigen
// Version, nur der Zustellweg hat sich geändert (Download/mailto statt
// automatischem EmailJS-Versand).
const BACKUP_ZIP_PIN = "1550";

// Zählt volle Kalendertage zwischen zwei Zeitpunkten (lokale Zeitzone),
// nicht volle 24-Stunden-Intervalle - damit die Erinnerung z.B. um 23:50
// Uhr und die nächste schon um 00:10 Uhr (nur 20 Minuten später, aber nach
// Mitternacht) bereits fällig ist, statt eines starren 24h-Countdowns ab
// der letzten Erledigung.
function daysBetweenLocalDates(earlier, later) {
  const a = new Date(earlier.getFullYear(), earlier.getMonth(), earlier.getDate());
  const b = new Date(later.getFullYear(), later.getMonth(), later.getDate());
  return Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

export function isBackupReminderDue(data) {
  const lastAt = data?.ui?.lastAutoExportAt;
  if (!lastAt) return true;

  const lastDate = new Date(lastAt);
  if (Number.isNaN(lastDate.getTime())) return true;

  return daysBetweenLocalDates(lastDate, new Date()) >= BACKUP_REMINDER_INTERVAL_DAYS;
}

// Eigener, unabhängiger Zeitstempel (lastAutoBackupDownloadAt) für den
// stillen automatischen Download - bewusst getrennt von lastAutoExportAt
// (das weiterhin nur die 14-tägliche "Bitte senden"-Erinnerung steuert),
// damit beide Rhythmen sich nicht gegenseitig zurücksetzen.
//
// Zwei Auslöser, das erste hat Vorrang:
// 1. Änderungsbasiert (PRIMÄR): existieren seit dem letzten Auto-Download
//    bereits neue, noch nicht gesicherte Daten (data.ui.lastDataChangeAt,
//    zentral in mutateRuntimeData() gepflegt), wird SOFORT gesichert -
//    unabhängig vom Kalenderrhythmus. Nutzerszenario: eine Kraft trägt nur
//    einmal wöchentlich alles auf einmal ein - ein reiner Fünf-Tage-Rhythmus
//    würde genau diesen Fall verpassen, wenn der Datenverlust kurz NACH der
//    Eintragung eintritt, aber VOR dem nächsten Kalendertermin. Da diese
//    Prüfung bei JEDEM Entsperren läuft (nicht nur beim kalten App-Start),
//    greift sie auch bei einer durch Auto-Lock unterbrochenen, mehrstündigen
//    Eintragungs-Sitzung mehrfach.
// 2. Kalenderbasiert (Sicherheitsuntergrenze): mindestens alle
//    BACKUP_AUTO_DOWNLOAD_INTERVAL_DAYS Tage, auch wenn aus irgendeinem
//    Grund kein lastDataChangeAt vorliegt oder nichts geändert wurde.
export function isAutoBackupDownloadDue(data) {
  const lastDownloadAt = data?.ui?.lastAutoBackupDownloadAt;
  const lastChangeAt = data?.ui?.lastDataChangeAt;

  if (lastChangeAt) {
    const changeDate = new Date(lastChangeAt);
    if (!Number.isNaN(changeDate.getTime())) {
      if (!lastDownloadAt) return true;
      const downloadDate = new Date(lastDownloadAt);
      if (Number.isNaN(downloadDate.getTime()) || changeDate > downloadDate) return true;
    }
  }

  if (!lastDownloadAt) return true;
  const lastDate = new Date(lastDownloadAt);
  if (Number.isNaN(lastDate.getTime())) return true;

  return daysBetweenLocalDates(lastDate, new Date()) >= BACKUP_AUTO_DOWNLOAD_INTERVAL_DAYS;
}

function requireZip() {
  if (!globalThis.zip) {
    throw new Error("ZIP Bibliothek ist nicht geladen");
  }
  return globalThis.zip;
}

function sanitizeFilenamePart(str) {
  return String(str || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9\-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

// Fügt einer bereits geöffneten ZipWriter-Instanz die für den Viewer nötige
// appData.json hinzu (vollständiger, unverschlüsselter JSON-Stand aller
// App-Daten, nur per ZIP-PIN geschützt, ohne den Praxispasswort-Krypto-Stack
// der App zu benötigen) - gemeinsam genutzt von buildBackupZip() hier und
// vom manuellen "Backup exportieren" in modules/backup.js, damit beide
// Export-Wege dieselbe, vom Viewer lesbare Datei mit derselben PIN erzeugen.
export async function addViewerAppDataEntry(writer, normalizedRuntimeData) {
  const zipLib = requireZip();
  await writer.add(
    "appData.json",
    new zipLib.TextReader(JSON.stringify(normalizedRuntimeData, null, 2)),
    { password: BACKUP_ZIP_PIN, encryptionStrength: 3 }
  );
}

// Baut die Viewer-Backup-ZIP: enthält eine einzige Datei (appData.json)
// mit dem vollständigen, unverschlüsselten JSON-Stand aller App-Daten -
// anders als das manuelle Backup in den Einstellungen keine appData.enc/
// cryptoMeta.json, da der Viewer die Daten direkt (nur per ZIP-PIN
// geschützt) lesen soll, ohne den Praxispasswort-Krypto-Stack der App zu
// benötigen.
export async function buildBackupZip(runtimeData) {
  const normalized = finalizeAppStructure(runtimeData);
  const zipLib = requireZip();
  const writer = new zipLib.ZipWriter(new zipLib.BlobWriter("application/zip"));
  await addViewerAppDataEntry(writer, normalized);

  const blob = await writer.close();
  const stamp = normalized.exportTimestamp.replace(/[:T]/g, "-").slice(0, 16);
  const therapistSlug = sanitizeFilenamePart(normalized.settings?.therapistName) || "therapeut";
  const filename = `FaSt-Doku-Viewer-Backup-${therapistSlug}-${stamp}.zip`;
  return { blob, filename };
}

// mailto kann aus Sicherheitsgründen keine Dateianhänge setzen - die ZIP
// muss vorher separat heruntergeladen und dann vom Therapeuten manuell an
// die geöffnete E-Mail angehängt werden. Der Text weist darauf explizit hin.
// bueroEmail kommt aus den Einstellungen (Büro-Mail) - ist dort nichts
// hinterlegt, wird auf die bisherige feste Zieladresse zurückgefallen, damit
// bestehende Praxen ohne gepflegte Büro-Mail nicht ohne Empfänger dastehen.
export function buildBackupReminderMailtoLink({ filename, therapistName, bueroEmail = "" }) {
  const subject = `Backup ${therapistName || "Therapeut"}`;
  const body = `Bitte die soeben heruntergeladene Datei "${filename}" manuell anhängen.`;
  const to = bueroEmail || BACKUP_REMINDER_TARGET_EMAIL;
  const params = [`subject=${encodeURIComponent(subject)}`, `body=${encodeURIComponent(body)}`];
  return `mailto:${encodeURIComponent(to)}?${params.join("&")}`;
}

function pushBackupReminderHistory(data, status, message) {
  if (!Array.isArray(data.autoExportHistory)) data.autoExportHistory = [];
  data.autoExportHistory.unshift({
    id: `autoexport_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
    createdAt: new Date().toISOString(),
    status,
    message: String(message || "")
  });
  data.autoExportHistory = data.autoExportHistory.slice(0, 20);
}

// Wird aufgerufen, sobald der Therapeut die Erinnerung tatsächlich erledigt
// hat (Backup heruntergeladen und/oder E-Mail-Programm geöffnet). Setzt den
// Fälligkeitszeitpunkt zurück, damit die Erinnerung erst nach dem nächsten
// vollen Intervall erneut erscheint.
export async function markBackupReminderHandled(message) {
  mutateRuntimeData((data) => {
    data.ui.lastAutoExportAt = new Date().toISOString();
    pushBackupReminderHistory(data, "handled", message);
  }, { silent: true });
  await queuePersistRuntimeData();
}

// Wird aufgerufen, wenn der Therapeut die Erinnerung wegklickt, ohne ein
// Backup zu erstellen - der Fälligkeitszeitpunkt bleibt bewusst
// unverändert, damit die Erinnerung beim nächsten Öffnen der App erneut
// erscheint statt für ein ganzes Intervall zu verschwinden.
export async function markBackupReminderPostponed() {
  mutateRuntimeData((data) => {
    pushBackupReminderHistory(data, "postponed", "Erinnerung verschoben - erscheint beim nächsten Öffnen der App erneut.");
  }, { silent: true });
  await queuePersistRuntimeData();
}

// Wird nach jedem erfolgreichen stillen Auto-Download aufgerufen - eigener
// Zeitstempel (siehe isAutoBackupDownloadDue()), damit dieser Rhythmus
// unabhängig von der 14-tägigen "Bitte senden"-Erinnerung läuft.
export async function markAutoBackupDownloadHandled(message) {
  // silent: true ist hier zwingend nötig, nicht nur Kosmetik - ohne diese
  // Option würde dieser Aufruf selbst den zentralen Änderungszeitstempel
  // (lastDataChangeAt) mit hochziehen und sich dadurch beim allernächsten
  // Login sofort wieder selbst als "neue ungesicherte Daten vorhanden"
  // melden (siehe isAutoBackupDownloadDue()) - der automatische Download
  // würde dann bei JEDEM Login erneut auslösen, egal ob wirklich etwas
  // Neues dazukam.
  mutateRuntimeData((data) => {
    data.ui.lastAutoBackupDownloadAt = new Date().toISOString();
    pushBackupReminderHistory(data, "auto-download", message);
  }, { silent: true });
  await queuePersistRuntimeData();
}
