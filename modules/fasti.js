// FaSti - regelbasierter Assistent (kein Sprachmodell, 100% lokal).
//
// Reine Logikschicht ohne DOM-Zugriff (wie alle anderen modules/*.js) - die
// Darstellung (Widget, Chat-Panel, Animationen) lebt in ui/views.js, die
// Persistenz-Trigger (Boot-Hook, Montags-Kennzeichnung) in core/boot.js.
//
// Bereiche: 1 Rezepte & Behandlungszählung, 2 Zeiterfassung & Saldo,
// 3 Assessments, 4 Fristen & Nachbestellung, 5 Zuzahlungsbefreiung.

import { mutateRuntimeData } from "../core/app-core.js";
import { generateId } from "../core/utils.js";
import {
  parseDeDate,
  formatDeDate,
  parseComparableDate,
  getComparableFromDate,
  isDateInRange,
  listComparableDatesInRange
} from "../core/date-utils.js";
import {
  getFaelligeAssessmentErinnerungen,
  getFaelligeZuzahlungErinnerungen,
  setZuzahlungsstatus,
  scheduleAssessment,
  buildNachbestellRows,
  buildNachbestellLetterData,
  getRezeptTimeEntries,
  createRezeptEntry,
  createAbwesenheit,
  getArztRegistry,
  saveFreikuvertBestellung,
  setPatientAusgeschieden,
  getHomeById,
  getPatientById,
  getRezeptById
} from "./homes.js";
import { getRezeptFristInfo, getRezeptGueltigBisComparable } from "./fristen.js";
import { optimiereVerordnung, EMPFEHLUNG_ZU_ITEM_TYPE } from "./rezeptoptimierung.js";
import { validateRezeptPflichtfelder } from "./rezeptpruefung.js";

const PRIORITY_ORDER = { rot: 0, orange: 1, gelb: 2 };

// ============================================================
// Kleine, lokale Hilfsfunktionen (bewusst dupliziert statt aus ui/views.js
// importiert, damit modules/fasti.js - wie alle anderen modules/*.js - ohne
// DOM/UI-Abhängigkeit bleibt und kein zirkulärer Import mit ui/views.js
// entsteht, das FaSti umgekehrt aufruft).
// ============================================================
function totalAnwendungsmenge(items) {
  let sum = 0;
  (items || []).forEach((item) => {
    if (!item || item.type === "Blanko") return;
    const n = Number(item.count);
    if (Number.isFinite(n)) sum += n;
  });
  return sum;
}

function fullPatientName(patient) {
  return `${patient?.lastName || ""}, ${patient?.firstName || ""}`.replace(/^,\s*/, "").trim() || "Ohne Namen";
}

function zuzahlungLabel(status) {
  if (status === "ja") return "befreit";
  if (status === "nein") return "nicht befreit";
  return "ungeklärt";
}

function addDaysToDate(date, days) {
  const d = new Date(date.getTime());
  d.setDate(d.getDate() + days);
  return d;
}

function formatMinutesPlain(minutes) {
  const total = Math.max(0, Math.round(Number(minutes) || 0));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${h}:${String(m).padStart(2, "0")} Std.`;
}

function formatMinutesSigned(minutes) {
  const total = Math.round(Number(minutes) || 0);
  const sign = total < 0 ? "-" : "+";
  const abs = Math.abs(total);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `${sign}${h}:${String(m).padStart(2, "0")} Std.`;
}

// Behandlungstage = eindeutige Datumswerte aus Schnelldoku-Einträgen UND
// Zeiterfassungs-Einträgen vom Typ "behandlung" - Duplikate am selben Tag
// (z.B. wenn beide Wege für denselben Tag existieren) zählen dank des Sets
// nur einmal.
function countBehandlungstage(rezept) {
  const days = new Set();
  (rezept?.entries || []).forEach((e) => { if (e?.date) days.add(e.date); });
  (rezept?.timeEntries || []).forEach((t) => { if (t?.type === "behandlung" && t?.date) days.add(t.date); });
  return days.size;
}

function getWorkDayCodeFromComparable(comparableDate) {
  const date = parseComparableDate(comparableDate);
  if (!date) return "";
  const dayMap = ["SO", "MO", "DI", "MI", "DO", "FR", "SA"];
  return dayMap[date.getDay()] || "";
}

// ============================================================
// Bereich 1 (Rezepte & Behandlungszählung) + Bereich 4 (Fristen)
// ============================================================
export function buildRezeptNotices(data) {
  const notices = [];
  const fastStartComparable = getFastStartDatumComparable(data?.settings);

  (data?.homes || []).forEach((home) => {
    (home.patients || []).forEach((patient) => {
      // Ausgeschiedene Patienten gelten wie verstorbene nicht mehr als aktiv -
      // keine Rezept-/Fristen-/Nachbestellungs-Hinweise mehr für sie (siehe
      // patient.ausgeschieden, per Stammdaten oder FaSti-Chat setzbar).
      if (patient.verstorben || patient.ausgeschieden) return;

      (patient.rezepte || []).forEach((rezept) => {
        // Auf der Abgabeliste gespeicherte/gedruckte Rezepte gelten für FaSti
        // als erledigt, egal ob der Therapeut sie zusätzlich noch manuell als
        // "abgegeben" markiert - rezept.abgegeben wird bereits beim
        // Speichern/Drucken einer Abgabeliste automatisch gesetzt.
        if (rezept.abgegeben) return;

        // FaSt-Startdatum: ein Alt-Rezept, dessen Gültigkeit schon vor dem
        // Startdatum endete, wird ignoriert - auch wenn Ausstellungsdatum und
        // Behandlungen davor lagen (Grund: alte, längst abgelaufene Rezepte
        // erzeugten sonst Phantom-Meldungen).
        if (fastStartComparable) {
          const gueltigBis = getRezeptGueltigBisComparable(rezept);
          if (gueltigBis && gueltigBis < fastStartComparable) return;
        }

        const gesamt = totalAnwendungsmenge(rezept.items);
        const gezaehlt = countBehandlungstage(rezept);
        const verbleibend = gesamt - gezaehlt;
        const frist = getRezeptFristInfo(rezept);
        const patientName = fullPatientName(patient);
        const heimName = home.name || "—";
        // Patienten können mehrere offene Rezepte gleichzeitig haben - ohne
        // das Ausstellungsdatum wäre bei einer Meldung nicht erkennbar,
        // welches der Rezepte konkret gemeint ist.
        const rezeptDatumLabel = rezept.ausstell ? `, Rezept vom ${rezept.ausstell}` : "";
        const arzt = String(rezept.arzt || "").trim();
        const nachbestellAction = arzt
          ? { type: "nachbestellung_vorschlagen", homeId: home.homeId, patientId: patient.patientId, rezeptId: rezept.rezeptId, patientName, arzt }
          : null;

        // "Abgelaufen" im Sinne des Konflikts meint: die Beginn-Frist ist
        // bereits verstrichen (daysRemaining < 0), nicht nur "läuft bald ab"
        // (daysRemaining <= 7, was schon traffic "red" ergibt) - Privatrezepte
        // haben keine Kassenfrist und sind hier immer ausgenommen.
        const abgelaufen = !rezept.privat && frist.mode !== "unknown" && Number.isFinite(frist.daysRemaining) && frist.daysRemaining < 0;

        if (abgelaufen && verbleibend > 0) {
          // frist.beginnErfolgt === true heißt: es gibt bereits einen
          // dokumentierten Behandlungstermin, der Fristverstoß ist also ein
          // TATSÄCHLICH verspäteter Beginn (nicht nur "heute schon zu spät,
          // aber noch gar nichts dokumentiert") - frist.statusText
          // beschreibt das bereits präzise ("Beginn verspätet: ... statt
          // spätestens ...").
          const text = frist.beginnErfolgt
            ? `Konflikt bei ${patientName} (${heimName})${rezeptDatumLabel}: ${frist.statusText} Noch ${verbleibend} Behandlung(en) offen.`
            : `Konflikt bei ${patientName} (${heimName})${rezeptDatumLabel}: Rezept ist laut Frist (${frist.statusText}) bereits abgelaufen, aber noch ${verbleibend} Behandlung(en) offen.`;
          notices.push({
            id: `rezept-konflikt-${rezept.rezeptId}`,
            bereich: "rezepte",
            priority: "rot",
            text,
            action: nachbestellAction
          });
        } else if (gesamt > 0 && verbleibend <= 3) {
          notices.push({
            id: `rezept-verbleibend-${rezept.rezeptId}`,
            bereich: "rezepte",
            priority: verbleibend <= 0 ? "rot" : "orange",
            text: verbleibend <= 0
              ? `${patientName} (${heimName})${rezeptDatumLabel}: Rezept ist aufgebraucht (${gesamt} von ${gesamt}) - Nachbestellung nötig.`
              : `${patientName} (${heimName})${rezeptDatumLabel}: Noch ${verbleibend} von ${gesamt} Behandlung(en) übrig - Nachbestellung vorbereiten.`,
            action: nachbestellAction
          });
        }

        if (!abgelaufen && !rezept.privat && frist.mode !== "unknown" && (frist.traffic === "red" || frist.traffic === "orange")) {
          notices.push({
            id: `rezept-frist-${rezept.rezeptId}`,
            bereich: "fristen",
            priority: frist.traffic === "red" ? "rot" : "orange",
            text: `${patientName} (${heimName})${rezeptDatumLabel}: Frist ${frist.statusText} (${frist.detailsText}).`,
            action: null
          });
        }
      });
    });
  });

  return notices;
}

// Meldet Rezepte, bei denen zwar schon eine Leistung ausgewählt ist (Doku und
// Zeiterfassung laufen also bewusst weiter, siehe ui/views.js), aber
// Angaben fehlen, die für ein gültiges Kassenrezept zwingend nötig sind. Nur
// die drei am Anfang typischerweise fehlenden Angaben werden hier gemeldet
// (ICD-10, Arzt, Leitsymptomatik) - die übrigen von
// validateRezeptPflichtfelder() geprüften Felder (Hausbesuch, Stempel,
// Unterschrift, Ausstellungsdatum) betreffen die spätere Abgabe/Frist und
// würden hier nur unnötig früh nerven.
const REZEPT_UNVOLLSTAENDIG_FELDER = ["icd10", "arzt", "leitsymptomatik"];

function buildRezeptUnvollstaendigNotices(data) {
  const notices = [];

  (data?.homes || []).forEach((home) => {
    (home.patients || []).forEach((patient) => {
      if (patient.verstorben || patient.ausgeschieden) return;

      (patient.rezepte || []).forEach((rezept) => {
        if (rezept.abgegeben) return;

        const { errors } = validateRezeptPflichtfelder(rezept);
        const relevanteFehler = errors.filter((e) => REZEPT_UNVOLLSTAENDIG_FELDER.includes(e.field));
        if (!relevanteFehler.length) return;

        const patientName = fullPatientName(patient);
        const fehlendeLabels = relevanteFehler.map((e) => e.message.replace(/\s*fehlt\.$/, ""));

        notices.push({
          id: `rezept-unvollstaendig-${rezept.rezeptId}`,
          bereich: "rezepte",
          priority: "gelb",
          text: `Bitte das Rezept von ${patientName} vervollständigen (fehlt: ${fehlendeLabels.join(", ")}).`,
          action: { type: "rezept_bearbeiten", homeId: home.homeId, patientId: patient.patientId, rezeptId: rezept.rezeptId, patientName }
        });
      });
    });
  });

  return notices;
}

// Meldet Tage, an denen für einen Patienten bereits eine Behandlungszeit
// gebucht wurde (Zeiterfassung, timeEntry.type === "behandlung"), aber noch
// kein Doku-Eintrag (rezept.entries) für denselben Tag existiert - z.B. wenn
// der Therapeut montags die Zeit erfasst, die Doku dazu aber vergisst. Der
// aktuelle Tag wird bewusst ausgenommen, damit die Doku noch bis Tagesende
// nachgetragen werden kann, ohne sofort eine Meldung auszulösen.
function buildDokuFehltNotices(data) {
  // Settings-Schalter "Doku-Prüfung deaktivieren" (nur per PIN aktivierbar,
  // siehe showSettingsView in ui/views.js) - wenn gesetzt, soll FaSti
  // grundsätzlich nicht mehr melden, ob dokumentiert wurde oder nicht.
  if (data?.settings?.dokuPruefungDeaktiviert) return [];

  const notices = [];
  const todayComparable = getComparableFromDate(new Date());
  const fastStartComparable = getFastStartDatumComparable(data?.settings);

  (data?.homes || []).forEach((home) => {
    (home.patients || []).forEach((patient) => {
      if (patient.verstorben || patient.ausgeschieden) return;

      const patientName = fullPatientName(patient);
      const heimName = home.name || "—";

      // WICHTIG: missingDates muss PRO REZEPT ermittelt werden, nicht einmal
      // patientenweit gesammelt - sonst wird bei mehreren gleichzeitig
      // offenen Rezepten desselben Patienten eine Meldung schon dadurch
      // "aufgelöst", dass irgendein Rezept an diesem Datum einen Doku-Eintrag
      // bekommt, selbst wenn das eigentlich betroffene Rezept weiterhin ohne
      // Doku-Eintrag dasteht (buildFastiNotices() erzeugt die Meldung beim
      // nächsten Entsperren erneut, da rezept.entries des betroffenen Rezepts
      // unverändert blieb).
      (patient.rezepte || []).forEach((rezept) => {
        // Abgegebene Rezepte werden von FaSti grundsätzlich nicht mehr
        // geprüft (siehe buildRezeptNotices() oben) - sonst würde hier eine
        // Meldung erzeugt, die sich über die SchnellDoku-Ansicht gar nicht
        // beheben ließe, da abgegebene Rezepte dort nicht mehr zur Auswahl
        // stehen.
        if (rezept.abgegeben) return;

        const dokuDates = new Set((rezept.entries || []).map((e) => e?.date).filter(Boolean));
        const missingDates = new Set();
        (rezept.timeEntries || []).forEach((entry) => {
          if (entry?.type !== "behandlung" || !entry?.date) return;
          if (dokuDates.has(entry.date)) return;
          const comparable = parseDeDate(entry.date);
          if (!comparable || comparable >= todayComparable) return;
          // FaSt-Startdatum: Behandlungen von VOR dem Umstieg auf FaSt wurden
          // in der vorherigen App dokumentiert - FaSti kennt diese Alt-Doku
          // nicht und soll dafür keine Phantom-Meldung erzeugen. Die
          // Zeiterfassung selbst (Saldo/Stunden) bleibt davon unberührt, nur
          // diese "Dokueintrag fehlt"-Prüfung greift erst ab dem Startdatum.
          if (fastStartComparable && comparable < fastStartComparable) return;
          missingDates.add(entry.date);
        });

        missingDates.forEach((date) => {
          notices.push({
            id: `doku-fehlt-${patient.patientId}-${rezept.rezeptId}-${date}`,
            bereich: "doku",
            priority: "orange",
            text: `${patientName} (${heimName}): Dokueintrag fehlt vom ${date}.`,
            action: { type: "doku_nachtragen", homeId: home.homeId, patientId: patient.patientId, rezeptId: rezept.rezeptId, patientName, date }
          });
        });
      });
    });
  });

  return notices;
}

// ============================================================
// Bereich 2 (Zeiterfassung & Saldo)
// ============================================================
function getFastStartDatumComparable(settings) {
  const value = String(settings?.fastStartDatum || "").trim();
  if (!value) return "";
  return parseComparableDate(value) ? value : (parseDeDate(value) || "");
}
function getEffectiveTimeSummaryFromDate(fromDate, fastStartComparable) {
  const requestedFrom = parseDeDate(fromDate);
  if (requestedFrom && fastStartComparable) {
    return formatDeDate(requestedFrom > fastStartComparable ? requestedFrom : fastStartComparable);
  }
  if (requestedFrom) return formatDeDate(requestedFrom);
  if (fastStartComparable) return formatDeDate(fastStartComparable);
  return String(fromDate || "").trim();
}
function getDailyPlannedMinutes(settings) {
  const workDays = Array.isArray(settings?.workDays) ? settings.workDays.filter(Boolean) : [];
  const weeklyHoursValue = String(settings?.weeklyHours || "").replace(",", ".").trim();
  const weeklyHours = Number(weeklyHoursValue);
  if (!workDays.length || !Number.isFinite(weeklyHours) || weeklyHours <= 0) return 0;
  return Math.round((weeklyHours * 60) / workDays.length);
}
function getStundenStartsaldoMinutes(settings) {
  const value = Number(settings?.stundenStartsaldoMinuten || 0);
  return Number.isFinite(value) ? Math.round(value) : 0;
}
function isComparableDateWithinAbsence(comparableDate, absence) {
  const from = parseDeDate(absence?.from);
  const to = parseDeDate(absence?.to);
  if (!from || !to || !comparableDate) return false;
  return comparableDate >= from && comparableDate <= to;
}
function getAbsenceForComparableDate(data, comparableDate) {
  return (data.abwesenheiten || []).find((item) => isComparableDateWithinAbsence(comparableDate, item)) || null;
}
function getSpecialDayForComparableDate(data, comparableDate) {
  if (!comparableDate) return null;
  const targetDate = formatDeDate(comparableDate);
  return (data.specialDays || []).find((item) => item?.date === targetDate) || null;
}
function collectAllFastiTimeEntries(data) {
  const rows = [];
  (data?.homes || []).forEach((home) => {
    (home?.patients || []).forEach((patient) => {
      (patient?.rezepte || []).forEach((rezept) => {
        getRezeptTimeEntries(rezept).forEach((entry) => {
          const minutes = Number(entry?.minutes || 0);
          if (!Number.isFinite(minutes) || minutes <= 0) return;
          rows.push({ date: String(entry?.date || "").trim(), minutes });
        });
      });
    });
  });
  return rows;
}

// Eigenständige Kopie der Kernlogik aus ui/views.js' getTimePeriodSummary()
// (die selbst wiederum die gleiche Logik ist wie im Viewer) - siehe
// Modulkommentar oben, warum hier bewusst nicht importiert wird.
export function getFastiTimePeriodSummary(data, fromDate, toDate) {
  const settings = data?.settings || {};
  const fastStartComparable = getFastStartDatumComparable(settings);
  const effectiveFromDate = getEffectiveTimeSummaryFromDate(fromDate, fastStartComparable);

  const totalsByDate = new Map();
  collectAllFastiTimeEntries(data)
    .filter((entry) => isDateInRange(entry.date, effectiveFromDate, toDate))
    .forEach((entry) => totalsByDate.set(entry.date, (totalsByDate.get(entry.date) || 0) + entry.minutes));

  const periodDates = listComparableDatesInRange(effectiveFromDate, toDate);
  const workDays = Array.isArray(settings.workDays) ? settings.workDays : [];
  const dailyPlannedMinutes = getDailyPlannedMinutes(settings);

  let totalMinutes = 0;
  let plannedMinutes = 0;
  periodDates.forEach((comparableDate) => {
    const dateDe = formatDeDate(comparableDate);
    totalMinutes += Number(totalsByDate.get(dateDe) || 0);
    const workDayCode = getWorkDayCodeFromComparable(comparableDate);
    const isWorkDay = workDays.includes(workDayCode);
    const absence = isWorkDay ? getAbsenceForComparableDate(data, comparableDate) : null;
    const specialDay = isWorkDay && !absence ? getSpecialDayForComparableDate(data, comparableDate) : null;
    if (isWorkDay && !absence && !specialDay) plannedMinutes += dailyPlannedMinutes;
  });

  const appSaldoMinutes = totalMinutes - plannedMinutes;
  const stundenStartsaldoMinuten = getStundenStartsaldoMinutes(settings);
  const stundenAbgleichMinuten = (data.stundenAbgleiche || [])
    .filter((item) => isDateInRange(item?.datum, effectiveFromDate, toDate))
    .reduce((sum, item) => sum + Math.max(0, Number(item?.minuten || 0)), 0);
  const saldoMinutes = appSaldoMinutes + stundenStartsaldoMinuten - stundenAbgleichMinuten;

  return {
    fromDate: String(fromDate || "").trim(),
    effectiveFromDate,
    toDate: String(toDate || "").trim(),
    totalMinutes,
    plannedMinutes,
    appSaldoMinutes,
    stundenStartsaldoMinuten,
    saldoMinutes
  };
}

function getIsoWeekNumber(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
}

// Läuft nur montags UND nur einmal pro Tag (data.ui.lastFastiWeeklySummaryAt
// wird nach dem Anzeigen vom Aufrufer über markWeeklySummaryShown() gesetzt).
function buildMontagsSummaryNotice(data) {
  const today = new Date();
  if (today.getDay() !== 1) return null;

  const todayComparable = getComparableFromDate(today);
  const lastShownComparable = String(data?.ui?.lastFastiWeeklySummaryAt || "").slice(0, 10);
  if (lastShownComparable === todayComparable) return null;

  const monday = addDaysToDate(today, -7);
  const sunday = addDaysToDate(monday, 6);
  const fromDe = formatDeDate(getComparableFromDate(monday));
  const toDe = formatDeDate(getComparableFromDate(sunday));
  const summary = getFastiTimePeriodSummary(data, fromDe, toDe);
  const kw = getIsoWeekNumber(monday);

  return {
    id: `montag-summary-${todayComparable}`,
    bereich: "stunden",
    priority: "gelb",
    text: `Wochenrückblick KW ${kw} (${fromDe} – ${toDe}): ${formatMinutesSigned(summary.appSaldoMinutes)} in dieser Woche, Gesamtsaldo jetzt ${formatMinutesSigned(summary.saldoMinutes)}.`,
    action: null,
    markShownOnDisplay: true
  };
}

// Vom Aufrufer (core/boot.js) zu rufen, sobald der Wochenrückblick tatsächlich
// angezeigt wurde (Notice mit markShownOnDisplay=true in den Ergebnissen von
// buildFastiNotices()).
export function markWeeklySummaryShown() {
  mutateRuntimeData((data) => {
    if (!data.ui) data.ui = {};
    data.ui.lastFastiWeeklySummaryAt = new Date().toISOString();
  }, { silent: true });
}

function countArbeitstageInAbsence(settings, absence) {
  const from = parseDeDate(absence?.from);
  const to = parseDeDate(absence?.to);
  if (!from || !to) return 0;
  const workDays = Array.isArray(settings?.workDays) ? settings.workDays : [];
  return listComparableDatesInRange(formatDeDate(from), formatDeDate(to))
    .filter((comparable) => workDays.includes(getWorkDayCodeFromComparable(comparable)))
    .length;
}

// Urlaubskonto: Anspruch (settings.jahresurlaubTage) minus tatsächlich
// genommene ARBEITSTAGE (nicht Kalendertage) innerhalb aller "urlaub"-
// Abwesenheiten, deren Start-Datum ins angefragte Jahr fällt.
export function getUrlaubStatus(data, year = new Date().getFullYear()) {
  const settings = data?.settings || {};
  const anspruch = Number(settings.jahresurlaubTage) || 0;
  const genommen = (data.abwesenheiten || [])
    .filter((item) => item.type === "urlaub")
    .filter((item) => {
      const from = parseDeDate(item.from);
      return from && from.slice(0, 4) === String(year);
    })
    .reduce((sum, item) => sum + countArbeitstageInAbsence(settings, item), 0);
  return { jahr: year, anspruch, genommen, rest: anspruch - genommen };
}

export function getKrankheitstageImZeitraum(data, fromDe, toDe) {
  const filterFrom = fromDe ? parseDeDate(fromDe) : null;
  const filterTo = toDe ? parseDeDate(toDe) : null;

  return (data.abwesenheiten || [])
    .filter((item) => item.type === "krank")
    .reduce((sum, item) => {
      const from = parseDeDate(item.from);
      const to = parseDeDate(item.to);
      if (!from || !to) return sum;
      const clippedFrom = filterFrom && filterFrom > from ? filterFrom : from;
      const clippedTo = filterTo && filterTo < to ? filterTo : to;
      if (clippedFrom > clippedTo) return sum;
      return sum + listComparableDatesInRange(formatDeDate(clippedFrom), formatDeDate(clippedTo)).length;
    }, 0);
}

// ============================================================
// Bereich 3 (Assessments)
// ============================================================
function buildAssessmentNotices(data) {
  return getFaelligeAssessmentErinnerungen(data).map((item) => ({
    id: `assessment-${item.patientId}`,
    bereich: "assessments",
    priority: "gelb",
    text: `Assessment fällig: ${item.patientName} (seit ${formatDeDate(item.dueAt)}).`,
    action: { type: "assessment_verschieben", homeId: item.homeId, patientId: item.patientId, patientName: item.patientName }
  }));
}

// ============================================================
// Bereich 5 (Zuzahlungsbefreiung)
// ============================================================
// Stichtag für die Zuzahlungsbefreiung ist der 1. Januar eines Jahres (nicht
// wie in einer früheren Fassung der 1. November) - die Bescheinigung gilt
// jeweils nur für das Kalenderjahr, in dem sie zuletzt bestätigt wurde
// (zuzahlungsstatusSetAt). Ab dem Jahreswechsel erinnert FaSti pro Patient
// einzeln, SOLANGE der Status nicht neu bestätigt wurde - der Status selbst
// wird dabei NICHT automatisch zurückgesetzt (das wäre eine stille Änderung
// an abrechnungsrelevanten Daten); FaSti fragt lediglich so lange nach, bis
// per "ja"/"nein" neu eingetragen wird (setZuzahlungsstatus() aktualisiert
// zuzahlungsstatusSetAt, danach verschwindet der Hinweis von selbst).
function buildZuzahlungJahreswechselNotices(data) {
  const currentYear = new Date().getFullYear();
  const notices = [];

  (data.homes || []).forEach((home) => {
    (home.patients || []).forEach((patient) => {
      if (patient.verstorben || patient.ausgeschieden) return;
      if (patient.zuzahlungsstatus !== "ja") return;

      const setAt = String(patient.zuzahlungsstatusSetAt || "").trim();
      const setYear = setAt ? Number(setAt.slice(0, 4)) : null;
      if (setYear && setYear >= currentYear) return; // für dieses Jahr schon bestätigt

      notices.push({
        id: `zuzahlung-jahreswechsel-${patient.patientId}-${currentYear}`,
        bereich: "zuzahlung",
        priority: "orange",
        text: `Zuzahlungsbefreiung von ${fullPatientName(patient)} muss für ${currentYear} neu bestätigt werden (zuletzt bestätigt: ${setYear || "unbekannt"}).`,
        action: null
      });
    });
  });

  return notices;
}

function buildZuzahlungNotices(data) {
  const notices = getFaelligeZuzahlungErinnerungen(data).map((item) => ({
    id: `zuzahlung-${item.patientId}`,
    bereich: "zuzahlung",
    priority: "gelb",
    text: `Zuzahlungsstatus noch ungeklärt: ${item.patientName}.`,
    action: null
  }));

  notices.push(...buildZuzahlungJahreswechselNotices(data));

  return notices;
}

// ============================================================
// Batch-Check (nach Login)
// ============================================================
export function buildFastiNotices(data) {
  const notices = [
    ...buildRezeptNotices(data),
    ...buildRezeptUnvollstaendigNotices(data),
    ...buildAssessmentNotices(data),
    ...buildZuzahlungNotices(data),
    ...buildDokuFehltNotices(data)
  ];

  const montag = buildMontagsSummaryNotice(data);
  if (montag) notices.push(montag);

  return notices.sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9));
}

// ============================================================
// Intent-Parser (Aktiv-Chat) - reines Schlüsselwort-Matching, kein
// Sprachmodell.
// ============================================================
const INTENT_KEYWORDS = [
  // "bbs"/"sturzrisiko"/"gleichgewicht" ergänzt beim FaSti-Stichwort-Abgleich
  // mit support-suchbegriffe-physio.json (Abschnitt 9.1) - bewusst NICHT das
  // dort ebenfalls gelistete "test" oder "berg" übernommen, da beides zu
  // allgemein ist und in völlig anderem Zusammenhang auftauchen kann.
  { intent: "assessment", words: ["assessment", "befund", "testung", "bbs", "sturzrisiko", "gleichgewicht"] },
  { intent: "rezept", words: ["rezept", "verordnung", "behandlung"] },
  { intent: "stunden", words: ["stunden", "saldo", "konto", "gearbeitet"] },
  { intent: "urlaub", words: ["urlaub", "resturlaub"] },
  { intent: "krank", words: ["krank", "krankheitstage"] },
  { intent: "zuzahlung", words: ["zuzahlung", "befreit", "befreiung"] },
  // "abgelaufen" ergänzt (Abschnitt 4-fristenrechner) - NICHT das dort auch
  // gelistete "behandlungsbeginn", weil es die Teilzeichenkette "behandlung"
  // enthält und dadurch vom weiter oben stehenden "rezept"-Intent abgefangen
  // würde, bevor diese Prüfung hier überhaupt erreicht wird.
  { intent: "frist", words: ["frist", "ablauf", "läuft ab", "abgelaufen"] },
  { intent: "nachbestellung", words: ["nachbestell", "bestell", "fax"] },
  { intent: "kilometer", words: ["kilometer", "km"] }
];

function detectIntent(textLower) {
  for (const entry of INTENT_KEYWORDS) {
    if (entry.words.some((w) => textLower.includes(w))) return entry.intent;
  }
  return null;
}

function findDoctorMention(data, textLower) {
  const doctors = Array.from(new Set(buildNachbestellRows(data).map((r) => r.doctor).filter(Boolean)));
  return doctors.find((d) => textLower.includes(d.toLowerCase())) || null;
}

const MONTH_NAMES = ["januar", "februar", "märz", "april", "mai", "juni", "juli", "august", "september", "oktober", "november", "dezember"];

function normalizeDatePart(raw) {
  const parts = raw.split(".");
  const day = parts[0].padStart(2, "0");
  const month = parts[1].padStart(2, "0");
  let year = parts[2];
  if (year.length === 2) year = `20${year}`;
  return `${day}.${month}.${year}`;
}

// Erkennt einfache deutsche Zeitraum-Angaben ("seit Juli", "letzte Woche",
// "diesen Monat", zwei explizite Daten, "seit TT.MM.JJJJ"). Liefert null,
// wenn nichts erkannt wurde - der Aufrufer verwendet dann einen sinnvollen
// Standardzeitraum.
export function parseFastiZeitraum(rawText, today = new Date()) {
  const textLower = String(rawText || "").toLowerCase();
  const todayDe = formatDeDate(getComparableFromDate(today));

  const explicitDates = textLower.match(/\d{1,2}\.\d{1,2}\.\d{2,4}/g) || [];
  if (explicitDates.length >= 2) {
    const from = parseDeDate(normalizeDatePart(explicitDates[0]));
    const to = parseDeDate(normalizeDatePart(explicitDates[1]));
    if (from && to) return { from: formatDeDate(from), to: formatDeDate(to) };
  }

  if (textLower.includes("heute")) return { from: todayDe, to: todayDe };

  if (textLower.includes("gestern")) {
    const gestern = addDaysToDate(today, -1);
    const de = formatDeDate(getComparableFromDate(gestern));
    return { from: de, to: de };
  }

  if (textLower.includes("letzte woche") || textLower.includes("letzten woche") || textLower.includes("vorwoche")) {
    const dow = today.getDay() || 7;
    const thisMonday = addDaysToDate(today, -(dow - 1));
    const lastMonday = addDaysToDate(thisMonday, -7);
    const lastSunday = addDaysToDate(lastMonday, 6);
    return { from: formatDeDate(getComparableFromDate(lastMonday)), to: formatDeDate(getComparableFromDate(lastSunday)) };
  }

  if (textLower.includes("diese woche") || textLower.includes("dieser woche")) {
    const dow = today.getDay() || 7;
    const monday = addDaysToDate(today, -(dow - 1));
    return { from: formatDeDate(getComparableFromDate(monday)), to: todayDe };
  }

  if (textLower.includes("diesen monat") || textLower.includes("diesem monat")) {
    const first = new Date(today.getFullYear(), today.getMonth(), 1);
    return { from: formatDeDate(getComparableFromDate(first)), to: todayDe };
  }

  if (textLower.includes("letzten monat") || textLower.includes("letzter monat") || textLower.includes("vormonat")) {
    const firstThis = new Date(today.getFullYear(), today.getMonth(), 1);
    const lastPrevMonth = addDaysToDate(firstThis, -1);
    const firstPrevMonth = new Date(lastPrevMonth.getFullYear(), lastPrevMonth.getMonth(), 1);
    return { from: formatDeDate(getComparableFromDate(firstPrevMonth)), to: formatDeDate(getComparableFromDate(lastPrevMonth)) };
  }

  const seitDatumMatch = textLower.match(/seit\s+(\d{1,2}\.\d{1,2}\.\d{2,4})/);
  if (seitDatumMatch) {
    const from = parseDeDate(normalizeDatePart(seitDatumMatch[1]));
    if (from) return { from: formatDeDate(from), to: todayDe };
  }

  const monthName = MONTH_NAMES.find((m) => textLower.includes(`seit ${m}`) || textLower.includes(`im ${m}`));
  if (monthName) {
    const monthIndex = MONTH_NAMES.indexOf(monthName);
    let year = today.getFullYear();
    if (monthIndex > today.getMonth()) year -= 1;
    const first = new Date(year, monthIndex, 1);
    const isSeit = textLower.includes(`seit ${monthName}`);
    const to = isSeit ? todayDe : formatDeDate(getComparableFromDate(new Date(year, monthIndex + 1, 0)));
    return { from: formatDeDate(getComparableFromDate(first)), to };
  }

  return null;
}

// ============================================================
// Chat-Antworten je Intent
// ============================================================
function answerAssessmentIntent(data, patientMatch) {
  if (patientMatch) {
    const { patient } = patientMatch;
    const name = fullPatientName(patient);
    const dueAt = String(patient.nextAssessmentDueAt || "").trim();
    if (!dueAt) return { reply: `Für ${name} ist noch kein nächstes Assessment-Datum hinterlegt.` };
    return { reply: `Nächstes Assessment von ${name}: ${formatDeDate(dueAt)}.` };
  }

  const faellig = getFaelligeAssessmentErinnerungen(data);
  if (faellig.length === 0) return { reply: "Aktuell sind keine Assessments fällig." };
  const sorted = [...faellig].sort((a, b) => String(a.dueAt).localeCompare(String(b.dueAt)));
  return { reply: `Fällige Assessments (${sorted.length}):\n${sorted.map((item) => `- ${item.patientName}: fällig seit ${formatDeDate(item.dueAt)}`).join("\n")}` };
}

function answerRezeptIntent(data, patientMatch) {
  if (patientMatch) {
    const { home, patient } = patientMatch;
    const rezepte = patient.rezepte || [];
    if (rezepte.length === 0) return { reply: `${fullPatientName(patient)} hat aktuell keine Rezepte.` };
    const lines = rezepte.map((r) => {
      const gesamt = totalAnwendungsmenge(r.items);
      const verbleibend = gesamt - countBehandlungstage(r);
      const heilmittel = (r.items || []).map((i) => i.type).join(", ") || "—";
      const stand = gesamt > 0 ? `${verbleibend} von ${gesamt} übrig` : "ohne feste Anzahl (Blanko)";
      return `- ${heilmittel} (ausgestellt ${r.ausstell || "—"}): ${stand}`;
    });
    return { reply: `Rezepte von ${fullPatientName(patient)} (${home.name || "—"}):\n${lines.join("\n")}` };
  }

  const notices = buildRezeptNotices(data).filter((n) => n.bereich === "rezepte");
  if (notices.length === 0) return { reply: "Aktuell läuft kein Rezept knapp." };
  return { reply: `Rezepte mit wenig verbleibenden Behandlungen (${notices.length}):\n${notices.map((n) => `- ${n.text}`).join("\n")}` };
}

function answerStundenIntent(data, zeitraum) {
  const today = new Date();
  const range = zeitraum || {
    from: formatDeDate(getComparableFromDate(new Date(today.getFullYear(), today.getMonth(), 1))),
    to: formatDeDate(getComparableFromDate(today))
  };
  const summary = getFastiTimePeriodSummary(data, range.from, range.to);
  return {
    reply: `Zeitraum ${range.from} bis ${range.to}: Ist-Zeit ${formatMinutesPlain(summary.totalMinutes)}, Soll-Zeit ${formatMinutesPlain(summary.plannedMinutes)}, Saldo im Zeitraum ${formatMinutesSigned(summary.appSaldoMinutes)}, Gesamt-Stundensaldo ${formatMinutesSigned(summary.saldoMinutes)}.`
  };
}

function answerUrlaubIntent(data) {
  const status = getUrlaubStatus(data);
  if (!status.anspruch) {
    return { reply: `Für ${status.jahr} ist noch kein Jahresurlaubsanspruch in den Einstellungen hinterlegt.` };
  }
  return { reply: `Urlaub ${status.jahr}: ${status.anspruch} Tage Anspruch, ${status.genommen} Tag(e) genommen, ${status.rest} Tag(e) verbleibend.` };
}

function answerKrankIntent(data, zeitraum) {
  const today = new Date();
  const range = zeitraum || {
    from: formatDeDate(getComparableFromDate(new Date(today.getFullYear(), 0, 1))),
    to: formatDeDate(getComparableFromDate(today))
  };
  const tage = getKrankheitstageImZeitraum(data, range.from, range.to);
  return { reply: `Krankheitstage ${range.from} bis ${range.to}: ${tage} Tag(e).` };
}

function answerZuzahlungIntent(data, textLower, patientMatch) {
  if (patientMatch) {
    const { home, patient } = patientMatch;
    const name = fullPatientName(patient);
    // Ein Fragezeichen ("Ist Frau Müller befreit?") heißt immer Abfrage, nie
    // Befehl - sonst würde reines Schlüsselwort-Matching jede Frage mit
    // "befreit" fälschlich als Statusänderungs-Wunsch interpretieren.
    const isQuestion = textLower.includes("?") || textLower.startsWith("ist ") || textLower.startsWith("sind ");
    const wantsNein = !isQuestion && (textLower.includes("nicht befreit") || textLower.includes("nicht mehr befreit"));
    const wantsUngeklaert = !isQuestion && (textLower.includes("ungeklärt") || textLower.includes("ungeklaert"));
    const wantsJa = !isQuestion && !wantsNein && !wantsUngeklaert && /\bbefreit\b/.test(textLower);

    if (wantsJa || wantsNein || wantsUngeklaert) {
      const status = wantsNein ? "nein" : wantsUngeklaert ? "ungeklaert" : "ja";
      if (status === patient.zuzahlungsstatus) {
        return { reply: `${name} ist bereits als "${zuzahlungLabel(status)}" erfasst.` };
      }
      return {
        reply: `${name} auf "${zuzahlungLabel(status)}" setzen?`,
        action: { type: "zuzahlung_setzen", homeId: home.homeId, patientId: patient.patientId, patientName: name, status }
      };
    }

    return { reply: `${name}: Zuzahlungsstatus = ${zuzahlungLabel(patient.zuzahlungsstatus)}.` };
  }

  if (textLower.includes("nicht befreit") || textLower.includes("wer ist nicht")) {
    const rows = [];
    (data.homes || []).forEach((home) => (home.patients || []).forEach((patient) => {
      if (patient.verstorben || patient.ausgeschieden) return;
      if (patient.zuzahlungsstatus === "nein" || patient.zuzahlungsstatus === "ungeklaert") {
        rows.push(`${fullPatientName(patient)} (${zuzahlungLabel(patient.zuzahlungsstatus)})`);
      }
    }));
    if (rows.length === 0) return { reply: "Alle erfassten Patienten sind als befreit markiert." };
    return { reply: `Nicht befreit / ungeklärt (${rows.length}):\n${rows.map((r) => `- ${r}`).join("\n")}` };
  }

  if (textLower.includes("erinnerung")) {
    const faellig = getFaelligeZuzahlungErinnerungen(data);
    if (faellig.length === 0) return { reply: "Keine offenen Zuzahlungs-Erinnerungen." };
    return { reply: `Offene Zuzahlungs-Erinnerungen (${faellig.length}):\n${faellig.map((f) => `- ${f.patientName}`).join("\n")}` };
  }

  // Standardfall bei einem bloßen Stichwort ohne Patientennamen und ohne
  // "nicht befreit"/"erinnerung"-Zusatz (z.B. einfach "Zuzahlungsstatus" oder
  // "Zuzahlungsbefreiung" eingetippt) - dann beide Gruppen zusammen auflisten,
  // statt nur die enger gefasste Erinnerungs-Liste zu zeigen.
  const befreitRows = [];
  const nichtBefreitRows = [];
  (data.homes || []).forEach((home) => (home.patients || []).forEach((patient) => {
    if (patient.verstorben || patient.ausgeschieden) return;
    if (patient.zuzahlungsstatus === "ja") {
      befreitRows.push(fullPatientName(patient));
    } else {
      nichtBefreitRows.push(`${fullPatientName(patient)} (${zuzahlungLabel(patient.zuzahlungsstatus)})`);
    }
  }));

  if (befreitRows.length === 0 && nichtBefreitRows.length === 0) {
    return { reply: "Es sind noch keine Patienten erfasst." };
  }

  const teile = [];
  teile.push(`Befreit (${befreitRows.length}):${befreitRows.length ? "\n" + befreitRows.map((r) => `- ${r}`).join("\n") : " —"}`);
  teile.push(`Nicht befreit / ungeklärt (${nichtBefreitRows.length}):${nichtBefreitRows.length ? "\n" + nichtBefreitRows.map((r) => `- ${r}`).join("\n") : " —"}`);
  return { reply: teile.join("\n\n") };
}

function answerFristIntent(data, patientMatch) {
  if (patientMatch) {
    const { patient } = patientMatch;
    const rezepte = (patient.rezepte || []).filter((r) => !r.privat);
    if (rezepte.length === 0) return { reply: `Für ${fullPatientName(patient)} gibt es keine Rezepte mit Kassenfrist.` };
    const lines = rezepte.map((r) => {
      const frist = getRezeptFristInfo(r);
      const heilmittel = (r.items || []).map((i) => i.type).join(", ") || "—";
      return `- ${heilmittel}: ${frist.statusText}`;
    });
    return { reply: `Fristen von ${fullPatientName(patient)}:\n${lines.join("\n")}` };
  }

  const notices = buildRezeptNotices(data).filter((n) => n.bereich === "fristen" || n.id.startsWith("rezept-konflikt"));
  if (notices.length === 0) return { reply: "Aktuell laufen keine Rezepte in Kürze ab." };
  return { reply: `Fristen-Hinweise (${notices.length}):\n${notices.map((n) => `- ${n.text}`).join("\n")}` };
}

// Kilometer sind per Chat bewusst NUR abfragbar, nicht eintragbar (siehe
// Nutzer-Feedback: der Therapeut fährt in der Praxis oft mehrere Ziele
// hintereinander an - Startpunkt -> Heim A -> Heim C -> Heim X - eine
// realistische Streckenführung ist für ein reines Schlüsselwort-Matching
// zu komplex, um sie zuverlässig aus einem Satz zu extrahieren). FaSti kann
// zur Kilometer-Ansicht navigieren ("Zeig Kilometer", siehe
// kilometer_oeffnen) und einen Überblick über einen Zeitraum geben.
function answerKilometerIntent(data, zeitraum) {
  const today = new Date();
  const range = zeitraum || {
    from: formatDeDate(getComparableFromDate(new Date(today.getFullYear(), today.getMonth(), 1))),
    to: formatDeDate(getComparableFromDate(today))
  };
  const rows = (data.kilometer?.travelLog || []).filter((r) => isDateInRange(r.date, range.from, range.to));
  if (rows.length === 0) return { reply: `Kilometer ${range.from} bis ${range.to}: keine Fahrten erfasst.` };
  const totalKm = rows.reduce((sum, r) => sum + (Number(r.km) || 0), 0);
  return { reply: `Kilometer ${range.from} bis ${range.to}: ${rows.length} Fahrt(en), ${totalKm.toFixed(1)} km gesamt.` };
}

// Extrahiert aus buildRezeptNotices() (Bereich 1) die rezeptId aller aktuell
// tatsächlich FÄLLIGEN Rezepte (Konflikt oder ≤3 verbleibend/aufgebraucht) -
// dieselbe Definition von "fällig", die auch die Batch-Hinweise verwenden.
// Ein Nachbestellzettel soll nie einfach ALLE Rezepte eines Arztes enthalten
// ("nicht alle Rezepte sind gleich fertig"), sondern nur die davon, die
// wirklich dran sind.
function getFaelligeRezeptIds(data) {
  const ids = new Set();
  buildRezeptNotices(data).forEach((notice) => {
    const match = notice.id.match(/^rezept-(?:konflikt|verbleibend)-(.+)$/);
    if (match) ids.add(match[1]);
  });
  return ids;
}

// Prüft rein anhand der bereits im Rezept hinterlegten ICD-10-Codes (kein
// zusätzliches Freitext-Diagnose-Gespräch nötig - "nur bezogen auf das
// aktuelle eingegebene Rezept und Diagnose"), ob der Rezeptoptimierer eine
// andere Leistung empfehlen würde als aktuell verordnet ist.
// status: "ok" (nichts zu tun), "optimierbar" (Vorschlag gefunden) oder
// "unklar" (kein/kein erkannter ICD-10-Code - das kann FaSti nicht selbst
// einschätzen, dafür ist der reguläre Rezeptoptimierer da).
function checkRezeptOptimierung(item, data) {
  const home = getHomeById(data, item.homeId);
  const patient = getPatientById(home, item.patientId);
  const rezept = getRezeptById(patient, item.rezeptId);
  if (!rezept || rezept.privat) return { status: "ok" };

  const icdInputs = [rezept.icd10, rezept.icd10b].filter(Boolean);
  if (icdInputs.length === 0) return { status: "unklar", home, patient };

  const zertifikate = data?.settings?.zertifikate || {};
  const ergebnisse = optimiereVerordnung(icdInputs, zertifikate);
  const beste = ergebnisse.find((e) => !e.unbekannt);
  if (!beste) return { status: "unklar", home, patient };

  const empfohlenerTyp = EMPFEHLUNG_ZU_ITEM_TYPE[beste.empfehlung];
  if (!empfohlenerTyp) return { status: "ok" };

  const aktuelleTypen = (rezept.items || []).map((i) => normalizeLeistungNameFasti(i.type));
  if (aktuelleTypen.includes(normalizeLeistungNameFasti(empfohlenerTyp))) return { status: "ok" };

  return { status: "optimierbar", home, patient, rezept, beste, empfohlenerTyp };
}

// Arbeitet die Warteschlange fälliger Rezepte für einen Arzt EINS NACH DEM
// ANDEREN ab: für jedes wird zuerst per checkRezeptOptimierung() geprüft, ob
// sich eine Optimierung anbietet - erst wenn die Warteschlange leer ist
// (oder bewusst übersprungen wurde), wird der eigentliche Nachbestellzettel
// für den Arzt erzeugt. So bekommt ein Patient nie einen fertigen Zettel,
// ohne dass FaSti vorher kurz nachgefragt hat.
function processNachbestellQueue(queue, arzt, data) {
  if (!queue || queue.length === 0) {
    const dueIds = getFaelligeRezeptIds(data);
    const rows = buildNachbestellRows(data).filter((r) => r.doctor === arzt && dueIds.has(r.rezeptId));
    if (rows.length === 0) return { reply: `Für ${arzt} liegen aktuell keine fälligen Rezepte vor.` };
    const patientCount = new Set(rows.map((r) => r.patientId)).size;
    return {
      reply: `Nachbestellzettel für ${arzt} mit ${rows.length} Rezept(en) für ${patientCount} Patient(en) erzeugen?`,
      action: { type: "nachbestellzettel_erzeugen", doctor: arzt, rows }
    };
  }

  const [current, ...rest] = queue;
  const check = checkRezeptOptimierung(current, data);

  if (check.status === "ok") {
    return processNachbestellQueue(rest, arzt, data);
  }

  if (check.status === "unklar") {
    return {
      reply: `Für das Rezept von ${fullPatientName(check.patient)} konnte ich anhand der ICD-10-Angabe keine Optimierung automatisch prüfen. Zum Rezeptoptimierer?`,
      choices: [
        { label: "Zum Rezeptoptimierer", resume: { kind: "command", commandId: "rezeptoptimierer_oeffnen", homeId: current.homeId, patientId: current.patientId } },
        { label: "Nein, weiter", resume: { kind: "nachbestell_queue", queue: rest, arzt } }
      ]
    };
  }

  const { patient, beste, empfohlenerTyp, rezept } = check;
  const aktuelleHeilmittel = (rezept.items || []).map((i) => i.type).join(", ") || "—";
  return {
    reply: `Für das Rezept von ${fullPatientName(patient)} (${beste.icd} - ${beste.diagnose}, aktuell ${aktuelleHeilmittel}) würde ${empfohlenerTyp} empfohlen. Optimieren?`,
    choices: [
      { label: "Optimieren", resume: { kind: "command", commandId: "rezeptoptimierer_oeffnen", homeId: current.homeId, patientId: current.patientId } },
      { label: "Nein, weiter", resume: { kind: "nachbestell_queue", queue: rest, arzt } }
    ]
  };
}

// Von einer Bereich-1-Batch-Meldung ("Nachbestellung vorbereiten") aus
// aufzurufen - NICHT über executeFastiAction(), da hier ggf. erst eine ganze
// Kette von Rückfragen (Optimierungs-Vorprüfung) kommt, bevor überhaupt ein
// Nachbestellzettel entsteht. Ermittelt den Arzt des auslösenden Rezepts und
// ALLE aktuell fälligen Rezepte dieses Arztes (können mehrere Patienten in
// unterschiedlichen Einrichtungen sein) und startet die Warteschlange.
export function startNachbestellungVorschlag(action, data) {
  const home = getHomeById(data, action.homeId);
  const patient = getPatientById(home, action.patientId);
  const rezept = getRezeptById(patient, action.rezeptId);
  const arzt = String(rezept?.arzt || action.arzt || "").trim();
  if (!arzt) return { reply: "Für dieses Rezept ist kein Arzt hinterlegt." };

  const dueIds = getFaelligeRezeptIds(data);
  const rows = buildNachbestellRows(data).filter((r) => r.doctor === arzt && dueIds.has(r.rezeptId));
  const queue = rows.map((r) => ({ homeId: r.homeId, patientId: r.patientId, rezeptId: r.rezeptId }));
  return processNachbestellQueue(queue, arzt, data);
}

function answerNachbestellungIntent(data, textLower) {
  const dueIds = getFaelligeRezeptIds(data);
  const doctor = findDoctorMention(data, textLower);

  if (doctor) {
    const rows = buildNachbestellRows(data).filter((r) => r.doctor === doctor && dueIds.has(r.rezeptId));
    if (rows.length === 0) return { reply: `Für ${doctor} liegen aktuell keine fälligen Rezepte vor.` };
    const queue = rows.map((r) => ({ homeId: r.homeId, patientId: r.patientId, rezeptId: r.rezeptId }));
    return processNachbestellQueue(queue, doctor, data);
  }

  const rows = buildNachbestellRows(data).filter((r) => dueIds.has(r.rezeptId));
  if (rows.length === 0) return { reply: "Aktuell gibt es keine fälligen Rezepte zur Nachbestellung." };
  const byDoctor = new Map();
  rows.forEach((r) => byDoctor.set(r.doctor || "ohne Arzt", (byDoctor.get(r.doctor || "ohne Arzt") || 0) + 1));
  const lines = Array.from(byDoctor.entries()).map(([doc, count]) => `- ${doc}: ${count} Rezept(e)`);
  return { reply: `Fällige Rezepte nach Arzt:\n${lines.join("\n")}` };
}

const FASTI_HELP_TEXT = "Das habe ich nicht verstanden. Ich kann helfen bei: Assessments, Rezepten/Behandlungen, Stunden/Saldo, Urlaub, Krankheitstagen, Zuzahlung/Befreiung, Fristen, Nachbestellungen und Kilometer-Übersichten. Ich kann auch direkt Dinge erledigen, z.B. \"Schreibe Doku für Herrn Müller: heute Kniemobilisation durchgeführt\" oder \"Optimiere Rezept für Frau Wagner\". Frag mich z.B. \"Wann ist das nächste Assessment von Frau Müller?\" oder \"Wie viele Stunden habe ich diesen Monat gearbeitet?\"";

// ============================================================
// Zentrale Aktionsschicht: FaSti als Bedienstelle für die ganze App - nicht
// nur für die 5 Analyse-Bereiche oben, sondern als Alternative zum
// Durchklicken durchs Menü. "FaSti schreibe Doku Herr Müller: ..." landet
// genauso im Schnelldoku-Eintrag wie der reguläre Weg über
// Einrichtung -> Patient -> Schnelldoku. Jeder Befehl ist entweder eine
// "navigation" (FaSti springt nur zur passenden Ansicht, keine Bestätigung
// nötig) oder eine "mutation" (immer über das bestehende
// Bestätigen/Abbrechen-Muster, siehe executeFastiAction()).
//
// Mehrdeutigkeit (z.B. zwei Patienten namens "Müller", oder ein Patient mit
// mehreren offenen Rezepten) wird NICHT durch erneutes Freitext-Raten
// aufgelöst, sondern über anklickbare Auswahl-Buttons in der UI - das
// zurückgegebene { choices } trägt dafür in jedem Kandidaten den
// vollständigen "resume"-Kontext, mit dem resumeFastiChoice() den
// ursprünglichen Befehl direkt an der aufgelösten Stelle fortsetzt.
// ============================================================
const FASTI_COMMANDS = {
  doku_schreiben: {
    kind: "mutation",
    // "doku schreiben" und "behandlung eintragen" beim FaSti-Stichwort-
    // Abgleich ergänzt (support-suchbegriffe-physio.json, Abschnitt 5).
    triggerWords: ["schreibe doku", "schreib doku", "dokumentiere", "trag doku ein", "trage doku ein", "doku eintragen", "in die doku", "notiere in der doku", "doku schreiben", "behandlung eintragen"]
  },
  zeit_eintragen: {
    kind: "mutation",
    triggerWords: ["zeit eintragen", "zeit buchen", "buche zeit", "trage zeit", "minuten eintragen", "zeiterfassung für", "zeiterfassung bei"],
    // Deutsche Trennverben ("trage ... ein", "buche ... ein") lassen sich
    // nicht als feste Wortfolge matchen, da beliebiger Text dazwischen steht
    // ("Trage 40 Minuten für Klara Beispiel ein") - hier reicht die
    // Kombination aus Zeit-/Minutenbezug UND einem der beiden Verbstämme
    // irgendwo im Satz.
    customDetect: (textLower) => (/\bminuten?\b|\bmin\b/.test(textLower) || textLower.includes("zeiterfassung")) && /\btrag\w*\b|\bbuch\w*\b/.test(textLower)
  },
  rezeptoptimierer_oeffnen: {
    kind: "navigation",
    triggerWords: ["optimiere rezept", "optimier rezept", "rezept optimieren", "rezeptoptimierung", "rezeptoptimierer"]
  },
  patient_oeffnen: {
    kind: "navigation",
    triggerWords: ["zeig patient", "zeig mir patient", "öffne patient", "patient anzeigen", "patientendetail", "zeig mir die patientenakte"]
  },
  rezept_anlegen: {
    kind: "navigation",
    triggerWords: ["neues rezept für", "neues rezept anlegen", "rezept anlegen für", "leg rezept an", "lege rezept an", "neue verordnung für"]
  },
  assessment_durchfuehren: {
    kind: "navigation",
    triggerWords: ["starte assessment", "assessment starten", "assessment durchführen", "mach assessment", "beginne assessment", "assessment beginnen"]
  },
  arztbericht_oeffnen: {
    kind: "navigation",
    triggerWords: ["arztbericht für", "therapiebericht für", "öffne arztbericht", "schreib arztbericht", "schreibe arztbericht", "arztbericht schreiben"]
  },
  // Diese vier brauchen keinen Patienten - reine Navigation zu einer
  // App-weiten Ansicht (siehe needsPatient: false unten in runFastiCommand).
  abgabeliste_oeffnen: {
    kind: "navigation",
    needsPatient: false,
    triggerWords: ["zeig abgabeliste", "öffne abgabeliste", "abgabeliste anzeigen", "zeig mir die abgabeliste"]
  },
  nachbestellungsuebersicht_oeffnen: {
    kind: "navigation",
    needsPatient: false,
    // "folgerezept"/"folgeverordnung" beim FaSti-Stichwort-Abgleich ergänzt
    // (support-suchbegriffe-physio.json, Abschnitt 11) - bewusst hier und
    // nicht im "nachbestellung"-Intent unten platziert: beide Wörter
    // enthalten die Teilzeichenkette "rezept" bzw. "verordnung" und würden
    // dort vom weiter vorne stehenden "rezept"-Intent abgefangen, bevor die
    // Nachbestellungs-Prüfung überhaupt erreicht wird. Als Befehl (wird vor
    // den Intents geprüft) funktioniert die Zuordnung dagegen zuverlässig.
    triggerWords: ["zeig nachbestellung", "öffne nachbestellung", "nachbestellungsübersicht", "nachbestellung anzeigen", "zeig die nachbestellliste", "folgerezept", "folgeverordnung"]
  },
  kilometer_oeffnen: {
    kind: "navigation",
    needsPatient: false,
    triggerWords: ["zeig kilometer", "öffne kilometer", "kilometeransicht", "kilometer anzeigen"]
  },
  stundenkonto_oeffnen: {
    kind: "navigation",
    needsPatient: false,
    triggerWords: ["zeig stundenkonto", "öffne stundenkonto", "stundenkonto anzeigen", "stundenübersicht öffnen"]
  },
  patientenliste_oeffnen: {
    kind: "navigation",
    needsPatient: false,
    triggerWords: ["zeig alle patienten", "patientenliste", "zeig die patientenliste", "öffne patientenliste"]
  },
  doku_liste_oeffnen: {
    kind: "navigation",
    needsPatient: false,
    // "schnelldoku" beim FaSti-Stichwort-Abgleich ergänzt (Abschnitt 5).
    triggerWords: ["zeig doku", "öffne doku", "doku anzeigen", "zeig die doku", "dokuliste", "doku-liste", "schnelldoku"]
  },
  abwesenheit_eintragen: {
    kind: "mutation",
    needsPatient: false,
    // "Ich bin vom 1.10. bis 5.10. im Urlaub" - Datum steht ZWISCHEN Verb und
    // Substantiv, feste Wortfolgen ("ich bin im urlaub") greifen daher nicht.
    // Kombination aus Urlaub/Krank-Bezug UND einer Meldungs-Formulierung.
    customDetect: (textLower) => (textLower.includes("urlaub") || textLower.includes("krank")) && (textLower.includes("ich bin") || textLower.includes("eintragen") || textLower.includes("melde") || textLower.includes("trage") || textLower.includes("krankgeschrieben"))
  },
  freikuvert_bestellen: {
    kind: "mutation",
    needsPatient: false,
    // "kuvert" beim FaSti-Stichwort-Abgleich ergänzt (Abschnitt 16, siehe
    // Beispiel im Auftrag: "Kuvert" gehört zum Freikuvert) - als Mutation
    // fragt FaSti vor dem eigentlichen Bestellen ohnehin erst nach, ein
    // versehentlicher Treffer ist also folgenlos abbrechbar.
    triggerWords: ["freikuvert bestellen", "freikuvert für", "bestelle freikuvert", "freiumschlag bestellen", "kuvert"]
  },
  // Neuen Patienten/eine neue Einrichtung komplett per Freitext anzulegen
  // wäre wegen der vielen Pflicht-/Prüffelder (Arzt, ICD-10,
  // Leitsymptomatik, Rezeptprüfung ...) zu fehleranfällig - FaSti springt
  // hier bewusst nur zum passenden, vorausgefüllten Formular statt selbst
  // Daten zu erzeugen.
  neuer_patient_anlegen: {
    kind: "navigation",
    needsPatient: false,
    triggerWords: ["neuen patienten anlegen", "neuer patient in", "patient anlegen in", "lege neuen patienten an"]
  },
  einrichtung_anlegen: {
    kind: "navigation",
    needsPatient: false,
    triggerWords: ["neue einrichtung anlegen", "neues heim anlegen", "leg neue einrichtung an", "lege neues heim an"]
  },
  // Löscht den Patienten NICHT (das bleibt dauerhaft nur über die
  // Stammdaten möglich, siehe Sicherheitsgrenze) - markiert ihn nur als
  // nicht mehr aktiv, damit weder FaSti noch die App künftig eine
  // Nachbestellung/Zuzahlungs-/Assessment-Erinnerung für ihn erwarten.
  patient_ausgeschieden_setzen: {
    kind: "mutation",
    triggerWords: ["ist ausgeschieden", "als ausgeschieden markieren", "ausgeschieden markieren", "nicht mehr aktiv", "wieder aktiv", "reaktivieren"]
  }
};

function detectFastiCommand(textLower) {
  for (const [commandId, def] of Object.entries(FASTI_COMMANDS)) {
    if (def.customDetect && def.customDetect(textLower)) return commandId;
    if (def.triggerWords && def.triggerWords.some((w) => textLower.includes(w))) return commandId;
  }
  return null;
}

function buildPatientLabel(home, patient) {
  const geb = patient.birthDate ? ` (geb. ${patient.birthDate})` : "";
  return `${fullPatientName(patient)} – ${home.name || "ohne Einrichtung"}${geb}`;
}

function buildRezeptLabel(rezept) {
  const heilmittel = (rezept.items || []).map((i) => i.type).join(", ") || "—";
  return `${heilmittel} (ausgestellt ${rezept.ausstell || "—"})`;
}

// Findet ALLE Patienten, deren Vor- oder Nachname (>=3 Zeichen) im Text
// vorkommt - im Gegensatz zu findPatientMention() (nimmt stillschweigend
// den längsten Treffer) wird hier explizit unterschieden zwischen "genau
// ein Treffer" und "mehrere gleichwertige Treffer", damit Letzteres eine
// echte Rückfrage auslöst statt eine möglicherweise falsche Annahme.
function resolvePatientMatches(data, textLower) {
  const seen = new Map();
  (data.homes || []).forEach((home) => {
    (home.patients || []).forEach((patient) => {
      if (patient.verstorben) return;
      const last = String(patient.lastName || "").trim();
      const first = String(patient.firstName || "").trim();
      // Summe statt Maximum: wer sowohl Vor- als auch Nachname im Text
      // erwähnt ("Peter Müller"), soll eindeutig vor jemandem gewinnen, der
      // nur denselben Nachnamen teilt ("Anna Müller") - ein reines Maximum
      // hätte beide gleich bewertet (beide "matchen" ja "Müller" gleich
      // lang) und selbst die vollständige Namensnennung wäre noch als
      // mehrdeutig gemeldet worden.
      let matchLength = 0;
      if (last.length >= 3 && textLower.includes(last.toLowerCase())) matchLength += last.length;
      if (first.length >= 3 && textLower.includes(first.toLowerCase())) matchLength += first.length;
      if (matchLength > 0) seen.set(`${home.homeId}:${patient.patientId}`, { home, patient, matchLength });
    });
  });

  const matches = Array.from(seen.values()).sort((a, b) => b.matchLength - a.matchLength);
  if (matches.length === 0) return { status: "none" };
  const maxLen = matches[0].matchLength;
  const tied = matches.filter((m) => m.matchLength === maxLen);
  if (tied.length === 1) return { status: "single", home: tied[0].home, patient: tied[0].patient };
  return { status: "ambiguous", matches: tied };
}

// Analog zu resolvePatientMatches(), aber für Einrichtungsnamen - gebraucht
// nur von "neuer_patient_anlegen" (dort existiert noch kein Patient, den man
// suchen könnte, wohl aber die Einrichtung, in der er angelegt werden soll).
function resolveHomeMatches(data, textLower) {
  const matches = (data.homes || [])
    .filter((home) => {
      const name = String(home.name || "").trim();
      return name.length >= 3 && textLower.includes(name.toLowerCase());
    })
    .map((home) => ({ home, matchLength: String(home.name || "").trim().length }));

  if (matches.length === 0) return { status: "none" };
  const maxLen = Math.max(...matches.map((m) => m.matchLength));
  const tied = matches.filter((m) => m.matchLength === maxLen);
  if (tied.length === 1) return { status: "single", home: tied[0].home };
  return { status: "ambiguous", matches: tied };
}

function getOffeneRezepte(patient) {
  return (patient?.rezepte || []).filter((r) => !r.abgegeben);
}

// Dieselbe Automatik wie im regulären Zeiterfassungs-Formular
// (getAutomaticTreatmentMinutesForZeit() in ui/views.js, faktisch identisch
// mit getAutomaticTreatmentMinutes() in homes.js) - hier dupliziert statt
// importiert, da beide Quellen entweder unexportiert oder in der
// UI-Schicht liegen (siehe Modulkommentar oben zu getFastiTimePeriodSummary).
function getAutoMinutesForRezept(rezept) {
  const items = Array.isArray(rezept?.items) ? rezept.items : [];
  if (items.length === 0) return 0;

  if (rezept?.bg) {
    return items.reduce((sum, item) => sum + getSingleLeistungMinutenFasti(item?.type), 0);
  }

  const hasBlanko = items.some((item) => normalizeLeistungNameFasti(item?.type) === "BLANKO");
  if (hasBlanko) return 20;

  const firstRelevant = items.find((item) => getSingleLeistungMinutenFasti(item?.type) > 0);
  const firstMinutes = firstRelevant ? getSingleLeistungMinutenFasti(firstRelevant.type) : 0;
  if (!firstMinutes) return 0;

  const firstKey = normalizeLeistungNameFasti(firstRelevant?.type);
  const isFixedMLD = firstKey === "MLD45" || firstKey === "MLD60";
  if (rezept?.dt && !isFixedMLD) return firstMinutes * 2;
  return firstMinutes;
}
function normalizeLeistungNameFasti(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "").replace(/–/g, "-").replace(/—/g, "-");
}
function getSingleLeistungMinutenFasti(type) {
  const key = normalizeLeistungNameFasti(type);
  if (["KG", "MT", "KG-ZNS", "KGZNS", "KG-ATEMTHERAPIE", "KGAT", "MLD30", "BLANKO"].includes(key)) return 20;
  if (key === "MLD45") return 40;
  if (key === "MLD60") return 60;
  return 0;
}

// Legt einen Zeiterfassungs-Eintrag exakt im selben Format an wie das
// reguläre Zeiterfassungs-Formular (Typ "behandlung", siehe views.js'
// "Zeit buchen"-Button) - modules/homes.js hat dafür keine exportierte
// Funktion (nur createRezeptTimeEntry() mit fest "besprechung" als Typ, für
// einen anderen Zweck). Optionales sourceEntryId verknüpft den neuen
// Zeiteintrag mit einem bereits bestehenden SchnellDoku-Eintrag (siehe
// answerDokuZeitBuchenChoice() unten) - genau die Verknüpfung, die
// entry.linkedTimeEntryId/timeEntry.sourceEntryId schon immer vorsahen.
function createFastiTimeEntry(homeId, patientId, rezeptId, { date, minutes, note = "", sourceEntryId = "" }) {
  mutateRuntimeData((data) => {
    const home = getHomeById(data, homeId);
    const patient = getPatientById(home, patientId);
    const rezept = getRezeptById(patient, rezeptId);
    if (!rezept) throw new Error("Rezept nicht gefunden");
    if (!Array.isArray(rezept.timeEntries)) rezept.timeEntries = [];
    const timeEntryId = generateId("time");
    rezept.timeEntries.push({
      timeEntryId,
      date,
      type: "behandlung",
      minutes,
      note,
      sourceEntryId,
      createdAt: new Date().toISOString()
    });
    if (sourceEntryId) {
      const sourceEntry = (rezept.entries || []).find((e) => e.entryId === sourceEntryId);
      if (sourceEntry) sourceEntry.linkedTimeEntryId = timeEntryId;
    }
  });
}

// Nimmt alles im Originaltext NACH der letzten Fundstelle des Patientennamens
// als den einzutragenden Text - passend zum in der Praxis erwarteten Muster
// "FaSti schreibe Doku Herr Müller: <Text>" (Befehl+Name zuerst, Inhalt
// danach). Liefert "", wenn nichts danach folgt - der Aufrufer fragt dann
// gezielt nach dem Text nach, statt einen leeren Eintrag anzulegen.
function extractContentAfterPatientName(rawText, patient) {
  const textLower = String(rawText || "").toLowerCase();
  const last = String(patient?.lastName || "").trim().toLowerCase();
  const first = String(patient?.firstName || "").trim().toLowerCase();
  let cutIndex = -1;
  if (last.length >= 3) {
    const idx = textLower.lastIndexOf(last);
    if (idx >= 0) cutIndex = Math.max(cutIndex, idx + last.length);
  }
  if (first.length >= 3) {
    const idx = textLower.lastIndexOf(first);
    if (idx >= 0) cutIndex = Math.max(cutIndex, idx + first.length);
  }
  if (cutIndex < 0) return "";
  return String(rawText || "").slice(cutIndex).replace(/^[\s:,;.\-–]+/, "").trim();
}

// Erkennt einen Zeitraum für eine Abwesenheitsmeldung: zwei explizite Daten
// ("vom 1.10. bis 5.10."), ein einzelnes Datum (dann from=to), "heute" oder
// "morgen". Bewusst einfacher als parseFastiZeitraum() (keine "letzte
// Woche"/"diesen Monat"-Angaben - für eine Abwesenheitsmeldung wird ein
// konkretes Datum erwartet). Liefert null, wenn nichts erkannt wurde.
function parseAbwesenheitZeitraum(rawText, today = new Date()) {
  const textLower = String(rawText || "").toLowerCase();
  const explicitDates = textLower.match(/\d{1,2}\.\d{1,2}\.\d{2,4}/g) || [];

  if (explicitDates.length >= 2) {
    const from = parseDeDate(normalizeDatePart(explicitDates[0]));
    const to = parseDeDate(normalizeDatePart(explicitDates[1]));
    if (from && to) return { from: formatDeDate(from), to: formatDeDate(to) };
  }
  if (explicitDates.length === 1) {
    const d = parseDeDate(normalizeDatePart(explicitDates[0]));
    if (d) return { from: formatDeDate(d), to: formatDeDate(d) };
  }
  if (textLower.includes("heute")) {
    const de = formatDeDate(getComparableFromDate(today));
    return { from: de, to: de };
  }
  if (textLower.includes("morgen")) {
    const de = formatDeDate(getComparableFromDate(addDaysToDate(today, 1)));
    return { from: de, to: de };
  }
  return null;
}

// context: { commandId, rawText, homeId?, patientId?, rezeptId?, content? } -
// homeId/patientId/rezeptId/content werden erst gesetzt, sobald sie über
// eine vorherige Rückfrage (choices) aufgelöst wurden; ist etwas davon noch
// offen, wird es hier aufgelöst - bei Mehrdeutigkeit mit choices statt einer
// Antwort zurückgegeben.
function runFastiCommand(context, data) {
  const commandDef = FASTI_COMMANDS[context.commandId];
  if (!commandDef) return { reply: FASTI_HELP_TEXT };

  let home = null;
  let patient = null;
  if (commandDef.needsPatient === false) {
    // App-weite Navigation (z.B. "Zeig Abgabeliste") - kein Patientenbezug
    // im Text zu erwarten, daher keine Namenssuche/Rückfrage nötig.
  } else if (context.homeId && context.patientId) {
    home = getHomeById(data, context.homeId);
    patient = getPatientById(home, context.patientId);
    if (!home || !patient) return { reply: "Dieser Patient wurde nicht gefunden (evtl. gelöscht)." };
  } else {
    const resolved = resolvePatientMatches(data, String(context.rawText || "").toLowerCase());
    if (resolved.status === "none") {
      return { reply: "Dazu konnte ich keinen Patienten finden. Bitte den vollen Vor- oder Nachnamen angeben." };
    }
    if (resolved.status === "ambiguous") {
      return {
        reply: "Es gibt mehrere passende Patienten. Wen meinst du?",
        choices: resolved.matches.map((m) => ({
          label: buildPatientLabel(m.home, m.patient),
          resume: { ...context, homeId: m.home.homeId, patientId: m.patient.patientId }
        }))
      };
    }
    home = resolved.home;
    patient = resolved.patient;
  }

  const needsRezept = context.commandId === "doku_schreiben" || context.commandId === "zeit_eintragen";
  let rezept = null;
  if (needsRezept) {
    if (context.rezeptId) {
      rezept = getRezeptById(patient, context.rezeptId);
    } else {
      const offene = getOffeneRezepte(patient);
      if (offene.length === 0) {
        return { reply: `${fullPatientName(patient)} hat kein offenes (nicht abgegebenes) Rezept, dem ich den Eintrag zuordnen könnte.` };
      }
      if (offene.length > 1) {
        return {
          reply: `${fullPatientName(patient)} hat mehrere offene Rezepte. Welches meinst du?`,
          choices: offene.map((r) => ({
            label: buildRezeptLabel(r),
            resume: { ...context, homeId: home.homeId, patientId: patient.patientId, rezeptId: r.rezeptId }
          }))
        };
      }
      rezept = offene[0];
    }
    if (!rezept) return { reply: "Dieses Rezept wurde nicht gefunden (evtl. gelöscht)." };
  }

  if (context.commandId === "doku_schreiben") {
    // freeTextAnswer: generische Antwort auf eine vorherige awaitingInput-
    // Rückfrage (siehe unten) - die UI hängt die nächste Chat-Nachricht
    // unverändert hier an, statt sie neu zu parsen.
    const content = context.freeTextAnswer !== undefined ? context.freeTextAnswer : extractContentAfterPatientName(context.rawText, patient);
    if (!content) {
      return {
        reply: `Was soll ich für ${fullPatientName(patient)} in die Doku eintragen? Bitte einfach den Text als nächste Nachricht schicken.`,
        awaitingInput: { resume: { ...context, homeId: home.homeId, patientId: patient.patientId, rezeptId: rezept.rezeptId } }
      };
    }
    const todayDe = formatDeDate(getComparableFromDate(new Date()));
    return {
      reply: `Doku-Eintrag für ${fullPatientName(patient)} am ${todayDe} anlegen: "${content}"?`,
      action: {
        type: "doku_eintrag_anlegen",
        homeId: home.homeId,
        patientId: patient.patientId,
        rezeptId: rezept.rezeptId,
        content,
        date: todayDe,
        patientName: fullPatientName(patient)
      }
    };
  }

  if (context.commandId === "zeit_eintragen") {
    const explicitMinutesMatch = String(context.rawText || "").match(/(\d{1,3})\s*(minuten|min\b)/i);
    const explicitMinutes = explicitMinutesMatch ? Number(explicitMinutesMatch[1]) : null;

    const explicitDateMatch = String(context.rawText || "").match(/\d{1,2}\.\d{1,2}\.\d{2,4}/);
    const parsedExplicitDate = explicitDateMatch ? parseDeDate(normalizeDatePart(explicitDateMatch[0])) : null;
    const dateDe = parsedExplicitDate ? formatDeDate(parsedExplicitDate) : formatDeDate(getComparableFromDate(new Date()));

    const autoMinutes = getAutoMinutesForRezept(rezept);
    const minutes = explicitMinutes || (autoMinutes > 0 ? autoMinutes : 20);

    return {
      reply: `${minutes} Minuten für ${fullPatientName(patient)} am ${dateDe} buchen (${buildRezeptLabel(rezept)})?`,
      action: {
        type: "zeit_eintrag_anlegen",
        homeId: home.homeId,
        patientId: patient.patientId,
        rezeptId: rezept.rezeptId,
        minutes,
        date: dateDe,
        patientName: fullPatientName(patient)
      }
    };
  }

  if (context.commandId === "rezeptoptimierer_oeffnen") {
    return {
      reply: `Öffne die Rezeptoptimierung für ${fullPatientName(patient)}.`,
      navigate: { view: "rezeptoptimierer", homeId: home.homeId, patientId: patient.patientId }
    };
  }

  if (context.commandId === "patient_oeffnen") {
    return {
      reply: `Öffne ${fullPatientName(patient)}.`,
      navigate: { view: "patient-detail", homeId: home.homeId, patientId: patient.patientId }
    };
  }

  if (context.commandId === "patient_ausgeschieden_setzen") {
    const textLower = String(context.rawText || "").toLowerCase();
    // "wieder aktiv"/"reaktivieren"/"nicht mehr ausgeschieden" heben den
    // Status auf, alles andere (inkl. "nicht mehr aktiv") setzt ihn.
    const value = !(textLower.includes("wieder aktiv") || textLower.includes("reaktivieren") || textLower.includes("nicht mehr ausgeschieden"));
    const name = fullPatientName(patient);
    if (!!patient.ausgeschieden === value) {
      return { reply: `${name} ist bereits als "${value ? "ausgeschieden" : "aktiv"}" markiert.` };
    }
    return {
      reply: value
        ? `${name} als ausgeschieden markieren? Der Patient bleibt erhalten, gilt aber nicht mehr als aktiv - keine Nachbestellungs-, Zuzahlungs- oder Assessment-Erinnerungen mehr.`
        : `${name} wieder als aktiv markieren?`,
      action: { type: "patient_ausgeschieden_setzen", homeId: home.homeId, patientId: patient.patientId, patientName: name, value }
    };
  }

  if (context.commandId === "rezept_anlegen") {
    return {
      reply: `Öffne "Neues Rezept" für ${fullPatientName(patient)}.`,
      navigate: { view: "rezept-create", homeId: home.homeId, patientId: patient.patientId }
    };
  }

  if (context.commandId === "assessment_durchfuehren") {
    return {
      reply: `Starte das Assessment für ${fullPatientName(patient)}.`,
      navigate: { view: "assessment-abfrage", homeId: home.homeId, patientId: patient.patientId }
    };
  }

  if (context.commandId === "arztbericht_oeffnen") {
    return {
      reply: `Öffne den Arztbericht für ${fullPatientName(patient)}.`,
      navigate: { view: "arztbericht", homeId: home.homeId, patientId: patient.patientId }
    };
  }

  if (context.commandId === "abgabeliste_oeffnen") {
    return { reply: "Öffne die Abgabeliste.", navigate: { view: "abgabe" } };
  }

  if (context.commandId === "nachbestellungsuebersicht_oeffnen") {
    return { reply: "Öffne die Nachbestellungsübersicht.", navigate: { view: "nachbestellung" } };
  }

  if (context.commandId === "kilometer_oeffnen") {
    return { reply: "Öffne die Kilometer-Übersicht.", navigate: { view: "kilometer" } };
  }

  if (context.commandId === "stundenkonto_oeffnen") {
    return { reply: "Öffne das Stundenkonto.", navigate: { view: "stundenkonto" } };
  }

  if (context.commandId === "patientenliste_oeffnen") {
    return { reply: "Öffne die Patientenliste.", navigate: { view: "patientenliste" } };
  }

  if (context.commandId === "doku_liste_oeffnen") {
    return { reply: "Öffne die Doku-Übersicht.", navigate: { view: "doku-liste" } };
  }

  if (context.commandId === "abwesenheit_eintragen") {
    // Der Typ (Urlaub/Krank) wird IMMER aus der ursprünglichen Nachricht
    // bestimmt, nicht aus einer späteren freeTextAnswer (die bei der
    // Rückfrage nur noch das Datum enthält).
    const abwesenheitType = String(context.rawText || "").toLowerCase().includes("krank") ? "krank" : "urlaub";
    const dateSource = context.freeTextAnswer !== undefined ? context.freeTextAnswer : context.rawText;
    const range = parseAbwesenheitZeitraum(dateSource);

    if (!range) {
      return {
        reply: `Für welchen Zeitraum? Bitte als TT.MM.JJJJ angeben (einzelnes Datum oder "vom ... bis ...").`,
        awaitingInput: { resume: { ...context } }
      };
    }

    const label = abwesenheitType === "krank" ? "Krankheit" : "Urlaub";
    return {
      reply: `${label} vom ${range.from} bis ${range.to} eintragen?`,
      action: { type: "abwesenheit_anlegen", abwesenheitType, from: range.from, to: range.to }
    };
  }

  if (context.commandId === "freikuvert_bestellen") {
    const searchText = context.freeTextAnswer !== undefined ? context.freeTextAnswer : context.rawText;
    const arzt = findDoctorMention(data, String(searchText || "").toLowerCase());

    if (!arzt) {
      return {
        reply: "Für welchen Arzt soll ich das Freikuvert bestellen? Bitte den Namen angeben.",
        awaitingInput: { resume: { ...context } }
      };
    }

    const registry = getArztRegistry(data);
    const arztAdresse = registry.find((r) => r.name === arzt)?.adresse || "";

    return {
      reply: `Freikuvert (10 Stück) für ${arzt} bestellen?`,
      action: { type: "freikuvert_bestellen", arztName: arzt, arztAdresse }
    };
  }

  if (context.commandId === "neuer_patient_anlegen") {
    if (context.homeId) {
      const resolvedHome = getHomeById(data, context.homeId);
      if (!resolvedHome) return { reply: "Diese Einrichtung wurde nicht gefunden (evtl. gelöscht)." };
      return {
        reply: `Öffne "Neuer Patient" für ${resolvedHome.name}.`,
        navigate: { view: "patient-create", homeId: resolvedHome.homeId }
      };
    }

    const resolvedHomeMatch = resolveHomeMatches(data, String(context.rawText || "").toLowerCase());
    if (resolvedHomeMatch.status === "none") {
      return { reply: 'Für welche Einrichtung? Bitte den Namen angeben, z.B. "Neuen Patienten anlegen in Heim Sonnenhof".' };
    }
    if (resolvedHomeMatch.status === "ambiguous") {
      return {
        reply: "Es gibt mehrere passende Einrichtungen. Welche meinst du?",
        choices: resolvedHomeMatch.matches.map((m) => ({
          label: m.home.name,
          resume: { ...context, homeId: m.home.homeId }
        }))
      };
    }
    return {
      reply: `Öffne "Neuer Patient" für ${resolvedHomeMatch.home.name}.`,
      navigate: { view: "patient-create", homeId: resolvedHomeMatch.home.homeId }
    };
  }

  if (context.commandId === "einrichtung_anlegen") {
    return { reply: 'Öffne die Einrichtungsübersicht - dort kannst du über "Neues Heim anlegen" eine neue Einrichtung erstellen.', navigate: { view: "homes" } };
  }

  return { reply: FASTI_HELP_TEXT };
}

// Dieselbe Mehrdeutigkeits-Auflösung wie runFastiCommand(), jetzt auch für
// die reinen Abfrage-Intents (Bereich 1-5-Fragen) - vorher nutzten diese noch
// den alten, stillschweigend besten Treffer ohne Rückfrage
// (findPatientMention(), jetzt entfernt), was inkonsistent zum neuen
// Befehlsweg war: derselbe Name sollte unabhängig davon, ob er eine Abfrage
// oder einen Befehl auslöst, gleich behandelt werden. context:
// { kind: "intent", intent, rawText, textLower, zeitraum, homeId?, patientId? }.
// "none" (kein Name erwähnt) lässt Patient bewusst leer - die einzelnen
// answer*Intent()-Funktionen liefern dafür weiterhin ihre Gesamtübersicht.
function runFastiIntent(context, data) {
  const needsPatient = ["assessment", "rezept", "zuzahlung", "frist"].includes(context.intent);
  let home = null;
  let patient = null;

  if (needsPatient) {
    if (context.homeId && context.patientId) {
      home = getHomeById(data, context.homeId);
      patient = getPatientById(home, context.patientId);
      if (!home || !patient) return { reply: "Dieser Patient wurde nicht gefunden (evtl. gelöscht)." };
    } else {
      const resolved = resolvePatientMatches(data, context.textLower);
      if (resolved.status === "ambiguous") {
        return {
          reply: "Es gibt mehrere passende Patienten. Wen meinst du?",
          choices: resolved.matches.map((m) => ({
            label: buildPatientLabel(m.home, m.patient),
            resume: { ...context, homeId: m.home.homeId, patientId: m.patient.patientId }
          }))
        };
      }
      if (resolved.status === "single") {
        home = resolved.home;
        patient = resolved.patient;
      }
    }
  }

  const patientMatch = home && patient ? { home, patient } : null;

  switch (context.intent) {
    case "assessment": return answerAssessmentIntent(data, patientMatch);
    case "rezept": return answerRezeptIntent(data, patientMatch);
    case "stunden": return answerStundenIntent(data, context.zeitraum);
    case "urlaub": return answerUrlaubIntent(data);
    case "krank": return answerKrankIntent(data, context.zeitraum);
    case "zuzahlung": return answerZuzahlungIntent(data, context.textLower, patientMatch);
    case "frist": return answerFristIntent(data, patientMatch);
    case "nachbestellung": return answerNachbestellungIntent(data, context.textLower);
    case "kilometer": return answerKilometerIntent(data, context.zeitraum);
    default: return { reply: FASTI_HELP_TEXT };
  }
}

// Von der UI aufzurufen, wenn der Nutzer auf einen der Auswahl-Buttons einer
// vorherigen { choices }-Antwort klickt - setzt entweder einen Befehl
// (runFastiCommand) oder eine Abfrage (runFastiIntent) mit dem jetzt
// aufgelösten resume-Kontext fort (kann erneut choices, eine action oder
// eine navigate-Antwort liefern, falls noch etwas offen ist).
// Antwort auf die "Soll ich für diesen Termin auch Zeit buchen?"-Rückfrage
// (siehe executeFastiAction() Fall "doku_eintrag_anlegen") - minutes:0 heißt
// "Nein", alles andere bucht per createFastiTimeEntry() und verknüpft den
// Zeiteintrag mit dem bereits angelegten Doku-Eintrag (resume.entryId).
function answerDokuZeitBuchenChoice(resume, data) {
  if (!resume.minutes || resume.minutes <= 0) {
    return { reply: "Alles klar, keine Zeit gebucht." };
  }
  createFastiTimeEntry(resume.homeId, resume.patientId, resume.rezeptId, {
    date: resume.date,
    minutes: resume.minutes,
    sourceEntryId: resume.entryId
  });
  return { reply: `${resume.minutes} Minuten für ${resume.patientName} am ${resume.date} gebucht.`, needsPersist: true };
}

export function resumeFastiChoice(resume, data) {
  if (resume?.kind === "intent") return runFastiIntent(resume, data);
  if (resume?.kind === "nachbestell_queue") return processNachbestellQueue(resume.queue, resume.arzt, data);
  if (resume?.kind === "doku_zeit_buchen") return answerDokuZeitBuchenChoice(resume, data);
  return runFastiCommand(resume, data);
}

// Haupteinstiegspunkt für den Aktiv-Chat. Liefert { reply, action? } - ist
// action gesetzt, muss die UI vor der Ausführung eine Bestätigung einholen
// und danach executeFastiAction() aufrufen. { reply, choices? } verlangt
// stattdessen eine Auswahl (siehe resumeFastiChoice()), { reply, navigate? }
// verlangt einen sofortigen Ansichtswechsel ohne Bestätigung.
export function answerFastiChat(rawText, data) {
  const text = String(rawText || "").trim();
  if (!text) return { reply: "Wie kann ich helfen?" };

  const textLower = text.toLowerCase();

  const commandId = detectFastiCommand(textLower);
  if (commandId) return runFastiCommand({ kind: "command", commandId, rawText: text }, data);

  const intent = detectIntent(textLower);
  if (!intent) return { reply: FASTI_HELP_TEXT };

  const zeitraum = parseFastiZeitraum(text);
  return runFastiIntent({ kind: "intent", intent, rawText: text, textLower, zeitraum }, data);
}

// ============================================================
// Aktionen (nur nach Bestätigung durch die UI aufzurufen)
// ============================================================
export function executeFastiAction(action, data) {
  switch (action?.type) {
    case "zuzahlung_setzen": {
      setZuzahlungsstatus(action.homeId, action.patientId, action.status);
      return { message: `${action.patientName}: Zuzahlungsstatus auf "${zuzahlungLabel(action.status)}" gesetzt.`, needsPersist: true };
    }

    case "patient_ausgeschieden_setzen": {
      setPatientAusgeschieden(action.homeId, action.patientId, action.value);
      return { message: `${action.patientName} als "${action.value ? "ausgeschieden" : "aktiv"}" markiert.`, needsPersist: true };
    }

    case "assessment_verschieben": {
      const dueDateComparable = getComparableFromDate(addDaysToDate(new Date(), 90));
      scheduleAssessment(action.homeId, action.patientId, dueDateComparable);
      return { message: `Nächstes Assessment für ${action.patientName} auf ${formatDeDate(dueDateComparable)} gesetzt.`, needsPersist: true };
    }

    // "nachbestellung_vorschlagen" (aus einer Batch-Meldung) läuft NICHT
    // mehr über diese Funktion, sondern über startNachbestellungVorschlag()
    // (siehe dort) - erst danach, wenn feststeht, dass keine
    // Optimierungs-Rückfrage mehr nötig ist, kommt hier "nachbestellzettel_erzeugen" an.
    case "nachbestellzettel_erzeugen": {
      const letterData = buildNachbestellLetterData(data, action.rows);
      return { message: `Nachbestellzettel für ${action.doctor} erstellt.`, letterData, needsPersist: false };
    }

    case "doku_eintrag_anlegen": {
      const entryId = createRezeptEntry(action.homeId, action.patientId, action.rezeptId, { date: action.date, text: action.content });
      // Direkt danach fragen, ob dafür auch Zeit gebucht werden soll - FaSti
      // bucht NICHT still im Hintergrund, sondern schlägt nur die aus der
      // Leistungsart berechnete Dauer als Option vor (genau wie das reguläre
      // "Zeit buchen"-Formular mit 20/40/60 Minuten zur Auswahl anbietet,
      // nur eben nicht ungefragt).
      const home = getHomeById(data, action.homeId);
      const patient = getPatientById(home, action.patientId);
      const rezept = getRezeptById(patient, action.rezeptId);
      const autoMinutes = getAutoMinutesForRezept(rezept);
      const followUp = autoMinutes > 0
        ? {
            reply: `Soll ich für diesen Termin auch die Zeit buchen (${autoMinutes} Minuten)?`,
            choices: [
              {
                label: `Ja, ${autoMinutes} Minuten buchen`,
                resume: { kind: "doku_zeit_buchen", homeId: action.homeId, patientId: action.patientId, rezeptId: action.rezeptId, entryId, date: action.date, patientName: action.patientName, minutes: autoMinutes }
              },
              {
                label: "Nein",
                resume: { kind: "doku_zeit_buchen", homeId: action.homeId, patientId: action.patientId, rezeptId: action.rezeptId, entryId, date: action.date, patientName: action.patientName, minutes: 0 }
              }
            ]
          }
        : null;
      return { message: `Doku-Eintrag für ${action.patientName} am ${action.date} angelegt.`, needsPersist: true, followUp };
    }

    case "zeit_eintrag_anlegen": {
      createFastiTimeEntry(action.homeId, action.patientId, action.rezeptId, { date: action.date, minutes: action.minutes });
      return { message: `${action.minutes} Minuten für ${action.patientName} am ${action.date} gebucht.`, needsPersist: true };
    }

    case "abwesenheit_anlegen": {
      createAbwesenheit({ type: action.abwesenheitType, from: action.from, to: action.to });
      const label = action.abwesenheitType === "krank" ? "Krankheit" : "Urlaub";
      return { message: `${label} vom ${action.from} bis ${action.to} eingetragen.`, needsPersist: true };
    }

    case "freikuvert_bestellen": {
      const therapistName = String(data?.settings?.therapistName || "").trim();
      saveFreikuvertBestellung({ arztName: action.arztName, arztAdresse: action.arztAdresse, therapistName });
      return { message: `Freikuvert für ${action.arztName} bestellt.`, needsPersist: true };
    }

    default:
      throw new Error("Unbekannte FaSti-Aktion.");
  }
}
