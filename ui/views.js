import { createEmptyAppData, APP_VERSION, PRACTICE_ADDRESS, PRACTICE_PHONE } from "../data/schema.js";
import { HILFE_KAPITEL } from "../data/hilfe-inhalt.js";
import { setupSecurity, unlockWithPIN, changePIN } from "../security/auth.js";
import { getRemainingLockoutMs } from "../security/lock.js";
import {
  getCryptoMeta,
  getSecurityState,
  setRuntimeSession,
  setCryptoMeta,
  setSecurityState,
  clearRuntimeSession,
  getRuntimeData,
  getRuntimeKey,
  setCurrentView,
  getCurrentView,
  getCurrentContext,
  queuePersistRuntimeData,
  mutateRuntimeData
} from "../core/app-core.js";
import { loadEncryptedAppData } from "../storage/secure-store.js";
import { closeDatabase } from "../storage/indexeddb.js";
import { logSecurityEvent } from "../security/security-log.js";
import {
  createHome,
  createPatient,
  updatePatient,
  updateHomeAddress,
  deleteHome,
  deletePatient,
  createRezept,
  updateRezept,
  markRezeptAbgegeben,
  unmarkRezeptAbgegeben,
  deleteRezept,
  createRezeptEntry,
  updateRezeptEntry,
  deleteRezeptEntry,
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
  deleteAbgabeHistoryItem,
  saveNachbestellHistorySnapshot,
  deleteNachbestellHistoryItem,
  buildNachbestellLetterData,
  buildAbgabeTree,
  buildNachbestellTree,
  createRezeptTimeEntry,
  deleteRezeptTimeEntry,
  getRezeptTimeEntries,
  getRezeptTimeSummary,
  saveKilometerStartPoint,
  saveKnownKilometerRoute,
  getKilometerOverview,
  getKilometerPointOptions,
  addManualKilometerTravel,
  updateKilometerTravel,
  deleteKilometerTravel,
  getKilometerPeriodSummary,
  finalizeKilometerExport,
  previewNextKilometerZettelNumber,
  saveDiagnoseZuordnung,
  deleteDiagnoseZuordnung,
  setZuzahlungsstatus,
  acknowledgeZuzahlungReminder,
  getFaelligeZuzahlungErinnerungen,
  createAbwesenheit,
  getArztRegistry,
  upsertArztAdresse,
  renameArzt,
  saveFreikuvertBestellung,
  scheduleAssessment,
  saveAssessmentResult,
  saveAssessmentDraft,
  clearAssessmentDraft,
  getFaelligeAssessmentErinnerungen
} from "../modules/homes.js";
import { getRezeptFristInfo } from "../modules/fristen.js";
import { validateRezeptPflichtfelder } from "../modules/rezeptpruefung.js";
import {
  optimiereVerordnung,
  resolveDiagnoseInput,
  formatICD,
  EMPFEHLUNG_ZU_ITEM_TYPE,
  VERGUETUNG,
  getDefaultLeitsymptomatik
} from "../modules/rezeptoptimierung.js";
import * as Assessment from "../modules/assessment.js";
import * as AssessmentInfo from "../modules/assessmentInfo.js";
import { exportBackup, importBackup, downloadBlob, validateBackupZip } from "../modules/backup.js";
import {
  buildBackupZip,
  buildBackupReminderMailtoLink,
  markBackupReminderHandled,
  markBackupReminderPostponed,
  markAutoBackupDownloadHandled
} from "../modules/backupReminder.js";
import { answerFastiChat, executeFastiAction, resumeFastiChoice, startNachbestellungVorschlag, buildFastiNotices } from "../modules/fasti.js";
import { generateId, formatPatientName } from "../core/utils.js";
import {
  normalizeDeDateInput,
  parseDeDate,
  formatDeDate,
  compareDeDates,
  isDateInRange,
  parseComparableDate,
  getComparableFromDate,
  listComparableDatesInRange
} from "../core/date-utils.js";

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

function isPatientDeceased(patient) {
  return !!patient?.verstorben;
}

// Verstorbene UND ausgeschiedene Patienten gelten beide als "nicht mehr
// aktiv" (siehe patient.ausgeschieden) - genutzt, um beide Gruppen aus
// patientenübergreifenden AKTIVITÄTS-Übersichten (Zeiterfassung,
// Dashboard-Doku-Liste, Patientenliste, Arztübersicht) herauszuhalten, wo
// sie sonst neben echten Behandlungsfällen auftauchen, ohne dort etwas zu
// tun zu haben. Bewusst NICHT in der Einrichtung->Patient-Stammdaten-Ansicht
// verwendet - dort müssen ausgeschiedene Patienten weiterhin auffindbar
// bleiben, u.a. um sie bei Bedarf wieder zu reaktivieren.
function isPatientInactive(patient) {
  return isPatientDeceased(patient) || !!patient?.ausgeschieden;
}

function hatAktivesRezept(patient) {
  return (patient.rezepte || []).some((r) => r.abgegeben !== true);
}

function sortRezepteForDisplay(rezepte) {
  return [...(rezepte || [])].sort((a, b) => compareDeDates(b?.ausstell, a?.ausstell));
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
      ${rezept.privat ? `<span class="pill">🔒 Privat</span>` : ""}
      ${rezept.bg ? `<span class="pill">BG</span>` : ""}
      ${rezept.dt ? `<span class="pill">DT</span>` : ""}
      ${rezept.dringend ? `<span class="pill">Dringend</span>` : ""}
      ${blanko ? `<span class="pill">Blanko</span>` : ""}
      ${rezept.privat ? "" : `<span class="${trafficClass}">${escapeHtml(frist.statusText || "Frist")}</span>`}
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

function formatHoursClockLabel(minutes) {
  const total = Math.max(0, Number(minutes) || 0);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${h}:${String(m).padStart(2, "0")} Stunden`;
}

function getSignedMinutesLabel(minutes) {
  const total = Number(minutes) || 0;
  const sign = total < 0 ? "-" : "+";
  const absolute = Math.abs(total);
  const h = Math.floor(absolute / 60);
  const m = absolute % 60;
  return `${sign}${h}:${String(m).padStart(2, "0")} Stunden`;
}

function parseStundenStartsaldoInput(value) {
  const raw = String(value || "").trim();
  if (!raw) return 0;
  const normalized = raw.replace(",", ".");
  const clockMatch = normalized.match(/^([+-])?\s*(\d{1,4})(?::(\d{1,2}))?$/);
  if (clockMatch) {
    const sign = clockMatch[1] === "-" ? -1 : 1;
    const hours = Number(clockMatch[2]);
    const minutes = Number(clockMatch[3] || 0);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes) || minutes >= 60) return null;
    return sign * ((hours * 60) + minutes);
  }
  const decimalMatch = normalized.match(/^([+-])?\s*(\d{1,4})(?:\.(\d{1,2}))?$/);
  if (!decimalMatch) return null;
  const sign = decimalMatch[1] === "-" ? -1 : 1;
  const hours = Number(`${decimalMatch[2]}.${decimalMatch[3] || "0"}`);
  if (!Number.isFinite(hours)) return null;
  return sign * Math.round(hours * 60);
}

function getStundenStartsaldoMinutes(settings) {
  const value = Number(settings?.stundenStartsaldoMinuten || 0);
  return Number.isFinite(value) ? Math.round(value) : 0;
}

function getFastStartDatumComparable(settings) {
  const value = String(settings?.fastStartDatum || '').trim();
  if (!value) return '';
  return parseComparableDate(value) ? value : (parseDeDate(value) || '');
}

function getEffectiveTimeSummaryFromDate(fromDate, fastStartComparable) {
  const requestedFrom = parseDeDate(fromDate);
  if (requestedFrom && fastStartComparable) {
    return formatDeDate(requestedFrom > fastStartComparable ? requestedFrom : fastStartComparable);
  }
  if (requestedFrom) return formatDeDate(requestedFrom);
  if (fastStartComparable) return formatDeDate(fastStartComparable);
  return String(fromDate || '').trim();
}

function formatComparableToDe(value) {
  return formatDeDate(value);
}

function getWorkDayCodeFromComparable(comparableDate) {
  const date = parseComparableDate(comparableDate);
  if (!date) return '';
  const dayMap = ['SO', 'MO', 'DI', 'MI', 'DO', 'FR', 'SA'];
  return dayMap[date.getDay()] || '';
}

// --- Kalender für die Zeitraum-Auswertung (Etappe A) ---

function buildCalendarMonthGrid(year, month) {
  // month: 1-12. Woche beginnt mit Montag.
  const firstOfMonth = new Date(year, month - 1, 1, 12, 0, 0, 0);
  const lastOfMonth = new Date(year, month, 0, 12, 0, 0, 0);
  const daysInMonth = lastOfMonth.getDate();
  const firstWeekday = (firstOfMonth.getDay() + 6) % 7; // 0=Montag...6=Sonntag

  const cells = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push(getComparableFromDate(new Date(year, month - 1, day, 12, 0, 0, 0)));
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function getMonthLabelDe(year, month) {
  const monthNames = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
  return `${monthNames[month - 1]} ${year}`;
}

function shiftMonth(year, month, delta) {
  const total = (year * 12 + (month - 1)) + delta;
  return { year: Math.floor(total / 12), month: (total % 12) + 1 };
}

function getQuickRangeDates(key) {
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const todayComparable = getComparableFromDate(today);

  function startOfWeek(date) {
    const d = new Date(date.getTime());
    const weekday = (d.getDay() + 6) % 7; // 0=Montag
    d.setDate(d.getDate() - weekday);
    return d;
  }

  if (key === 'thisWeek') {
    const start = startOfWeek(today);
    const end = new Date(start.getTime());
    end.setDate(end.getDate() + 6);
    return { from: getComparableFromDate(start), to: getComparableFromDate(end) };
  }
  if (key === 'lastWeek') {
    const start = startOfWeek(today);
    start.setDate(start.getDate() - 7);
    const end = new Date(start.getTime());
    end.setDate(end.getDate() + 6);
    return { from: getComparableFromDate(start), to: getComparableFromDate(end) };
  }
  if (key === 'thisMonth') {
    const start = new Date(today.getFullYear(), today.getMonth(), 1, 12, 0, 0, 0);
    const end = new Date(today.getFullYear(), today.getMonth() + 1, 0, 12, 0, 0, 0);
    return { from: getComparableFromDate(start), to: getComparableFromDate(end) };
  }
  if (key === 'lastMonth') {
    const start = new Date(today.getFullYear(), today.getMonth() - 1, 1, 12, 0, 0, 0);
    const end = new Date(today.getFullYear(), today.getMonth(), 0, 12, 0, 0, 0);
    return { from: getComparableFromDate(start), to: getComparableFromDate(end) };
  }
  return { from: todayComparable, to: todayComparable };
}

function getDailyPlannedMinutes(settings) {
  const workDays = Array.isArray(settings?.workDays) ? settings.workDays.filter(Boolean) : [];
  const weeklyHoursValue = String(settings?.weeklyHours || '').replace(',', '.').trim();
  const weeklyHours = Number(weeklyHoursValue);
  if (!workDays.length || !Number.isFinite(weeklyHours) || weeklyHours <= 0) return 0;
  return Math.round((weeklyHours * 60) / workDays.length);
}

function getAbsenceRows(data) {
  return Array.isArray(data?.abwesenheiten) ? data.abwesenheiten : [];
}

function getSpecialDayRows(data) {
  return Array.isArray(data?.specialDays) ? data.specialDays : [];
}

function getStundenAbgleichRows(data) {
  return Array.isArray(data?.stundenAbgleiche) ? data.stundenAbgleiche : [];
}

function getStundenAbgleichTypLabel(typ) {
  return typ === "frei" ? "Überstundenfrei" : "Auszahlung";
}

function isComparableDateWithinAbsence(comparableDate, absence) {
  const from = parseDeDate(absence?.from);
  const to = parseDeDate(absence?.to);
  if (!from || !to || !comparableDate) return false;
  return comparableDate >= from && comparableDate <= to;
}

function getAbsenceForComparableDate(data, comparableDate) {
  return getAbsenceRows(data).find((item) => isComparableDateWithinAbsence(comparableDate, item)) || null;
}

function getSpecialDayForComparableDate(data, comparableDate) {
  if (!comparableDate) return null;
  const targetDate = formatComparableToDe(comparableDate);
  return getSpecialDayRows(data).find((item) => item?.date === targetDate) || null;
}

function collectAllTimeEntries(data) {
  const rows = [];
  (data?.homes || []).forEach((home) => {
    (home?.patients || []).forEach((patient) => {
      const patientName = `${patient?.lastName || ""}, ${patient?.firstName || ""}`.replace(/^,\s*/, "").trim() || 'Ohne Namen';
      (patient?.rezepte || []).forEach((rezept) => {
        getRezeptTimeEntries(rezept).forEach((entry) => {
          const minutes = Number(entry?.minutes || 0);
          if (!Number.isFinite(minutes) || minutes <= 0) return;
          rows.push({
            date: String(entry?.date || '').trim(),
            minutes,
            patientName,
            homeName: home?.name || '',
            rezeptLabel: rezeptSummary(rezept),
            type: entry?.type || '',
            note: entry?.note || '',
            createdAt: entry?.createdAt || '',
            homeId: home?.homeId || '',
            patientId: patient?.patientId || '',
            rezeptId: rezept?.rezeptId || '',
            timeEntryId: entry?.timeEntryId || ''
          });
        });
      });
    });
  });
  return rows;
}

function getTimePeriodSummary(data, fromDate, toDate) {
  const fastStartComparable = getFastStartDatumComparable(data?.settings);
  const effectiveFromDate = getEffectiveTimeSummaryFromDate(fromDate, fastStartComparable);
  const rows = collectAllTimeEntries(data)
    .filter((entry) => isDateInRange(entry.date, effectiveFromDate, toDate));

  const totalsByDate = new Map();
  const entriesByDate = new Map();
  rows.forEach((entry) => {
    totalsByDate.set(entry.date, (totalsByDate.get(entry.date) || 0) + entry.minutes);
    if (!entriesByDate.has(entry.date)) entriesByDate.set(entry.date, []);
    entriesByDate.get(entry.date).push(entry);
  });

  const periodDates = listComparableDatesInRange(effectiveFromDate, toDate);
  const workDays = Array.isArray(data?.settings?.workDays) ? data.settings.workDays : [];
  const dailyPlannedMinutes = getDailyPlannedMinutes(data?.settings);

  const dailyRows = periodDates.map((comparableDate) => {
    const date = formatComparableToDe(comparableDate);
    const totalMinutes = Number(totalsByDate.get(date) || 0);
    const workDayCode = getWorkDayCodeFromComparable(comparableDate);
    const isWorkDay = workDays.includes(workDayCode);
    const absence = isWorkDay ? getAbsenceForComparableDate(data, comparableDate) : null;
    const specialDay = isWorkDay && !absence ? getSpecialDayForComparableDate(data, comparableDate) : null;
    const plannedMinutes = isWorkDay && !absence && !specialDay ? dailyPlannedMinutes : 0;
    const saldoMinutes = totalMinutes - plannedMinutes;

    return {
      date,
      totalMinutes,
      plannedMinutes,
      saldoMinutes,
      isWorkDay,
      absenceType: absence?.type || '',
      isHoliday: Boolean(specialDay),
      entries: (entriesByDate.get(date) || [])
        .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || ''), 'de'))
    };
  }).filter((row) => row.totalMinutes > 0 || row.plannedMinutes > 0 || row.absenceType || row.isHoliday);

  const totalMinutes = dailyRows.reduce((sum, row) => sum + row.totalMinutes, 0);
  const plannedMinutes = dailyRows.reduce((sum, row) => sum + row.plannedMinutes, 0);
  const appSaldoMinutes = totalMinutes - plannedMinutes;
  const stundenStartsaldoMinuten = getStundenStartsaldoMinutes(data?.settings);
  const stundenAbgleichRows = getStundenAbgleichRows(data)
    .filter((item) => isDateInRange(item?.datum, effectiveFromDate, toDate))
    .sort((a, b) => compareDeDates(a?.datum, b?.datum));
  const stundenAbgleichMinuten = stundenAbgleichRows.reduce((sum, item) => sum + Math.max(0, Number(item?.minuten || 0)), 0);
  const saldoMinutes = appSaldoMinutes + stundenStartsaldoMinuten - stundenAbgleichMinuten;
  const absenceRows = getAbsenceRows(data).filter((item) => {
    const from = parseDeDate(item?.from);
    const to = parseDeDate(item?.to);
    const filterFrom = parseDeDate(effectiveFromDate);
    const filterTo = parseDeDate(toDate);
    if (!from || !to) return false;
    if (filterFrom && to < filterFrom) return false;
    if (filterTo && from > filterTo) return false;
    return true;
  }).sort((a, b) => compareDeDates(a?.from, b?.from));

  const specialDayRows = getSpecialDayRows(data).filter((item) => {
    const date = parseDeDate(item?.date);
    const filterFrom = parseDeDate(effectiveFromDate);
    const filterTo = parseDeDate(toDate);
    if (!date) return false;
    if (filterFrom && date < filterFrom) return false;
    if (filterTo && date > filterTo) return false;
    return true;
  }).sort((a, b) => compareDeDates(a?.date, b?.date));

  return {
    fromDate: String(fromDate || '').trim(),
    effectiveFromDate,
    toDate: String(toDate || '').trim(),
    fastStartDatum: fastStartComparable ? formatDeDate(fastStartComparable) : '',
    totalMinutes,
    plannedMinutes,
    appSaldoMinutes,
    stundenStartsaldoMinuten,
    stundenAbgleichMinuten,
    saldoMinutes,
    stundenAbgleichRows,
    dailyRows,
    absenceRows,
    specialDayRows
  };
}


function getTimeOverviewStatusLabel(row) {
  if (row?.absenceType === 'krank') return 'Krank';
  if (row?.absenceType === 'urlaub') return 'Urlaub';
  if (row?.isHoliday) return 'Feiertag';
  return 'Arbeit';
}

function buildTimeOverviewPrintMarkup({ therapistName, summary }) {
  const absenceMarkup = summary.absenceRows.length === 0
    ? '<p>Keine Urlaubs- oder Krankheitseinträge im Zeitraum.</p>'
    : `<table><thead><tr><th>Status</th><th>Von</th><th>Bis</th></tr></thead><tbody>${summary.absenceRows.map((item) => `
      <tr>
        <td>${escapeHtml(item.type === 'krank' ? 'Krank' : 'Urlaub')}</td>
        <td>${escapeHtml(item.from || '—')}</td>
        <td>${escapeHtml(item.to || '—')}</td>
      </tr>
    `).join('')}</tbody></table>`;

  const holidayMarkup = summary.specialDayRows.length === 0
    ? '<p>Keine Feiertage im Zeitraum.</p>'
    : `<table><thead><tr><th>Feiertag</th></tr></thead><tbody>${summary.specialDayRows.map((item) => `
      <tr><td>${escapeHtml(item.date || '—')}</td></tr>
    `).join('')}</tbody></table>`;

  const dailyMarkup = summary.dailyRows.length === 0
    ? '<p>Keine Zeiten im gewählten Zeitraum.</p>'
    : `<table><thead><tr><th>Datum</th><th>Status</th><th>Geleistete Zeit</th><th>Soll-Zeit</th><th>Tages-Saldo</th></tr></thead><tbody>${summary.dailyRows.map((row) => `
      <tr>
        <td>${escapeHtml(row.date || '—')}</td>
        <td>${escapeHtml(getTimeOverviewStatusLabel(row))}</td>
        <td>${escapeHtml(formatHoursClockLabel(row.totalMinutes))}</td>
        <td>${escapeHtml(formatHoursClockLabel(row.plannedMinutes))}</td>
        <td>${escapeHtml(formatHoursClockLabel(Math.abs(row.saldoMinutes)))} ${row.saldoMinutes > 0 ? 'Plus' : row.saldoMinutes < 0 ? 'Minus' : 'Ausgeglichen'}</td>
      </tr>
    `).join('')}</tbody></table>`;

  return `
    <div class="print-section">
      <div><strong>Therapeut:</strong> ${escapeHtml(therapistName || '—')}</div>
      <div><strong>Zeitraum:</strong> ${escapeHtml(summary.fromDate || '—')} bis ${escapeHtml(summary.toDate || '—')}</div>
      <div><strong>FaSt-Startdatum:</strong> ${escapeHtml(summary.fastStartDatum || '—')}</div>
    </div>

    <div class="print-section">
      <h3>Gesamt</h3>
      <table>
        <tbody>
          <tr><th>Soll-Zeit</th><td>${escapeHtml(formatHoursClockLabel(summary.plannedMinutes))}</td></tr>
          <tr><th>Ist-Zeit</th><td>${escapeHtml(formatHoursClockLabel(summary.totalMinutes))}</td></tr>
          <tr><th>Startsaldo vor App/FaSt</th><td>${escapeHtml(getSignedMinutesLabel(summary.stundenStartsaldoMinuten))}</td></tr>
          <tr><th>Seit Start erfasst</th><td>${escapeHtml(formatHoursClockLabel(Math.abs(summary.appSaldoMinutes)))} ${summary.appSaldoMinutes > 0 ? 'Plus' : summary.appSaldoMinutes < 0 ? 'Minus' : 'Ausgeglichen'}</td></tr>
          <tr><th>Abgeglichen</th><td>-${escapeHtml(formatHoursClockLabel(summary.stundenAbgleichMinuten || 0))}</td></tr>
          <tr><th>Gesamt</th><td>${escapeHtml(formatHoursClockLabel(Math.abs(summary.saldoMinutes)))} ${summary.saldoMinutes > 0 ? 'Plus' : summary.saldoMinutes < 0 ? 'Minus' : 'Ausgeglichen'}</td></tr>
        </tbody>
      </table>
    </div>

    <div class="print-section">
      <h3>Tagesliste</h3>
      ${dailyMarkup}
    </div>

    <div class="print-section">
      <h3>Urlaub / Krank</h3>
      ${absenceMarkup}
    </div>

    <div class="print-section">
      <h3>Feiertage</h3>
      ${holidayMarkup}
    </div>
  `;
}

function printTimeOverview() {
  const contentNode = document.getElementById('zeituebersicht-content');
  if (!contentNode) return;
  const content = contentNode.innerHTML;
  const win = window.open('', '', 'width=1000,height=800');
  if (!win) return;

  win.document.write(`<!doctype html>
  <html>
    <head>
      <meta charset="utf-8">
      <title>Zeitübersicht</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 20px; color: #111827; }
        h2 { margin: 0 0 18px 0; }
        h3 { margin: 0 0 10px 0; font-size: 18px; }
        .print-section { margin-bottom: 24px; }
        table { width: 100%; border-collapse: collapse; margin-top: 8px; }
        th, td { border: 1px solid #d1d5db; padding: 8px; text-align: left; vertical-align: top; }
        th { background: #f3f4f6; }
      </style>
    </head>
    <body>
      <h2>Zeitübersicht</h2>
      ${content}
    </body>
  </html>`);
  win.document.close();
  win.focus();
  win.print();
}
window.printTimeOverview = printTimeOverview;

function getDashboardTodayPatients(data, targetDate = formatCurrentDateShort()) {
  const normalizedDate = String(targetDate || '').trim();
  const rows = [];
  (data?.homes || []).forEach((home) => {
    (home?.patients || []).forEach((patient) => {
      const patientName = `${patient?.lastName || ""}, ${patient?.firstName || ""}`.replace(/^,\s*/, "").trim() || 'Ohne Namen';

      (patient?.rezepte || []).forEach((rezept) => {
        getRezeptTimeEntries(rezept).forEach((entry) => {
          if (String(entry?.date || '').trim() !== normalizedDate) return;
          const minutes = Number(entry?.minutes || 0);
          if (!Number.isFinite(minutes)) return;

          rows.push({
            patientName,
            homeName: home?.name || '',
            rezeptLabel: rezeptSummary(rezept),
            totalMinutes: minutes,
            type: entry?.type || '',
            note: entry?.note || '',
            homeId: home?.homeId || '',
            patientId: patient?.patientId || '',
            rezeptId: rezept?.rezeptId || '',
            timeEntryId: entry?.timeEntryId || ''
          });
        });
      });
    });
  });
  return rows.sort((a,b)=>collatorDE.compare(a.patientName,b.patientName));
}

// Wie getDashboardTodayPatients, aber für einen frei wählbaren Zeitraum
// statt eines einzelnen Tages. Eigenständige Funktion (Etappe A der
// Zeitraum-Auswertung), um die bereits getestete Tagesansicht ("Patienten
// heute") nicht zu beeinflussen.
function getPatientsInDateRange(data, fromDate, toDate) {
  const rows = [];
  (data?.homes || []).forEach((home) => {
    (home?.patients || []).forEach((patient) => {
      const patientName = `${patient?.lastName || ""}, ${patient?.firstName || ""}`.replace(/^,\s*/, "").trim() || 'Ohne Namen';

      (patient?.rezepte || []).forEach((rezept) => {
        getRezeptTimeEntries(rezept).forEach((entry) => {
          if (!isDateInRange(entry?.date, fromDate, toDate)) return;
          const minutes = Number(entry?.minutes || 0);
          if (!Number.isFinite(minutes)) return;

          rows.push({
            date: String(entry?.date || '').trim(),
            patientName,
            homeName: home?.name || '',
            rezeptLabel: rezeptSummary(rezept),
            totalMinutes: minutes,
            type: entry?.type || '',
            note: entry?.note || '',
            homeId: home?.homeId || '',
            patientId: patient?.patientId || '',
            rezeptId: rezept?.rezeptId || '',
            timeEntryId: entry?.timeEntryId || ''
          });
        });
      });
    });
  });
  return rows.sort((a, b) => {
    const dateCompare = compareDeDates(a.date, b.date);
    if (dateCompare !== 0) return dateCompare;
    return collatorDE.compare(a.patientName, b.patientName);
  });
}

// Etappe C: App-weite Patientensuche. Findet passende Patienten über alle
// Heime hinweg und liefert für jeden Treffer die komplette Zeit-Historie
// (alle Zeiteinträge, unabhängig vom Datum), chronologisch sortiert.
function searchPatientsAcrossApp(data, query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return [];

  const results = [];
  (data?.homes || []).forEach((home) => {
    (home?.patients || []).forEach((patient) => {
      const haystack = [
        patient?.firstName || "",
        patient?.lastName || "",
        patient?.birthDate || ""
      ].join(" ").toLowerCase();

      if (!haystack.includes(q)) return;

      const entries = [];
      (patient?.rezepte || []).forEach((rezept) => {
        getRezeptTimeEntries(rezept).forEach((entry) => {
          const minutes = Number(entry?.minutes || 0);
          if (!Number.isFinite(minutes) || minutes <= 0) return;
          entries.push({
            date: String(entry?.date || '').trim(),
            minutes,
            rezeptLabel: rezeptSummary(rezept),
            type: entry?.type || '',
            note: entry?.note || '',
            homeId: home?.homeId || '',
            patientId: patient?.patientId || '',
            rezeptId: rezept?.rezeptId || '',
            timeEntryId: entry?.timeEntryId || ''
          });
        });
      });

      entries.sort((a, b) => compareDeDates(a.date, b.date));

      results.push({
        patientId: patient?.patientId || '',
        homeId: home?.homeId || '',
        patientName: `${patient?.lastName || ""}, ${patient?.firstName || ""}`.replace(/^,\s*/, "").trim() || 'Ohne Namen',
        homeName: home?.name || '',
        totalMinutes: entries.reduce((s, e) => s + e.minutes, 0),
        entries
      });
    });
  });

  return results.sort((a, b) => collatorDE.compare(a.patientName, b.patientName));
}

function getDocumentationOverviewRows(data, targetDate = "") {
  const normalizedDate = normalizeDeDateInput(String(targetDate || '').trim()) || String(targetDate || '').trim();
  if (!normalizedDate || !parseDeDate(normalizedDate)) return [];

  const rows = [];
  (data?.homes || []).forEach((home) => {
    (home?.patients || []).forEach((patient) => {
      const entries = [];
      (patient?.rezepte || []).forEach((rezept) => {
        (rezept?.entries || []).forEach((entry) => {
          if (String(entry?.date || '').trim() !== normalizedDate) return;
          entries.push({
            rezeptLabel: rezeptSummary(rezept),
            text: entry?.text || ''
          });
        });
      });

      if (entries.length > 0) {
        rows.push({
          patientName: `${patient?.lastName || ""}, ${patient?.firstName || ""}`.replace(/^,\s*/, "").trim() || 'Ohne Namen',
          homeName: home?.name || '',
          entries
        });
      }
    });
  });

  return rows.sort((a, b) => collatorDE.compare(a.patientName, b.patientName));
}

function bindCheckChipToggles(root = document) {
  root.querySelectorAll('.check-chip').forEach((chip) => {
    const input = chip.querySelector('input[type="checkbox"], input[type="radio"]');
    if (!input) return;

    const sync = () => {
      chip.classList.toggle('is-checked', !!input.checked);
    };

    // Bei Radios müssen auch die Geschwister-Chips (gleicher name) synchron
    // gehalten werden, da nur ein Radio pro Gruppe "checked" sein kann.
    const syncGroup = () => {
      if (input.type === 'radio' && input.name) {
        root.querySelectorAll(`input[type="radio"][name="${CSS.escape(input.name)}"]`).forEach((sibling) => {
          const siblingChip = sibling.closest('.check-chip');
          if (siblingChip) siblingChip.classList.toggle('is-checked', !!sibling.checked);
        });
      } else {
        sync();
      }
    };

    sync();

    if (chip.dataset.bound === '1') return;
    chip.dataset.bound = '1';
    chip.addEventListener('click', (event) => {
      if (event.target === input) return;
      event.preventDefault();
      if (input.type === 'radio') {
        input.checked = true;
      } else {
        input.checked = !input.checked;
      }
      input.dispatchEvent(new Event('change', { bubbles: true }));
      syncGroup();
    });
    input.addEventListener('change', syncGroup);
  });
}

function bindQuickDocSelectionStyles(root = document) {
  const checks = root.querySelectorAll('.quickDocRezeptCheck');

  const syncGroup = (patientId) => {
    root.querySelectorAll(`.quick-doc-chip[data-patient-id="${patientId}"]`).forEach((chip) => {
      const input = chip.querySelector('.quickDocRezeptCheck');
      chip.classList.toggle('is-checked', !!input?.checked);
    });
  };

  checks.forEach((check) => {
    const patientId = check.dataset.patientId;
    syncGroup(patientId);
    if (check.dataset.bound === '1') return;
    check.dataset.bound = '1';
    check.addEventListener('change', () => syncGroup(patientId));
  });
}

const WORK_DAY_OPTIONS = ["MO", "DI", "MI", "DO", "FR"];

function normalizeWorkDaysForUi(value) {
  const allowed = new Set(WORK_DAY_OPTIONS);
  return Array.isArray(value)
    ? value
        .map((item) => String(item || "").trim().toUpperCase())
        .filter((item, index, array) => allowed.has(item) && array.indexOf(item) === index)
    : [];
}

function normalizeWeeklyHoursInput(value) {
  return String(value || "")
    .trim()
    .replace(",", ".");
}

function isValidWeeklyHours(value) {
  if (!value) return true;
  return /^\d+(?:\.\d+)?$/.test(value);
}

function renderWorkDayChips(selectedDays = [], idPrefix = "workday") {
  const selected = new Set(normalizeWorkDaysForUi(selectedDays));
  return `
    <div class="checkbox-row">
      ${WORK_DAY_OPTIONS.map((day) => `
        <label class="check-chip">
          <input id="${idPrefix}-${day}" class="workday-check" type="checkbox" value="${day}" ${selected.has(day) ? "checked" : ""}>
          <span>${day}</span>
        </label>
      `).join("")}
    </div>
  `;
}

function getSelectedWorkDays(root = document) {
  return WORK_DAY_OPTIONS.filter((day) => {
    const input = root.getElementById ? root.getElementById(`setupWorkDay-${day}`) || root.getElementById(`settingsWorkDay-${day}`) : null;
    return !!input?.checked;
  });
}

function bindSelectableCardChecks(root = document) {
  root.querySelectorAll('.selectable-card').forEach((card) => {
    const input = card.querySelector('input[type="checkbox"]');
    if (!input) return;

    const sync = () => {
      card.classList.toggle('is-selected', !!input.checked);
    };

    sync();

    if (input.dataset.boundCard !== '1') {
      input.dataset.boundCard = '1';
      input.addEventListener('change', sync);
    }

    if (card.dataset.boundSelectableCard === '1') return;
    card.dataset.boundSelectableCard = '1';

    card.addEventListener('click', (event) => {
      if (event.target.closest('input, button, a, select, textarea, summary')) return;
      if (event.target.closest('label')) return;
      event.preventDefault();
      input.checked = !input.checked;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
  });
}

function getCheckedRowIds(selector, root = document) {
  return Array.from(root.querySelectorAll(`${selector}:checked`))
    .map((element) => String(element.dataset.rowId || '').trim())
    .filter(Boolean);
}

function normalizeSelectedRowIds(selectedIds = [], rows = []) {
  const allowedIds = new Set((rows || []).map((row) => row.rowId));
  return Array.from(new Set((selectedIds || []).filter((id) => allowedIds.has(id))));
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

function buildKilometerZettelHtml({ number, therapistName, fromDate, toDate, rows, totalKm, totalAmount }) {
  return `
    <h1>FaSt Kilometer</h1>
    <div class="row"><strong>Nummer:</strong> ${escapeHtml(number || "—")}</div>
    <div class="row"><strong>Therapeut:</strong> ${escapeHtml(therapistName || "—")}</div>
    <div class="row"><strong>Zeitraum:</strong> ${escapeHtml(fromDate || "—")} bis ${escapeHtml(toDate || "—")}</div>
    <table>
      <thead>
        <tr>
          <th>Datum</th>
          <th>Von</th>
          <th>Nach</th>
          <th class="numeric">Kilometer</th>
          <th class="numeric">Wert</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((item) => `
          <tr>
            <td>${escapeHtml(item.date || "—")}</td>
            <td>${escapeHtml(item.fromLabel || "—")}</td>
            <td>${escapeHtml(item.toLabel || "—")}</td>
            <td class="numeric">${escapeHtml(formatKm(item.km || 0))}</td>
            <td class="numeric">${escapeHtml(formatEuro((Number(item.km) || 0) * 0.3))}</td>
          </tr>
        `).join("")}
      </tbody>
      <tfoot>
        <tr>
          <td colspan="3">Summe</td>
          <td class="numeric">${escapeHtml(formatKm(totalKm))}</td>
          <td class="numeric">${escapeHtml(formatEuro(totalAmount))}</td>
        </tr>
      </tfoot>
    </table>
  `;
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

const REZEPT_ITEM_OPTIONS = ["KG", "MT", "KG-ZNS", "KG-Atemtherapie", "MLD30", "MLD45", "MLD60", "Blanko"];

function getKnownDoctorNames(data) {
  return getDoctorList(data).filter(Boolean);
}

function bindDateAutoFormat(input) {
  if (!input || input.dataset.dateAutoBound === '1') return;
  input.dataset.dateAutoBound = '1';
  input.setAttribute("inputmode", "numeric");
  input.setAttribute("autocomplete", "off");
  input.setAttribute("maxlength", "10");
  input.setAttribute("placeholder", input.getAttribute("placeholder") || "TT.MM.JJJJ");
  input.addEventListener("input", () => {
    // Das bloße Neuzuweisen von input.value springt in den meisten Browsern
    // IMMER ans Feldende, auch wenn sich der Text gar nicht ändert - ohne
    // Gegenmaßnahme sprang der Cursor nach jedem Tastendruck ans Ende, sodass
    // man z.B. nur den Tag mittendrin ändern wollte, aber der nächste
    // Tastendruck am Ende statt an der gewünschten Stelle landete (Nutzer
    // musste deshalb immer das komplette Feld löschen und neu eintippen).
    // Fix: Position als "Anzahl Ziffern vor dem Cursor" merken (bleibt beim
    // Einfügen/Entfernen der Trennpunkte stabil) und danach wiederherstellen.
    const caret = input.selectionStart ?? input.value.length;
    const digitsBeforeCaret = (input.value.slice(0, caret).match(/\d/g) || []).length;
    const formatted = normalizeDeDateInput(input.value);
    input.value = formatted;
    let newPos = 0;
    let digitsSeen = 0;
    while (newPos < formatted.length && digitsSeen < digitsBeforeCaret) {
      if (/\d/.test(formatted[newPos])) digitsSeen++;
      newPos++;
    }
    input.setSelectionRange(newPos, newPos);
  });
  input.addEventListener("blur", () => {
    input.value = normalizeDeDateInput(input.value);
  });
}

function isAutoDateField(input) {
  if (!input || input.tagName !== "INPUT") return false;
  if ((input.getAttribute("type") || "text").toLowerCase() !== "text") return false;

  const placeholder = String(input.getAttribute("placeholder") || "").trim();
  if (placeholder === "TT.MM.JJJJ") return true;

  const id = String(input.id || "").toLowerCase();
  return [
    "date",
    "birthdate",
    "ausstell",
    "summaryfrom",
    "summaryto",
    "absencefrom",
    "absenceto"
  ].some((token) => id.includes(token));
}

function bindDateAutoFormatsIn(root = document) {
  if (!root || typeof root.querySelectorAll !== "function") return;
  root.querySelectorAll('input').forEach((input) => {
    if (isAutoDateField(input)) bindDateAutoFormat(input);
  });
}

function renderRezeptItemsEditor(items = []) {
  const safe = Array.isArray(items) && items.length ? items : [{}];
  return `
    <div id="leistungenContainer" class="list-stack">
      ${safe.map((item, idx) => renderRezeptItemRow(item, idx)).join("")}
    </div>
    <button id="addLeistungRowBtn" type="button" class="secondary">Leistung hinzufügen</button>
  `;
}

function renderRezeptItemRow(item = {}, idx = 0) {
  const isBlanko = String(item.type || "") === "Blanko";
  return `
    <div class="compact-card rezept-item-row" data-item-row="${idx}" style="padding:14px;">
      <div class="row" style="gap:12px; align-items:end; flex-wrap:wrap;">
        <div style="flex:1; min-width:180px;">
          <label>Leistung</label>
          <select class="rezept-item-type">
            <option value="">Bitte wählen</option>
            ${REZEPT_ITEM_OPTIONS.map(opt => `<option value="${escapeHtml(opt)}" ${String(item.type||'')===opt?'selected':''}>${escapeHtml(opt)}</option>`).join('')}
          </select>
        </div>
        <div style="width:140px; max-width:100%;">
          <label>Anzahl</label>
          <input class="rezept-item-count" type="number" inputmode="numeric" min="0" step="1" value="${escapeHtml(isBlanko ? "" : (item.count || ""))}" placeholder="z.B. 6" ${isBlanko ? "disabled" : ""}>
        </div>
      </div>
    </div>
  `;
}

function updateRezeptItemCountState(row) {
  if (!row) return;
  const typeSelect = row.querySelector(".rezept-item-type");
  const countInput = row.querySelector(".rezept-item-count");
  if (!typeSelect || !countInput) return;
  const isBlanko = typeSelect.value === "Blanko";
  countInput.disabled = isBlanko;
  if (isBlanko) countInput.value = "";
}

function bindRezeptItemsEditor(items = []) {
  const container = document.getElementById("leistungenContainer");
  const bindRow = (row) => {
    if (!row) return;
    const typeSelect = row.querySelector(".rezept-item-type");
    if (typeSelect) {
      typeSelect.addEventListener("change", () => updateRezeptItemCountState(row));
    }
    updateRezeptItemCountState(row);
  };

  if (container) {
    Array.from(container.querySelectorAll(".rezept-item-row")).forEach(bindRow);
  }

  const addBtn = document.getElementById("addLeistungRowBtn");
  if (!addBtn) return;
  addBtn.onclick = () => {
    if (!container) return;
    const idx = container.querySelectorAll("[data-item-row]").length;
    container.insertAdjacentHTML("beforeend", renderRezeptItemRow({}, idx));
    const newRow = container.querySelector(`.rezept-item-row[data-item-row="${idx}"]`);
    bindRow(newRow);
  };
}

function collectRezeptItemsFromForm() {
  return Array.from(document.querySelectorAll(".rezept-item-row")).map((row) => ({
    type: row.querySelector(".rezept-item-type")?.value.trim() || "",
    count: row.querySelector(".rezept-item-count")?.value.trim() || ""
  })).filter((item) => item.type);
}

function renderJaNeinSelect(id, value) {
  return `
    <select id="${id}">
      <option value="" ${value ? "" : "selected"}>Bitte wählen</option>
      <option value="ja" ${value === "ja" ? "selected" : ""}>Ja</option>
      <option value="nein" ${value === "nein" ? "selected" : ""}>Nein</option>
    </select>
  `;
}

const LEITSYMPTOMATIK_OPTIONEN = [
  { val: "a", label: "A", text: "a) Schädigung der Motorik (Bewegungs-, Koordinations- oder Kraftdefizit)" },
  { val: "b", label: "B", text: "b) Schädigung der Sensibilität / Wahrnehmung" },
  { val: "c", label: "C", text: "c) Schädigung sonstiger Art mit Auswirkung auf die Bewegungsfähigkeit" },
  { val: "custom", label: "Patient individuell", text: "" }
];

// Leitsymptomatik wird intern weiterhin als ein einzelner String gespeichert
// (Kompatibilität mit Rezeptprüfung/Anzeige/Export), bei Mehrfachauswahl
// werden die Texte der ausgewählten Optionen mit "; " verbunden.
function parseLeitsymptomatikSelection(value) {
  const parts = String(value || "").split(";").map((p) => p.trim()).filter(Boolean);
  const selectedVals = [];
  const customParts = [];
  parts.forEach((part) => {
    const opt = LEITSYMPTOMATIK_OPTIONEN.find((o) => o.val !== "custom" && o.text === part);
    if (opt) selectedVals.push(opt.val);
    else customParts.push(part);
  });
  return { selectedVals, customText: customParts.join("; ") };
}

function renderLeitsymptomatikField(currentValue) {
  const { selectedVals, customText } = parseLeitsymptomatikSelection(currentValue);
  const selected = new Set(selectedVals);
  return `
    <label>Leitsymptomatik</label>
    <p class="muted" style="margin-top:-4px;">Mehrfachauswahl möglich.</p>
    <div class="checkbox-row">
      ${LEITSYMPTOMATIK_OPTIONEN.filter((opt) => opt.val !== "custom").map((opt) => `
        <label class="check-chip">
          <input type="checkbox" name="leitsymptomatikWahl" class="leitsymptomatikWahl" value="${escapeHtml(opt.val)}" ${selected.has(opt.val) ? "checked" : ""}>
          <span>${escapeHtml(opt.label)}</span>
        </label>
      `).join("")}
      <label class="check-chip">
        <input type="checkbox" id="leitsymptomatikCustomToggle" ${customText ? "checked" : ""}>
        <span>Patient individuell</span>
      </label>
    </div>
    <div id="leitsymptomatikCustomWrap" style="display:${customText ? "block" : "none"};">
      <label for="leitsymptomatikCustom">Patientenindividuelle Leitsymptomatik</label>
      <input id="leitsymptomatikCustom" type="text" placeholder="Freitext" value="${escapeHtml(customText)}">
    </div>
    <input id="leitsymptomatik" type="hidden" value="${escapeHtml(currentValue || "")}">
  `;
}

function bindLeitsymptomatikField() {
  bindCheckChipToggles(app);
  const hidden = document.getElementById("leitsymptomatik");
  const customWrap = document.getElementById("leitsymptomatikCustomWrap");
  const customInput = document.getElementById("leitsymptomatikCustom");
  const customToggle = document.getElementById("leitsymptomatikCustomToggle");

  const applySelection = () => {
    const parts = Array.from(document.querySelectorAll(".leitsymptomatikWahl:checked"))
      .map((cb) => LEITSYMPTOMATIK_OPTIONEN.find((o) => o.val === cb.value)?.text)
      .filter(Boolean);

    if (customToggle.checked) {
      customWrap.style.display = "block";
      const customVal = customInput.value.trim();
      if (customVal) parts.push(customVal);
    } else {
      customWrap.style.display = "none";
    }

    hidden.value = parts.join("; ");
    hidden.dispatchEvent(new Event("input", { bubbles: true }));
  };

  document.querySelectorAll(".leitsymptomatikWahl").forEach((cb) => {
    cb.addEventListener("change", applySelection);
  });
  customToggle.addEventListener("change", applySelection);
  customInput.addEventListener("input", applySelection);
}

function bindIcdAutoFormat(inputEl) {
  if (!inputEl) return;
  inputEl.addEventListener("input", () => {
    const cursorAtEnd = inputEl.selectionEnd === inputEl.value.length;
    inputEl.value = formatICD(inputEl.value);
    if (cursorAtEnd) inputEl.setSelectionRange(inputEl.value.length, inputEl.value.length);
  });
}

// Arztadresse wird im Register (data.aerzte) weiterhin als ein einzelner
// String gespeichert (Kompatibilität mit Freikuvert-Versand u.a.), im
// Rezept-Formular aber als Straße/PLZ/Ort getrennt erfasst und angezeigt
// (u.a. für eine GKV-Muster-16-nahe Darstellung, siehe Aufgabe 9).
function splitArztAdresse(adresse) {
  const trimmed = String(adresse || "").trim();
  if (!trimmed) return { strasse: "", plz: "", ort: "" };
  const match = trimmed.match(/^(.*?),?\s*(\d{5})\s+(.+)$/);
  if (match) {
    return { strasse: match[1].trim(), plz: match[2], ort: match[3].trim() };
  }
  return { strasse: trimmed, plz: "", ort: "" };
}

function joinArztAdresse(strasse, plz, ort) {
  const plzOrt = [String(plz || "").trim(), String(ort || "").trim()].filter(Boolean).join(" ");
  return [String(strasse || "").trim(), plzOrt].filter(Boolean).join(", ");
}

function renderArztAdresseFields(adresse, email = "") {
  const parts = splitArztAdresse(adresse);
  return `
    <label for="arztStrasse">Arztadresse (Straße, Hausnummer)</label>
    <input id="arztStrasse" type="text" placeholder="z.B. Musterstraße 5" value="${escapeHtml(parts.strasse)}">
    <div class="row">
      <div style="flex:1;">
        <label for="arztPlz">PLZ</label>
        <input id="arztPlz" type="text" inputmode="numeric" maxlength="5" placeholder="12345" value="${escapeHtml(parts.plz)}">
      </div>
      <div style="flex:2;">
        <label for="arztOrt">Ort</label>
        <input id="arztOrt" type="text" placeholder="Musterstadt" value="${escapeHtml(parts.ort)}">
      </div>
    </div>
    <label for="arztEmail">E-Mail (für Nachbestellung per Mail)</label>
    <input id="arztEmail" type="email" autocomplete="off" placeholder="praxis@arzt.de" value="${escapeHtml(email || "")}">
  `;
}

// Füllt Straße/PLZ/Ort automatisch aus, sobald der eingegebene Arztname
// exakt einem bereits gespeicherten Arzt entspricht, UND zeigt zusätzlich
// ein eigenes Dropdown mit passenden Ärzten, sobald getippt wird. Ein
// eigenes Dropdown statt (nur) der nativen <datalist> des Feldes, weil
// natives Datalist-Verhalten auf mobilen Browsern (v.a. iOS Safari, auf
// Tablets/Handys in der Praxis der Hauptanwendungsfall) unzuverlässig
// bis gar nicht angezeigt wird.
function bindArztAdresseAutofill(arztInput, arztRegistry) {
  const strasseInput = document.getElementById("arztStrasse");
  const plzInput = document.getElementById("arztPlz");
  const ortInput = document.getElementById("arztOrt");
  const emailInput = document.getElementById("arztEmail");

  function fillAddressFor(name) {
    const match = arztRegistry.find((a) => a.name === name);
    const parts = splitArztAdresse(match?.adresse || "");
    strasseInput.value = parts.strasse;
    plzInput.value = parts.plz;
    ortInput.value = parts.ort;
    if (emailInput) emailInput.value = match?.email || "";
  }

  // position:fixed mit per Hand berechneten Koordinaten statt einer
  // relativ positionierten Elternstruktur - so ist die Platzierung
  // unabhängig davon, wo im Formular das Feld gerade steht, und muss
  // nicht auf das umgebende Markup (z.B. eine .card mit Innenabstand)
  // Rücksicht nehmen. Als Kind von #app statt document.body angehängt,
  // damit render() (app.innerHTML = ...) es beim nächsten Rendern
  // automatisch mit entfernt - sonst würde bei jedem erneuten Aufruf
  // dieser Ansicht ein weiteres, verwaistes Dropdown-Element im DOM
  // liegen bleiben.
  const dropdown = document.createElement("div");
  dropdown.className = "arzt-suggestion-dropdown";
  dropdown.style.cssText = "position:fixed; z-index:200; background:var(--card); border:1px solid var(--border); border-radius:10px; max-height:220px; overflow-y:auto; display:none; box-shadow:0 6px 20px rgba(15,23,42,0.12);";
  app.appendChild(dropdown);

  // Klappt das Dropdown nach oben statt nach unten auf, wenn unterhalb
  // des Eingabefelds nicht genug Platz im sichtbaren Bereich ist (z.B.
  // Feld weit unten im Formular auf einem kleinen Bildschirm) - sonst
  // würde das Dropdown teilweise oder ganz außerhalb des Viewports
  // erscheinen und wäre nicht erreichbar (position:fixed folgt der
  // Seite beim Scrollen nicht, ein Herunterscrollen würde es also nicht
  // sichtbar machen).
  const DROPDOWN_MAX_HEIGHT = 220;
  function positionDropdown() {
    const rect = arztInput.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;

    dropdown.style.left = `${rect.left}px`;
    dropdown.style.width = `${rect.width}px`;

    if (spaceBelow < DROPDOWN_MAX_HEIGHT && rect.top > spaceBelow) {
      dropdown.style.top = "";
      dropdown.style.bottom = `${window.innerHeight - rect.top + 4}px`;
    } else {
      dropdown.style.bottom = "";
      dropdown.style.top = `${rect.bottom + 4}px`;
    }
  }

  function renderDropdown() {
    const query = arztInput.value.trim().toLowerCase();
    const matches = query ? arztRegistry.filter((a) => a.name.toLowerCase().includes(query)).slice(0, 8) : [];

    if (matches.length === 0) {
      dropdown.style.display = "none";
      dropdown.innerHTML = "";
      return;
    }

    positionDropdown();
    dropdown.innerHTML = matches.map((a) => `
      <div class="arzt-suggestion-item" data-name="${escapeHtml(a.name)}" style="padding:10px 12px; cursor:pointer; border-bottom:1px solid var(--border);">${escapeHtml(a.name)}</div>
    `).join("");
    dropdown.style.display = "block";

    dropdown.querySelectorAll(".arzt-suggestion-item").forEach((el) => {
      // mousedown statt click, damit preventDefault greift, bevor das
      // Eingabefeld durch den Klick den Fokus verliert (blur würde das
      // Dropdown sonst schon vor dem Klick-Handler schließen).
      el.addEventListener("mousedown", (e) => {
        e.preventDefault();
        const name = el.dataset.name;
        arztInput.value = name;
        fillAddressFor(name);
        dropdown.style.display = "none";
      });
    });
  }

  arztInput.addEventListener("input", () => {
    fillAddressFor(arztInput.value.trim());
    renderDropdown();
  });
  arztInput.addEventListener("focus", renderDropdown);
  arztInput.addEventListener("blur", () => {
    setTimeout(() => { dropdown.style.display = "none"; }, 150);
  });

  // position:fixed folgt dem Eingabefeld nicht automatisch beim Scrollen
  // eines umgebenden Containers (nur beim Scrollen des Viewports selbst) -
  // auf einem langen Formular muss die Position deshalb bei jedem Scroll
  // neu berechnet werden, sonst driftet das Dropdown vom Eingabefeld weg.
  // Entfernt sich selbst wieder, sobald das Eingabefeld (nach dem nächsten
  // render()) nicht mehr im DOM hängt - window-Listener werden sonst bei
  // jedem erneuten Aufruf dieser Funktion dauerhaft angehäuft.
  function onWindowScroll() {
    if (!document.body.contains(arztInput)) {
      window.removeEventListener("scroll", onWindowScroll, true);
      return;
    }
    if (dropdown.style.display === "block") positionDropdown();
  }
  window.addEventListener("scroll", onWindowScroll, true);
}

function collectArztAdresseFromForm() {
  return joinArztAdresse(
    document.getElementById("arztStrasse").value,
    document.getElementById("arztPlz").value,
    document.getElementById("arztOrt").value
  );
}

function collectArztEmailFromForm() {
  return document.getElementById("arztEmail")?.value.trim() || "";
}

function renderZuzahlungsstatusSelect(id, value) {
  return `
    <select id="${id}">
      <option value="" ${value ? "" : "selected"}>Nicht angegeben</option>
      <option value="ja" ${value === "ja" ? "selected" : ""}>Ja, zuzahlungsbefreit</option>
      <option value="nein" ${value === "nein" ? "selected" : ""}>Nein</option>
      <option value="ungeklaert" ${value === "ungeklaert" ? "selected" : ""}>Noch nicht geklärt</option>
    </select>
  `;
}

// ============================================================
// Assessment-Wizard – kleine Render-Helfer (siehe modules/assessment.js
// für Testdefinitionen und Scoring)
// ============================================================
function renderRadioGroup(name, options, selected) {
  return `
    <div class="checkbox-row checkbox-row-column">
      ${options.map((opt) => `
        <label class="check-chip" style="justify-content:flex-start; margin-bottom:6px;">
          <input type="radio" name="${name}" value="${escapeHtml(opt.val)}" ${String(selected) === String(opt.val) ? "checked" : ""}>
          <span>${escapeHtml(opt.label)}</span>
        </label>
      `).join("")}
    </div>
  `;
}

function getRadioValue(name) {
  const el = document.querySelector(`input[name="${name}"]:checked`);
  return el ? el.value : "";
}

function renderCheckboxList(namePrefix, options, selectedValues) {
  const selected = new Set(selectedValues || []);
  return `
    <div class="checkbox-row checkbox-row-column">
      ${options.map((opt, idx) => `
        <label class="check-chip" style="justify-content:flex-start; margin-bottom:6px;">
          <input type="checkbox" class="${namePrefix}-check" value="${escapeHtml(opt)}" ${selected.has(opt) ? "checked" : ""}>
          <span>${escapeHtml(opt)}</span>
        </label>
      `).join("")}
    </div>
  `;
}

function getCheckboxListValues(namePrefix) {
  return Array.from(document.querySelectorAll(`.${namePrefix}-check:checked`)).map((el) => el.value);
}

function ampelBadgeHtml(ampel) {
  if (!ampel) return "";
  const cls = ampel === "gruen" ? "pill-green" : ampel === "gelb" ? "pill-orange" : "pill-red";
  return `<span class="${cls}">${Assessment.ampelEmoji(ampel)}</span>`;
}

function getPreviousAssessment(patient, beforeId) {
  const list = (patient.assessments || []).filter((a) => a.id !== beforeId && (a.barthel || a.nrs !== null || a.neuro || a.ortho));
  return list.length > 0 ? list[0] : null;
}

// Extrahiert vergleichbare Testergebnisse aus einem einzelnen Assessment-
// Eintrag (für Verlauf, Ampel und Therapiebericht). Gibt nur Tests zurück,
// die in diesem Eintrag tatsächlich erhoben wurden.
function extractAssessmentScores(assessment) {
  if (!assessment) return [];
  const a = assessment;
  const scores = [];

  const barthelValues = a.barthel || {};
  if (Object.values(barthelValues).some((v) => v !== null && v !== undefined)) {
    const total = Assessment.computeBarthelTotal(barthelValues);
    scores.push({ key: "barthel", label: "Barthel-Index", value: total, max: Assessment.BARTHEL_MAX, direction: "high", classify: () => Assessment.classifyBarthel(total) });
  }

  if (a.schmerzTyp === "besd" && Object.values(a.besd || {}).some((v) => v !== null && v !== undefined)) {
    const total = Assessment.computeBesdTotal(a.besd);
    scores.push({ key: "schmerz", label: "Schmerz (BESD)", value: total, max: Assessment.BESD_MAX, direction: "low", classify: () => Assessment.classifyBesd(total) });
  } else if (a.schmerzTyp === "nrs" && a.nrs !== null && a.nrs !== undefined) {
    scores.push({ key: "schmerz", label: "Schmerz (NRS)", value: a.nrs, max: Assessment.NRS_MAX, direction: "low", classify: () => Assessment.classifyNrs(a.nrs) });
  }

  if (a.tug && a.tug.sekunden !== null && a.tug.sekunden !== undefined) {
    scores.push({ key: "tug", label: "TUG", value: a.tug.sekunden, max: null, direction: "low", unit: "s", classify: () => Assessment.classifyTug(a.tug.sekunden) });
  }

  if (a.weiche === "neurologisch") {
    const bbs = Assessment.computeBbs7(a.neuro?.bbs7);
    if (bbs.maxPossible > 0) {
      scores.push({ key: "bbs7", label: "BBS-7", value: bbs.total, max: bbs.maxPossible, direction: "high", classify: () => Assessment.classifyBbs7(bbs.total, bbs.maxPossible) });
    }
    const rmiAnswered = (a.neuro?.rmi?.antworten || []).length > 0;
    if (rmiAnswered) {
      const total = Assessment.computeRmiTotal(a.neuro.rmi.antworten, a.neuro.rmi.beobachtung);
      scores.push({ key: "rmi", label: "RMI", value: total, max: Assessment.RMI_MAX, direction: "high", classify: () => Assessment.classifyRmi(total) });
    }
    const mrc = Assessment.computeMrcTotal(a.neuro?.mrc?.gruppen);
    if (mrc.count > 0) {
      scores.push({ key: "mrc", label: "MRC gesamt", value: mrc.total, max: mrc.max, direction: "high" });
    }
  } else if (a.weiche === "orthopaedisch") {
    const sppb = Assessment.computeSppbTotal(a.ortho?.sppb);
    if (a.ortho?.sppb) {
      scores.push({ key: "sppb", label: "SPPB", value: sppb.total, max: Assessment.SPPB_MAX, direction: "high", classify: () => Assessment.classifySppb(sppb.total) });
    }
  } else if (a.weiche === "schwerstbetroffen") {
    const mrc = Assessment.computeMrcTotal(a.schwerst?.mrc?.gruppen);
    if (mrc.count > 0) {
      scores.push({ key: "mrcSchwerst", label: "MRC gesamt (liegend)", value: mrc.total, max: mrc.max, direction: "high" });
    }
  } else if (a.weiche === "bbs") {
    const bbs = Assessment.computeBbsTotal(a.bbs14);
    if (bbs.maxPossible > 0) {
      scores.push({ key: "bbs14", label: "Berg-Balance-Test", value: bbs.total, max: bbs.maxPossible, direction: "high", classify: () => Assessment.classifyBbs(bbs.total, bbs.maxPossible) });
    }
  }

  return scores;
}

function renderLineChartSvg(series, { width = 280, height = 70 } = {}) {
  if (series.length < 2) return "";
  const values = series.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values, min + 1);
  const stepX = width / (series.length - 1);
  const points = series.map((p, idx) => {
    const x = idx * stepX;
    const y = height - ((p.value - min) / (max - min)) * (height - 10) - 5;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");

  return `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="display:block;">
      <polyline points="${points}" fill="none" stroke="#2563eb" stroke-width="2"></polyline>
      ${series.map((p, idx) => {
        const x = idx * stepX;
        const y = height - ((p.value - min) / (max - min)) * (height - 10) - 5;
        return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" fill="#2563eb"></circle>`;
      }).join("")}
    </svg>
  `;
}

function renderAssessmentHistorySection(patient) {
  const assessments = [...(patient.assessments || [])]
    .filter((a) => a.barthel || a.neuro || a.ortho || a.schwerst || a.nrs !== null)
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));

  if (assessments.length === 0) {
    return `<p class="muted" style="margin-top:12px;">Noch keine strukturierten Assessments durchgeführt.</p>`;
  }

  // Verlaufsgraphen je Test (chronologisch aufsteigend)
  const chronological = [...assessments].reverse();
  const seriesByKey = new Map();
  chronological.forEach((a) => {
    extractAssessmentScores(a).forEach((s) => {
      if (!seriesByKey.has(s.key)) seriesByKey.set(s.key, { label: s.label, points: [] });
      seriesByKey.get(s.key).points.push({ date: a.date, value: s.value });
    });
  });

  const chartsHtml = Array.from(seriesByKey.values())
    .filter((s) => s.points.length >= 2)
    .map((s) => `
      <div class="compact-card" style="margin-bottom:8px;">
        <div style="font-weight:600; margin-bottom:6px;">${escapeHtml(s.label)} – Verlauf</div>
        ${renderLineChartSvg(s.points)}
      </div>
    `).join("");

  const entriesHtml = assessments.map((a, idx) => {
    const previous = assessments[idx + 1] || null;
    const scores = extractAssessmentScores(a);
    const prevScores = previous ? extractAssessmentScores(previous) : [];

    const scoreLines = scores.map((s) => {
      const prev = prevScores.find((p) => p.key === s.key);
      const ampel = prev ? Assessment.computeAmpel({ current: s.value, previous: prev.value, max: s.max, direction: s.direction }) : null;
      const deltaText = prev ? ` (Vorwert: ${prev.value}${s.unit || ""}, ${s.value - prev.value >= 0 ? "+" : ""}${(s.value - prev.value).toFixed(s.unit ? 1 : 0)}${s.unit || ""})` : "";
      const classification = s.classify ? s.classify() : "";
      return `<div>${ampelBadgeHtml(ampel)} <strong>${escapeHtml(s.label)}:</strong> ${s.value}${s.max ? `/${s.max}` : s.unit || ""} ${classification ? `– ${escapeHtml(classification)}` : ""}${escapeHtml(deltaText)}</div>`;
    }).join("");

    return `
      <details class="accordion" style="margin-bottom:8px;">
        <summary><span>${escapeHtml(formatDeDate(a.date))}</span><span class="muted">${escapeHtml(Assessment.WEICHEN_OPTIONEN.find((w) => w.val === a.weiche)?.label || "Basis")}</span></summary>
        <div class="accordion-body">${scoreLines || '<p class="muted">Keine auswertbaren Ergebnisse.</p>'}</div>
      </details>
    `;
  }).join("");

  return `
    ${chartsHtml}
    <div class="list-stack" style="margin-top:8px;">${entriesHtml}</div>
  `;
}

function collectRezeptFormPayload() {
  return {
    arzt: document.getElementById("arzt").value.trim(),
    ausstell: document.getElementById("ausstell").value.trim(),
    bg: document.getElementById("bg").checked,
    dt: document.getElementById("dt").checked,
    dringend: document.getElementById("dringend").checked,
    icd10: document.getElementById("icd10").value.trim(),
    icd10b: document.getElementById("icd10b")?.value.trim() || "",
    leitsymptomatik: document.getElementById("leitsymptomatik").value.trim(),
    hausbesuch: document.getElementById("hausbesuch").value,
    arztStempel: document.getElementById("arztStempel").value,
    arztUnterschrift: document.getElementById("arztUnterschrift").value,
    privat: document.getElementById("privat")?.checked || false,
    items: collectRezeptItemsFromForm()
  };
}

// Vergleicht die eingegebene(n) ICD-10-Angabe(n) gegen den Heilmittelkatalog
// (dieselbe Logik wie der separate "Rezeptoptimierer" und FaSti vor der
// Nachbestellung, siehe checkRezeptOptimierung() in modules/fasti.js) und
// gibt einen rein informativen Hinweis zurück (kein Pflichtfeld, blockiert
// das Speichern nicht) - Nutzerwunsch: dieser Abgleich soll nicht erst im
// separaten Rezeptoptimierer-Werkzeug auffallen, sondern schon live beim
// Ausfüllen des Rezepts selbst. Auf Nutzerwunsch bewusst sehr kompakt: passt
// alles, nur ein grüner Haken; passt es nicht, nur ein kleines Warnschild -
// die Erklärung (inkl. Empfehlung) klappt erst per Klick auf. isOpen wird
// von außen hereingereicht (siehe bindRezeptPruefungLive()) statt allein auf
// den nativen <details>-Toggle zu vertrauen: das Panel wird bei JEDER
// Formularänderung komplett neu gerendert (auch durch ein "change" beim
// Verlassen eines Feldes, z.B. wenn der Klick auf das Warnschild selbst
// gerade erst ein anderes Feld unfokussiert) - ohne von außen gehaltenen
// Zustand würde ein frisches, wieder geschlossenes <details> das gerade
// geöffnete sofort überschreiben. Bewusst OHNE Navigations-Button zum
// Rezeptoptimierer, da das die noch ungespeicherten Formulardaten verwerfen
// würde - stattdessen nur der Hinweis, ihn bei Bedarf manuell zu öffnen.
function buildHeilmittelKatalogHinweis(payload, isOpen = false) {
  const icdInputs = [payload.icd10, payload.icd10b].filter((v) => String(v || "").trim());
  if (icdInputs.length === 0) return "";

  const items = (payload.items || []).filter((item) => item.type);
  if (items.length === 0) return "";

  const zertifikate = getRuntimeData()?.settings?.zertifikate || {};
  const ergebnisse = optimiereVerordnung(icdInputs, zertifikate);
  const beste = ergebnisse.find((e) => !e.unbekannt);
  if (!beste) return "";

  const empfohlenerTyp = EMPFEHLUNG_ZU_ITEM_TYPE[beste.empfehlung];
  if (!empfohlenerTyp) return "";

  const aktuelleTypen = items.map((item) => String(item.type || "").trim().toUpperCase());
  if (aktuelleTypen.includes(empfohlenerTyp.toUpperCase())) {
    return `<p class="pill-green" style="margin-top:8px;">✓ ICD-10/Heilmittel passen</p>`;
  }

  const heilmittelLabel = VERGUETUNG[beste.empfehlung]?.label || beste.empfehlung;
  return `
    <details id="katalogHinweisDetails" style="margin-top:8px;" ${isOpen ? "open" : ""}>
      <summary id="katalogHinweisSummary" class="pill-orange" style="list-style:none; cursor:pointer; display:inline-block;">⚠️ ICD-10/Heilmittel</summary>
      <p class="muted" style="margin:6px 0 0 0;">ICD-10-Code und Heilmittel passen nicht zusammen (empfohlen: ${escapeHtml(heilmittelLabel)}). Bitte den Rezeptoptimierer nutzen.</p>
    </details>
  `;
}

function renderRezeptPruefungPanel(validation, payload = null, katalogHinweisOpen = false) {
  const parts = [];

  if (validation.privat) {
    parts.push(`<p class="pill-green">🔒 Privatrezept — keine Kassenregeln, keine Pflichtfeld-Prüfung nötig.</p>`);
  } else if (validation.ok) {
    parts.push(`<p class="pill-green">✓ Alle Pflichtfelder vollständig · Fristen ok</p>`);
  } else {
    parts.push(`
      <div class="error" style="margin-top:12px;">
        <p class="pill-red" style="display:block; margin-bottom:8px;">✗ Rezeptprüfung: ${validation.errors.length} Punkt(e) offen</p>
        <ul style="margin:0; padding-left:20px; font-weight:400;">
          ${validation.errors.map((err) => `<li>${escapeHtml(err.message)}</li>`).join("")}
        </ul>
      </div>
    `);
  }

  // Nutzerwunsch: sichtbare (nicht blockierende) Warnung, sobald Hausbesuch
  // auf "Nein" steht - diese Praxis arbeitet praktisch ausschließlich per
  // Hausbesuch, "Nein" ist daher fast immer ein Versehen.
  if (payload && payload.hausbesuch === "nein") {
    parts.push(`
      <div class="card" style="background:#fffbeb; border-color:#f59e0b; margin-top:12px; margin-bottom:0; padding:14px;">
        <p class="pill-orange" style="display:block; margin-bottom:6px;">⚠️ Hausbesuch: Nein</p>
        <p style="margin:0;">Diese Praxis arbeitet praktisch ausschließlich per Hausbesuch – bitte prüfen, ob das wirklich so gewollt ist.</p>
      </div>
    `);
  }

  if (payload && !validation.privat) {
    const katalogHinweis = buildHeilmittelKatalogHinweis(payload, katalogHinweisOpen);
    if (katalogHinweis) parts.push(katalogHinweis);
  }

  return parts.join("");
}

function bindRezeptPruefungLive(panelId) {
  const panel = document.getElementById(panelId);
  if (!panel) return;

  // Merkt sich, ob das Heilmittelkatalog-Warnschild gerade aufgeklappt ist -
  // das Panel wird bei JEDER Formularänderung komplett neu gerendert (auch
  // durch das "change", das beim Verlassen eines Feldes feuert - z.B. genau
  // dann, wenn ein Klick auf das Warnschild selbst gerade ein zuvor
  // fokussiertes Feld unfokussiert). Ohne diesen von außen gehaltenen
  // Zustand würde ein dadurch ausgelöster refresh() das native
  // <details>-Aufklappen im selben Moment wieder zurücksetzen.
  let katalogHinweisOpen = false;

  const refresh = () => {
    const payload = collectRezeptFormPayload();
    const validation = validateRezeptPflichtfelder(payload);
    panel.innerHTML = renderRezeptPruefungPanel(validation, payload, katalogHinweisOpen);
  };

  panel.addEventListener("click", (event) => {
    if (!event.target.closest("#katalogHinweisSummary")) return;
    event.preventDefault();
    katalogHinweisOpen = !katalogHinweisOpen;
    refresh();
  });

  ["arzt", "ausstell", "bg", "dt", "dringend", "icd10", "icd10b", "leitsymptomatik", "hausbesuch", "arztStempel", "arztUnterschrift", "privat"]
    .forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener("input", refresh);
      if (el) el.addEventListener("change", refresh);
    });

  const container = document.getElementById("leistungenContainer");
  if (container) {
    container.addEventListener("input", refresh);
    container.addEventListener("change", refresh);
  }
  const addBtn = document.getElementById("addLeistungRowBtn");
  if (addBtn) addBtn.addEventListener("click", refresh);

  refresh();
}

function render(html) {
  app.innerHTML = html;
  bindDateAutoFormatsIn(app);
  syncHardwareBackGuardForCurrentView();
}

// Android-Hardware-/Geste-Zurück-Taste: soll die App nie schließen, sondern
// exakt dieselbe Funktion wie der jeweils sichtbare In-App-"Zurück"-Button
// auslösen - unabhängig davon, wo in der App man sich gerade befindet. Die
// App hat kein URL-Routing (jede Ansicht wird per direktem Funktionsaufruf
// gerendert), daher dient die History-API hier nur als reine Sperre: ein
// einzelner Wächter-Eintrag wird bei jedem Zurück-Druck sofort wieder
// nachgeschoben (Standardtrick für PWAs ohne Router), sodass die
// History-Tiefe konstant bleibt und die Taste niemals tatsächlich aus der
// App heraus navigiert oder sie schließt.
//
// Der zu klickende Button wird zur Laufzeit anhand seiner id gesucht statt
// jede Ansicht einzeln zu verdrahten: alle echten Zurück-Buttons der App
// folgen durchgängig dem Namensmuster "backXyzBtn" bzw. "...BackXyz" (z.B.
// backDashboardBtn, wizardBack, zeitBackHomeBtn), vereinzelt auch
// "...ZurueckBtn" (z.B. assessmentSpaeterZurueckBtn) - verlangt wird jeweils
// ein großer Anfangsbuchstabe direkt nach "back"/"zurueck", um z.B.
// "backupReminderDownloadBtn" (Backup, kein Zurück-Button) sicher
// auszuschließen. Ist kein solcher Button sichtbar (z.B. ein Dialog mit nur
// "Abbrechen"), wird ersatzweise danach gesucht - bewusst OHNE "später"/
// "spaeter", da das eine eigenständige Weiter-Aktion mit Seiteneffekt ist
// (Termin verschieben), keine reine Zurück-Aktion, und sonst z.B. auf der
// Assessment-Startseite fälschlich vor "Abbrechen" ausgewählt würde. Bleibt
// auch das erfolglos (z.B. auf dem PIN-Login-Bildschirm), bleibt der
// Tastendruck wirkungslos, statt die App zu verlassen oder den PIN-Schutz
// versehentlich zu umgehen.
function isBackLikeButtonId(id) {
  return /^back[A-Z]/.test(id) || /[a-z]Back([A-Z]|$)/.test(id)
    || /^zurueck[A-Z]/.test(id) || /[a-z]Zurueck([A-Z]|$)/.test(id);
}

function isFallbackDismissButtonId(id) {
  return /abbrechen|cancel|schliessen|schließen|close/i.test(id);
}

// Nur für Buttons INNERHALB eines Overlays (siehe findHardwareBackTarget) -
// dort ist "Später"/"Later" (z.B. backupReminderLaterBtn) die einzige echte
// Dismiss-Aktion neben Abbrechen/Schließen, anders als z.B. auf der
// Assessment-Startseite, wo "Später" eine eigenständige Weiter-Aktion mit
// Seiteneffekt ist und deshalb bewusst NICHT in isFallbackDismissButtonId
// landet (siehe Kommentar dort).
function isOverlayDismissButtonId(id) {
  return isFallbackDismissButtonId(id) || /spaeter|später|later/i.test(id);
}

function findHardwareBackTarget() {
  // Offene Overlays (Backup-Erinnerung, Assessment verschieben) liegen
  // außerhalb von #app direkt in <body> und legen sich optisch über die
  // aktuelle Ansicht - ihr eigener Abbrechen-/Später-Button hat Vorrang vor
  // dem darunterliegenden Zurück-Button der eigentlichen Ansicht.
  const overlay = document.querySelector('[id$="Overlay"]');
  if (overlay) {
    const overlayBtn = Array.from(overlay.querySelectorAll('button[id]'))
      .find((btn) => isOverlayDismissButtonId(btn.id) || isBackLikeButtonId(btn.id));
    if (overlayBtn) return overlayBtn;
  }

  const buttons = Array.from(document.querySelectorAll('#app button[id]'));
  return buttons.find((btn) => isBackLikeButtonId(btn.id))
    || buttons.find((btn) => isFallbackDismissButtonId(btn.id))
    || null;
}

function pushHardwareBackGuard() {
  try {
    history.pushState({ appBackGuard: true }, "", location.href);
  } catch (err) {
    // pushState kann in seltenen eingebetteten Kontexten fehlschlagen - dann
    // bleibt die Zurück-Taste beim nächsten Druck wirkungslos, statt die App
    // zum Absturz zu bringen.
    console.error("Zurück-Sperre konnte nicht gesetzt werden", err);
  }
}

// Schiebt nur dann eine neue Sperre nach, wenn ganz oben im Verlauf nicht
// ohnehin schon eine liegt (history.state verrät das direkt) - idempotent,
// darf also beliebig oft aufgerufen werden, ohne den Verlauf unnötig
// wachsen zu lassen.
function ensureHardwareBackGuardArmed() {
  if (history.state && history.state.appBackGuard === true) return;
  pushHardwareBackGuard();
}

// Wird gesetzt, kurz bevor disarmHardwareBackGuardForDashboard() selbst ein
// history.back() auslöst, damit der darauf folgende, rein programmatisch
// erzeugte popstate NICHT wie ein echter Tastendruck behandelt wird (sonst
// würde er fälschlich versuchen, einen Zurück-Button auf dem Dashboard zu
// suchen/klicken).
let hardwareBackGuardSelfTriggeredPop = false;

// Löst sich auf, sobald ein per disarmHardwareBackGuardForDashboard()
// ausgelöster history.back() tatsächlich abgeschlossen ist (popstate kommt
// immer asynchron). Ohne diese Synchronisierung entsteht ein Wettlauf: die
// automatische Backup-Erinnerung (maybeShowBackupReminder() in core/boot.js)
// öffnet ihr Overlay UNMITTELBAR NACH showDashboardView() - also potenziell
// bevor der noch ausstehende history.back()-Abbau abgeschlossen ist. Würde
// das Overlay in diesem Zwischenzustand history.state prüfen, sähe es
// fälschlich noch die ALTE (armed) Sperre, hielte sich selbst für bereits
// ausreichend gesichert und würde NICHT erneut schaerfen - sobald der Abbau
// dann doch noch durchläuft, stünde man mit offenem Overlay OHNE Sperre da,
// und ein Zurück-Druck würde die App verlassen statt nur das Overlay zu
// schließen. Jeder Aufrufer, der scharf stellen will, wartet deshalb zuerst
// auf ein eventuell laufendes Abbauen.
let hardwareBackGuardDisarmPending = null;

// Entfernt eine ggf. noch bestehende Zurück-Sperre wieder, sobald das
// Dashboard erreicht wird - notwendig, weil eine Sperre, die z.B. beim
// App-Start oder bei früherer Navigation in eine Unteransicht gesetzt wurde,
// sonst unverändert stehen bleibt (pushState/Sperren werden nie durch
// normale Klick-Navigation zurückgebaut, siehe Kommentar bei
// syncHardwareBackGuardForCurrentView()). Ohne dieses aktive Zurückfahren
// "verpufft" der erste Zurück-Druck auf dem Dashboard wirkungslos an dieser
// Alt-Sperre (kein Zurück-Button auf dem Dashboard klickbar), und erst ein
// ZWEITER Druck verlässt tatsächlich die App - genau der seit Langem
// gemeldete, unzuverlässige "manchmal einmal, manchmal zweimal"-Bug.
function disarmHardwareBackGuardForDashboard() {
  if (!(history.state && history.state.appBackGuard === true)) return Promise.resolve();
  if (hardwareBackGuardDisarmPending) return hardwareBackGuardDisarmPending;
  hardwareBackGuardSelfTriggeredPop = true;
  hardwareBackGuardDisarmPending = new Promise((resolve) => {
    const onSelfPop = () => {
      window.removeEventListener("popstate", onSelfPop);
      hardwareBackGuardDisarmPending = null;
      resolve();
    };
    window.addEventListener("popstate", onSelfPop);
  });
  history.back();
  return hardwareBackGuardDisarmPending;
}

// Hält die Zurück-Sperre synchron zur aktuell sichtbaren Ansicht - wird aus
// render() heraus bei JEDER Bildschirmänderung aufgerufen, unabhängig davon,
// ob sie durch einen normalen Klick oder durch die Zurück-Taste selbst
// ausgelöst wurde. Das ist entscheidend: ohne diesen Aufruf aus render()
// "vergaß" die App die Sperre dauerhaft, sobald einmal auf dem Dashboard
// zurückgedrückt wurde, selbst wenn der Nutzer danach über normale Klicks
// wieder tief in die App navigierte (per Playwright gefundener, echter
// Folgefehler der ersten Fassung) - die Sperre wurde dort nur im
// popstate-Handler verwaltet, der bei normaler Navigation nie feuert.
//
// Bewusst async (fire-and-forget für alle bestehenden Aufrufer, die das
// Ergebnis nie abwarten): siehe hardwareBackGuardDisarmPending oben.
async function syncHardwareBackGuardForCurrentView() {
  // Auf dem Dashboard (und nur dort) soll der Zurück-Druck die App
  // tatsächlich verlassen können - Standard-Android-Verhalten: Zurück auf
  // dem "Zuhause"-Bildschirm einer App beendet sie. Eine ggf. noch aktive
  // Sperre wird deshalb hier aktiv abgebaut, solange kein Overlay (z.B.
  // Backup-Erinnerung) offen ist - das hat weiterhin Vorrang und wird zuerst
  // geschlossen, statt die App direkt zu verlassen.
  const overlay = document.querySelector('[id$="Overlay"]');
  if (getCurrentView() === "dashboard" && !overlay) {
    await disarmHardwareBackGuardForDashboard();
    return;
  }
  if (hardwareBackGuardDisarmPending) await hardwareBackGuardDisarmPending;
  ensureHardwareBackGuardArmed();
}

function initHardwareBackButtonHandling() {
  pushHardwareBackGuard();
  window.addEventListener("popstate", () => {
    if (hardwareBackGuardSelfTriggeredPop) {
      // Eigener, programmatischer Abbau der Sperre (siehe
      // disarmHardwareBackGuardForDashboard()) - kein echter Tastendruck,
      // also keinen Zurück-Button suchen/klicken, nur den Zustand neu
      // bewerten.
      hardwareBackGuardSelfTriggeredPop = false;
      syncHardwareBackGuardForCurrentView();
      return;
    }
    const target = findHardwareBackTarget();
    if (target) target.click();
    // target.click() löst normalerweise render() aus, das die Sperre über
    // syncHardwareBackGuardForCurrentView() bereits selbst nachzieht - der
    // Aufruf hier fängt zusätzlich die Fälle ab, in denen das NICHT
    // passiert: ein per Klick geschlossenes Overlay (nur overlay.remove(),
    // kein render()) oder gar kein gefundenes Ziel (z.B. PIN-Login-
    // Bildschirm, wo ein zweiter Druck nicht aus der App führen soll).
    syncHardwareBackGuardForCurrentView();
  });
}

initHardwareBackButtonHandling();

// Kurze, stille Meldung (z.B. "Export gesendet") ohne dass der Therapeut
// etwas tun muss. Verschwindet nach ein paar Sekunden von selbst.
export function showToast(message, duration = 4000) {
  const toast = document.createElement("div");
  toast.textContent = message;
  toast.style.cssText = "position:fixed; left:50%; bottom:24px; transform:translateX(-50%); background:#0f172a; color:#fff; padding:12px 18px; border-radius:12px; font-size:14px; box-shadow:0 10px 30px rgba(15,23,42,0.25); z-index:9999; max-width:90vw; text-align:center;";
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), duration);
}

// Sichtbare, NICHT von selbst verschwindende Warnleiste für kritische
// Fehler (siehe initGlobalErrorHandling() unten) - lebt außerhalb von #app
// (überlebt also jeden render()-Aufruf) und bekommt bewusst eine id, die
// NICHT auf "Overlay" endet, damit findHardwareBackTarget()/
// syncHardwareBackGuardForCurrentView() sie nicht als modales Overlay
// behandeln - die Android-Zurück-Taste soll durch die App navigieren
// können, während diese Leiste sichtbar ist, statt daran hängen zu bleiben.
let criticalErrorBannerEl = null;
export function showCriticalErrorBanner(message) {
  if (criticalErrorBannerEl) {
    // Bereits sichtbar - Text aktualisieren statt eine zweite Leiste
    // aufzubauen, falls kurz hintereinander mehrere Fehler auftreten.
    const textEl = criticalErrorBannerEl.querySelector(".criticalErrorBannerText");
    if (textEl) textEl.textContent = message;
    return;
  }

  const banner = document.createElement("div");
  banner.id = "criticalErrorBanner";
  banner.style.cssText = "position:fixed; top:0; left:0; right:0; z-index:10000; background:#7f1d1d; color:#fff; padding:12px 16px; display:flex; align-items:center; gap:12px; flex-wrap:wrap; box-shadow:0 4px 12px rgba(0,0,0,0.3); font-size:14px;";
  banner.innerHTML = `
    <span class="criticalErrorBannerText" style="flex:1; min-width:200px;">${escapeHtml(message)}</span>
    <button id="criticalErrorBannerReloadBtn" style="margin:0; width:auto; padding:6px 14px; background:#fff; color:#7f1d1d;">Seite neu laden</button>
    <button id="criticalErrorBannerCloseBtn" class="secondary" style="margin:0; width:auto; padding:6px 14px; background:transparent; border:1px solid #fff; color:#fff;">Schließen</button>
  `;
  document.body.appendChild(banner);
  criticalErrorBannerEl = banner;

  document.getElementById("criticalErrorBannerReloadBtn").onclick = () => window.location.reload();
  document.getElementById("criticalErrorBannerCloseBtn").onclick = () => {
    banner.remove();
    criticalErrorBannerEl = null;
  };
}

// Auffangnetz für sonst komplett unsichtbare Abstürze: bisher gab es KEINEN
// globalen Fehler-Handler - ein einzelner unerwarteter Fehler irgendwo in
// einem render()/Klick-Handler ließ die App einfach "einfrieren" (Klicks
// tun nichts mehr), ohne jede Erklärung für den Therapeuten, was von außen
// wie ein "Absturz" wirkt. Ebenso liefen etliche Speichervorgänge bewusst
// "fire-and-forget" (siehe z.B. queuePersistRuntimeData()-Aufrufe ohne
// await/catch) - schlägt so ein Hintergrund-Speichern fehl (z.B. voller
// Gerätespeicher), verschwand der Fehler bisher spurlos, obwohl die gerade
// gemachte Eingabe dadurch NICHT gespeichert wurde. Ersetzt kein sauberes
// Fehlerhandling an der jeweiligen Stelle, macht aber jeden bisher
// unsichtbaren Fehler wenigstens sichtbar, statt dass der Therapeut nie
// erfährt, dass etwas schiefgelaufen ist.
function initGlobalErrorHandling() {
  window.addEventListener("error", (event) => {
    console.error("Unerwarteter Fehler:", event.error || event.message);
    showCriticalErrorBanner(
      "Es ist ein unerwarteter technischer Fehler aufgetreten. Bitte die Seite neu laden - bereits gespeicherte Daten sind davon nicht betroffen, nur eine gerade eingegebene, noch nicht gespeicherte Änderung könnte verloren sein."
    );
  });

  window.addEventListener("unhandledrejection", (event) => {
    console.error("Unbehandelter Fehler (Hintergrundvorgang):", event.reason);
    showCriticalErrorBanner(
      "Eine Aktion konnte im Hintergrund nicht vollständig gespeichert werden. Bitte die zuletzt gemachte Eingabe prüfen und die Seite bei Unsicherheit neu laden."
    );
  });
}

initGlobalErrorHandling();

// Lädt ganz ohne Klick/Overlay ein frisches, VOLLSTÄNDIGES Backup herunter,
// sobald das Intervall abgelaufen ist (siehe isAutoBackupDownloadDue() in
// modules/backupReminder.js, Vorgabe des Nutzers: alle 5 Tage bzw. sofort bei
// neuen Änderungen) - unabhängig von der separaten, klickbasierten "Bitte
// senden"-Erinnerung weiter unten. Nutzt exportBackup() (dieselbe Funktion
// wie der manuelle "Backup exportieren"-Button), NICHT das reine
// buildBackupZip() - damit sich diese Datei über "Backup wiederherstellen"
// auch tatsächlich zur kompletten Wiederherstellung der App nutzen lässt,
// statt nur im separaten Offline-Viewer lesbar zu sein (enthält zusätzlich
// die appData.json, ist also weiterhin auch viewer-kompatibel). Landet im
// normalen Downloads-Ordner des Geräts, also AUSSERHALB des von
// Browser-Speicher-Eviction betroffenen App-Speichers (siehe
// Stabilitäts-Audit) - auf Betriebshandys dürfen sich die ZIP-Dateien dort
// ausdrücklich ansammeln. Schlägt der Download fehl (z.B. blockiertes
// Download-Popup oder Runtime-Key noch nicht verfügbar), wird das nur
// geloggt und beim nächsten Öffnen erneut versucht (lastAutoBackupDownloadAt
// bleibt in dem Fall unverändert) - blockiert NICHT den Login-Vorgang.
export async function triggerAutomaticBackupDownload(runtimeData) {
  try {
    const result = await exportBackup(runtimeData);
    downloadBlob(result.blob, result.filename);
    await markAutoBackupDownloadHandled(`Automatisches Backup "${result.filename}" heruntergeladen.`);
    // Bewusst kein showToast() mehr (Nutzerfeedback: die Meldung beim
    // Öffnen der App wurde als störend empfunden) - der Download selbst
    // läuft weiterhin ganz normal und unverändert im Hintergrund, nur ohne
    // sichtbare Benachrichtigung darüber.
  } catch (err) {
    console.error("Automatischer Backup-Download fehlgeschlagen:", err);
  }
}

// Erinnerung, das zuletzt automatisch heruntergeladene (oder frisch hier
// erstellte) Backup an die Praxis/den Viewer-PC zu SENDEN, damit der
// separate Offline-Viewer regelmäßig auf den aktuellen Stand kommt -
// eigenständiges Overlay (als Kind von document.body statt #app angehängt,
// damit es unabhängig von der gerade angezeigten Ansicht sichtbar bleibt
// und von einem render() der dahinterliegenden Ansicht nicht mit entfernt
// wird). Kein automatischer Versand mehr (EmailJS wurde entfernt) - der
// Therapeut erledigt das Senden per Klick selbst (Download und/oder
// E-Mail-Programm mit vorbereitetem Anhangs-Hinweis öffnen). "Später
// erinnern" lässt die Fälligkeit bewusst unverändert, damit die Erinnerung
// beim nächsten Öffnen der App erneut erscheint.
export function showBackupReminderModal({ onDone } = {}) {
  const runtimeData = getRuntimeData();
  if (!runtimeData) return;

  document.getElementById("backupReminderOverlay")?.remove();

  const overlay = document.createElement("div");
  overlay.id = "backupReminderOverlay";
  overlay.style.cssText = "position:fixed; inset:0; background:rgba(15,23,42,0.55); z-index:9998; display:flex; align-items:center; justify-content:center; padding:16px;";
  overlay.innerHTML = `
    <div class="card" style="max-width:420px; width:100%; margin:0;">
      <h3>🔔 Backup-Erinnerung</h3>
      <p class="muted">Damit der separate Offline-Viewer aktuell bleibt, bitte regelmäßig ein Backup an die Praxis/den Viewer-PC senden.</p>
      <div class="row" style="flex-direction:column; gap:10px; margin-top:16px;">
        <button id="backupReminderDownloadBtn" style="margin-top:0;">Als Datei herunterladen</button>
        <button id="backupReminderMailBtn" class="secondary" style="margin-top:0;">Per E-Mail senden (mailto)</button>
        <button id="backupReminderLaterBtn" class="secondary" style="margin-top:0;">Später erinnern</button>
      </div>
      <div id="backupReminderMsg" class="muted" style="margin-top:12px;"></div>
    </div>
  `;
  document.body.appendChild(overlay);
  // Overlays hängen außerhalb von #app direkt in <body> und lösen deshalb
  // KEIN render() aus - ohne diesen expliziten Sync bliebe die Zurück-Sperre
  // z.B. auf dem Dashboard deaktiviert, und ein Zurück-Druck würde die App
  // sofort verlassen statt nur diesen Dialog zu schließen.
  syncHardwareBackGuardForCurrentView();

  function close() {
    overlay.remove();
    // Nicht auf ein render() durch onDone() verlassen, um die Sperre
    // zurückzusetzen - onDone() rendert zwar in der Praxis meist neu, aber
    // ohne diesen expliziten Sync hier bliebe die Sperre bei jedem
    // zukünftigen Aufrufer ohne re-render fälschlich scharf.
    syncHardwareBackGuardForCurrentView();
    if (onDone) onDone();
  }

  document.getElementById("backupReminderLaterBtn").onclick = async () => {
    await markBackupReminderPostponed();
    close();
  };

  async function createBackupZip() {
    const msg = document.getElementById("backupReminderMsg");
    msg.className = "muted";
    msg.textContent = "Backup wird erstellt…";
    const result = await buildBackupZip(runtimeData);
    downloadBlob(result.blob, result.filename);
    return result;
  }

  document.getElementById("backupReminderDownloadBtn").onclick = async () => {
    try {
      const result = await createBackupZip();
      await markBackupReminderHandled(`Backup "${result.filename}" heruntergeladen.`);
      showToast("Backup heruntergeladen");
      close();
    } catch (err) {
      console.error(err);
      const msg = document.getElementById("backupReminderMsg");
      msg.className = "error";
      msg.textContent = `Backup fehlgeschlagen: ${err.message || err}`;
    }
  };

  document.getElementById("backupReminderMailBtn").onclick = async () => {
    try {
      const result = await createBackupZip();
      window.location.href = buildBackupReminderMailtoLink({
        filename: result.filename,
        therapistName: runtimeData.settings?.therapistName,
        bueroEmail: runtimeData.settings?.buero?.email
      });
      await markBackupReminderHandled(`Backup "${result.filename}" heruntergeladen, E-Mail-Programm geöffnet (Anhang manuell hinzufügen).`);
      showToast("Backup versendet", 2000);
      close();
    } catch (err) {
      console.error(err);
      const msg = document.getElementById("backupReminderMsg");
      msg.className = "error";
      msg.textContent = `Backup fehlgeschlagen: ${err.message || err}`;
    }
  };
}

// Ersetzt ein früheres window.prompt() für "Assessment verschieben" (Dashboard,
// Bereich 3) - ein natives Browser-Prompt kann keine TT.MM.JJJJ-Auto-Formatierung
// bekommen (bindDateAutoFormat setzt auf echte <input>-Events), deshalb ein
// kleines eigenes Modal nach demselben Muster wie showBackupReminderModal().
function showAssessmentVerschiebenModal({ homeId, patientId, onDone }) {
  document.getElementById("assessmentVerschiebenOverlay")?.remove();

  const overlay = document.createElement("div");
  overlay.id = "assessmentVerschiebenOverlay";
  overlay.style.cssText = "position:fixed; inset:0; background:rgba(15,23,42,0.55); z-index:9998; display:flex; align-items:center; justify-content:center; padding:16px;";
  overlay.innerHTML = `
    <div class="card" style="max-width:380px; width:100%; margin:0;">
      <h3>Assessment verschieben</h3>
      <label for="assessmentVerschiebenDatum">Neues Datum</label>
      <input id="assessmentVerschiebenDatum" type="text" inputmode="numeric" placeholder="TT.MM.JJJJ" autocomplete="off">
      <div id="assessmentVerschiebenMsg" class="error" style="margin-top:8px;"></div>
      <div class="row" style="margin-top:16px;">
        <button id="assessmentVerschiebenSaveBtn" style="margin-top:0;">Speichern</button>
        <button id="assessmentVerschiebenCancelBtn" class="secondary" style="margin-top:0;">Abbrechen</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  // Overlays hängen außerhalb von #app direkt in <body> und lösen deshalb
  // KEIN render() aus - ohne diesen expliziten Sync bliebe die Zurück-Sperre
  // z.B. auf dem Dashboard deaktiviert, und ein Zurück-Druck würde die App
  // sofort verlassen statt nur diesen Dialog zu schließen.
  syncHardwareBackGuardForCurrentView();

  const input = document.getElementById("assessmentVerschiebenDatum");
  bindDateAutoFormat(input);
  input.focus();

  function close() {
    overlay.remove();
    // Kein render() bei einem reinen Abbrechen/Schließen per Klick (im
    // Unterschied zum Hardware-Zurück-Pfad, der diesen Sync bereits selbst
    // im popstate-Handler nachzieht) - ohne diesen Aufruf bliebe die Sperre
    // nach dem Schließen fälschlich scharf, z.B. auf dem Dashboard.
    syncHardwareBackGuardForCurrentView();
  }

  document.getElementById("assessmentVerschiebenCancelBtn").onclick = close;

  async function save() {
    const msg = document.getElementById("assessmentVerschiebenMsg");
    msg.textContent = "";
    const parsed = parseDeDate(input.value.trim());
    if (!parsed) {
      msg.textContent = "Bitte ein gültiges Datum im Format TT.MM.JJJJ eingeben.";
      return;
    }
    try {
      scheduleAssessment(homeId, patientId, parsed);
      await queuePersistRuntimeData();
      close();
      if (onDone) onDone();
    } catch (err) {
      console.error(err);
      msg.textContent = err?.message || "Termin konnte nicht verschoben werden.";
    }
  }

  document.getElementById("assessmentVerschiebenSaveBtn").onclick = save;
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") save();
  });
}

function openHtmlDocument(title, bodyHtml, { autoPrint = false } = {}) {
  const win = window.open("", "_blank", "width=900,height=700");
  if (!win) {
    alert("Fenster konnte nicht geöffnet werden.");
    return null;
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
          line-height: 1.45;
        }
        h1{
          font-size: 22px;
          margin-bottom: 18px;
        }
        .row{
          border-bottom:1px solid #d1d5db;
          padding:10px 0;
        }
        table{
          width:100%;
          border-collapse:collapse;
          margin-top:12px;
        }
        th, td{
          border:1px solid #d1d5db;
          padding:8px 10px;
          text-align:left;
          font-size:14px;
        }
        th{
          background:#f3f4f6;
          font-weight:700;
        }
        td.numeric, th.numeric{
          text-align:right;
          white-space:nowrap;
        }
        tfoot td{
          font-weight:700;
          background:#f9fafb;
        }
        .muted{
          color:#6b7280;
          font-size:12px;
        }
        .print-actions{
          margin-top: 20px;
          display:flex;
          gap:12px;
          flex-wrap:wrap;
        }
        button{
          border:0;
          border-radius:8px;
          padding:10px 14px;
          cursor:pointer;
          background:#2563eb;
          color:white;
          font-weight:600;
        }
        button.secondary{
          background:#e5e7eb;
          color:#111827;
        }
        @media print{
          .print-actions{ display:none; }
          body{ padding:0; }
        }
      </style>
    </head>
    <body>
      ${bodyHtml}
      <div class="print-actions">
        <button onclick="window.print()">Drucken / als PDF speichern</button>
        <button class="secondary" onclick="window.close()">Schließen</button>
      </div>
    </body>
    </html>
  `);

  win.document.close();
  win.focus();
  if (autoPrint) win.print();
  return win;
}

function printHtml(title, bodyHtml) {
  openHtmlDocument(title, `<h1>${escapeHtml(title)}</h1>${bodyHtml}`, { autoPrint: true });
}

function openLetterPreview(title, bodyHtml) {
  openHtmlDocument(title, bodyHtml, { autoPrint: false });
}

function formatIsoDateShort(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return formatCurrentDateShort(new Date());
  return date.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function escapeAndPreserveLineBreaks(value) {
  return escapeHtml(String(value || "")).replace(/\n/g, "<br>");
}

function buildCleanLetterHeaderLines(lines = []) {
  const seen = new Set();
  const cleaned = [];

  for (const rawLine of lines) {
    const splitLines = String(rawLine || "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    for (const line of splitLines) {
      const normalized = line.replace(/\s+/g, " ").trim().toLowerCase();
      if (!normalized) continue;
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      cleaned.push(line);
    }
  }

  return cleaned;
}

function flattenNachbestellLines(letterData = {}) {
  return (letterData.groups || []).flatMap((group) =>
    (group.patients || []).flatMap((patient) =>
      (patient.rezepte || []).map((rezept) => ({
        patient: patient.patientName || "",
        geb: patient.geb || "",
        heim: group.title || "",
        text: rezept.text || ""
      }))
    )
  );
}

// versandart steuert, wie die Verordnungen laut Brieftext zur Praxis kommen
// sollen - "fax" (Standard: Fax an den Arzt, Original zur Einrichtung),
// "abholen" (Therapeut holt die Rezepte selbst in der Praxis ab, braucht ein
// Abholdatum) oder "post" (Original per Post direkt an die Praxisadresse,
// nicht an die Einrichtung).
function renderNachbestellLetterHtml(letterData = {}, { versandart = "fax", abholDatum = "" } = {}) {
  const createdAt = formatIsoDateShort(letterData.createdAt);
  const praxis = letterData.praxis || {};
  const doctor = letterData.doctor || "";
  const therapistName = praxis.therapistName || "";
  const headerLines = buildCleanLetterHeaderLines([
    praxis.name,
    praxis.department,
    praxis.address,
    praxis.phone ? `Tel.: ${praxis.phone}` : "",
    praxis.fax ? `Fax.: ${praxis.fax}` : ""
  ]);

  const praxisAdresseZeilen = buildCleanLetterHeaderLines([praxis.name, praxis.address]).map(escapeHtml).join("<br>");
  const versandTextByArt = {
    fax: `
      für unsere gemeinsamen Patientinnen und Patienten bitten wir Sie, folgende Heilmittelverordnungen für Physiotherapie auszustellen und diese per Fax an folgende Nummer zu senden:<br>
      Fax: ${escapeHtml(praxis.fax || '—')}<br>
      Bitte senden Sie die neue Heilmittelverordnung per Fax an meine Fax-Nummer, damit ich die Therapie ohne Unterbrechung fortsetzen kann.<br>
      Bitte lassen Sie die Originale der Verordnungen anschließend der jeweils unten angegebenen Einrichtung zukommen.<br>
      Vielen Dank für Ihre Unterstützung.
    `,
    abholen: `
      für unsere gemeinsamen Patientinnen und Patienten bitten wir Sie, folgende Heilmittelverordnungen für Physiotherapie auszustellen.<br>
      Ich werde die Verordnungen persönlich am ${escapeHtml(abholDatum || '—')} in Ihrer Praxis abholen.<br>
      Vielen Dank für das Herrichten der Verordnungen.
    `,
    post: `
      für unsere gemeinsamen Patientinnen und Patienten bitten wir Sie, folgende Heilmittelverordnungen für Physiotherapie auszustellen und diese per Fax an folgende Nummer zu senden:<br>
      Fax: ${escapeHtml(praxis.fax || '—')}<br>
      Bitte senden Sie die neue Heilmittelverordnung per Fax an meine Fax-Nummer, damit ich die Therapie ohne Unterbrechung fortsetzen kann.<br>
      Bitte senden Sie die Originale der Verordnungen anschließend per Post an unsere Praxisadresse:<br>
      ${praxisAdresseZeilen}<br>
      Vielen Dank für Ihre Unterstützung.
    `,
    email: `
      für unsere gemeinsamen Patientinnen und Patienten bitten wir Sie, folgende Heilmittelverordnungen für Physiotherapie auszustellen und diese per E-Mail an den Absender dieser Nachricht zurückzusenden.<br>
      Bitte lassen Sie die Originale der Verordnungen anschließend der jeweils unten angegebenen Einrichtung zukommen.<br>
      Vielen Dank für Ihre Unterstützung.
    `
  };
  const versandText = versandTextByArt[versandart] || versandTextByArt.fax;

  return `
    <style>
      .letter-wrap{max-width:820px;margin:0 auto;color:#111827;}
      .letter-head{margin-bottom:28px;}
      .letter-head .line{font-size:14px;}
      .letter-recipient{margin:22px 0 10px;}
      .letter-subject{margin:14px 0 18px;font-weight:700;}
      .letter-date{margin:8px 0 18px;}
      .letter-text{margin-bottom:20px;}
      .letter-group{margin:18px 0 0;}
      .letter-group-title{font-weight:700;}
      .letter-group-address{margin-top:2px;white-space:pre-line;}
      .letter-patient{margin:12px 0 0;}
      .letter-patient-name{font-weight:700;}
      .letter-list{margin:4px 0 0 20px;padding:0;}
      .letter-list li{margin:2px 0;}
      .letter-closing{margin-top:28px;}
    </style>
    <div class="letter-wrap">
      <div class="letter-head">
        ${headerLines.map((line, index) => `<div class="line">${index === 0 ? `<strong>${escapeHtml(line)}</strong>` : escapeHtml(line)}</div>`).join('')}
      </div>

      <div class="letter-recipient">
        <div><strong>An:</strong></div>
        <div>${escapeHtml(doctor || '—')}</div>
      </div>

      <div class="letter-subject">Betreff: Rezeptnachbestellung Physiotherapie</div>
      <div class="letter-date">Datum: ${escapeHtml(createdAt)}</div>

      <div class="letter-text">
        Sehr geehrte Damen und Herren,<br>
        liebes Praxis-Team,<br><br>
        ${versandText}
      </div>

      ${(letterData.groups || []).map((group) => `
        <div class="letter-group">
          <div class="letter-group-title">${escapeHtml(group.title || '')}</div>
          ${group.address ? `<div class="letter-group-address">${escapeAndPreserveLineBreaks(group.address)}</div>` : ''}

          ${(group.patients || []).map((patient) => `
            <div class="letter-patient">
              <div class="letter-patient-name">${escapeHtml(patient.patientName || 'Patient')}${patient.geb ? ` – geb. ${escapeHtml(patient.geb)}` : ''}</div>
              <ul class="letter-list">
                ${(patient.rezepte || []).map((rezept) => `<li>${escapeHtml(rezept.text || '—')}</li>`).join('')}
              </ul>
            </div>
          `).join('')}
        </div>
      `).join('')}

      <div class="letter-closing">
        Mit freundlichen Grüßen<br><br>
        ${escapeHtml(therapistName || '')}<br>
        Physiotherapeut<br>
        ${escapeHtml(praxis.name || 'Physio Strobl')} – ${escapeHtml(praxis.department || 'Abteilung FaSt')}
      </div>
    </div>
  `;
}


function ensureDoctorReportsState(rezept) {
  if (!rezept || typeof rezept !== "object") return [];
  if (!Array.isArray(rezept.doctorReports)) {
    rezept.doctorReports = [];
  }
  return rezept.doctorReports;
}

// Legt einen neuen, leeren Arztbericht für ein Rezept an und gibt dessen
// reportId zurück - gemeinsam genutzt vom bisherigen Weg (Einrichtung ->
// Patient -> Arztbericht-Bereich -> Rezept auswählen) und dem neuen
// Schnellzugriff-Button in der Patientenliste, damit die Erzeugungslogik
// nicht doppelt gepflegt werden muss.
function createDoctorReportForRezept(homeId, patientId, rezeptId) {
  let createdReportId = "";
  mutateRuntimeData((data) => {
    const home = getHomeById(data, homeId);
    const patient = getPatientById(home, patientId);
    const rezept = getRezeptById(patient, rezeptId);
    if (!patient || !rezept) throw new Error("Rezept nicht gefunden");
    const reports = ensureDoctorReportsState(rezept);
    const now = new Date().toISOString();
    createdReportId = `report_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    reports.unshift({
      reportId: createdReportId,
      content: "",
      therapieziele: [],
      therapiezielFreitext: "",
      compliance: "",
      complianceFreitext: "",
      verlauf: "",
      verlaufFreitext: "",
      therapieWeiterfuehren: "",
      therapieNutzen: "",
      therapieText: "",
      bemerkungen: "",
      createdAt: now,
      updatedAt: now
    });
  });
  return createdReportId;
}

// Teil 1 des Therapieberichts (automatisch): letztes Assessment mit
// Ampel/Delta zum Vorwert, z.B. "Barthel-Index: 65/100 🟡 (Vorwert: 75/100, -10 Punkte)".
function buildAssessmentSummaryLines(patient) {
  const assessments = [...(patient?.assessments || [])]
    .filter((a) => a.barthel || a.neuro || a.ortho || a.schwerst || a.nrs !== null)
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));

  if (assessments.length === 0) return null;

  const latest = assessments[0];
  const previous = assessments[1] || null;
  const scores = extractAssessmentScores(latest);
  const prevScores = previous ? extractAssessmentScores(previous) : [];

  return {
    date: latest.date,
    lines: scores.map((s) => {
      const prev = prevScores.find((p) => p.key === s.key);
      const ampel = prev ? Assessment.computeAmpel({ current: s.value, previous: prev.value, max: s.max, direction: s.direction }) : null;
      const delta = prev ? `${s.value - prev.value >= 0 ? "+" : ""}${(s.value - prev.value).toFixed(s.unit ? 1 : 0)}${s.unit || ""}` : "";
      return {
        text: `${s.label}: ${s.value}${s.max ? `/${s.max}` : s.unit || ""}`,
        ampel,
        deltaText: prev ? `Vorwert: ${prev.value}${s.unit || ""}, ${delta}` : ""
      };
    })
  };
}

function getPracticeHeaderLines(settings = {}) {
  const lines = buildCleanLetterHeaderLines([
    'Physio Strobl',
    'therapeutisches Handwerk',
    settings.practiceAddress || '',
    settings.practicePhone ? `Telefon ${settings.practicePhone}` : '',
    settings.therapistFax ? `Fax ${settings.therapistFax}` : ''
  ]);
  return lines;
}

// Feste Einleitung des Therapieberichts, automatisch mit Patientendaten
// befüllt (Vorgabe Aufgabe 6). "der/die" bleibt bewusst ungegendert
// stehen, wie in der Nutzervorgabe wörtlich vorgegeben - nur die vier
// markierten Platzhalter werden ersetzt.
function buildDoctorReportIntroLine(patient) {
  const anredeArzt = "Sehr geehrte Damen und Herren";
  const anredePatient = patient?.anrede === "frau" ? "Frau " : patient?.anrede === "herr" ? "Herrn " : "";
  const patientName = formatPatientName(patient) || "";
  const geburtsdatum = patient?.birthDate || "—";

  return `${anredeArzt}, vielen Dank für die Heilmittelverordnung für ${anredePatient}${patientName}, geboren am ${geburtsdatum}, der/die bei uns in Behandlung ist. Um Sie über den aktuellen Stand der Therapie auf dem Laufenden zu halten, übermitteln wir Ihnen folgenden Bericht.`;
}

// Zeigt ALLE bisher durchgeführten Assessments eines Patienten (nicht nur
// das letzte) mit Ampel/Delta zum jeweiligen Vorwert - Vorgabe Aufgabe 6
// ("Alle Assessments anzeigen"). Analog zu renderAssessmentHistorySection,
// aber ohne <details>-Akkordeon, da eingeklappte <details>-Inhalte beim
// Drucken/PDF-Export je nach Browser nicht mit ausgegeben werden.
function buildAllAssessmentsReportHtml(patient) {
  const assessments = [...(patient?.assessments || [])]
    .filter((a) => a.barthel || a.neuro || a.ortho || a.schwerst || a.nrs !== null)
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));

  if (assessments.length === 0) return `<div>Kein Assessment durchgeführt</div>`;

  return assessments.map((a, idx) => {
    const previous = assessments[idx + 1] || null;
    const scores = extractAssessmentScores(a);
    const prevScores = previous ? extractAssessmentScores(previous) : [];

    const lines = scores.map((s) => {
      const prev = prevScores.find((p) => p.key === s.key);
      const ampel = prev ? Assessment.computeAmpel({ current: s.value, previous: prev.value, max: s.max, direction: s.direction }) : null;
      const deltaText = prev ? ` (Vorwert: ${prev.value}${s.unit || ""}, ${s.value - prev.value >= 0 ? "+" : ""}${(s.value - prev.value).toFixed(s.unit ? 1 : 0)}${s.unit || ""})` : "";
      return `<div>${Assessment.ampelEmoji(ampel)} ${escapeHtml(s.label)}: ${s.value}${s.max ? `/${s.max}` : s.unit || ""}${escapeHtml(deltaText)}</div>`;
    }).join("");

    return `
      <div style="margin-bottom:10px;">
        <div style="font-weight:600;">${escapeHtml(formatDeDate(a.date))}</div>
        ${lines || '<div class="muted">Keine auswertbaren Ergebnisse.</div>'}
      </div>
    `;
  }).join("");
}

function formatDoctorReportBodyHtml(content = "") {
  const labels = [
    'Stand der Therapie:',
    'Besonderheiten während des Behandlungsverlaufs:',
    'Fortsetzung der Therapie vorgeschlagen:',
    'Prognostische Einschätzung:'
  ];

  let html = escapeAndPreserveLineBreaks(content || '').replace(
    /Therapiebericht an .*? vom .*?(<br>|$)/,
    ''
  );

  labels.forEach((label) => {
    const escapedLabel = escapeHtml(label);
    html = html.replaceAll(escapedLabel, `<strong>${escapedLabel}</strong>`);
  });

  return html;
}

function renderDoctorReportPrintHtml({ settings = {}, patient = {}, rezept = {}, report = {} }) {
  const headerLines = getPracticeHeaderLines(settings);
  const createdDate = formatIsoDateShort(report?.createdAt);
  const patientName = formatPatientName(patient) || 'Patient/in';
  const introLine = buildDoctorReportIntroLine(patient);
  const allAssessmentsHtml = buildAllAssessmentsReportHtml(patient);

  const therapieziele = [...(report?.therapieziele || []), report?.therapiezielFreitext].filter(Boolean).join(", ");
  const complianceLabel = Assessment.COMPLIANCE_OPTIONEN.find((o) => o.val === report?.compliance)?.label || "";
  const verlaufLabel = Assessment.VERLAUF_OPTIONEN.find((o) => o.val === report?.verlauf)?.label || "";
  const weiterfuehrenLabel = Assessment.THERAPIE_WEITERFUEHREN_OPTIONEN.find((o) => o.val === report?.therapieWeiterfuehren)?.label || "";
  const nutzenLabel = Assessment.THERAPIE_NUTZEN_OPTIONEN.find((o) => o.val === report?.therapieNutzen)?.label || "";
  const legacyBodyHtml = report?.content ? formatDoctorReportBodyHtml(report.content) : "";

  return `
    <style>
      .doctor-report-wrap{max-width:820px;margin:0 auto;color:#111827;}
      .doctor-report-head{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;margin-bottom:28px;}
      .doctor-report-head-left .line{font-size:14px;}
      .doctor-report-date{white-space:nowrap;font-size:14px;}
      .doctor-report-recipient{margin:18px 0 26px;}
      .doctor-report-title{font-size:28px;font-weight:700;margin:0 0 18px;line-height:1.2;}
      .doctor-report-meta{margin:0 0 18px;}
      .doctor-report-section{margin:0 0 16px;}
      .doctor-report-section h4{margin:0 0 6px;font-size:14px;}
      .doctor-report-body{white-space:normal;line-height:1.55;}
      .doctor-report-sign{margin-top:28px;}
    </style>
    <div class="doctor-report-wrap">
      <div class="doctor-report-head">
        <div class="doctor-report-head-left">
          ${headerLines.map((line, index) => `<div class="line">${index === 0 ? `<strong>${escapeHtml(line)}</strong>` : escapeHtml(line)}</div>`).join('')}
        </div>
        <div class="doctor-report-date">${escapeHtml(createdDate)}</div>
      </div>

      <div class="doctor-report-recipient">${escapeHtml(rezept?.arzt || '—')}</div>
      <div class="doctor-report-title">Therapiebericht</div>
      <div class="doctor-report-meta">
        <strong>für den Patienten:</strong><br>
        ${escapeHtml(patientName)}${patient?.birthDate ? `, geb.: ${escapeHtml(patient.birthDate)}` : ''}<br>
        ${patient?.homeName ? `Einrichtung: ${escapeHtml(patient.homeName)}<br>` : ''}
        Ihre Verordnung vom ${escapeHtml(rezept?.ausstell || '—')}
      </div>

      <div class="doctor-report-section doctor-report-body">${escapeHtml(introLine)}</div>

      <div class="doctor-report-section">
        <h4>Assessment-Verlauf</h4>
        ${allAssessmentsHtml}
      </div>

      ${therapieziele || complianceLabel || verlaufLabel || weiterfuehrenLabel || nutzenLabel ? `
        <div class="doctor-report-section">
          ${therapieziele ? `<div><strong>Therapieziel:</strong> ${escapeHtml(therapieziele)}</div>` : ''}
          ${complianceLabel ? `<div><strong>Patientencompliance:</strong> ${escapeHtml(complianceLabel)}${report?.complianceFreitext ? ` – ${escapeHtml(report.complianceFreitext)}` : ''}</div>` : ''}
          ${verlaufLabel ? `<div><strong>Verlauf:</strong> ${escapeHtml(verlaufLabel)}${report?.verlaufFreitext ? ` – ${escapeHtml(report.verlaufFreitext)}` : ''}</div>` : ''}
          ${weiterfuehrenLabel ? `<div><strong>Therapie weiterführen:</strong> ${escapeHtml(weiterfuehrenLabel)}</div>` : ''}
          ${nutzenLabel ? `<div><strong>Therapie bringt Nutzen:</strong> ${escapeHtml(nutzenLabel)}</div>` : ''}
        </div>
      ` : ''}

      ${report?.therapieText ? `
        <div class="doctor-report-section">
          <h4>Therapie</h4>
          <div class="doctor-report-body">${escapeAndPreserveLineBreaks(report.therapieText)}</div>
        </div>
      ` : ''}

      ${report?.bemerkungen ? `
        <div class="doctor-report-section">
          <h4>Bemerkungen</h4>
          <div class="doctor-report-body">${escapeAndPreserveLineBreaks(report.bemerkungen)}</div>
        </div>
      ` : ''}

      ${legacyBodyHtml ? `<div class="doctor-report-section doctor-report-body">${legacyBodyHtml}</div>` : ''}

      <div class="doctor-report-sign">${escapeHtml(settings?.therapistName || '')}</div>
    </div>
  `;
}

async function wipeAllAppData() {
  clearRuntimeSession();
  // Eine offene IndexedDB-Verbindung (siehe storage/indexeddb.js) muss vor
  // dem Löschen der Datenbank geschlossen werden, sonst blockiert der
  // Browser deleteDatabase() dauerhaft, obwohl kein anderer Tab offen ist.
  await closeDatabase();
  await new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase("fast_doku_db");
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error || new Error("Datenbank konnte nicht gelöscht werden."));
    req.onblocked = () => reject(new Error("Datenbank-Löschung ist blockiert. Bitte andere Tabs schließen."));
  });
}

async function performFullReset(msgEl) {
  try {
    await wipeAllAppData();
    window.location.reload();
  } catch (err) {
    console.error(err);
    if (msgEl) msgEl.textContent = err?.message || "Daten konnten nicht gelöscht werden.";
  }
}

// Eigenständiges Passwort (unabhängig von der Geräte-PIN) für den
// "PIN vergessen? App zurücksetzen"-Weg auf dem Sperrbildschirm - falls ein
// Therapeut die PIN nicht mehr kennt, kommt er sonst gar nicht mehr in die
// App hinein (siehe showLoginView). Auf Nutzerwunsch fest auf "1989" gesetzt.
// Wie beim festen Praxispasswort bewusst nicht im Klartext im Quellcode,
// nur als Schutz gegen zufälliges Auffinden (z.B. GitHub-Volltextsuche) -
// keine echte Sicherheitsmaßnahme.
const FORGOT_PIN_RESET_PASSWORD_ENCODED = "MTk4OQ==";
function getForgotPinResetPassword() {
  return atob(FORGOT_PIN_RESET_PASSWORD_ENCODED);
}

export function bindLockButton(onLock) {
  lockBtn.style.display = "inline-block";
  lockBtn.onclick = onLock;
}

export function hideLockButton() {
  lockBtn.style.display = "none";
  lockBtn.onclick = null;
}

// Das Praxispasswort ist auf Nutzerwunsch fest vorgegeben (gilt für die
// App-Verschlüsselung UND alle Backups) statt frei wählbar zu sein. Bewusst
// nicht als Klartext-String im Quellcode, damit es bei einem oberflächlichen
// Blick in den Code (z.B. per GitHub-Suche) nicht sofort auffällt - das ist
// keine echte Sicherheitsmaßnahme (jeder mit Lesezugriff auf den Code kann
// es trivial decodieren), nur ein Schutz gegen zufälliges Auffinden.
const FIXED_PRACTICE_PASSWORD_ENCODED = "RmFsbG1hbm4uU3Ryb2Js";
function getFixedPracticePassword() {
  return atob(FIXED_PRACTICE_PASSWORD_ENCODED);
}

function requestPracticePasswordForBackup() {
  return getFixedPracticePassword();
}

// PIN zum Deaktivieren der FaSti-Doku-Prüfung (Einstellungen) - auf
// Nutzerwunsch fest auf "3010" gesetzt, nur zum Einschalten nötig (das
// Wiedereinschalten der Prüfung braucht keine PIN). Wie beim
// Praxispasswort nur Base64-codiert, keine echte Sicherheitsmaßnahme.
const DOKU_PRUEFUNG_PIN_ENCODED = "MzAxMA==";
function getDokuPruefungPin() {
  return atob(DOKU_PRUEFUNG_PIN_ENCODED);
}

async function runBackupImportFlow({ file, messageElement, successMessage, beforeReload }) {
  if (!file || !messageElement) return;

  messageElement.className = "muted";
  messageElement.textContent = "Backup wird geprüft...";

  try {
    const practicePassword = requestPracticePasswordForBackup().trim();
    if (!practicePassword) {
      throw new Error("Falsches Praxispasswort");
    }

    const preview = await validateBackupZip(file, practicePassword);
    messageElement.className = "muted";
    messageElement.textContent = `Backup geprüft: ${preview.meta?.therapistName || "FaSt-Doku"} · Export ${preview.meta?.exportTimestamp || ""}`;

    await importBackup(file, practicePassword);
    clearRuntimeSession();

    if (typeof beforeReload === "function") {
      await beforeReload();
    }

    messageElement.className = "success";
    messageElement.textContent = successMessage || "Backup geladen. App wird neu gestartet…";
    setTimeout(() => {
      window.location.reload();
    }, 600);
  } catch (err) {
    console.error(err);
    messageElement.className = "error";
    messageElement.textContent = `Backup-Import fehlgeschlagen: ${err.message || err}`;
  }
}

export function showSetupView({ onSuccess }) {
  hideLockButton();

  render(`
    <div class="card" style="background:#fffbeb; border-color:#f59e0b;">
      <h3>⚠️ Schon einmal genutzt?</h3>
      <p class="muted">Falls FaSt App auf diesem Gerät bereits eingerichtet war und dieser Bildschirm unerwartet erscheint, wurden die bisherigen Daten vermutlich vom Browser gelöscht. Bitte in diesem Fall ZUERST hier ein Backup wiederherstellen, statt unten eine neue Einrichtung anzulegen - sonst gehen eventuell noch vorhandene Daten endgültig verloren.</p>
      <button id="restoreBackupBtnTop" class="secondary" style="margin-top:8px;">Backup wiederherstellen</button>
    </div>

    <div class="card">
      <h2>Ersteinrichtung</h2>
      <p class="muted">FaSt App wird jetzt mit Praxispasswort und PIN abgesichert.</p>

      <label for="therapistName">Therapeutenname</label>
      <input id="therapistName" type="text" autocomplete="off">

      <label>Praxisadresse</label>
      <p class="muted" style="white-space:pre-line; border:1px solid var(--border); border-radius:10px; padding:10px 12px; margin-top:4px;">${escapeHtml(PRACTICE_ADDRESS)}</p>

      <label>Telefon</label>
      <p class="muted" style="border:1px solid var(--border); border-radius:10px; padding:10px 12px; margin-top:4px;">${escapeHtml(PRACTICE_PHONE)}</p>

      <label for="therapistFax">Faxnummer</label>
      <input id="therapistFax" type="tel" inputmode="numeric" autocomplete="off">

      <label>Arbeitstage pro Woche</label>
      ${renderWorkDayChips([], "setupWorkDay")}

      <label for="weeklyHours">Arbeitsstunden pro Woche</label>
      <input id="weeklyHours" type="text" inputmode="decimal" autocomplete="off" placeholder="z. B. 20 oder 38.5">

      <label for="fastStartDatum">Startdatum bei FaSt</label>
      <input id="fastStartDatum" type="text" inputmode="numeric" autocomplete="off" placeholder="TT.MM.JJJJ">
      <p class="muted">Ab diesem Datum werden Zeiten aus der App fürs Stundenkonto berücksichtigt.</p>

      <label for="stundenStartsaldo">Startsaldo Stundenkonto</label>
      <input id="stundenStartsaldo" type="text" inputmode="numeric" autocomplete="off" placeholder="z. B. +40:00 oder -12:30">
      <p class="muted">Plus-/Minusstunden vor App-Einführung. Wird zum Stundenkonto addiert.</p>

      <label for="workflowPin">PIN (mindestens 6 Zeichen)</label>
      <input id="workflowPin" type="password" inputmode="numeric" autocomplete="new-password">

      <label for="workflowPinRepeat">PIN wiederholen</label>
      <input id="workflowPinRepeat" type="password" inputmode="numeric" autocomplete="new-password">

      <button id="saveSetupBtn">Einrichtung abschließen</button>
      <button id="restoreBackupBtn" class="secondary" style="margin-top:10px;">Backup wiederherstellen</button>
      <input id="restoreBackupInput" type="file" accept=".zip" style="display:none;">
      <div id="setupMessage"></div>
    </div>
  `);

  bindCheckChipToggles(app);
  bindDateAutoFormat(document.getElementById("fastStartDatum"));

  document.getElementById("restoreBackupBtn").onclick = () => {
    document.getElementById("restoreBackupInput").click();
  };
  document.getElementById("restoreBackupBtnTop").onclick = () => {
    document.getElementById("restoreBackupInput").click();
  };

  document.getElementById("restoreBackupInput").onchange = async (event) => {
    const file = event.target.files?.[0];
    const msg = document.getElementById("setupMessage");
    if (!file) return;

    await runBackupImportFlow({
      file,
      messageElement: msg,
      successMessage: "Backup geladen. App wird neu gestartet…"
    });

    event.target.value = "";
  };

  document.getElementById("saveSetupBtn").onclick = async () => {
    const therapistName = document.getElementById("therapistName").value.trim();
    const practiceAddress = PRACTICE_ADDRESS;
    const practicePhone = PRACTICE_PHONE;
    const therapistFax = document.getElementById("therapistFax").value.trim();
    const workDays = WORK_DAY_OPTIONS.filter((day) => document.getElementById(`setupWorkDay-${day}`)?.checked);
    const weeklyHours = normalizeWeeklyHoursInput(document.getElementById("weeklyHours").value);
    const fastStartDatumInput = document.getElementById("fastStartDatum").value.trim();
    const fastStartDatum = fastStartDatumInput ? parseDeDate(fastStartDatumInput) : "";
    const stundenStartsaldoMinuten = parseStundenStartsaldoInput(document.getElementById("stundenStartsaldo").value);
    const password = getFixedPracticePassword();
    const pin = document.getElementById("workflowPin").value;
    const pinRepeat = document.getElementById("workflowPinRepeat").value;
    const msg = document.getElementById("setupMessage");

    msg.className = "error";
    msg.textContent = "";

    if (!isValidWeeklyHours(weeklyHours)) {
      msg.textContent = "Die Arbeitsstunden pro Woche müssen als Zahl eingegeben werden, z. B. 20 oder 38.5.";
      return;
    }

    if (fastStartDatumInput && !fastStartDatum) {
      msg.textContent = "Das Startdatum bei FaSt muss im Format TT.MM.JJJJ eingegeben werden.";
      return;
    }

    if (stundenStartsaldoMinuten === null) {
      msg.textContent = "Der Startsaldo muss im Format +HH:MM oder -HH:MM eingegeben werden, z. B. +40:00.";
      return;
    }

    if (!pin || pin.length < 6) {
      msg.textContent = "Die PIN muss mindestens 6 Zeichen haben.";
      return;
    }

    if (pin !== pinRepeat) {
      msg.textContent = "Die PIN stimmt nicht überein.";
      return;
    }

    // Diese Bestätigung ist ausschließlich ein Sicherheitsnetz gegen den
    // Fall, dass dieser Bildschirm NICHT bei einer echten Erstinstallation
    // erscheint, sondern weil der Browser zuvor bestehende Praxisdaten
    // gelöscht hat (siehe Warnkarte oben) - eine Ersteinrichtung
    // überschreibt etwaige, technisch noch vorhandene Restdaten
    // unwiederbringlich.
    if (!confirm("Wirklich eine NEUE Ersteinrichtung anlegen?\n\nFalls auf diesem Gerät schon einmal FaSt-App-Daten gespeichert waren, werden diese dabei unwiederbringlich überschrieben. Bei einem wirklich neuen Gerät/einer neuen Praxis auf \"OK\" klicken, ansonsten \"Abbrechen\" und zuerst ein Backup wiederherstellen.")) {
      return;
    }

    try {
      const initialAppData = createEmptyAppData();
      initialAppData.settings.therapistName = therapistName;
      initialAppData.settings.practiceAddress = practiceAddress;
      initialAppData.settings.practicePhone = practicePhone;
      initialAppData.settings.therapistFax = therapistFax;
      initialAppData.settings.workDays = workDays;
      initialAppData.settings.weeklyHours = weeklyHours;
      initialAppData.settings.fastStartDatum = fastStartDatum;
      initialAppData.settings.stundenStartsaldoMinuten = stundenStartsaldoMinuten;

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
      <h2>PIN Login</h2>
      <p class="muted">Bitte PIN eingeben, um FaSt App zu entsperren.</p>

      <label for="loginPin">PIN</label>
      <input id="loginPin" type="password" inputmode="numeric" autocomplete="current-password">

      <button id="loginBtn">Entsperren</button>

      <div id="loginMessage" class="${remainingMs > 0 ? "error" : ""}">
        ${remainingMs > 0 ? `Sperre aktiv. Noch ${Math.ceil(remainingMs / 1000)} Sekunden.` : ""}
      </div>
    </div>

    <div class="card">
      <button id="forgotPinBtn" class="secondary">PIN vergessen? App zurücksetzen</button>
      <div id="forgotPinWrap" style="display:none; margin-top:12px;">
        <p class="muted">Löscht alle auf diesem Gerät gespeicherten Praxisdaten unwiderruflich (bereits heruntergeladene Backup-Dateien auf Ihrem Computer sind davon nicht betroffen). Nur verwenden, wenn die PIN nicht mehr bekannt ist.</p>
        <label for="resetPasswordInput">Zurücksetzen-Passwort</label>
        <input id="resetPasswordInput" type="password" autocomplete="off">
        <button id="confirmForgotPinResetBtn" class="danger" style="margin-top:10px;">Alles löschen und neu starten</button>
        <div id="forgotPinResetMsg" class="error"></div>
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

      if (err.code === "STORAGE_ERROR") {
        msg.textContent = "Technisches Problem: Sicherheits- oder App-Daten fehlen im Speicher. Dies liegt nicht an der PIN. Bitte App neu laden; falls das Problem bleibt, Backup wiederherstellen.";
        return;
      }

      if (err.code === "DATA_CORRUPTED") {
        msg.textContent = "PIN war korrekt, aber die App-Daten konnten nicht gelesen werden (möglicherweise beschädigt). Bitte App neu laden; falls das Problem bleibt, Backup wiederherstellen.";
        return;
      }

      msg.textContent = "Login fehlgeschlagen.";
    }
  };

  document.getElementById("forgotPinBtn").onclick = () => {
    const wrap = document.getElementById("forgotPinWrap");
    wrap.style.display = wrap.style.display === "none" ? "block" : "none";
  };

  document.getElementById("confirmForgotPinResetBtn").onclick = async () => {
    const resetMsg = document.getElementById("forgotPinResetMsg");
    resetMsg.textContent = "";

    const enteredPassword = document.getElementById("resetPasswordInput").value;
    if (enteredPassword !== getForgotPinResetPassword()) {
      resetMsg.textContent = "Falsches Passwort.";
      return;
    }

    const confirmed = window.confirm("Wirklich ALLE auf diesem Gerät gespeicherten Praxisdaten unwiderruflich löschen? Dieser Vorgang kann nicht rückgängig gemacht werden.");
    if (!confirmed) return;

    await performFullReset(resetMsg);
  };
}

// Angepasst wegen Samsungs "Nicht genutzte Apps schlafen legen"-Funktion,
// die bei manchen Geräten bereits nach 3-4 Tagen Nichtnutzung greifen kann
// und dabei den App-Speicher (inkl. IndexedDB) zurücksetzen kann. Häufigere
// Erinnerungen sollen das Risiko eines folgenlosen Datenverlusts reduzieren.
function renderDashboardHeaderCard({ therapistName }) {
  return `
    <div class="card">
      <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:12px;">
        <div>
          <h2 style="margin-bottom:6px;">Dashboard</h2>
          <p class="muted">${escapeHtml(formatCurrentDateLong())}</p>
          <p>Willkommen, ${escapeHtml(therapistName)}.</p>
        </div>
        <button id="openSettingsBtn" class="secondary" title="Einstellungen bearbeiten" aria-label="Einstellungen bearbeiten" style="width:auto; margin-top:0; padding:10px 12px; min-width:48px; font-size:20px; line-height:1;">⚙️</button>
      </div>
    </div>
  `;
}

export function showSettingsView({ onLock }) {
  bindLockButton(onLock);
  setCurrentView("settings");

  const runtimeData = getRuntimeData();
  const settings = runtimeData?.settings || {};

  render(`
    <div class="card">
      <h2>Einstellungen</h2>
      <p class="muted">Hier können die Angaben aus der Ersteinrichtung bearbeitet werden.</p>
      <button id="backDashboardFromSettingsBtn" class="secondary">Zurück zum Dashboard</button>
    </div>

    <div class="card">
      <label for="settingsTherapistName">Therapeutenname</label>
      <input id="settingsTherapistName" type="text" autocomplete="off" value="${escapeHtml(settings.therapistName || "")}">

      <label>Praxisadresse</label>
      <p class="muted" style="white-space:pre-line; border:1px solid var(--border); border-radius:10px; padding:10px 12px; margin-top:4px;">${escapeHtml(PRACTICE_ADDRESS)}</p>

      <label>Telefon</label>
      <p class="muted" style="border:1px solid var(--border); border-radius:10px; padding:10px 12px; margin-top:4px;">${escapeHtml(PRACTICE_PHONE)}</p>

      <label for="settingsTherapistFax">Faxnummer</label>
      <input id="settingsTherapistFax" type="tel" inputmode="numeric" autocomplete="off" value="${escapeHtml(settings.therapistFax || "")}">

      <label>Arbeitstage pro Woche</label>
      ${renderWorkDayChips(settings.workDays || [], "settingsWorkDay")}

      <label for="settingsWeeklyHours">Arbeitsstunden pro Woche</label>
      <input id="settingsWeeklyHours" type="text" inputmode="decimal" autocomplete="off" value="${escapeHtml(settings.weeklyHours || "")}" placeholder="z. B. 20 oder 38.5">

      <label for="settingsFastStartDatum">Startdatum bei FaSt</label>
      <input id="settingsFastStartDatum" type="text" inputmode="numeric" autocomplete="off" value="${escapeHtml(formatDeDate(getFastStartDatumComparable(settings)))}" placeholder="TT.MM.JJJJ">

      <label for="settingsStundenStartsaldo">Startsaldo Stundenkonto</label>
      <input id="settingsStundenStartsaldo" type="text" inputmode="numeric" autocomplete="off" value="${escapeHtml(getSignedMinutesLabel(getStundenStartsaldoMinutes(settings)).replace(' Stunden', ''))}" placeholder="z. B. +40:00 oder -12:30">

      <label for="settingsJahresurlaubTage">Jahresurlaub (Tage)</label>
      <input id="settingsJahresurlaubTage" type="text" inputmode="numeric" autocomplete="off" value="${escapeHtml(String(settings.jahresurlaubTage || 0))}" placeholder="z. B. 30">

      <h3 style="margin-top:20px;">FaSti</h3>
      <label class="check-chip"><input id="settingsFastiEnabled" type="checkbox" ${settings.fastiEnabled !== false ? "checked" : ""}> <span>FaSti aktiviert</span></label>
      <label class="check-chip" style="margin-top:8px;"><input id="settingsDokuPruefungDeaktiviert" type="checkbox" ${settings.dokuPruefungDeaktiviert ? "checked" : ""}> <span>Doku-Prüfung deaktivieren (FaSti meldet dann keine fehlende Doku mehr)</span></label>
      <div id="dokuPruefungPinWrap" style="display:none; margin-top:10px;">
        <label for="dokuPruefungPinInput">PIN zum Deaktivieren</label>
        <input id="dokuPruefungPinInput" type="password" inputmode="numeric" autocomplete="off" maxlength="4">
        <div class="row" style="margin-top:8px;">
          <button type="button" id="confirmDokuPruefungPinBtn" class="secondary">Bestätigen</button>
          <button type="button" id="cancelDokuPruefungPinBtn" class="secondary">Abbrechen</button>
        </div>
        <div id="dokuPruefungPinMsg" class="error"></div>
      </div>

      <h3 style="margin-top:20px;">Zertifikate</h3>
      <div class="checkbox-row">
        <label class="check-chip"><input id="zertMt" type="checkbox" ${settings.zertifikate?.mt ? "checked" : ""}> <span>MT</span></label>
        <label class="check-chip"><input id="zertMld" type="checkbox" ${settings.zertifikate?.mld ? "checked" : ""}> <span>MLD</span></label>
        <label class="check-chip"><input id="zertKgzns" type="checkbox" ${settings.zertifikate?.kgzns ? "checked" : ""}> <span>KG-ZNS</span></label>
      </div>

      <label for="settingsBueroEmail">Büro-E-Mail-Adresse</label>
      <input id="settingsBueroEmail" type="email" autocomplete="off" value="${escapeHtml(settings.buero?.email || "")}" placeholder="buero@praxis.de">

      <label for="settingsAssessmentInterval">Assessment-Intervall (Folge-Assessments)</label>
      <select id="settingsAssessmentInterval">
        <option value="3" ${Number(settings.assessmentIntervalMonths) === 3 ? "selected" : ""}>Alle 3 Monate</option>
        <option value="6" ${Number(settings.assessmentIntervalMonths) === 6 ? "selected" : ""}>Alle 6 Monate</option>
      </select>

      <button id="saveSettingsBtn">Änderungen speichern</button>
      <div id="settingsMessage"></div>
    </div>

    <div class="card">
      <h3>PIN ändern</h3>

      <label for="settingsCurrentPin">Aktuelle PIN</label>
      <input id="settingsCurrentPin" type="password" inputmode="numeric" autocomplete="current-password">

      <label for="settingsNewPin">Neue PIN (mindestens 6 Zeichen)</label>
      <input id="settingsNewPin" type="password" inputmode="numeric" autocomplete="new-password">

      <label for="settingsNewPinRepeat">Neue PIN wiederholen</label>
      <input id="settingsNewPinRepeat" type="password" inputmode="numeric" autocomplete="new-password">

      <button id="changePinBtn" class="secondary">PIN ändern</button>
      <div id="changePinMsg"></div>
    </div>

    <div class="card">
      <h3>App-Version</h3>
      <p class="muted">Aktuelle Version: ${escapeHtml(APP_VERSION)}</p>
      <button id="checkForUpdatesBtn" class="secondary">Aktualisieren</button>
      <div id="updateCheckMsg" class="muted" style="margin-top:10px;"></div>
    </div>
  `);

  bindCheckChipToggles(app);
  bindDateAutoFormat(document.getElementById("settingsFastStartDatum"));

  document.getElementById("backDashboardFromSettingsBtn").onclick = () => {
    showDashboardView({ onLock });
  };

  // Doku-Prüfung deaktivieren: nur mit PIN einschaltbar (Nutzerwunsch) - das
  // Wiedereinschalten der Prüfung (Checkbox wieder abwählen) braucht keine
  // PIN, da das nur die Kontrolle verschärft statt sie zu lockern.
  const dokuPruefungCheckbox = document.getElementById("settingsDokuPruefungDeaktiviert");
  const dokuPruefungPinWrap = document.getElementById("dokuPruefungPinWrap");
  const dokuPruefungPinInput = document.getElementById("dokuPruefungPinInput");
  const dokuPruefungPinMsg = document.getElementById("dokuPruefungPinMsg");

  dokuPruefungCheckbox.addEventListener("change", () => {
    if (dokuPruefungCheckbox.checked) {
      dokuPruefungCheckbox.checked = false;
      dokuPruefungCheckbox.closest(".check-chip")?.classList.remove("is-checked");
      dokuPruefungPinWrap.style.display = "";
      dokuPruefungPinMsg.textContent = "";
      dokuPruefungPinInput.value = "";
      dokuPruefungPinInput.focus();
    } else {
      dokuPruefungPinWrap.style.display = "none";
    }
  });

  document.getElementById("confirmDokuPruefungPinBtn").onclick = () => {
    if (dokuPruefungPinInput.value.trim() !== getDokuPruefungPin()) {
      dokuPruefungPinMsg.textContent = "Falsche PIN.";
      return;
    }
    dokuPruefungCheckbox.checked = true;
    dokuPruefungCheckbox.closest(".check-chip")?.classList.add("is-checked");
    dokuPruefungPinWrap.style.display = "none";
    dokuPruefungPinMsg.textContent = "";
  };

  document.getElementById("cancelDokuPruefungPinBtn").onclick = () => {
    dokuPruefungPinWrap.style.display = "none";
    dokuPruefungPinMsg.textContent = "";
  };

  // Liest+validiert+speichert alle allgemeinen Einstellungsfelder (Name,
  // Fax, Arbeitstage, Stunden, Jahresurlaub, FaSti, Doku-Prüfung,
  // Zertifikate, Büro-Mail, Assessment-Intervall). Wird sowohl vom
  // "Änderungen speichern"-Button als auch vom "PIN ändern"-Button
  // aufgerufen, damit beim PIN-Wechsel nichts verloren geht, was auf
  // derselben Seite eingegeben, aber nicht separat über "Änderungen
  // speichern" gesichert wurde - landet dadurch garantiert mit im nächsten
  // Backup. Wirft bei einem Validierungsfehler, statt still fehlzuschlagen,
  // damit der aufrufende Button-Handler die Meldung anzeigen und z.B. die
  // PIN-Änderung NICHT durchführen kann, wenn die übrigen Angaben ungültig
  // sind (kein halb gespeicherter Zustand).
  async function saveGeneralSettings() {
    const therapistName = document.getElementById("settingsTherapistName").value.trim();
    const practiceAddress = PRACTICE_ADDRESS;
    const practicePhone = PRACTICE_PHONE;
    const therapistFax = document.getElementById("settingsTherapistFax").value.trim();
    const workDays = WORK_DAY_OPTIONS.filter((day) => document.getElementById(`settingsWorkDay-${day}`)?.checked);
    const weeklyHours = normalizeWeeklyHoursInput(document.getElementById("settingsWeeklyHours").value);
    const fastStartDatumInput = document.getElementById("settingsFastStartDatum").value.trim();
    const fastStartDatum = fastStartDatumInput ? parseDeDate(fastStartDatumInput) : "";
    const stundenStartsaldoMinuten = parseStundenStartsaldoInput(document.getElementById("settingsStundenStartsaldo").value);
    const jahresurlaubTageInput = document.getElementById("settingsJahresurlaubTage").value.trim();
    const jahresurlaubTage = jahresurlaubTageInput === "" ? 0 : Number(jahresurlaubTageInput);
    const fastiEnabled = document.getElementById("settingsFastiEnabled").checked;
    const dokuPruefungDeaktiviert = document.getElementById("settingsDokuPruefungDeaktiviert").checked;
    const zertifikate = {
      mt: document.getElementById("zertMt").checked,
      mld: document.getElementById("zertMld").checked,
      kgzns: document.getElementById("zertKgzns").checked
    };
    const bueroEmail = document.getElementById("settingsBueroEmail").value.trim();
    const assessmentIntervalMonths = Number(document.getElementById("settingsAssessmentInterval").value);

    if (!isValidWeeklyHours(weeklyHours)) {
      throw new Error("Die Arbeitsstunden pro Woche müssen als Zahl eingegeben werden, z. B. 20 oder 38.5.");
    }

    if (fastStartDatumInput && !fastStartDatum) {
      throw new Error("Das Startdatum bei FaSt muss im Format TT.MM.JJJJ eingegeben werden.");
    }

    if (stundenStartsaldoMinuten === null) {
      throw new Error("Der Startsaldo muss im Format +HH:MM oder -HH:MM eingegeben werden, z. B. +40:00.");
    }

    if (!Number.isFinite(jahresurlaubTage) || jahresurlaubTage < 0) {
      throw new Error("Der Jahresurlaub muss als Zahl (Tage) eingegeben werden, z. B. 30.");
    }

    mutateRuntimeData((data) => {
      data.settings.therapistName = therapistName;
      data.settings.practiceAddress = practiceAddress;
      data.settings.practicePhone = practicePhone;
      data.settings.therapistFax = therapistFax;
      data.settings.workDays = workDays;
      data.settings.weeklyHours = weeklyHours;
      data.settings.fastStartDatum = fastStartDatum;
      data.settings.stundenStartsaldoMinuten = stundenStartsaldoMinuten;
      data.settings.jahresurlaubTage = jahresurlaubTage;
      data.settings.fastiEnabled = fastiEnabled;
      data.settings.dokuPruefungDeaktiviert = dokuPruefungDeaktiviert;
      data.settings.zertifikate = zertifikate;
      data.settings.buero = { email: bueroEmail };
      data.settings.assessmentIntervalMonths = assessmentIntervalMonths;
      data.settings.updatedAt = new Date().toISOString();
    });

    await queuePersistRuntimeData();

    // Sofort wirksam machen, ohne dass ein erneutes Ein-/Ausloggen nötig
    // ist - "aus" blendet Button+Panel sofort aus, "an" baut sie (falls
    // gerade deaktiviert) mit frisch berechneten Hinweisen wieder auf.
    if (fastiEnabled) {
      showFastiNotices(buildFastiNotices(getRuntimeData()));
    } else {
      hideFastiWidget();
    }
  }

  document.getElementById("saveSettingsBtn").onclick = async () => {
    const msg = document.getElementById("settingsMessage");
    msg.className = "error";
    msg.textContent = "";

    try {
      await saveGeneralSettings();
      msg.className = "success";
      msg.textContent = "Einstellungen gespeichert.";
    } catch (err) {
      console.error(err);
      msg.className = "error";
      msg.textContent = err?.message || "Einstellungen konnten nicht gespeichert werden.";
    }
  };

  document.getElementById("changePinBtn").onclick = async () => {
    const currentPin = document.getElementById("settingsCurrentPin").value;
    const newPin = document.getElementById("settingsNewPin").value;
    const newPinRepeat = document.getElementById("settingsNewPinRepeat").value;
    const msg = document.getElementById("changePinMsg");

    msg.className = "error";
    msg.textContent = "";

    if (!currentPin) {
      msg.textContent = "Bitte die aktuelle PIN eingeben.";
      return;
    }

    if (!newPin || newPin.length < 6) {
      msg.textContent = "Die neue PIN muss mindestens 6 Zeichen haben.";
      return;
    }

    if (newPin !== newPinRepeat) {
      msg.textContent = "Die PIN stimmt nicht überein.";
      return;
    }

    try {
      // Erst die übrigen Einstellungen auf dieser Seite sichern (Name,
      // Stunden, ...), damit beim PIN-Wechsel nichts verloren geht, was
      // zwar eingegeben, aber noch nicht über "Änderungen speichern"
      // gesichert wurde.
      await saveGeneralSettings();

      const updatedCryptoMeta = await changePIN({
        currentPin,
        newPin,
        cryptoMeta: getCryptoMeta()
      });
      setCryptoMeta(updatedCryptoMeta);

      document.getElementById("settingsCurrentPin").value = "";
      document.getElementById("settingsNewPin").value = "";
      document.getElementById("settingsNewPinRepeat").value = "";
      msg.className = "success";
      msg.textContent = "PIN geändert und Einstellungen gespeichert.";
    } catch (err) {
      console.error(err);
      msg.className = "error";
      msg.textContent = err?.message || "PIN konnte nicht geändert werden.";
    }
  };

  document.getElementById("checkForUpdatesBtn").onclick = async () => {
    const updateMsg = document.getElementById("updateCheckMsg");
    updateMsg.textContent = "Suche nach Updates ...";
    try {
      // Eventuell vorhandene Browser-Caches leeren, damit garantiert die
      // neueste vom Server ausgelieferte Version geladen wird (die App hat
      // keinen Service Worker mehr, aber ältere Geräte könnten noch
      // Caches aus einer früheren Version haben).
      if ("caches" in window) {
        const cacheKeys = await caches.keys();
        await Promise.all(cacheKeys.map((key) => caches.delete(key)));
      }
    } catch (err) {
      console.error("Cache konnte nicht geleert werden:", err);
    }
    window.location.reload();
  };
}


export function showDashboardView({ onLock, keepOverviewOpen = false } = {}) {
  bindLockButton(onLock);
  setCurrentView("dashboard");

  const runtimeData = getRuntimeData();
  const homes = runtimeData?.homes || [];
  const therapistName = runtimeData?.settings?.therapistName || "—";
  const lastBackupAt = runtimeData?.ui?.lastBackupAt || "";
  const todayDate = formatCurrentDateShort();
  const dashboardTodayPatients = getDashboardTodayPatients(runtimeData, todayDate);
  // Bewusst aus derselben Liste wie "Patienten heute" berechnet (statt der
  // früheren getTotalTrackedMinutes(), die zusätzlich nach dem
  // Stundenkonto-Startdatum gefiltert hat) - das führte dazu, dass "Stunden
  // heute" 0:00 zeigte, obwohl "Patienten heute" bereits Einträge für den
  // Tag auflistete: der Stundenkonto-Cutoff gehört zur Saldo-Berechnung,
  // nicht zu einer reinen Tagesübersicht der tatsächlich erfassten Zeit.
  const totalTrackedMinutes = dashboardTodayPatients.reduce((s, r) => s + r.totalMinutes, 0);
  const zuzahlungErinnerungen = getFaelligeZuzahlungErinnerungen(runtimeData);
  const assessmentErinnerungen = getFaelligeAssessmentErinnerungen(runtimeData);

  render(`
    ${renderDashboardHeaderCard({ therapistName })}

    ${zuzahlungErinnerungen.length > 0 ? `
      <div class="card" style="background:#fffbeb; border-color:#f59e0b;">
        <h3>Zuzahlungsstatus ungeklärt</h3>
        <div class="list-stack">
          ${zuzahlungErinnerungen.map((item) => `
            <div class="compact-card" style="display:flex; justify-content:space-between; align-items:center; gap:10px;">
              <div>Zuzahlungsstatus ungeklärt – Patient ${escapeHtml(item.patientName)}</div>
              <button type="button" class="klaereZuzahlungBtn secondary" style="width:auto;" data-home-id="${escapeHtml(item.homeId)}" data-patient-id="${escapeHtml(item.patientId)}">Jetzt klären</button>
            </div>
          `).join("")}
        </div>
      </div>
    ` : ""}

    ${assessmentErinnerungen.length > 0 ? `
      <div class="card" style="background:#eff6ff; border-color:#2563eb;">
        <h3>Assessment fällig</h3>
        <div class="list-stack">
          ${assessmentErinnerungen.map((item) => `
            <div class="compact-card" style="display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap;">
              <div>Assessment fällig – Patient ${escapeHtml(item.patientName)}</div>
              <div class="row" style="width:auto; gap:8px;">
                <button type="button" class="assessmentJetztDurchfuehrenBtn secondary" style="width:auto;" data-home-id="${escapeHtml(item.homeId)}" data-patient-id="${escapeHtml(item.patientId)}">Jetzt durchführen</button>
                <button type="button" class="assessmentVerschiebenBtn secondary" style="width:auto;" data-home-id="${escapeHtml(item.homeId)}" data-patient-id="${escapeHtml(item.patientId)}">Verschieben</button>
              </div>
            </div>
          `).join("")}
        </div>
      </div>
    ` : ""}

    <details class="accordion" ${keepOverviewOpen ? 'open' : ''}>
      <summary>
        <span>Überblick</span>
        <span class="muted">Stunden</span>
      </summary>
      <div class="accordion-body">
        <div class="compact-card" style="margin:0;">
          <div style="font-weight:700; margin-bottom:6px;">Stunden heute</div>
          <div class="compact-meta" style="font-size:16px; font-weight:700; color:var(--text);">${escapeHtml(formatHoursClockLabel(totalTrackedMinutes))}</div>
          <div class="compact-meta" style="margin-top:6px;">Aktuelle Zeit · Heute</div>
        </div>
        <div class="row" style="margin-top:10px;">
          <button id="openStundenkontoFromOverviewBtn" class="secondary">📊 Stundenkonto</button>
        </div>
        <details class="accordion" style="margin-top:10px;" ${keepOverviewOpen ? 'open' : ''}>
          <summary>
            <span>Patienten heute</span>
            <span class="muted">${dashboardTodayPatients.length} · ${escapeHtml(formatMinutesLabel(dashboardTodayPatients.reduce((s, r) => s + r.totalMinutes, 0)))}</span>
          </summary>
          <div class="accordion-body">
            ${dashboardTodayPatients.length === 0
              ? `<p class="muted">Heute noch keine Zeit erfasst.</p>`
              : `<div class="list-stack">
                  ${dashboardTodayPatients.map((row) => `
                    <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; padding:10px 0; border-bottom:1px solid var(--border);">
                      <div style="min-width:0;">
                        <div style="font-weight:600; font-size:15px;">${escapeHtml(row.patientName)}</div>
                        <div class="compact-meta">${escapeHtml(row.rezeptLabel || '—')}</div>
                      </div>
                      <div style="display:flex; align-items:center; gap:10px; flex-shrink:0;">
                        <div style="font-weight:700; color:var(--primary); font-size:15px; white-space:nowrap;">
                          ${row.totalMinutes > 0 ? escapeHtml(formatMinutesLabel(row.totalMinutes)) : '—'}
                        </div>
                        <button
                          class="delete-dashboard-time-entry-btn danger"
                          style="padding:6px 10px; font-size:13px; white-space:nowrap;"
                          data-home-id="${escapeHtml(row.homeId)}"
                          data-patient-id="${escapeHtml(row.patientId)}"
                          data-rezept-id="${escapeHtml(row.rezeptId)}"
                          data-time-entry-id="${escapeHtml(row.timeEntryId)}"
                        >Löschen</button>
                      </div>
                    </div>
                  `).join("")}
                  <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 0; margin-top:4px;">
                    <div style="font-weight:700;">Gesamt</div>
                    <div style="font-weight:700; color:var(--primary);">${escapeHtml(formatMinutesLabel(dashboardTodayPatients.reduce((s, r) => s + r.totalMinutes, 0)))}</div>
                  </div>
                </div>`
            }
          </div>
        </details>
      </div>
    </details>

    <div class="card">
      <h3>Bereiche</h3>
      <div class="row">
        <button id="openDokuBtn" style="margin-top:0;">📝 Doku</button>
        <button id="openZeiterfassungBtn" class="secondary" style="margin-top:0;">⏱ Zeiterfassung</button>
      </div>
      <div class="row" style="margin-top:12px;">
        <button id="openHomesBtn" class="secondary" style="margin-top:0;">Einrichtungen</button>
        <button id="openPatientenBtn" class="secondary" style="margin-top:0;">👤 Patienten</button>
      </div>
      <div class="row" style="margin-top:12px;">
        <button id="openAbgabeBtn" class="secondary" style="margin-top:0;">Abgabeliste</button>
        <button id="openNachbestellBtn" class="secondary" style="margin-top:0;">Nachbestellung</button>
      </div>
      <div class="row" style="margin-top:12px;">
        <button id="openKilometerBtn" class="secondary" style="margin-top:0;">Kilometer</button>
        <button id="openAerzteBtn" class="secondary" style="margin-top:0;">👨‍⚕️ Ärzte</button>
      </div>
      <div class="row" style="margin-top:12px;">
        <button id="openUnterschriftenblattBtn" class="secondary" style="margin-top:0;">Unterschriften</button>
      </div>
      <div class="row" style="margin-top:12px;">
        <button id="openAbwesenheitBtn" class="secondary" style="margin-top:0;">🤒 Krank / Urlaub</button>
        <button id="openFreikuvertBtn" class="secondary" style="margin-top:0;">✉️ Freikuvert</button>
      </div>
      <div class="row" style="margin-top:12px;">
        <button id="openAssessmentEinstiegBtn" class="secondary" style="margin-top:0;">📋 Assessment</button>
        <button id="openFaqBtn" class="secondary" style="margin-top:0;">❓ FAQ</button>
      </div>
      <div class="row" style="margin-top:12px;">
        <button id="openSupportBtn" class="secondary" style="margin-top:0;">🆘 Support</button>
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

  document.getElementById("openSettingsBtn").onclick = () => showSettingsView({ onLock });
  document.getElementById("openDokuBtn").onclick = () => showDokuPatientenListeView({ onLock });
  document.getElementById("openZeiterfassungBtn").onclick = () => showZeiterfassungView({ onLock });
  document.getElementById("openHomesBtn").onclick = () => showHomesView({ onLock });
  document.getElementById("openPatientenBtn").onclick = () => showPatientenListeView({ onLock });
  document.getElementById("openAbgabeBtn").onclick = () => showAbgabeView({ onLock });
  document.getElementById("openNachbestellBtn").onclick = () => showNachbestellungView({ onLock });
  document.getElementById("openKilometerBtn").onclick = () => showKilometerView({ onLock });
  document.getElementById("openAerzteBtn").onclick = () => showArztuebersichtView({ onLock });
  document.getElementById("openUnterschriftenblattBtn").onclick = () => {
    window.open("./vorlagen/unterschriftenblatt.pdf", "_blank");
  };
  document.getElementById("openSupportBtn").onclick = () => showSupportView({ onLock });
  document.getElementById("openAbwesenheitBtn").onclick = () => showAbwesenheitView({ onLock });
  document.getElementById("openFreikuvertBtn").onclick = () => showFreikuvertView({ onLock });
  document.getElementById("openAssessmentEinstiegBtn").onclick = () => showAssessmentEinrichtungAuswahlView({ onLock });
  document.getElementById("openFaqBtn").onclick = () => showFaqView({ onLock });

  document.getElementById("openStundenkontoFromOverviewBtn").onclick = () => showStundenkontoView({ onLock });

  document.querySelectorAll('.delete-dashboard-time-entry-btn').forEach((button) => {
    button.onclick = async () => {
      const { homeId, patientId, rezeptId, timeEntryId } = button.dataset;
      if (!homeId || !patientId || !rezeptId || !timeEntryId) return;
      if (!confirm('Diesen Zeiteintrag wirklich löschen?')) return;

      try {
        const scrollPosition = window.scrollY;
        deleteRezeptTimeEntry(homeId, patientId, rezeptId, timeEntryId);
        await queuePersistRuntimeData();
        showDashboardView({ onLock, keepOverviewOpen: true });
        window.scrollTo(0, scrollPosition);
      } catch (err) {
        console.error(err);
        alert(err?.message || 'Zeiteintrag konnte nicht gelöscht werden.');
      }
    };
  });

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
      }, { silent: true });
      await queuePersistRuntimeData();

      const result = await exportBackup(getRuntimeData());
      downloadBlob(result.blob, result.filename);
      await markBackupReminderHandled(`Backup "${result.filename}" manuell im Dashboard exportiert.`);
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

    await runBackupImportFlow({
      file,
      messageElement: msg,
      successMessage: "Backup geladen. App wird neu gestartet…"
    });

    event.target.value = "";
  };

  document.getElementById("resetAppBtn").onclick = async () => {
    const msg = document.getElementById("resetMsg");
    msg.className = "error";
    msg.textContent = "";

    const confirmed = window.confirm("Wirklich alle Daten löschen? Dieser Vorgang kann nicht rückgängig gemacht werden.");
    if (!confirmed) return;

    await performFullReset(msg);
  };

  document.querySelectorAll(".klaereZuzahlungBtn").forEach((btn) => {
    btn.onclick = () => {
      showZuzahlungsabfrageView({
        onLock,
        homeId: btn.dataset.homeId,
        patientId: btn.dataset.patientId,
        onDone: () => showDashboardView({ onLock })
      });
    };
  });

  document.querySelectorAll(".assessmentJetztDurchfuehrenBtn").forEach((btn) => {
    btn.onclick = () => {
      showAssessmentAbfrageView({
        onLock,
        homeId: btn.dataset.homeId,
        patientId: btn.dataset.patientId,
        onDone: () => showDashboardView({ onLock })
      });
    };
  });

  document.querySelectorAll(".assessmentVerschiebenBtn").forEach((btn) => {
    btn.onclick = () => {
      showAssessmentVerschiebenModal({
        homeId: btn.dataset.homeId,
        patientId: btn.dataset.patientId,
        onDone: () => showDashboardView({ onLock })
      });
    };
  });

  // Die angezeigten Erinnerungen gelten als "zugestellt" und werden erst in
  // 7 Tagen erneut fällig (siehe ZUZAHLUNG_REMINDER_INTERVAL_DAYS in homes.js).
  if (zuzahlungErinnerungen.length > 0) {
    zuzahlungErinnerungen.forEach((item) => {
      acknowledgeZuzahlungReminder(item.homeId, item.patientId);
    });
    queuePersistRuntimeData().catch((err) => console.error(err));
  }
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
                <div class="compact-meta">${(home.patients || []).filter((patient) => !isPatientDeceased(patient)).length} Patient(en)</div>
              </div>
              <button class="secondary editHomeToggleBtn" data-home-id="${home.homeId}" title="Heim bearbeiten" aria-label="Heim bearbeiten" style="width:auto; padding:8px 10px;">✎</button>
            </div>
            <div class="edit-home-panel" id="edit-home-panel-${home.homeId}" style="display:none; margin-top:12px;">
              <label for="edit-home-name-${home.homeId}">Heimname</label>
              <input id="edit-home-name-${home.homeId}" type="text" value="${escapeHtml(home.name || "")}">

              <label for="edit-home-address-${home.homeId}">Heimadresse</label>
              <input id="edit-home-address-${home.homeId}" type="text" value="${escapeHtml(home.adresse || "")}">

              <label for="edit-home-email-${home.homeId}">Verwaltungs-E-Mail</label>
              <input id="edit-home-email-${home.homeId}" type="email" value="${escapeHtml(home.verwaltungsEmail || "")}" placeholder="verwaltung@einrichtung.de">

              <label>HB-Pauschale</label>
              <div class="row" style="gap:12px;">
                <label class="check-chip" style="justify-content:flex-start;">
                  <input type="radio" name="homePauschale-${home.homeId}" value="HB" ${(home.hbPauschale || "HB") === "HB" ? "checked" : ""}>
                  <span>HB</span>
                </label>
                <label class="check-chip" style="justify-content:flex-start;">
                  <input type="radio" name="homePauschale-${home.homeId}" value="HBHP" ${home.hbPauschale === "HBHP" ? "checked" : ""}>
                  <span>HBHP</span>
                </label>
              </div>

              <div class="row">
                <button class="saveHomeEditBtn" data-home-id="${home.homeId}">Speichern</button>
                <button class="deleteHomeBtn danger" data-home-id="${home.homeId}">Heim löschen</button>
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

          <label for="homeVerwaltungsEmail">Verwaltungs-E-Mail</label>
          <input id="homeVerwaltungsEmail" type="email" placeholder="verwaltung@einrichtung.de">

          <label>HB-Pauschale</label>
          <div class="row" style="gap:12px;">
            <label class="check-chip" style="justify-content:flex-start;">
              <input type="radio" name="homePauschale" value="HB" checked>
              <span>HB</span>
            </label>
            <label class="check-chip" style="justify-content:flex-start;">
              <input type="radio" name="homePauschale" value="HBHP">
              <span>HBHP</span>
            </label>
          </div>

          <button id="createHomeBtn">Heim speichern</button>
          <div id="homeMsg"></div>
        </div>
      </details>
    </div>
  `);

  bindCheckChipToggles(app);

  document.getElementById("backDashboardBtn").onclick = () => {
    showDashboardView({ onLock });
  };

  document.getElementById("createHomeBtn").onclick = async () => {
    const name = document.getElementById("homeName").value.trim();
    const adresse = document.getElementById("homeAddress").value.trim();
    const verwaltungsEmail = document.getElementById("homeVerwaltungsEmail").value.trim();
    const hbPauschale = document.querySelector('input[name="homePauschale"]:checked')?.value || "HB";
    const msg = document.getElementById("homeMsg");

    msg.className = "error";
    msg.textContent = "";

    if (!name) {
      msg.textContent = "Bitte einen Heimnamen eingeben.";
      return;
    }

    try {
      createHome({ name, adresse, verwaltungsEmail, hbPauschale });
      await queuePersistRuntimeData();
      showHomesView({ onLock });
    } catch (err) {
      console.error(err);
      msg.textContent = "Heim konnte nicht gespeichert werden.";
    }
  };

  document.querySelectorAll(".home-open-card").forEach((card) => {
    card.onclick = (event) => {
      if (event.target.closest(".editHomeToggleBtn") || event.target.closest(".saveHomeEditBtn") || event.target.closest(".deleteHomeBtn") || event.target.closest(".edit-home-panel")) {
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
      const verwaltungsEmail = document.getElementById(`edit-home-email-${homeId}`).value.trim();
      const hbPauschale = document.querySelector(`input[name="homePauschale-${homeId}"]:checked`)?.value || "HB";
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
          home.verwaltungsEmail = verwaltungsEmail;
          home.hbPauschale = ["HB", "HBHP"].includes(hbPauschale) ? hbPauschale : "HB";
        });
        await queuePersistRuntimeData();
        showHomesView({ onLock });
      } catch (err) {
        console.error(err);
        msg.textContent = "Heim konnte nicht aktualisiert werden.";
      }
    };
  });

  document.querySelectorAll(".deleteHomeBtn").forEach((btn) => {
    btn.onclick = async (event) => {
      event.stopPropagation();
      const homeId = btn.dataset.homeId;
      const ok = window.confirm("Heim wirklich löschen? Alle Patienten, Rezepte und Dokumentationen dieses Heims werden ebenfalls gelöscht.");
      if (!ok) return;

      try {
        deleteHome(homeId);
        await queuePersistRuntimeData();
        showHomesView({ onLock });
      } catch (err) {
        console.error(err);
        alert(err?.message || "Heim konnte nicht gelöscht werden.");
      }
    };
  });
}

// Sammelt alle Patienten über alle Einrichtungen hinweg für die
// alphabetische Patienten-Gesamtliste (Dashboard-Button "Patienten") und
// weitere patientenübergreifende Übersichten (Doku-Liste, Arztübersicht).
// includeInactive:true liefert AUSSCHLIESSLICH für den separaten
// "Ausgeschieden/Verstorben"-Bereich in showPatientenListeView() auch
// ausgeschiedene/verstorbene Patienten zurück - der normale (default)
// Aufruf blendet beide Gruppen weiterhin aus, damit sie nicht neben aktiven
// Fällen in Aktivitäts-Übersichten auftauchen.
function collectAllPatients(data, { includeInactive = false } = {}) {
  const results = [];
  (data?.homes || []).forEach((home) => {
    (home?.patients || []).forEach((patient) => {
      if (!includeInactive && isPatientInactive(patient)) return;
      results.push({ patient, homeId: home?.homeId || "", homeName: home?.name || "Ohne Name" });
    });
  });
  return results.sort((a, b) => {
    const aName = formatPatientName(a.patient);
    const bName = formatPatientName(b.patient);
    return collatorDE.compare(aName, bName);
  });
}

export function showPatientenListeView({ onLock, searchText = "" } = {}) {
  bindLockButton(onLock);
  setCurrentView("patienten-liste", { searchText });

  const runtimeData = getRuntimeData();
  const q = String(searchText || "").trim().toLowerCase();
  const allPatients = collectAllPatients(runtimeData).filter(({ patient, homeName }) => {
    if (!q) return true;
    const haystack = [patient.firstName, patient.lastName, patient.birthDate, homeName].join(" ").toLowerCase();
    return haystack.includes(q);
  });

  // Eigener, eingeklappter Bereich für ausgeschiedene/verstorbene Patienten
  // (Nutzerwunsch): die tauchten bisher nirgendwo gesammelt auf, sondern nur
  // vereinzelt (mit Pille) in der jeweiligen Einrichtung - hier jetzt
  // zusätzlich patientenübergreifend auffindbar, aber bewusst getrennt von
  // der aktiven Liste oben, damit sie dort (und in Zeiterfassung/Doku) nicht
  // mehr neben echten Behandlungsfällen auftauchen.
  const inactivePatients = collectAllPatients(runtimeData, { includeInactive: true })
    .filter(({ patient }) => isPatientInactive(patient));

  render(`
    <div class="card">
      <h2>Patienten</h2>
      <p class="muted">${allPatients.length} Patient(en) über alle Einrichtungen, alphabetisch sortiert.</p>
      <button id="backDashboardBtn" class="secondary">Zurück zum Dashboard</button>
    </div>

    <div class="card">
      <details class="accordion">
        <summary>
          <span>Ausgeschieden / Verstorben</span>
          <span class="muted">${inactivePatients.length} Patient(en)</span>
        </summary>
        <div class="accordion-body">
          ${inactivePatients.length === 0 ? `<p class="muted">Keine ausgeschiedenen oder verstorbenen Patienten vorhanden.</p>` : `
            <div class="list-stack">
              ${inactivePatients.map(({ patient, homeName }) => `
                <div class="compact-card">
                  <div style="font-weight:600;">
                    ${escapeHtml(formatPatientName(patient) || "Ohne Namen")}
                    ${patient.verstorben ? `<span class="pill-red">Verstorben</span>` : `<span class="pill-gray">Ausgeschieden</span>`}
                  </div>
                  <div class="compact-meta">${escapeHtml(homeName)}${patient.birthDate ? ` · geb. ${escapeHtml(patient.birthDate)}` : ""}</div>
                </div>
              `).join("")}
            </div>
          `}
        </div>
      </details>
    </div>

    <div class="card">
      <label for="patientenListeSearch">Suche nach Name, Geburtsdatum oder Einrichtung</label>
      <input id="patientenListeSearch" type="text" value="${escapeHtml(searchText)}" placeholder="z.B. Müller oder Heim Sonnenschein">
      <div class="row">
        <button id="runPatientenListeSearchBtn" class="secondary">Suchen</button>
        <button id="clearPatientenListeSearchBtn" class="secondary">Suche löschen</button>
      </div>
    </div>

    <div class="card">
      <div class="list-stack">
        ${allPatients.length === 0 ? `<p class="muted">Keine passenden Patienten gefunden.</p>` : ""}
        ${allPatients.map(({ patient, homeId, homeName }) => `
          <div class="compact-card">
            <div style="font-weight:600;">${escapeHtml(formatPatientName(patient) || "Ohne Namen")}</div>
            <div class="compact-meta" style="margin-bottom:8px;">${escapeHtml(homeName)}${patient.birthDate ? ` · geb. ${escapeHtml(patient.birthDate)}` : ""}</div>
            <div class="inline-action-stack">
              <button class="openPatientFromListeBtn secondary" data-home-id="${escapeHtml(homeId)}" data-patient-id="${escapeHtml(patient.patientId)}">Rezept</button>
              <button class="openOptimierungFromListeBtn secondary" data-home-id="${escapeHtml(homeId)}" data-patient-id="${escapeHtml(patient.patientId)}">Rezeptoptimierer</button>
            </div>
            <div class="inline-action-stack" style="margin-top:8px;">
              <button class="openArztberichtFromListeBtn secondary" data-home-id="${escapeHtml(homeId)}" data-patient-id="${escapeHtml(patient.patientId)}">Arztbericht</button>
            </div>
          </div>
        `).join("")}
      </div>
    </div>
  `);

  document.getElementById("backDashboardBtn").onclick = () => showDashboardView({ onLock });

  const runSearch = () => {
    showPatientenListeView({ onLock, searchText: document.getElementById("patientenListeSearch").value });
  };
  document.getElementById("runPatientenListeSearchBtn").onclick = runSearch;
  document.getElementById("patientenListeSearch").addEventListener("keydown", (e) => {
    if (e.key === "Enter") runSearch();
  });
  document.getElementById("clearPatientenListeSearchBtn").onclick = () => {
    showPatientenListeView({ onLock, searchText: "" });
  };

  // returnTo sorgt dafür, dass "Zurück" aus dem Patienten/Rezept-Bereich
  // wieder hier auf der Patientenliste landet statt über die Einrichtung
  // und die Einrichtungsliste zum Dashboard durchgereicht zu werden.
  document.querySelectorAll(".openPatientFromListeBtn").forEach((btn) => {
    btn.onclick = () => {
      showPatientDetailView({ onLock, homeId: btn.dataset.homeId, patientId: btn.dataset.patientId, returnTo: { from: "patienten-liste", searchText } });
    };
  });
  document.querySelectorAll(".openOptimierungFromListeBtn").forEach((btn) => {
    btn.onclick = () => {
      showRezeptoptimierungView({ onLock, homeId: btn.dataset.homeId, patientId: btn.dataset.patientId, returnTo: { from: "patienten-liste", searchText } });
    };
  });

  // Schnellzugriff: Dashboard -> Patienten -> Patient -> "Arztbericht" -
  // ersetzt den bisherigen Umweg über die Einrichtung (Einrichtung ->
  // Patient -> Arztbericht-Bereich -> Rezept auswählen).
  document.querySelectorAll(".openArztberichtFromListeBtn").forEach((btn) => {
    btn.onclick = () => {
      showArztberichtView({ onLock, homeId: btn.dataset.homeId, patientId: btn.dataset.patientId, searchText });
    };
  });
}

// Gemeinsamer SchnellDoku-Baustein (Markup + Bindung), genutzt sowohl von der
// bestehenden Einrichtungen->Einrichtung->Patient->SchnellDoku-Stelle
// (showHomeDetailView) als auch vom neuen Dashboard-Button "Doku"
// (showDokuSchreibenView) - beide Wege müssen laut Vorgabe exakt dieselbe
// Funktion bieten, nur der Einstiegsweg unterscheidet sich.
function renderQuickDocFields(patient, prefillDate = "", prefillRezeptId = "") {
  const quickDocRezepte = sortRezepteForDisplay(patient.rezepte || []).filter((rezept) => rezept.abgegeben !== true);
  return `
    <div class="compact-card" style="margin-bottom:10px;">
      <label for="quickDocDate-${patient.patientId}">Behandlungsdatum</label>
      <input id="quickDocDate-${patient.patientId}" class="quickDocDateInput" type="text" value="${escapeHtml(prefillDate || formatCurrentDateShort())}" placeholder="TT.MM.JJJJ" inputmode="numeric">
    </div>
    ${quickDocRezepte.length === 0 ? `
      <p class="muted">Keine Rezepte für SchnellDoku vorhanden.</p>
      <p class="muted">Falls das Rezept noch nicht eingetippt wurde (z.B. aus Zeitgründen), kann trotzdem schon dokumentiert werden - die Rezeptangaben lassen sich später über Einrichtung → Patient → Rezept nachtragen.</p>
      <button type="button" class="quickDocOhneRezeptBtn secondary" data-patient-id="${patient.patientId}">Ohne Rezept-Angaben dokumentieren</button>
    ` : quickDocRezepte.length === 1 ? `
      <div class="compact-card" style="margin-bottom:10px;">
        <div style="font-weight:600; margin-bottom:6px;">Zielrezept vom: ${escapeHtml(quickDocRezepte[0].ausstell || "—")}</div>
        <div class="compact-meta">${escapeHtml(rezeptSummary(quickDocRezepte[0]))}</div>
      </div>
    ` : `
      <div class="compact-card" style="margin-bottom:10px;">
        <div style="font-weight:600; margin-bottom:6px;">Zielrezept auswählen</div>
        <div class="list-stack">
          ${quickDocRezepte.map(rezept => {
            const isPreselected = !!prefillRezeptId && rezept.rezeptId === prefillRezeptId;
            return `
            <label class="check-chip quick-doc-chip${isPreselected ? " is-checked" : ""}" data-patient-id="${patient.patientId}" data-rezept-id="${rezept.rezeptId}" style="flex:1 1 auto;">
              <input class="quickDocRezeptCheck" type="checkbox" data-patient-id="${patient.patientId}" data-rezept-id="${rezept.rezeptId}" ${isPreselected ? "checked" : ""}>
              <span>
                <strong>Zielrezept vom: ${escapeHtml(rezept.ausstell || "—")}</strong><br>
                <span class="muted">${escapeHtml(rezeptSummary(rezept))}</span>
              </span>
            </label>
          `;}).join("")}
        </div>
      </div>
    `}

    <div id="quickDocLastEntryBox-${patient.patientId}" class="compact-card" style="display:none; margin-bottom:10px; background:#eff6ff; border-color:#93c5fd;">
      <div style="font-weight:600; margin-bottom:6px;">📋 Vom letzten Mal (<span id="quickDocLastEntryDate-${patient.patientId}"></span>)</div>
      <div id="quickDocLastEntryText-${patient.patientId}" class="muted" style="white-space:pre-wrap; margin-bottom:10px;"></div>
      <button type="button" id="quickDocUseLastBtn-${patient.patientId}" class="secondary" style="margin:0; width:auto;">Vom letzten Mal übernehmen</button>
    </div>

    <label for="quickDocText-${patient.patientId}">Dokumentation</label>
    <div class="compact-card" style="margin-bottom:10px; padding:14px;">
      <textarea id="quickDocText-${patient.patientId}" rows="4" placeholder="Dokumentation direkt zum Rezept speichern" style="width:100%; border:none; outline:none; resize:vertical; background:transparent; font:inherit; color:inherit; min-height:96px;"></textarea>
    </div>
    <button class="saveQuickDocBtn" data-patient-id="${patient.patientId}" ${quickDocRezepte.length===0?'disabled':''}>SchnellDoku speichern</button>
    <div id="quickDocMsg-${patient.patientId}"></div>
  `;
}

function bindQuickDocHandlers({ homeId, patient, onSaved, onRezeptCreated }) {
  const patientId = patient.patientId;

  const dateInputEl = document.getElementById(`quickDocDate-${patientId}`);
  if (dateInputEl) bindDateAutoFormat(dateInputEl);

  // Sichtbare Markierung des ausgewählten Zielrezepts: das Setzen von
  // other.checked = false unten löst KEIN "change"-Event aus (nur echte
  // Nutzerinteraktion tut das), weshalb sich die von bindCheckChipToggles()
  // gesetzte .is-checked-Klasse an den abgewählten Geschwister-Chips sonst
  // nie wieder entfernt hätte - die Klasse wird deshalb hier direkt und
  // vollständig selbst verwaltet, statt sich auf ein extern ausgelöstes
  // "change" zu verlassen.
  document.querySelectorAll(`.quickDocRezeptCheck[data-patient-id="${patientId}"]`).forEach((check) => {
    check.addEventListener('change', () => {
      if (!check.checked) return;
      document.querySelectorAll(`.quickDocRezeptCheck[data-patient-id="${patientId}"]`).forEach((other) => {
        if (other !== check) {
          other.checked = false;
          other.closest('.check-chip')?.classList.remove('is-checked');
        }
      });
      check.closest('.check-chip')?.classList.add('is-checked');
      updateQuickDocLastEntryPreview(check.dataset.rezeptId);
    });
  });

  // "Vom letzten Mal übernehmen" (Kollegen-Wunsch): zeigt oberhalb des
  // Textfelds den zuletzt geschriebenen Doku-Text zum aktuell gewählten
  // Zielrezept an (letzter Eintrag = höchstes Datum, da rezept.entries beim
  // Speichern immer chronologisch sortiert wird, siehe sortRezeptEntriesByDate()
  // in modules/homes.js) - ein Klick füllt nur das Textfeld, gespeichert wird
  // weiterhin erst über den normalen "SchnellDoku speichern"-Button, damit
  // Datum/Text vorher noch angepasst werden können. Bewusst NICHT wie der
  // ältere, versteckte "Für heute übernehmen"-Button auf der Patientenseite
  // (der sofort einen neuen Eintrag anlegt), sondern direkt sichtbar in der
  // SchnellDoku-Maske selbst.
  const quickDocRezepteForPreview = sortRezepteForDisplay(patient?.rezepte || []).filter((rezept) => rezept.abgegeben !== true);
  const lastEntryByRezeptId = {};
  quickDocRezepteForPreview.forEach((rezept) => {
    const entries = rezept.entries || [];
    if (entries.length > 0) {
      lastEntryByRezeptId[rezept.rezeptId] = entries[entries.length - 1];
    }
  });

  // Patientenweiter Fallback (Nutzerwunsch): ein gerade erst neu angelegtes
  // Rezept hat naturgemäß noch KEINE eigenen Einträge - ohne Fallback wäre
  // "Vom letzten Mal übernehmen" direkt nach einem Rezeptwechsel immer leer,
  // bis man einmal neu dokumentiert hat. Sucht deshalb über ALLE Rezepte des
  // Patienten hinweg (auch bereits abgegebene/archivierte) den zeitlich
  // letzten Eintrag, damit die Übernahme-Funktion unabhängig davon
  // funktioniert, ob gerade ein neues Rezept läuft oder nicht.
  let patientWideLastEntry = null;
  let patientWideLastEntryComparable = '';
  (patient?.rezepte || []).forEach((rezept) => {
    (rezept.entries || []).forEach((entry) => {
      const comparable = parseDeDate(entry?.date) || '';
      if (!comparable) return;
      if (!patientWideLastEntry || comparable > patientWideLastEntryComparable) {
        patientWideLastEntry = entry;
        patientWideLastEntryComparable = comparable;
      }
    });
  });

  function getSelectedQuickDocRezeptId() {
    if (quickDocRezepteForPreview.length === 1) return quickDocRezepteForPreview[0].rezeptId;
    const checked = document.querySelector(`.quickDocRezeptCheck[data-patient-id="${patientId}"]:checked`);
    return checked?.dataset.rezeptId || '';
  }

  function getQuickDocLastEntry(rezeptId) {
    return (rezeptId && lastEntryByRezeptId[rezeptId]) || patientWideLastEntry || null;
  }

  function updateQuickDocLastEntryPreview(rezeptId) {
    const box = document.getElementById(`quickDocLastEntryBox-${patientId}`);
    if (!box) return;
    const lastEntry = getQuickDocLastEntry(rezeptId);
    if (!lastEntry) {
      box.style.display = 'none';
      return;
    }
    document.getElementById(`quickDocLastEntryDate-${patientId}`).textContent = lastEntry.date || '—';
    document.getElementById(`quickDocLastEntryText-${patientId}`).textContent = lastEntry.text || '—';
    box.style.display = '';
  }

  updateQuickDocLastEntryPreview(getSelectedQuickDocRezeptId());

  const useLastBtn = document.getElementById(`quickDocUseLastBtn-${patientId}`);
  if (useLastBtn) {
    useLastBtn.onclick = () => {
      const rezeptId = getSelectedQuickDocRezeptId();
      const lastEntry = getQuickDocLastEntry(rezeptId);
      const textarea = document.getElementById(`quickDocText-${patientId}`);
      if (!lastEntry || !textarea) return;
      textarea.value = lastEntry.text || '';
      textarea.focus();
    };
  }

  // "Ohne Rezept-Angaben dokumentieren" (Nutzerwunsch): legt ein leeres
  // Platzhalter-Rezept an (createRezept() mit payload={}, siehe Kommentar
  // dort), damit direkt dokumentiert werden kann, auch wenn das Rezept aus
  // Zeitgründen noch nicht eingetippt wurde - die eigentlichen Angaben
  // (ICD-10, Arzt, Leitsymptomatik, Heilmittel) lassen sich jederzeit
  // später über Einrichtung → Patient → Rezept ergänzen; FaSti erinnert
  // daran über die bereits bestehende "Rezept unvollständig"-Meldung.
  const ohneRezeptBtn = document.querySelector(`.quickDocOhneRezeptBtn[data-patient-id="${patientId}"]`);
  if (ohneRezeptBtn) {
    ohneRezeptBtn.onclick = async () => {
      try {
        createRezept(homeId, patientId, {});
        await queuePersistRuntimeData();
        (onRezeptCreated || onSaved)();
      } catch (err) {
        console.error(err);
      }
    };
  }

  const btn = document.querySelector(`.saveQuickDocBtn[data-patient-id="${patientId}"]`);
  if (!btn) return;

  btn.onclick = async () => {
    const rezepte = sortRezepteForDisplay(patient?.rezepte || []).filter((rezept) => rezept.abgegeben !== true);
    const msg = document.getElementById(`quickDocMsg-${patientId}`);
    const text = document.getElementById(`quickDocText-${patientId}`).value.trim();

    msg.className = 'error';
    msg.textContent = '';

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
      const dateInput = document.getElementById(`quickDocDate-${patientId}`);
      const quickDate = normalizeDeDateInput(dateInput?.value || '') || formatCurrentDateShort();
      if (!parseDeDate(quickDate)) {
        msg.textContent = 'Bitte ein gültiges Behandlungsdatum im Format TT.MM.JJJJ eingeben.';
        return;
      }

      createRezeptEntry(homeId, patientId, targetRezeptId, {
        date: quickDate,
        text
      });
      await queuePersistRuntimeData();
      onSaved();
    } catch (err) {
      console.error(err);
      msg.textContent = 'SchnellDoku konnte nicht gespeichert werden.';
    }
  };
}

// Dashboard-Button "Doku": Patientenliste einrichtungsübergreifend,
// alphabetisch, mit Suchfeld - Klick auf einen Patienten führt direkt zum
// SchnellDoku-Schreibfeld (showDokuSchreibenView), ohne den Umweg über
// Einrichtungen -> Einrichtung -> Patient. Der bisherige Weg über die
// Einrichtung bleibt zusätzlich bestehen (Vorgabe: "Beide Wege behalten").
export function showDokuPatientenListeView({ onLock, searchText = "" } = {}) {
  bindLockButton(onLock);
  setCurrentView("doku-patienten-liste", { searchText });

  const runtimeData = getRuntimeData();
  const q = String(searchText || "").trim().toLowerCase();
  const allPatients = collectAllPatients(runtimeData)
    .filter(({ patient, homeName }) => {
      if (!q) return true;
      const haystack = [patient.firstName, patient.lastName, patient.birthDate, homeName].join(" ").toLowerCase();
      return haystack.includes(q);
    });

  render(`
    <div class="card">
      <h2>Doku</h2>
      <p class="muted">${allPatients.length} Patient(en) über alle Einrichtungen, alphabetisch sortiert.</p>
      <button id="backDashboardBtn" class="secondary">Zurück zum Dashboard</button>
    </div>

    <div class="card">
      <label for="dokuPatientenSearch">Suche nach Name, Geburtsdatum oder Einrichtung</label>
      <input id="dokuPatientenSearch" type="text" value="${escapeHtml(searchText)}" placeholder="z.B. Müller oder Heim Sonnenschein">
      <div class="row">
        <button id="runDokuPatientenSearchBtn" class="secondary">Suchen</button>
        <button id="clearDokuPatientenSearchBtn" class="secondary">Suche löschen</button>
      </div>
    </div>

    <div class="card">
      <div class="list-stack">
        ${allPatients.length === 0 ? `<p class="muted">Keine passenden Patienten gefunden.</p>` : ""}
        ${allPatients.map(({ patient, homeId, homeName }) => `
          <div class="openDokuSchreibenBtn compact-card" style="cursor:pointer;" data-home-id="${escapeHtml(homeId)}" data-patient-id="${escapeHtml(patient.patientId)}">
            <div style="font-weight:600;">${escapeHtml(formatPatientName(patient) || "Ohne Namen")}</div>
            <div class="compact-meta">${escapeHtml(homeName)}${patient.birthDate ? ` · geb. ${escapeHtml(patient.birthDate)}` : ""}</div>
          </div>
        `).join("")}
      </div>
    </div>
  `);

  document.getElementById("backDashboardBtn").onclick = () => showDashboardView({ onLock });

  const runSearch = () => {
    showDokuPatientenListeView({ onLock, searchText: document.getElementById("dokuPatientenSearch").value });
  };
  document.getElementById("runDokuPatientenSearchBtn").onclick = runSearch;
  document.getElementById("dokuPatientenSearch").addEventListener("keydown", (e) => {
    if (e.key === "Enter") runSearch();
  });
  document.getElementById("clearDokuPatientenSearchBtn").onclick = () => {
    showDokuPatientenListeView({ onLock, searchText: "" });
  };

  document.querySelectorAll(".openDokuSchreibenBtn").forEach((btn) => {
    btn.onclick = () => {
      showDokuSchreibenView({ onLock, homeId: btn.dataset.homeId, patientId: btn.dataset.patientId, searchText });
    };
  });
}

// Direktes SchnellDoku-Schreibfeld für einen Patienten, ohne Einrichtungs-
// Umweg - siehe showDokuPatientenListeView() oben. Nutzt dieselben
// renderQuickDocFields()/bindQuickDocHandlers()-Bausteine wie die
// SchnellDoku in showHomeDetailView.
export function showDokuSchreibenView({ onLock, homeId, patientId, searchText = "", prefillDate = "", prefillRezeptId = "" }) {
  bindLockButton(onLock);
  setCurrentView("doku-schreiben", { homeId, patientId, searchText });

  const runtimeData = getRuntimeData();
  const home = getHomeById(runtimeData, homeId);
  const patient = home ? getPatientById(home, patientId) : null;

  if (!home || !patient) {
    render(`
      <div class="card">
        <p class="error">Patient nicht gefunden.</p>
        <button id="backDokuListeBtn" class="secondary">Zurück zur Patientenliste</button>
      </div>
    `);
    document.getElementById("backDokuListeBtn").onclick = () => showDokuPatientenListeView({ onLock, searchText });
    return;
  }

  render(`
    <div class="card">
      <h2>Doku – ${escapeHtml(formatPatientName(patient) || "Ohne Namen")}</h2>
      <div class="compact-meta" style="margin-bottom:8px;">${escapeHtml(home.name || "")}</div>
      <button id="backDokuListeBtn" class="secondary">Zurück zur Patientenliste</button>
    </div>

    <div class="card">
      ${renderQuickDocFields(patient, prefillDate, prefillRezeptId)}
    </div>
  `);
  bindCheckChipToggles(app);

  document.getElementById("backDokuListeBtn").onclick = () => showDokuPatientenListeView({ onLock, searchText });

  bindQuickDocHandlers({
    homeId,
    patient,
    onSaved: () => {
      showToast("Dokumentation gespeichert");
      showDokuSchreibenView({ onLock, homeId, patientId, searchText });
    },
    onRezeptCreated: () => {
      showToast("Rezept angelegt - Angaben können später ergänzt werden");
      showDokuSchreibenView({ onLock, homeId, patientId, searchText });
    }
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

  const filteredPatients = sortPatientsAlpha(searchPatientsInHome(home, searchText).filter((patient) => !isPatientDeceased(patient)));

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
          <span>Suche</span>
          <span class="muted">Nach Name oder Geburtsdatum</span>
        </summary>
        <div class="accordion-body">
          <label for="patientSearch">Suche nach Name oder Geburtsdatum</label>
          <input id="patientSearch" type="text" value="${escapeHtml(searchText)}" placeholder="z.B. Müller oder 01.01.1950">

          <div class="row">
            <button id="runPatientSearchBtn" class="secondary">Suchen</button>
            <button id="clearPatientSearchBtn" class="secondary">Suche löschen</button>
          </div>
        </div>
      </details>

      <button id="openCreatePatientRezeptBtn" style="margin-top:12px;">Neuen Patienten + Rezept anlegen</button>

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
                  ${patient.verstorben ? `<span class="pill-red">Verstorben</span>` : ""}
                  ${patient.ausgeschieden ? `<span class="pill-gray">Ausgeschieden</span>` : ""}
                </div>

                <div class="inline-action-stack" style="margin-bottom:10px;">
                  <button class="patientSectionBtn secondary" data-target="patient-rezepte-${patient.patientId}">Rezept</button>
                  <button class="patientSectionBtn secondary" data-target="patient-stammdaten-${patient.patientId}">Stammdaten</button>
                </div>
                <div class="inline-action-stack" style="margin-bottom:12px;">
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
                              <div class="inline-action-stack" style="margin-top:10px;">
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
                  ${renderQuickDocFields(patient)}
                </div>

                <div id="patient-stammdaten-${patient.patientId}" class="patient-inline-section" style="display:none;">
                  <label for="edit-lastName-${patient.patientId}">Nachname</label>
                  <input id="edit-lastName-${patient.patientId}" type="text" value="${escapeHtml(patient.lastName || "")}">

                  <label for="edit-firstName-${patient.patientId}">Vorname</label>
                  <input id="edit-firstName-${patient.patientId}" type="text" value="${escapeHtml(patient.firstName || "")}">

                  <label for="edit-birthDate-${patient.patientId}">Geburtsdatum</label>
                  <input id="edit-birthDate-${patient.patientId}" type="text" value="${escapeHtml(patient.birthDate || "")}" inputmode="numeric" placeholder="TT.MM.JJJJ">

                  <div class="checkbox-row">
                    <label class="check-chip"><input id="edit-verstorben-${patient.patientId}" type="checkbox" ${patient.verstorben ? "checked" : ""}> <span>Verstorben</span></label>
                    <label class="check-chip"><input id="edit-ausgeschieden-${patient.patientId}" type="checkbox" ${patient.ausgeschieden ? "checked" : ""}> <span>Ausgeschieden</span></label>
                  </div>
                  <p class="muted">"Ausgeschieden" löscht den Patienten nicht, gilt aber nicht mehr als aktiv - keine Nachbestellungs-, Zuzahlungs- oder Assessment-Erinnerungen mehr.</p>

                  <label for="edit-zuzahlungsstatus-${patient.patientId}">Zuzahlungsstatus</label>
                  ${renderZuzahlungsstatusSelect(`edit-zuzahlungsstatus-${patient.patientId}`, patient.zuzahlungsstatus || "")}
                  <p class="muted">Bitte mit Stationsleitung oder Büro klären. Bei "Noch nicht geklärt" erinnert die App wöchentlich.</p>

                  <button class="savePatientDataBtn" data-patient-id="${patient.patientId}">Stammdaten speichern</button>
                  <div id="patient-edit-msg-${patient.patientId}"></div>

                  <button class="deletePatientInlineBtn danger" data-patient-id="${patient.patientId}" style="margin-top:16px; width:100%;">Patient löschen</button>
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

  document.querySelectorAll('[id^="edit-birthDate-"]').forEach((el) => bindDateAutoFormat(el));
  bindCheckChipToggles(app);
  bindQuickDocSelectionStyles(app);
  bindSelectableCardChecks(app);

  document.getElementById("openCreatePatientRezeptBtn").onclick = () => {
    showCreatePatientRezeptView({ onLock, homeId, searchText });
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

  filteredPatients.forEach((patient) => {
    bindQuickDocHandlers({
      homeId,
      patient,
      onSaved: () => showHomeDetailView({ onLock, homeId, searchText }),
      onRezeptCreated: () => {
        showToast("Rezept angelegt - Angaben können später ergänzt werden");
        showHomeDetailView({ onLock, homeId, searchText });
      }
    });
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
          verstorben: document.getElementById(`edit-verstorben-${patientId}`).checked,
          ausgeschieden: document.getElementById(`edit-ausgeschieden-${patientId}`).checked
        });

        const currentPatient = getPatientById(getHomeById(getRuntimeData(), homeId), patientId);
        const nextZuzahlungsstatus = document.getElementById(`edit-zuzahlungsstatus-${patientId}`).value;
        if (nextZuzahlungsstatus && nextZuzahlungsstatus !== currentPatient?.zuzahlungsstatus) {
          setZuzahlungsstatus(homeId, patientId, nextZuzahlungsstatus);
        }

        await queuePersistRuntimeData();
        showHomeDetailView({ onLock, homeId, searchText });
      } catch (err) {
        console.error(err);
        msg.textContent = 'Stammdaten konnten nicht gespeichert werden.';
      }
    };
  });

  document.querySelectorAll('.deletePatientInlineBtn').forEach((btn) => {
    btn.onclick = async () => {
      const patientId = btn.dataset.patientId;
      const patient = (home.patients || []).find((p) => p.patientId === patientId);
      const patientLabel = patient ? formatPatientName(patient) || "Patient" : "Patient";
      const ok = confirm(`${patientLabel} wirklich löschen? Alle Rezepte und Dokumentationen dieses Patienten werden ebenfalls gelöscht.`);
      if (!ok) return;

      try {
        deletePatient(homeId, patientId);
        await queuePersistRuntimeData();
        showHomeDetailView({ onLock, homeId, searchText });
      } catch (err) {
        console.error(err);
        alert(err?.message || "Patient konnte nicht gelöscht werden.");
      }
    };
  });
}

// Übersicht aller Rezepte + Arztberichte eines Patienten (Neu anlegen und
// bestehende öffnen). Direkt erreichbar über den "Arztbericht"-Button in
// der Patientenliste (Dashboard -> Patienten) - ersetzt den bisherigen
// Weg über Einrichtung -> Patient -> Arztbericht-Bereich -> Rezept
// auswählen (Aufgabe 6: "Schnellerer Zugriff").
export function showArztberichtView({ onLock, homeId, patientId, searchText = "" }) {
  bindLockButton(onLock);
  setCurrentView("arztbericht-uebersicht", { homeId, patientId, searchText });

  const runtimeData = getRuntimeData();
  const home = getHomeById(runtimeData, homeId);
  const patient = getPatientById(home, patientId);

  if (!home || !patient) {
    showPatientenListeView({ onLock, searchText });
    return;
  }

  const rezepte = sortRezepteForDisplay(patient.rezepte || []);
  const patientName = formatPatientName(patient) || "Patient/in";

  render(`
    <div class="card">
      <h2>Arztberichte</h2>
      <p class="muted">Patient: ${escapeHtml(patientName)}</p>
      <button id="backFromArztberichtBtn" class="secondary">Zurück zur Patientenliste</button>
    </div>

    <div class="card">
      ${rezepte.length === 0 ? `<p class="muted">Keine Rezepte für Arztberichte vorhanden. Bitte zuerst ein Rezept anlegen.</p>` : `
        <div class="list-stack">
          ${rezepte.map((rezept, idx) => {
            const reportCount = ensureDoctorReportsState(rezept).length;
            const reports = [...ensureDoctorReportsState(rezept)].sort((a, b) => String(b?.createdAt || "").localeCompare(String(a?.createdAt || "")));
            return `
              <details class="accordion" style="margin-bottom:8px;" ${idx === 0 ? "open" : ""}>
                <summary>
                  <span>${escapeHtml(rezeptSummary(rezept))}</span>
                  <span class="muted">${reportCount} Bericht(e)</span>
                </summary>
                <div class="accordion-body">
                  <div class="compact-meta" style="margin-bottom:10px;">
                    Arzt: ${escapeHtml(rezept.arzt || "—")}<br>
                    Ausstellung: ${escapeHtml(rezept.ausstell || "—")}<br>
                    Aktuelles Datum wird beim Anlegen automatisch gesetzt.
                  </div>
                  <div class="row" style="margin-bottom:10px;">
                    <button class="createDoctorReportBtn" data-patient-id="${patient.patientId}" data-rezept-id="${rezept.rezeptId}">Neuen Arztbericht erstellen</button>
                  </div>
                  ${reports.length === 0 ? `<p class="muted">Noch keine Arztberichte gespeichert.</p>` : `
                    <div class="list-stack">
                      ${reports.map((report) => `
                        <div class="compact-card" style="padding:14px;">
                          <div class="row" style="justify-content:space-between; align-items:center; gap:10px; margin-bottom:8px;">
                            <div>
                              <div style="font-weight:700;">${escapeHtml(formatIsoDateShort(report.createdAt))}</div>
                              <div class="compact-meta">Zuletzt geändert: ${escapeHtml(formatIsoDateShort(report.updatedAt || report.createdAt))}</div>
                            </div>
                            <button class="openDoctorReportBtn secondary" data-patient-id="${patient.patientId}" data-rezept-id="${rezept.rezeptId}" data-report-id="${report.reportId}">Öffnen</button>
                          </div>
                        </div>
                      `).join("")}
                    </div>
                  `}
                </div>
              </details>
            `;
          }).join("")}
        </div>
      `}
    </div>
  `);

  document.getElementById("backFromArztberichtBtn").onclick = () => {
    showPatientenListeView({ onLock, searchText });
  };

  document.querySelectorAll(".createDoctorReportBtn").forEach((btn) => {
    btn.onclick = async () => {
      try {
        const createdReportId = createDoctorReportForRezept(homeId, btn.dataset.patientId, btn.dataset.rezeptId);
        await queuePersistRuntimeData();
        showDoctorReportEditorView({
          onLock,
          homeId,
          patientId: btn.dataset.patientId,
          rezeptId: btn.dataset.rezeptId,
          reportId: createdReportId,
          searchText
        });
      } catch (err) {
        console.error(err);
        alert(err?.message || "Arztbericht konnte nicht erstellt werden.");
      }
    };
  });

  document.querySelectorAll(".openDoctorReportBtn").forEach((btn) => {
    btn.onclick = () => {
      showDoctorReportEditorView({
        onLock,
        homeId,
        patientId: btn.dataset.patientId,
        rezeptId: btn.dataset.rezeptId,
        reportId: btn.dataset.reportId,
        searchText
      });
    };
  });
}

export function showDoctorReportEditorView({ onLock, homeId, patientId, rezeptId, reportId, searchText = "", successMsg = "" }) {
  bindLockButton(onLock);
  setCurrentView("doctor-report-editor", { homeId, patientId, rezeptId, reportId, searchText });

  const runtimeData = getRuntimeData();
  const home = getHomeById(runtimeData, homeId);
  const patient = getPatientById(home, patientId);
  const rezept = getRezeptById(patient, rezeptId);
  const report = ensureDoctorReportsState(rezept).find((item) => item.reportId === reportId);

  if (!home || !patient || !rezept || !report) {
    showHomeDetailView({ onLock, homeId, searchText });
    return;
  }

  const patientName = formatPatientName(patient) || 'Patient/in';
  const introLine = buildDoctorReportIntroLine(patient);
  const allAssessmentsHtml = buildAllAssessmentsReportHtml(patient);

  render(`
    <div class="card">
      <h2>Therapiebericht</h2>
      <p class="muted">Patient: ${escapeHtml(patientName)} · Rezept: ${escapeHtml(rezeptSummary(rezept))}</p>
      <button id="backDoctorReportBtn" class="secondary">Zurück zur Patientenübersicht</button>
    </div>

    <div class="card">
      <div class="row" style="justify-content:space-between; align-items:flex-start; gap:12px; margin-bottom:12px;">
        <div>
          <div><strong>Erstellt:</strong> ${escapeHtml(formatIsoDateShort(report.createdAt))}</div>
          <div class="muted">Zuletzt geändert: ${escapeHtml(formatIsoDateShort(report.updatedAt || report.createdAt))}</div>
        </div>
        <div class="muted" style="text-align:right;">Arzt: ${escapeHtml(rezept.arzt || '—')}<br>Verordnung vom ${escapeHtml(rezept.ausstell || '—')}</div>
      </div>

      <h3>Einleitung (automatisch)</h3>
      <div class="compact-card">
        <p style="margin:0;">${escapeHtml(introLine)}</p>
      </div>

      <h3 style="margin-top:20px;">Teil 1 – Assessment-Verlauf (automatisch, alle bisherigen Assessments)</h3>
      <div class="compact-card">
        ${allAssessmentsHtml}
      </div>

      <h3 style="margin-top:20px;">Teil 2 – Geführte Eingabe</h3>
      <label>Therapieziel (Mehrfachauswahl)</label>
      ${renderCheckboxList('therapieziel', Assessment.THERAPIEZIEL_OPTIONEN, report.therapieziele)}
      <label for="therapiezielFreitext">Sonstiges Therapieziel (optional)</label>
      <input id="therapiezielFreitext" type="text" value="${escapeHtml(report.therapiezielFreitext || '')}">

      <label style="margin-top:14px;">Patientencompliance</label>
      ${renderRadioGroup('compliance', Assessment.COMPLIANCE_OPTIONEN, report.compliance)}
      <label for="complianceFreitext">Anmerkung zur Compliance (optional)</label>
      <input id="complianceFreitext" type="text" value="${escapeHtml(report.complianceFreitext || '')}">

      <label style="margin-top:14px;">Verlauf</label>
      ${renderRadioGroup('verlauf', Assessment.VERLAUF_OPTIONEN, report.verlauf)}
      <label for="verlaufFreitext">Anmerkung zum Verlauf (optional)</label>
      <input id="verlaufFreitext" type="text" value="${escapeHtml(report.verlaufFreitext || '')}">

      <label style="margin-top:14px;">Soll die Therapie weitergeführt werden?</label>
      ${renderRadioGroup('therapieWeiterfuehren', Assessment.THERAPIE_WEITERFUEHREN_OPTIONEN, report.therapieWeiterfuehren)}

      <label style="margin-top:14px;">Bringt die Therapie Nutzen?</label>
      ${renderRadioGroup('therapieNutzen', Assessment.THERAPIE_NUTZEN_OPTIONEN, report.therapieNutzen)}

      <h3 style="margin-top:20px;">Teil 3 – Freitext</h3>
      <label for="therapieText">Therapie (Pflichtfeld) – was wurde in der Therapie gemacht</label>
      <textarea id="therapieText" rows="6">${escapeHtml(report.therapieText || '')}</textarea>

      <label for="bemerkungen">Bemerkungen (optional)</label>
      <textarea id="bemerkungen" rows="4">${escapeHtml(report.bemerkungen || '')}</textarea>

      ${report.content ? `
        <details class="accordion" style="margin-top:16px;">
          <summary><span>Alter Berichtstext (vor Umstellung)</span><span class="muted">anzeigen</span></summary>
          <div class="accordion-body"><pre style="white-space:pre-wrap; font:inherit; margin:0;">${escapeHtml(report.content)}</pre></div>
        </details>
      ` : ''}

      <div class="row" style="margin-top:16px; flex-wrap:wrap;">
        <button id="saveDoctorReportEditorBtn">Speichern</button>
        <button id="printDoctorReportEditorBtn" class="secondary">PDF / Drucken</button>
        <button id="deleteDoctorReportEditorBtn" class="secondary">Löschen</button>
      </div>
      <div id="doctorReportEditorMsg" class="${successMsg ? 'success' : ''}">${escapeHtml(successMsg)}</div>
    </div>
  `);
  bindCheckChipToggles(app);

  document.getElementById('backDoctorReportBtn').onclick = () => {
    showArztberichtView({ onLock, homeId, patientId, searchText });
  };

  function collectReportFormValues() {
    return {
      therapieziele: getCheckboxListValues('therapieziel'),
      therapiezielFreitext: document.getElementById('therapiezielFreitext').value.trim(),
      compliance: getRadioValue('compliance'),
      complianceFreitext: document.getElementById('complianceFreitext').value.trim(),
      verlauf: getRadioValue('verlauf'),
      verlaufFreitext: document.getElementById('verlaufFreitext').value.trim(),
      therapieWeiterfuehren: getRadioValue('therapieWeiterfuehren'),
      therapieNutzen: getRadioValue('therapieNutzen'),
      therapieText: document.getElementById('therapieText').value.trim(),
      bemerkungen: document.getElementById('bemerkungen').value.trim()
    };
  }

  document.getElementById('saveDoctorReportEditorBtn').onclick = async () => {
    const msg = document.getElementById('doctorReportEditorMsg');
    msg.className = 'error';
    msg.textContent = '';

    try {
      const values = collectReportFormValues();
      if (!values.therapieText) {
        msg.textContent = 'Bitte das Feld "Therapie" ausfüllen.';
        return;
      }

      mutateRuntimeData((data) => {
        const currentHome = getHomeById(data, homeId);
        const currentPatient = getPatientById(currentHome, patientId);
        const currentRezept = getRezeptById(currentPatient, rezeptId);
        const currentReport = ensureDoctorReportsState(currentRezept).find((item) => item.reportId === reportId);
        if (!currentReport) throw new Error('Bericht nicht gefunden');
        Object.assign(currentReport, values);
        currentReport.updatedAt = new Date().toISOString();
      });
      await queuePersistRuntimeData();
      showDoctorReportEditorView({ onLock, homeId, patientId, rezeptId, reportId, searchText, successMsg: 'Therapiebericht gespeichert.' });
    } catch (err) {
      console.error(err);
      msg.textContent = 'Therapiebericht konnte nicht gespeichert werden.';
    }
  };

  document.getElementById('printDoctorReportEditorBtn').onclick = () => {
    try {
      const currentHome = getHomeById(getRuntimeData(), homeId);
      const currentPatient = getPatientById(currentHome, patientId);
      const currentRezept = getRezeptById(currentPatient, rezeptId);
      const currentReport = ensureDoctorReportsState(currentRezept).find((item) => item.reportId === reportId);
      if (!currentHome || !currentPatient || !currentRezept || !currentReport) throw new Error('Bericht nicht gefunden');
      const previewReport = { ...currentReport, ...collectReportFormValues() };
      openLetterPreview(
        `Therapiebericht ${currentPatient.lastName || ''}`.trim(),
        renderDoctorReportPrintHtml({
          settings: getRuntimeData()?.settings || {},
          patient: { ...currentPatient, homeName: currentHome?.name || '' },
          rezept: currentRezept,
          report: previewReport
        })
      );
    } catch (err) {
      console.error(err);
      alert(err?.message || 'Therapiebericht konnte nicht gedruckt werden.');
    }
  };

  document.getElementById('deleteDoctorReportEditorBtn').onclick = async () => {
    if (!confirm('Diesen Arztbericht wirklich löschen?')) return;
    try {
      mutateRuntimeData((data) => {
        const currentHome = getHomeById(data, homeId);
        const currentPatient = getPatientById(currentHome, patientId);
        const currentRezept = getRezeptById(currentPatient, rezeptId);
        const reports = ensureDoctorReportsState(currentRezept);
        currentRezept.doctorReports = reports.filter((item) => item.reportId !== reportId);
      });
      await queuePersistRuntimeData();
      showArztberichtView({ onLock, homeId, patientId, searchText });
    } catch (err) {
      console.error(err);
      alert(err?.message || 'Arztbericht konnte nicht gelöscht werden.');
    }
  };
}

// Kombinierter Flow: Patient anlegen und Rezept anlegen in einem Schritt
// (statt wie bisher zwei getrennte Vorgänge). Nur manuelle Eingabe (die
// vormalige Fotoerkennung per Kamera/Tesseract.js OCR wurde auf
// Nutzerwunsch komplett entfernt).
export function showCreatePatientRezeptView({ onLock, homeId, searchText = "" }) {
  bindLockButton(onLock);
  setCurrentView("create-patient-rezept", { homeId, searchText });

  const runtimeData = getRuntimeData();
  const home = getHomeById(runtimeData, homeId);
  if (!home) {
    showHomesView({ onLock });
    return;
  }

  function renderCombinedForm() {
    const arztRegistry = getArztRegistry(runtimeData);

    render(`
      <div class="card">
        <h2>Neuen Patienten + Rezept anlegen</h2>
        <p class="muted">${escapeHtml(home.name || "Einrichtung")}</p>
        <button id="backToModeBtn" class="secondary">Zurück zum Heim</button>
      </div>

      <div class="card">
        <h3>Patient</h3>
        <label for="lastName">Nachname</label>
        <input id="lastName" type="text" value="">

        <label for="firstName">Vorname</label>
        <input id="firstName" type="text" value="">

        <label for="anrede">Anrede</label>
        <select id="anrede">
          <option value="">Keine Angabe</option>
          <option value="frau">Frau</option>
          <option value="herr">Herr</option>
        </select>
        <p class="muted">Wird für die automatische Anrede im Arztbericht genutzt.</p>

        <label for="birthDate">Geburtsdatum</label>
        <input id="birthDate" type="text" placeholder="TT.MM.JJJJ" inputmode="numeric" value="">
      </div>

      <div class="card">
        <h3>Rezept</h3>
        <label for="arzt">Arzt</label>
        <input id="arzt" type="text" list="doctorSuggestions" autocomplete="off" value="">
        <datalist id="doctorSuggestions">
          ${getKnownDoctorNames(runtimeData).map((name) => `<option value="${escapeHtml(name)}"></option>`).join("")}
        </datalist>

        ${renderArztAdresseFields("")}

        <label for="ausstell">Ausstellungsdatum</label>
        <input id="ausstell" type="text" placeholder="TT.MM.JJJJ" inputmode="numeric" value="">

        <label for="icd10">ICD-10 Code</label>
        <input id="icd10" type="text" placeholder="z.B. M54.5" value="">

        <label for="icd10b">2. ICD-10 Code (optional)</label>
        <input id="icd10b" type="text" placeholder="z.B. M54.5" value="">

        ${renderLeitsymptomatikField("")}

        <h3 style="margin-top:20px;">Leistungen</h3>
        ${renderRezeptItemsEditor([])}

        <h3 style="margin-top:20px;">Rezeptprüfung</h3>
        <div class="checkbox-row">
          <label class="check-chip"><input id="privat" type="checkbox"> <span>🔒 Privat (keine Prüfung nötig)</span></label>
        </div>
        <div class="checkbox-row">
          <label class="check-chip"><input id="bg" type="checkbox"> <span>BG</span></label>
          <label class="check-chip"><input id="dt" type="checkbox"> <span>Doppeltermin</span></label>
          <label class="check-chip"><input id="dringend" type="checkbox"> <span>Dringender Bedarf</span></label>
        </div>

        <label for="hausbesuch">Hausbesuch (Rezeptvermerk)</label>
        ${renderJaNeinSelect("hausbesuch", "")}

        <label for="arztStempel">Arzt-Stempel vorhanden</label>
        ${renderJaNeinSelect("arztStempel", "")}

        <label for="arztUnterschrift">Arzt-Unterschrift vorhanden</label>
        ${renderJaNeinSelect("arztUnterschrift", "")}

        <div id="rezeptPruefungPanel" style="margin-top:16px;"></div>

        <button id="saveCombinedBtn">Patient + Rezept speichern</button>
        <div id="combinedMsg"></div>
      </div>
    `);

    document.getElementById("backToModeBtn").onclick = () => {
      showHomeDetailView({ onLock, homeId, searchText });
    };

    bindDateAutoFormat(document.getElementById("birthDate"));
    bindDateAutoFormat(document.getElementById("ausstell"));
    bindIcdAutoFormat(document.getElementById("icd10"));
    bindIcdAutoFormat(document.getElementById("icd10b"));
    bindRezeptItemsEditor([]);
    bindCheckChipToggles(app);
    bindQuickDocSelectionStyles(app);
    bindSelectableCardChecks(app);
    bindLeitsymptomatikField();
    bindRezeptPruefungLive("rezeptPruefungPanel");

    const arztInput = document.getElementById("arzt");
    bindArztAdresseAutofill(arztInput, arztRegistry);

    document.getElementById("saveCombinedBtn").onclick = async () => {
      const msg = document.getElementById("combinedMsg");
      msg.className = "error";
      msg.textContent = "";

      const firstName = document.getElementById("firstName").value.trim();
      const lastName = document.getElementById("lastName").value.trim();
      const anrede = document.getElementById("anrede").value;
      const birthDate = document.getElementById("birthDate").value.trim();

      if (!firstName && !lastName) {
        msg.textContent = "Bitte mindestens einen Namen für den Patienten eingeben.";
        return;
      }

      const rezeptPayload = collectRezeptFormPayload();
      if (rezeptPayload.items.length === 0) {
        msg.textContent = "Bitte mindestens eine Leistung angeben.";
        return;
      }

      try {
        const newPatientId = createPatient(homeId, {
          firstName,
          lastName,
          anrede,
          birthDate,
          befreit: false
        });
        createRezept(homeId, newPatientId, rezeptPayload);
        const arztAdresse = collectArztAdresseFromForm();
        const arztEmail = collectArztEmailFromForm();
        if (rezeptPayload.arzt && (arztAdresse || arztEmail)) {
          upsertArztAdresse(rezeptPayload.arzt, arztAdresse, arztEmail);
        }

        await queuePersistRuntimeData();
        showZuzahlungsabfrageView({
          onLock,
          homeId,
          patientId: newPatientId,
          searchText,
          onDone: () => showAssessmentAbfrageView({ onLock, homeId, patientId: newPatientId, searchText })
        });
      } catch (err) {
        console.error(err);
        msg.textContent = "Patient/Rezept konnten nicht gespeichert werden.";
      }
    };
  }

  renderCombinedForm();
}

// Wird direkt nach dem Anlegen eines neuen Patienten aufgerufen (Funktion 3).
// onDone erlaubt es, weitere Abfrage-Schritte anzuhängen (z.B. Funktion 7: Assessment).
export function showZuzahlungsabfrageView({ onLock, homeId, patientId, searchText = "", onDone = null }) {
  bindLockButton(onLock);
  setCurrentView("zuzahlungsabfrage", { homeId, patientId });

  const runtimeData = getRuntimeData();
  const home = getHomeById(runtimeData, homeId);
  const patient = getPatientById(home, patientId);

  if (!home || !patient) {
    showHomeDetailView({ onLock, homeId, searchText });
    return;
  }

  const weiter = onDone || (() => showPatientDetailView({ onLock, homeId, patientId }));

  render(`
    <div class="card">
      <h2>Zuzahlungsstatus</h2>
      <p class="muted">Patient: ${escapeHtml(formatPatientName(patient) || "—")}</p>
    </div>

    <div class="card">
      <h3>Ist der Patient zuzahlungsbefreit?</h3>
      <p class="muted">Bitte mit Stationsleitung oder Büro klären.</p>

      <div class="list-stack" style="margin-top:12px;">
        <button id="zuzahlungJaBtn">Ja</button>
        <button id="zuzahlungNeinBtn" class="secondary">Nein</button>
        <button id="zuzahlungUngeklaertBtn" class="secondary">Noch nicht geklärt</button>
      </div>
      <div id="zuzahlungMsg"></div>
    </div>
  `);

  async function waehleStatus(status) {
    const msg = document.getElementById("zuzahlungMsg");
    try {
      setZuzahlungsstatus(homeId, patientId, status);
      await queuePersistRuntimeData();
      weiter();
    } catch (err) {
      console.error(err);
      msg.className = "error";
      msg.textContent = err?.message || "Zuzahlungsstatus konnte nicht gespeichert werden.";
    }
  }

  document.getElementById("zuzahlungJaBtn").onclick = () => waehleStatus("ja");
  document.getElementById("zuzahlungNeinBtn").onclick = () => waehleStatus("nein");
  document.getElementById("zuzahlungUngeklaertBtn").onclick = () => waehleStatus("ungeklaert");
}

export function showAssessmentEinrichtungAuswahlView({ onLock }) {
  bindLockButton(onLock);
  setCurrentView("assessment-einrichtung-auswahl", {});

  const runtimeData = getRuntimeData();
  const homes = sortHomesAlpha(runtimeData?.homes || []);

  render(`
    <div class="card">
      <h2>Assessment</h2>
      <p class="muted">Einrichtung auswählen</p>
      <button id="backDashboardBtn" class="secondary">Zurück zum Dashboard</button>
    </div>

    <div class="card">
      <h3>Einrichtungen</h3>
      <div class="list-stack">
        ${homes.length === 0 ? `<p class="muted">Noch keine Einrichtungen vorhanden.</p>` : ""}
        ${homes.map(home => `
          <div class="compact-card assessment-home-open-card" data-home-id="${home.homeId}" style="cursor:pointer;">
            <div style="font-weight:700;">${escapeHtml(home.name || "Ohne Name")}</div>
            <div class="compact-meta">${(home.patients || []).filter((patient) => !isPatientDeceased(patient)).length} Patient(en)</div>
          </div>
        `).join("")}
      </div>
    </div>
  `);

  document.getElementById("backDashboardBtn").onclick = () => showDashboardView({ onLock });

  document.querySelectorAll(".assessment-home-open-card").forEach((card) => {
    card.onclick = () => showAssessmentPatientAuswahlView({ onLock, homeId: card.dataset.homeId });
  });
}

export function showAssessmentPatientAuswahlView({ onLock, homeId, searchText = "" }) {
  bindLockButton(onLock);
  setCurrentView("assessment-patient-auswahl", { homeId, searchText });

  const runtimeData = getRuntimeData();
  const home = getHomeById(runtimeData, homeId);

  if (!home) {
    showAssessmentEinrichtungAuswahlView({ onLock });
    return;
  }

  const filteredPatients = sortPatientsAlpha(searchPatientsInHome(home, searchText).filter((patient) => !isPatientDeceased(patient)));

  render(`
    <div class="card">
      <h2>Assessment</h2>
      <p class="muted">${escapeHtml(home.name || "Einrichtung")} – Patient auswählen</p>
      <button id="backEinrichtungAuswahlBtn" class="secondary">Zurück zur Einrichtungsauswahl</button>
    </div>

    <div class="card">
      <h3>Patienten</h3>
      <label for="assessmentPatientSearch">Suche nach Name oder Geburtsdatum</label>
      <input id="assessmentPatientSearch" type="text" value="${escapeHtml(searchText)}" placeholder="z.B. Müller oder 01.01.1950">
      <div class="row">
        <button id="runAssessmentPatientSearchBtn" class="secondary">Suchen</button>
        <button id="clearAssessmentPatientSearchBtn" class="secondary">Suche löschen</button>
      </div>

      <div class="list-stack" style="margin-top:12px;">
        ${filteredPatients.length === 0 ? `<p class="muted">Keine passenden Patienten gefunden.</p>` : ""}
        ${filteredPatients.map(patient => `
          <div class="compact-card assessment-patient-open-card" data-patient-id="${patient.patientId}" style="cursor:pointer;">
            <div style="font-weight:700;">${escapeHtml(`${patient.lastName || ""}, ${patient.firstName || ""}`.replace(/^,\s*/, "").trim() || "Ohne Namen")}</div>
            <div class="compact-meta">${patient.nextAssessmentDueAt ? `Nächstes Assessment fällig ab: ${escapeHtml(formatDeDate(patient.nextAssessmentDueAt))}` : "Kein Folge-Assessment geplant."}</div>
          </div>
        `).join("")}
      </div>
    </div>
  `);

  document.getElementById("backEinrichtungAuswahlBtn").onclick = () => showAssessmentEinrichtungAuswahlView({ onLock });

  document.getElementById("runAssessmentPatientSearchBtn").onclick = () => {
    showAssessmentPatientAuswahlView({ onLock, homeId, searchText: document.getElementById("assessmentPatientSearch").value.trim() });
  };
  document.getElementById("clearAssessmentPatientSearchBtn").onclick = () => {
    showAssessmentPatientAuswahlView({ onLock, homeId, searchText: "" });
  };

  document.querySelectorAll(".assessment-patient-open-card").forEach((card) => {
    card.onclick = () => {
      showAssessmentAbfrageView({
        onLock,
        homeId,
        patientId: card.dataset.patientId,
        onDone: () => showAssessmentPatientAuswahlView({ onLock, homeId })
      });
    };
  });
}

export function showAssessmentAbfrageView({ onLock, homeId, patientId, searchText = "", onDone = null }) {
  bindLockButton(onLock);
  setCurrentView("assessment-abfrage", { homeId, patientId });

  const runtimeData = getRuntimeData();
  const home = getHomeById(runtimeData, homeId);
  const patient = getPatientById(home, patientId);
  const intervalMonths = runtimeData?.settings?.assessmentIntervalMonths || 3;

  if (!home || !patient) {
    showHomeDetailView({ onLock, homeId, searchText });
    return;
  }

  const weiter = onDone || (() => showPatientDetailView({ onLock, homeId, patientId }));

  // Setzt den laufenden Wizard-Zustand aus einem gespeicherten Zwischenstand
  // wieder ein und springt an die dazu passende Stelle: ist der Bereich
  // (weiche) bereits bekannt, direkt in dessen ersten Schritt (die davor
  // liegenden Ebene0/Barthel/Schmerz/TUG-Werte sind im wiederhergestellten
  // wizard-Objekt bereits enthalten und müssen nicht erneut abgefragt
  // werden) - sonst zurück zur Bereichsauswahl bzw. Ebene 0, je nachdem wie
  // der Durchlauf begonnen hatte. Einzelne Unterschritte innerhalb eines
  // Bereichs (z.B. "mitten in der ROM-Bewertung") werden bewusst nicht exakt
  // wiederhergestellt, um die Komplexität gering zu halten - stattdessen
  // zeigt jeder Schritt beim erneuten Durchklicken bereits die vorher
  // eingegebenen Werte an.
  function resumeDraft(draft) {
    Object.assign(wizard, draft.wizard);
    stepBbs14();
  }

  function renderFrage() {
    const existingAssessments = [...(patient.assessments || [])]
      .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
    const hasExisting = existingAssessments.length > 0;
    const draft = patient.assessmentDraft;

    render(`
      <div class="card">
        <h2>Assessment</h2>
        <p class="muted">Patient: ${escapeHtml(formatPatientName(patient) || "—")}</p>
      </div>

      ${draft ? `
      <div class="card">
        <h3>Unvollständige Erfassung gefunden</h3>
        <p class="muted">Zuletzt bearbeitet: ${escapeHtml(formatIsoDateShort(draft.updatedAt))}${draft.stepTitle ? ` · ${escapeHtml(draft.stepTitle)}` : ""}</p>
        <div class="row">
          <button id="assessmentDraftFortsetzenBtn">Fortsetzen</button>
          <button id="assessmentDraftVerwerfenBtn" class="secondary">Verwerfen &amp; neu beginnen</button>
        </div>
      </div>
      ` : `
      <div class="card">
        <h3>Assessment jetzt durchführen?</h3>
        <div class="row">
          <button id="assessmentJetztBtn">Jetzt durchführen</button>
          <button id="assessmentSpaeterBtn" class="secondary">Später</button>
        </div>
        ${hasExisting ? `
        <div class="row" style="margin-top:12px;">
          <button id="assessmentZusammenfassungBtn" class="secondary">Letztes Assessment ansehen (${escapeHtml(formatDeDate(existingAssessments[0].date) || "—")})</button>
        </div>
        ` : ""}
        <div class="row" style="margin-top:12px;">
          <button id="assessmentAbbrechenBtn" class="secondary">Abbrechen</button>
        </div>
      </div>
      `}
    `);

    if (draft) {
      document.getElementById("assessmentDraftFortsetzenBtn").onclick = () => resumeDraft(draft);
      document.getElementById("assessmentDraftVerwerfenBtn").onclick = async () => {
        try {
          clearAssessmentDraft(homeId, patientId);
          await queuePersistRuntimeData();
          patient.assessmentDraft = null;
          renderFrage();
        } catch (err) {
          console.error(err);
          alert(err?.message || "Zwischenstand konnte nicht verworfen werden.");
        }
      };
      return;
    }

    document.getElementById("assessmentJetztBtn").onclick = () => stepBbs14();
    document.getElementById("assessmentSpaeterBtn").onclick = () => renderSpaeter();
    document.getElementById("assessmentAbbrechenBtn").onclick = () => weiter();
    if (hasExisting) {
      document.getElementById("assessmentZusammenfassungBtn").onclick = () => renderZusammenfassung(existingAssessments[0]);
    }
  }

  // Zusammenfassung des zuletzt durchgeführten Assessments - bislang war
  // von hier aus nur ein komplett neues Assessment möglich, ein bereits
  // vorhandenes ließ sich nur über den Umweg der Patientendetailseite
  // einsehen.
  function renderZusammenfassung(latest) {
    const summary = buildAssessmentSummaryLines(patient);
    const weicheLabel = Assessment.WEICHEN_OPTIONEN.find((w) => w.val === latest.weiche)?.label || "Basis";

    render(`
      <div class="card">
        <h2>Letztes Assessment</h2>
        <p class="muted">Patient: ${escapeHtml(formatPatientName(patient) || "—")} · ${escapeHtml(formatDeDate(latest.date) || "—")} · ${escapeHtml(weicheLabel)}</p>
        <button id="backToAssessmentFrageBtn" class="secondary">Zurück</button>
      </div>

      <div class="card">
        ${summary && summary.lines.length ? `
          <div class="list-stack">
            ${summary.lines.map((l) => `
              <div>${ampelBadgeHtml(l.ampel)} <strong>${escapeHtml(l.text)}</strong>${l.deltaText ? ` <span class="muted">(${escapeHtml(l.deltaText)})</span>` : ""}</div>
            `).join("")}
          </div>
        ` : `<p class="muted">Keine auswertbaren Ergebnisse für dieses Assessment.</p>`}
      </div>
    `);

    document.getElementById("backToAssessmentFrageBtn").onclick = () => renderFrage();
  }

  // ---------- Geführter Assessment-Wizard ----------
  // Auf Nutzerwunsch reduziert auf ausschließlich den Berg-Balance-Test
  // (vollständige 14-Item-Version, siehe modules/assessment.js BBS_ITEMS) -
  // alle früheren Domänen (Ebene0, Barthel, Schmerz, TUG, Weichenscreen,
  // BBS-7/RMI/MRC, SPPB/ROM, Kontrakturen/Dekubitus) wurden aus dem Wizard
  // entfernt. Bereits vorhandene alte Assessments mit diesen Feldern bleiben
  // unverändert in der Historie sichtbar (siehe extractAssessmentScores()).
  const wizard = {
    date: getComparableFromDate(new Date()),
    weiche: "bbs",
    bbs14: {}
  };

  // Zwischenspeichern: bei jedem Schrittwechsel wird der aktuelle Wizard-
  // Zustand in patient.assessmentDraft gesichert (fire-and-forget, blockiert
  // die Anzeige nicht) - ein Auto-Lock oder Schließen der App mitten in der
  // Erfassung führt dadurch nicht mehr zum kompletten Verlust der bereits
  // eingegebenen Werte (siehe renderFrage()/resumeDraft() für den Wiedereinstieg).
  function persistDraft(stepTitle) {
    try {
      saveAssessmentDraft(homeId, patientId, {
        wizard: JSON.parse(JSON.stringify(wizard)),
        stepTitle,
        updatedAt: new Date().toISOString()
      });
      queuePersistRuntimeData();
    } catch (err) {
      console.error("Assessment-Zwischenspeicherung fehlgeschlagen", err);
    }
  }

  function wizardCard(title, bodyHtml, infoKey = null) {
    persistDraft(title);
    const info = infoKey ? AssessmentInfo.TEST_INFO[infoKey] : null;
    render(`
      <div class="card">
        <h2>Assessment durchführen</h2>
        <p class="muted">Patient: ${escapeHtml(formatPatientName(patient) || "—")} · ${escapeHtml(title)}</p>
      </div>
      <div class="card">
        ${info ? `
          <details class="accordion" style="margin-bottom:16px;">
            <summary>
              <span>ℹ️ ${escapeHtml(info.title)}</span>
              <span class="muted">Durchführung &amp; Werte</span>
            </summary>
            <div class="accordion-body">
              <h4 style="margin-top:0;">Durchführung</h4>
              <ul style="margin:0 0 12px; padding-left:20px;">
                ${info.durchfuehrung.map((point) => `<li>${escapeHtml(point)}</li>`).join("")}
              </ul>
              <h4>Werteinterpretation</h4>
              <ul style="margin:0; padding-left:20px;">
                ${info.interpretation.map((point) => `<li>${escapeHtml(point)}</li>`).join("")}
              </ul>
            </div>
          </details>
        ` : ""}
        ${bodyHtml}
      </div>
    `);
  }

  // ---------- Berg-Balance-Test (vollständige 14-Item-Version) ----------
  function stepBbs14() {
    wizardCard("Berg-Balance-Test", `
      <p class="muted">Jedes Item wird mit 0-4 Punkten bewertet - die Bedeutung jeder Punktzahl steht direkt beim jeweiligen Item.</p>
      ${Assessment.BBS_ITEMS.map((item, idx) => {
        const entry = wizard.bbs14[item.key] || {};
        return `
          <div class="compact-card" style="margin-bottom:8px;">
            <div style="font-weight:600; margin-bottom:4px;">${idx + 1}. ${escapeHtml(item.label)}</div>
            <div class="compact-meta" style="margin-bottom:8px;">${escapeHtml(item.aufgabe)}</div>
            <label class="check-chip" style="justify-content:flex-start; margin-bottom:6px;">
              <input type="checkbox" class="bbs14-nd" data-key="${item.key}" ${entry.nichtDurchfuehrbar ? "checked" : ""}> <span>Nicht durchführbar</span>
            </label>
            <div class="bbs14-score-wrap-${item.key}" style="${entry.nichtDurchfuehrbar ? "display:none;" : ""}">
              <div class="list-stack">
                ${item.scores.map((s) => `
                  <label class="check-chip" style="justify-content:flex-start; margin-bottom:4px;">
                    <input type="radio" name="bbs14-${item.key}" value="${s.val}" ${Number(entry.score) === s.val ? "checked" : ""}>
                    <span><strong>${s.val}</strong> – ${escapeHtml(s.text)}</span>
                  </label>
                `).join("")}
              </div>
            </div>
          </div>
        `;
      }).join("")}
      <div class="row" style="margin-top:16px;">
        <button id="wizardAbbrechen" class="secondary">Abbrechen</button>
        <button id="wizardNext">Weiter</button>
      </div>
      <div id="wizardMsg" class="error"></div>
    `, "bbs14");
    bindCheckChipToggles(app);
    document.querySelectorAll(".bbs14-nd").forEach((cb) => {
      cb.addEventListener("change", () => {
        document.querySelector(`.bbs14-score-wrap-${cb.dataset.key}`).style.display = cb.checked ? "none" : "block";
      });
    });

    document.getElementById("wizardAbbrechen").onclick = () => weiter();
    document.getElementById("wizardNext").onclick = () => {
      const msg = document.getElementById("wizardMsg");
      const result = {};
      for (const item of Assessment.BBS_ITEMS) {
        const nd = document.querySelector(`.bbs14-nd[data-key="${item.key}"]`).checked;
        if (nd) {
          result[item.key] = { score: null, nichtDurchfuehrbar: true };
          continue;
        }
        const raw = getRadioValue(`bbs14-${item.key}`);
        if (raw === "") {
          msg.textContent = `Bitte "${item.label}" bewerten oder als nicht durchführbar markieren.`;
          return;
        }
        result[item.key] = { score: Number(raw), nichtDurchfuehrbar: false };
      }
      wizard.bbs14 = result;
      stepReview();
    };
  }


  // ---------- Zusammenfassung & Speichern ----------
  function stepReview() {
    const bbs = Assessment.computeBbsTotal(wizard.bbs14);

    wizardCard("Zusammenfassung", `
      <p><strong>Berg-Balance-Test:</strong> ${bbs.total}/${bbs.maxPossible} – ${escapeHtml(Assessment.classifyBbs(bbs.total, bbs.maxPossible))}${bbs.notDurchfuehrbar ? ` (${bbs.notDurchfuehrbar} Item(s) nicht durchführbar)` : ""}</p>

      <div class="row" style="margin-top:16px;">
        <button id="wizardBack" class="secondary">Zurück</button>
        <button id="assessmentSpeichernBtn">Assessment speichern</button>
      </div>
      <div id="wizardMsg" class="error"></div>
    `);

    document.getElementById("wizardBack").onclick = () => stepBbs14();
    document.getElementById("assessmentSpeichernBtn").onclick = async () => {
      const msg = document.getElementById("wizardMsg");
      try {
        saveAssessmentResult(homeId, patientId, wizard, intervalMonths);
        clearAssessmentDraft(homeId, patientId);
        await queuePersistRuntimeData();
        weiter();
      } catch (err) {
        console.error(err);
        msg.textContent = err?.message || "Assessment konnte nicht gespeichert werden.";
      }
    };
  }

  function renderSpaeter() {
    render(`
      <div class="card">
        <h2>Assessment später durchführen</h2>
        <p class="muted">Wann möchtest du das Assessment durchführen?</p>
      </div>

      <div class="card">
        <label for="assessmentSpaeterDatum">Datum</label>
        <input id="assessmentSpaeterDatum" type="text" placeholder="TT.MM.JJJJ" inputmode="numeric">
        <p class="muted">Die Erinnerung erscheint erst ab diesem Datum in der App – keine wöchentliche Wiederholung vorher.</p>
        <div class="row" style="margin-top:12px;">
          <button id="assessmentSpaeterZurueckBtn" class="secondary">Zurück</button>
          <button id="assessmentSpaeterSpeichernBtn">Speichern</button>
        </div>
        <div id="assessmentSpaeterMsg" class="error"></div>
      </div>
    `);

    bindDateAutoFormat(document.getElementById("assessmentSpaeterDatum"));

    document.getElementById("assessmentSpaeterZurueckBtn").onclick = () => renderFrage();
    document.getElementById("assessmentSpaeterSpeichernBtn").onclick = async () => {
      const msg = document.getElementById("assessmentSpaeterMsg");
      const value = document.getElementById("assessmentSpaeterDatum").value.trim();
      const parsed = parseDeDate(value);
      if (!parsed) {
        msg.textContent = "Bitte ein gültiges Datum eingeben.";
        return;
      }

      try {
        scheduleAssessment(homeId, patientId, parsed);
        await queuePersistRuntimeData();
        weiter();
      } catch (err) {
        console.error(err);
        msg.textContent = err?.message || "Termin konnte nicht gespeichert werden.";
      }
    };
  }

  renderFrage();
}

// Patient-/Rezept-Detailseiten sind auf zwei Wegen erreichbar: über die
// Einrichtung (Heim -> Patient) oder direkt über die Dashboard-weite
// Patientenliste (Patient ohne Umweg über sein Heim). returnTo trägt fest,
// welcher der beiden Wege es war, damit "Zurück" den Nutzer dahin
// zurückbringt, wo er wirklich herkam, statt ihn immer über das Heim und
// die Einrichtungsliste zum Dashboard durchzureichen.
function goBackFromPatient({ onLock, homeId, returnTo }) {
  if (returnTo?.from === "patienten-liste") {
    showPatientenListeView({ onLock, searchText: returnTo.searchText || "" });
  } else {
    showHomeDetailView({ onLock, homeId });
  }
}

export function showPatientDetailView({ onLock, homeId, patientId, returnTo = null }) {
  bindLockButton(onLock);
  setCurrentView("patient-detail", { homeId, patientId, returnTo });

  const runtimeData = getRuntimeData();
  const home = getHomeById(runtimeData, homeId);
  const patient = getPatientById(home, patientId);

  if (!home || !patient) {
    goBackFromPatient({ onLock, homeId, returnTo });
    return;
  }

  const rezepteSorted = sortRezepteForDisplay(patient.rezepte || []);
  const rezepte = rezepteSorted.filter((rezept) => rezept.abgegeben !== true);
  const abgegebeneRezepte = rezepteSorted.filter((rezept) => rezept.abgegeben === true);

  // Doku-Übernahme: da sich die Therapie oft wiederholt, soll ein bereits
  // geschriebener SchnellDoku-Text mit einem Klick auch für einen späteren
  // Tag übernommen werden können, statt ihn jedes Mal neu zu tippen - flacht
  // dafür die Dokumentationseinträge aller Rezepte des Patienten zu einer
  // chronologischen Liste ab (neuester zuerst).
  const todayDe = formatCurrentDateShort();
  const allDokuEntries = (patient.rezepte || []).flatMap((rezept) =>
    (rezept.entries || []).map((entry) => ({
      ...entry,
      rezeptId: rezept.rezeptId,
      rezeptLabel: rezeptSummary(rezept),
      rezeptAbgegeben: rezept.abgegeben === true
    }))
  ).sort((a, b) => compareDeDates(b.date, a.date) || String(b.createdAt || "").localeCompare(String(a.createdAt || "")));

  render(`
    <div class="card">
      <h2>${escapeHtml(formatPatientName(patient) || "Patient")}</h2>
      <p class="muted">Heim: ${escapeHtml(home.name || "—")}</p>
      <button id="backHomeDetailBtn" class="secondary">${returnTo?.from === "patienten-liste" ? "Zurück zu Patienten" : "Zurück zum Heim"}</button>
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
                <span>${escapeHtml(rezeptSummary(rezept))} · ${escapeHtml(rezept.ausstell || '—')}</span>
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

    <details class="accordion" style="margin-top:12px;">
      <summary>
        <span>Doku</span>
        <span class="muted">${allDokuEntries.length}</span>
      </summary>
      <div class="accordion-body">
        ${allDokuEntries.length === 0 ? `<p class="muted">Noch keine Dokumentationseinträge vorhanden.</p>` : `
          <div class="list-stack">
            ${allDokuEntries.map((entry) => `
              <div class="compact-card" style="margin:0;">
                <div style="font-weight:700; margin-bottom:4px;">${escapeHtml(entry.date || "—")}</div>
                <div class="compact-meta" style="margin-bottom:8px;">${escapeHtml(entry.rezeptLabel || "—")}${entry.rezeptAbgegeben ? " · abgegeben" : ""}</div>
                <div style="white-space:pre-wrap;">${escapeHtml(entry.text || "—")}</div>
                ${entry.date === todayDe || entry.rezeptAbgegeben
                  ? `<div class="compact-meta" style="margin-top:10px;">${entry.date === todayDe ? "Bereits von heute." : "Rezept ist abgegeben."}</div>`
                  : `<button class="dokuUebernehmenBtn secondary" data-rezept-id="${escapeHtml(entry.rezeptId)}" data-entry-id="${escapeHtml(entry.entryId)}" style="margin-top:10px; width:100%;">Für heute übernehmen</button>`
                }
              </div>
            `).join("")}
          </div>
        `}
      </div>
    </details>

    <details class="accordion" style="margin-top:12px;">
      <summary>
        <span>Abgegebene Rezepte</span>
        <span class="muted">${abgegebeneRezepte.length}</span>
      </summary>
      <div class="accordion-body">
        <div class="list-stack">
          ${abgegebeneRezepte.length === 0 ? `<p class="muted" style="margin:0;">Keine abgegebenen Rezepte.</p>` : ""}
          ${abgegebeneRezepte.map(rezept => {
            const frist = getRezeptFristInfo(rezept);
            return `
              <details class="accordion">
                <summary>
                  <span>${escapeHtml(rezeptSummary(rezept))} · ${escapeHtml(rezept.ausstell || '—')}</span>
                  <span class="muted">Abgegeben</span>
                </summary>
                <div class="accordion-body">
                  ${renderRezeptMarkerLine(rezept, frist)}
                  <div class="compact-meta">
                    Arzt: ${escapeHtml(rezept.arzt || "—")}<br>
                    Ausstellung: ${escapeHtml(rezept.ausstell || "—")}<br>
                    Doku-Einträge: ${rezept.entries?.length || 0}<br>
                    Zeit gesamt: ${escapeHtml(formatMinutesLabel(getRezeptTimeSummary(rezept).totalMinutes))}
                  </div>
                  <div class="row" style="margin-top:10px;">
                    <button class="openRezeptBtn" data-rezept-id="${rezept.rezeptId}">Rezept öffnen</button>
                  </div>
                </div>
              </details>
            `;
          }).join("")}
        </div>
      </div>
    </details>

    <details class="accordion">
      <summary>
        <span>Assessments</span>
        <span class="muted">${(patient.assessments || []).length}</span>
      </summary>
      <div class="accordion-body">
        <p class="muted">${patient.nextAssessmentDueAt ? `Nächstes Assessment fällig ab: ${escapeHtml(formatDeDate(patient.nextAssessmentDueAt))}` : "Kein Folge-Assessment geplant."}</p>
        ${patient.assessmentMrcPosition ? `<p class="muted">MRC-Testposition (fixiert): ${patient.assessmentMrcPosition === "liegen" ? "Liegen" : "Sitzen"}</p>` : ""}
        <p class="muted">Assessments werden über den Dashboard-Button „Assessment" gestartet.</p>
        ${renderAssessmentHistorySection(patient)}
      </div>
    </details>

    <details class="accordion">
      <summary>
        <span>Stammdaten</span>
        <span class="muted">anzeigen</span>
      </summary>
      <div class="accordion-body">
        <p><strong>Nachname:</strong> ${escapeHtml(patient.lastName || "—")}</p>
        <p><strong>Vorname:</strong> ${escapeHtml(patient.firstName || "—")}</p>
        <p><strong>Geburtsdatum:</strong> ${escapeHtml(patient.birthDate || "—")}</p>
        <p><strong>Befreit:</strong> ${patient.befreit ? "Ja" : "Nein"}</p>
        <p><strong>Verstorben:</strong> ${patient.verstorben ? "Ja" : "Nein"}</p>
        <p><strong>Ausgeschieden:</strong> ${patient.ausgeschieden ? "Ja" : "Nein"}</p>
        <button id="deletePatientBtn" class="danger" style="margin-top:16px; width:100%;">Patient löschen</button>
      </div>
    </details>
  `);

  document.getElementById("backHomeDetailBtn").onclick = () => {
    goBackFromPatient({ onLock, homeId, returnTo });
  };

  document.getElementById("openCreateRezeptBtn").onclick = () => {
    showCreateRezeptView({ onLock, homeId, patientId, returnTo });
  };

  document.getElementById("deletePatientBtn").onclick = async () => {
    const patientLabel = formatPatientName(patient) || "Patient";
    const ok = confirm(`${patientLabel} wirklich löschen? Alle Rezepte und Dokumentationen dieses Patienten werden ebenfalls gelöscht.`);
    if (!ok) return;

    try {
      deletePatient(homeId, patientId);
      await queuePersistRuntimeData();
      goBackFromPatient({ onLock, homeId, returnTo });
    } catch (err) {
      console.error(err);
      alert(err?.message || "Patient konnte nicht gelöscht werden.");
    }
  };

  document.querySelectorAll(".openRezeptBtn").forEach((btn) => {
    btn.onclick = () => {
      showRezeptDetailView({
        onLock,
        homeId,
        patientId,
        rezeptId: btn.dataset.rezeptId,
        returnTo
      });
    };
  });

  document.querySelectorAll(".editRezeptBtn").forEach((btn) => {
    btn.onclick = () => {
      showEditRezeptView({
        onLock,
        homeId,
        patientId,
        rezeptId: btn.dataset.rezeptId,
        returnTo
      });
    };
  });

  document.querySelectorAll(".dokuUebernehmenBtn").forEach((btn) => {
    btn.onclick = async () => {
      const sourceEntry = allDokuEntries.find((e) => e.entryId === btn.dataset.entryId && e.rezeptId === btn.dataset.rezeptId);
      if (!sourceEntry) return;

      try {
        createRezeptEntry(homeId, patientId, btn.dataset.rezeptId, { date: formatCurrentDateShort(), text: sourceEntry.text });
        await queuePersistRuntimeData();
        showPatientDetailView({ onLock, homeId, patientId, returnTo });
      } catch (err) {
        console.error(err);
        alert(err?.message || "Eintrag konnte nicht übernommen werden.");
      }
    };
  });
}

function renderOptimierungErgebnisCard(ergebnis, { primary = false } = {}) {
  const heilmittelLabel = VERGUETUNG[ergebnis.empfehlung]?.label || ergebnis.empfehlung;
  return `
    <div class="compact-card selectable-card" style="${primary ? 'border-color:var(--primary);' : ''}">
      <p style="margin:0;"><strong>${escapeHtml(heilmittelLabel)}</strong></p>
      <div class="compact-meta" style="margin-top:6px;">
        Diagnose: ${escapeHtml(ergebnis.diagnose || "—")}<br>
        ICD-10: ${escapeHtml(ergebnis.icd)} · Gruppe: ${escapeHtml(ergebnis.gruppeLabel || ergebnis.gruppe)}<br>
        Max. je VO: ${ergebnis.maxProVO}x · Orient. Menge: ${ergebnis.orientierendeMenge} Einheiten
        ${ergebnis.lhb ? `<br><span class="pill-green">LHB möglich</span>` : ""}
        ${ergebnis.bvb ? `<br><span class="pill-orange">Besonderer Verordnungsbedarf: ${escapeHtml(ergebnis.bvb)}</span>` : ""}
      </div>
      <div class="row" style="margin-top:10px;">
        <button class="optimierungUebernehmenBtn" data-icd="${escapeHtml(ergebnis.icd)}" data-empfehlung="${escapeHtml(ergebnis.empfehlung)}" data-gruppe="${escapeHtml(ergebnis.gruppe)}" data-gruppelabel="${escapeHtml(ergebnis.gruppeLabel || '')}" data-maxprovo="${ergebnis.maxProVO}" data-orientierendemenge="${ergebnis.orientierendeMenge}" data-lhb="${ergebnis.lhb ? '1' : '0'}" data-eingabe="${escapeHtml(ergebnis.eingabe || ergebnis.icd)}">Übernehmen</button>
        <button class="optimierungPdfBtn secondary" data-icd="${escapeHtml(ergebnis.icd)}" data-empfehlung="${escapeHtml(ergebnis.empfehlung)}" data-gruppe="${escapeHtml(ergebnis.gruppe)}" data-gruppelabel="${escapeHtml(ergebnis.gruppeLabel || '')}" data-maxprovo="${ergebnis.maxProVO}" data-orientierendemenge="${ergebnis.orientierendeMenge}" data-diagnose="${escapeHtml(ergebnis.diagnose || '')}" data-lhb="${ergebnis.lhb ? '1' : '0'}" data-bvb="${escapeHtml(ergebnis.bvb || '')}">PDF für Arzt-Fax</button>
      </div>
    </div>
  `;
}

export function showRezeptoptimierungView({ onLock, homeId, patientId, returnTo = null }) {
  bindLockButton(onLock);
  setCurrentView("rezept-optimierung", { homeId, patientId, returnTo });

  const runtimeData = getRuntimeData();
  const home = getHomeById(runtimeData, homeId);
  const patient = getPatientById(home, patientId);

  if (!home || !patient) {
    goBackFromPatient({ onLock, homeId, returnTo });
    return;
  }

  const zertifikate = runtimeData?.settings?.zertifikate || { kgzns: false, mt: false, mld: false };
  const gespeicherteZuordnungen = patient.diagnoseZuordnung || [];
  let diagnoseListe = [];

  function renderZertifikateHinweis() {
    const aktiv = [
      zertifikate.kgzns ? "KG-ZNS" : null,
      zertifikate.mt ? "MT" : null,
      zertifikate.mld ? "MLD" : null
    ].filter(Boolean);
    return aktiv.length === 0
      ? `<p class="muted">Keine Zusatz-Zertifikate hinterlegt – Vorschläge basieren nur auf KG. In den Einstellungen ergänzbar.</p>`
      : `<p class="muted">Aktive Zertifikate: ${aktiv.map((z) => `<span class="pill">${escapeHtml(z)}</span>`).join(" ")}</p>`;
  }

  function renderDiagnoseChips() {
    if (diagnoseListe.length === 0) {
      return `<p class="muted" style="margin:0;">Noch keine Diagnosen eingegeben.</p>`;
    }
    return diagnoseListe.map((eingabe, idx) => `
      <span class="pill-blue" style="display:inline-flex; align-items:center; gap:6px;">
        ${escapeHtml(eingabe)}
        <button type="button" class="removeDiagnoseBtn" data-idx="${idx}" style="width:auto; margin:0; padding:0 4px; background:none; color:inherit; font-weight:700;">×</button>
      </span>
    `).join(" ");
  }

  function refreshDiagnoseChips() {
    const container = document.getElementById("diagnoseChipsContainer");
    if (!container) return;
    container.innerHTML = renderDiagnoseChips();
    container.querySelectorAll(".removeDiagnoseBtn").forEach((btn) => {
      btn.onclick = () => {
        diagnoseListe.splice(Number(btn.dataset.idx), 1);
        refreshDiagnoseChips();
      };
    });
  }

  function buildOptimierungLetterHtml(ergebnis) {
    const settings = runtimeData?.settings || {};
    const patientName = `${patient.lastName || ""}, ${patient.firstName || ""}`.replace(/^,\s*/, "").trim() || "—";
    const heilmittelLabel = EMPFEHLUNG_ZU_ITEM_TYPE[ergebnis.empfehlung] || ergebnis.empfehlung;
    const leitsymptomatik = getDefaultLeitsymptomatik(ergebnis.gruppe);
    const empfohleneMenge = ergebnis.lhb ? (ergebnis.orientierendeMenge || ergebnis.maxProVO) : ergebnis.maxProVO;

    return `
      <h1>Verordnungsvorschlag</h1>
      <p class="muted">Erstellt am ${escapeHtml(formatDeDate(new Date()))} · ${escapeHtml(settings.therapistName || "")}</p>

      <p>Sehr geehrte Damen und Herren,</p>
      <p>
        wir bitten Sie freundlich, für den/die Patient/in <strong>${escapeHtml(patientName)}</strong>${patient.birthDate ? ` (geb. ${escapeHtml(patient.birthDate)})` : ""}
        eine physiotherapeutische Verordnung gemäß Heilmittelkatalog auszustellen. Nachfolgend unser Vorschlag auf Basis der vorliegenden Diagnose:
      </p>

      ${ergebnis.lhb ? `<p><strong>Hinweis:</strong> Die genannte Diagnose berechtigt zum langfristigen Heilmittelbedarf (§ 32 Abs. 1a SGB V) – kein Regress für den Arzt.</p>` : ""}

      <table>
        <tr><th>Patient/in</th><td>${escapeHtml(patientName)}</td></tr>
        <tr><th>Geburtsdatum</th><td>${escapeHtml(patient.birthDate || "—")}</td></tr>
        <tr><th>Heim / Einrichtung</th><td>${escapeHtml(home.name || "—")}</td></tr>
        <tr><th>Heilmittel</th><td>${escapeHtml(heilmittelLabel)}</td></tr>
        <tr><th>Diagnosegruppe</th><td>${escapeHtml(ergebnis.gruppe)} – ${escapeHtml(ergebnis.gruppeLabel || "")}</td></tr>
        <tr><th>ICD-10-Code</th><td>${escapeHtml(ergebnis.icd)}${ergebnis.diagnose ? ` (${escapeHtml(ergebnis.diagnose)})` : ""}</td></tr>
        <tr><th>Leitsymptomatik</th><td>${escapeHtml(leitsymptomatik)}</td></tr>
        <tr><th>Behandlungseinheiten</th><td>${empfohleneMenge}x</td></tr>
        <tr><th>Hausbesuch</th><td>Ja</td></tr>
        <tr><th>LHB</th><td>${ergebnis.lhb ? "Ja" : "Nein"}</td></tr>
      </table>

      ${ergebnis.bvb ? `<p class="muted">Besonderer Verordnungsbedarf: ${escapeHtml(ergebnis.bvb)}</p>` : ""}

      <p style="margin-top:20px;">Wir danken Ihnen herzlich für Ihre Unterstützung und stehen bei Rückfragen jederzeit gerne zur Verfügung.</p>
      <p>Mit freundlichen Grüßen<br>${escapeHtml(settings.therapistName || "")}${settings.therapistFax ? `<br>Fax: ${escapeHtml(settings.therapistFax)}` : ""}</p>
    `;
  }

  function bindErgebnisActions(container) {
    container.querySelectorAll(".optimierungUebernehmenBtn").forEach((btn) => {
      btn.onclick = async () => {
        const icd10 = btn.dataset.icd;
        const empfehlung = btn.dataset.empfehlung;
        const gruppe = btn.dataset.gruppe;
        const gruppeLabel = btn.dataset.gruppelabel;
        const maxProVO = btn.dataset.maxprovo;
        const orientierendeMenge = btn.dataset.orientierendemenge;
        const lhb = btn.dataset.lhb === "1";
        const eingabe = btn.dataset.eingabe;
        // Bei langfristigem Heilmittelbedarf (LHB) darf die verordnete Menge
        // über dem Regelfall-Höchstwert je VO liegen (orientierende Menge
        // aus dem Heilmittelkatalog statt pauschal maxProVO).
        const empfohleneMenge = lhb ? (orientierendeMenge || maxProVO) : maxProVO;

        try {
          saveDiagnoseZuordnung(homeId, patientId, {
            input: eingabe,
            icd10,
            gruppe,
            gruppeLabel,
            empfehlung
          });
          await queuePersistRuntimeData();

          showCreateRezeptView({
            onLock,
            homeId,
            patientId,
            returnTo,
            prefill: {
              icd10,
              leitsymptomatik: getDefaultLeitsymptomatik(gruppe),
              itemType: EMPFEHLUNG_ZU_ITEM_TYPE[empfehlung] || "KG",
              count: empfohleneMenge || ""
            }
          });
        } catch (err) {
          console.error(err);
          alert(err?.message || "Diagnose-Zuordnung konnte nicht gespeichert werden.");
        }
      };
    });

    container.querySelectorAll(".optimierungPdfBtn").forEach((btn) => {
      btn.onclick = () => {
        const ergebnis = {
          icd: btn.dataset.icd,
          empfehlung: btn.dataset.empfehlung,
          gruppe: btn.dataset.gruppe,
          gruppeLabel: btn.dataset.gruppelabel,
          maxProVO: btn.dataset.maxprovo,
          orientierendeMenge: btn.dataset.orientierendemenge,
          diagnose: btn.dataset.diagnose,
          lhb: btn.dataset.lhb === "1",
          bvb: btn.dataset.bvb || null
        };
        const bodyHtml = buildOptimierungLetterHtml(ergebnis);
        openHtmlDocument("Verordnungsvorschlag", bodyHtml, { autoPrint: false });
      };
    });
  }

  function runOptimierung() {
    const ergebnisContainer = document.getElementById("optimierungErgebnisContainer");
    if (!ergebnisContainer) return;

    if (diagnoseListe.length === 0) {
      ergebnisContainer.innerHTML = `<p class="error">Bitte mindestens eine Diagnose eingeben.</p>`;
      return;
    }

    const ergebnisse = optimiereVerordnung(diagnoseListe, zertifikate);
    const bekannte = ergebnisse.filter((e) => !e.unbekannt);
    const unbekannte = ergebnisse.filter((e) => e.unbekannt);

    if (bekannte.length === 0) {
      ergebnisContainer.innerHTML = `<p class="error">Keine der eingegebenen Diagnosen konnte zugeordnet werden. Bitte ICD-10-Code direkt eingeben oder Formulierung anpassen.</p>`;
      return;
    }

    const beste = bekannte[0];
    const alternativen = bekannte.slice(1);

    ergebnisContainer.innerHTML = `
      <h3 style="margin-top:20px;">✓ Beste Verordnung</h3>
      ${renderOptimierungErgebnisCard(beste, { primary: true })}
      ${alternativen.length > 0 ? `
        <h3 style="margin-top:20px;">Weitere Optionen</h3>
        <div class="list-stack">${alternativen.map((e) => renderOptimierungErgebnisCard(e)).join("")}</div>
      ` : ""}
      ${unbekannte.length > 0 ? `
        <p class="error" style="margin-top:16px;">Nicht erkannt: ${unbekannte.map((e) => escapeHtml(e.eingabe || e.icd)).join(", ")} – bitte ICD-10-Code direkt eingeben oder manuell prüfen.</p>
      ` : ""}
    `;

    bindErgebnisActions(ergebnisContainer);
  }

  render(`
    <div class="card">
      <h2>Rezeptoptimierung</h2>
      <p class="muted">Patient: ${escapeHtml(formatPatientName(patient) || "—")}</p>
      <button id="backPatientBtn" class="secondary">Zurück zum Patienten</button>
    </div>

    <div class="card">
      <h3>Zertifikate</h3>
      ${renderZertifikateHinweis()}
    </div>

    ${gespeicherteZuordnungen.length > 0 ? `
      <div class="card">
        <h3>Zuletzt verwendete Diagnosen</h3>
        <div class="list-stack">
          ${gespeicherteZuordnungen.slice(0, 5).map((item) => `
            <div class="compact-card" style="display:flex; justify-content:space-between; align-items:center; gap:10px;">
              <div style="min-width:0;">
                <div style="font-weight:600;">${escapeHtml(item.input || item.icd10)}</div>
                <div class="compact-meta">${escapeHtml(item.icd10)} · ${escapeHtml(item.gruppeLabel || item.gruppe)}</div>
              </div>
              <button type="button" class="reuseZuordnungBtn secondary" style="width:auto;" data-icd="${escapeHtml(item.icd10)}">Erneut verwenden</button>
            </div>
          `).join("")}
        </div>
      </div>
    ` : ""}

    <div class="card">
      <h3>Diagnose(n) eingeben</h3>
      <p class="muted">Freitext (z.B. "Schlaganfall", "Rückenschmerzen") oder ICD-10-Code.</p>
      <div class="row">
        <input id="diagnoseInput" type="text" placeholder="z.B. Rückenschmerzen oder M54.5">
        <button id="addDiagnoseBtn" type="button" style="flex:0 0 auto; width:auto;">Hinzufügen</button>
      </div>
      <div id="diagnoseChipsContainer" style="margin-top:12px; display:flex; flex-wrap:wrap; gap:8px;">
        ${renderDiagnoseChips()}
      </div>
      <button id="findOptimumBtn" style="margin-top:16px;">Optimale Verordnung finden</button>
      <div id="optimierungErgebnisContainer"></div>
    </div>
  `);

  document.getElementById("backPatientBtn").onclick = () => {
    showPatientDetailView({ onLock, homeId, patientId, returnTo });
  };

  document.querySelectorAll(".reuseZuordnungBtn").forEach((btn) => {
    btn.onclick = () => {
      const icd = btn.dataset.icd;
      if (icd && !diagnoseListe.includes(icd)) {
        diagnoseListe.push(icd);
        refreshDiagnoseChips();
      }
    };
  });

  function addDiagnoseFromInput() {
    const input = document.getElementById("diagnoseInput");
    const raw = input.value.trim();
    if (!raw) return;
    const resolved = resolveDiagnoseInput(raw);
    const value = resolved?.quelle === "icd10" ? formatICD(raw) : raw;
    if (!diagnoseListe.includes(value)) {
      diagnoseListe.push(value);
      refreshDiagnoseChips();
    }
    input.value = "";
    input.focus();
  }

  document.getElementById("addDiagnoseBtn").onclick = addDiagnoseFromInput;
  document.getElementById("diagnoseInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addDiagnoseFromInput();
    }
  });

  document.getElementById("findOptimumBtn").onclick = runOptimierung;
}

export function showCreateRezeptView({ onLock, homeId, patientId, prefill = null, returnTo = null }) {
  bindLockButton(onLock);
  setCurrentView("rezept-create", { homeId, patientId, returnTo });

  const prefillItems = prefill?.itemType ? [{ type: prefill.itemType, count: prefill.count || "" }] : [];

  render(`
    <div class="card">
      <h2>Neues Rezept</h2>
      ${prefill ? `<p class="muted">Vorausgefüllt aus der Rezeptoptimierung. Bitte prüfen und ggf. anpassen.</p>` : ""}
      <button id="backPatientBtn" class="secondary">Zurück zum Patienten</button>
    </div>

    <div class="card">
      <label for="arzt">Arzt</label>
      <input id="arzt" type="text" list="doctorSuggestions" autocomplete="off">
      <datalist id="doctorSuggestions">
        ${getKnownDoctorNames(getRuntimeData()).map((name) => `<option value="${escapeHtml(name)}"></option>`).join("")}
      </datalist>

      ${renderArztAdresseFields("")}

      <label for="ausstell">Ausstellungsdatum</label>
      <input id="ausstell" type="text" placeholder="TT.MM.JJJJ" inputmode="numeric">

      <label for="icd10">ICD-10 Code</label>
      <input id="icd10" type="text" placeholder="z.B. M54.5" value="${escapeHtml(prefill?.icd10 || "")}">

      <label for="icd10b">2. ICD-10 Code (optional)</label>
      <input id="icd10b" type="text" placeholder="z.B. M54.5" value="${escapeHtml(prefill?.icd10b || "")}">

      ${renderLeitsymptomatikField(prefill?.leitsymptomatik || "")}

      <h3 style="margin-top:20px;">Leistungen</h3>
      ${renderRezeptItemsEditor(prefillItems)}

      <h3 style="margin-top:20px;">Rezeptprüfung</h3>
      <div class="checkbox-row">
        <label class="check-chip"><input id="privat" type="checkbox"> <span>🔒 Privat (keine Prüfung nötig)</span></label>
      </div>
      <div class="checkbox-row">
        <label class="check-chip"><input id="bg" type="checkbox"> <span>BG</span></label>
        <label class="check-chip"><input id="dt" type="checkbox"> <span>Doppeltermin</span></label>
        <label class="check-chip"><input id="dringend" type="checkbox"> <span>Dringender Bedarf</span></label>
      </div>

      <label for="hausbesuch">Hausbesuch</label>
      ${renderJaNeinSelect("hausbesuch", "")}

      <label for="arztStempel">Arzt-Stempel vorhanden</label>
      ${renderJaNeinSelect("arztStempel", "")}

      <label for="arztUnterschrift">Arzt-Unterschrift vorhanden</label>
      ${renderJaNeinSelect("arztUnterschrift", "")}

      <div id="rezeptPruefungPanel" style="margin-top:16px;"></div>

      <button id="saveRezeptBtn">Rezept speichern</button>
      <div id="rezeptMsg"></div>
    </div>
  `);

  document.getElementById("backPatientBtn").onclick = () => {
    showPatientDetailView({ onLock, homeId, patientId, returnTo });
  };

  bindDateAutoFormat(document.getElementById("ausstell"));
  bindIcdAutoFormat(document.getElementById("icd10"));
  bindIcdAutoFormat(document.getElementById("icd10b"));
  bindRezeptItemsEditor(prefillItems);
  bindCheckChipToggles(app);
  bindQuickDocSelectionStyles(app);
  bindSelectableCardChecks(app);
  bindLeitsymptomatikField();
  bindRezeptPruefungLive("rezeptPruefungPanel");

  const arztInput = document.getElementById("arzt");
  const arztRegistry = getArztRegistry(getRuntimeData());
  bindArztAdresseAutofill(arztInput, arztRegistry);

  document.getElementById("saveRezeptBtn").onclick = async () => {
    const msg = document.getElementById("rezeptMsg");
    msg.className = "error";
    msg.textContent = "";

    const payload = collectRezeptFormPayload();

    if (payload.items.length === 0) {
      msg.textContent = "Bitte mindestens eine Leistung angeben.";
      return;
    }

    try {
      createRezept(homeId, patientId, payload);
      const arztAdresse = collectArztAdresseFromForm();
      const arztEmail = collectArztEmailFromForm();
      if (payload.arzt && (arztAdresse || arztEmail)) {
        upsertArztAdresse(payload.arzt, arztAdresse, arztEmail);
      }

      await queuePersistRuntimeData();
      showPatientDetailView({ onLock, homeId, patientId, returnTo });
    } catch (err) {
      console.error(err);
      msg.textContent = "Rezept konnte nicht gespeichert werden.";
    }
  };
}

export function showEditRezeptView({ onLock, homeId, patientId, rezeptId, returnTo = null }) {
  bindLockButton(onLock);
  setCurrentView("rezept-edit", { homeId, patientId, rezeptId, returnTo });

  const runtimeData = getRuntimeData();
  const home = getHomeById(runtimeData, homeId);
  const patient = getPatientById(home, patientId);
  const rezept = getRezeptById(patient, rezeptId);

  if (!home || !patient || !rezept) {
    showPatientDetailView({ onLock, homeId, patientId, returnTo });
    return;
  }

  const items = rezept.items || [];
  const arztRegistryForEdit = getArztRegistry(runtimeData);
  const currentArztAdresse = arztRegistryForEdit.find((a) => a.name === (rezept.arzt || ""))?.adresse || "";
  const currentArztEmail = arztRegistryForEdit.find((a) => a.name === (rezept.arzt || ""))?.email || "";

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

      ${renderArztAdresseFields(currentArztAdresse, currentArztEmail)}

      <label for="ausstell">Ausstellungsdatum</label>
      <input id="ausstell" type="text" inputmode="numeric" value="${escapeHtml(rezept.ausstell || "")}">

      <label for="icd10">ICD-10 Code</label>
      <input id="icd10" type="text" placeholder="z.B. M54.5" value="${escapeHtml(rezept.icd10 || "")}">

      <label for="icd10b">2. ICD-10 Code (optional)</label>
      <input id="icd10b" type="text" placeholder="z.B. M54.5" value="${escapeHtml(rezept.icd10b || "")}">

      ${renderLeitsymptomatikField(rezept.leitsymptomatik || "")}

      <h3 style="margin-top:20px;">Leistungen</h3>
      ${renderRezeptItemsEditor(items)}

      <h3 style="margin-top:20px;">Rezeptprüfung</h3>
      <div class="checkbox-row">
        <label class="check-chip"><input id="privat" type="checkbox" ${rezept.privat ? "checked" : ""}> <span>🔒 Privat (keine Prüfung nötig)</span></label>
      </div>
      <div class="checkbox-row">
        <label class="check-chip"><input id="bg" type="checkbox" ${rezept.bg ? "checked" : ""}> <span>BG</span></label>
        <label class="check-chip"><input id="dt" type="checkbox" ${rezept.dt ? "checked" : ""}> <span>Doppeltermin</span></label>
        <label class="check-chip"><input id="dringend" type="checkbox" ${rezept.dringend ? "checked" : ""}> <span>Dringender Bedarf</span></label>
      </div>

      <label for="hausbesuch">Hausbesuch</label>
      ${renderJaNeinSelect("hausbesuch", rezept.hausbesuch || "")}

      <label for="arztStempel">Arzt-Stempel vorhanden</label>
      ${renderJaNeinSelect("arztStempel", rezept.arztStempel || "")}

      <label for="arztUnterschrift">Arzt-Unterschrift vorhanden</label>
      ${renderJaNeinSelect("arztUnterschrift", rezept.arztUnterschrift || "")}

      <div id="rezeptPruefungPanel" style="margin-top:16px;"></div>

      <button id="updateRezeptBtn">Änderungen speichern</button>
      <button id="deleteRezeptBtn" class="danger">Rezept löschen</button>
      <div id="rezeptMsg"></div>
    </div>
  `);

  document.getElementById("backPatientBtn").onclick = () => {
    showPatientDetailView({ onLock, homeId, patientId, returnTo });
  };

  bindDateAutoFormat(document.getElementById("ausstell"));
  bindIcdAutoFormat(document.getElementById("icd10"));
  bindIcdAutoFormat(document.getElementById("icd10b"));
  bindRezeptItemsEditor(items);
  bindCheckChipToggles(app);
  bindQuickDocSelectionStyles(app);
  bindSelectableCardChecks(app);
  bindLeitsymptomatikField();
  bindRezeptPruefungLive("rezeptPruefungPanel");

  const arztInputEdit = document.getElementById("arzt");
  bindArztAdresseAutofill(arztInputEdit, arztRegistryForEdit);

  document.getElementById("updateRezeptBtn").onclick = async () => {
    const msg = document.getElementById("rezeptMsg");
    msg.className = "error";
    msg.textContent = "";

    const payload = collectRezeptFormPayload();
    const nextItems = payload.items.map((item, idx) => ({
      itemId: rezept.items?.[idx]?.itemId,
      ...item
    }));

    if (nextItems.length === 0) {
      msg.textContent = "Bitte mindestens eine Leistung angeben.";
      return;
    }

    try {
      updateRezept(homeId, patientId, rezeptId, {
        ...payload,
        items: nextItems
      });
      const arztAdresse = collectArztAdresseFromForm();
      const arztEmail = collectArztEmailFromForm();
      if (payload.arzt && (arztAdresse || arztEmail)) {
        upsertArztAdresse(payload.arzt, arztAdresse, arztEmail);
      }

      await queuePersistRuntimeData();
      showPatientDetailView({ onLock, homeId, patientId, returnTo });
    } catch (err) {
      console.error(err);
      msg.textContent = "Rezept konnte nicht aktualisiert werden.";
    }
  };

  document.getElementById("deleteRezeptBtn").onclick = async () => {
    const ok = window.confirm(
      "Rezept wirklich löschen?\n\nDokumentationseinträge und Zeiteinträge werden ebenfalls mit gelöscht."
    );
    if (!ok) return;

    try {
      deleteRezept(homeId, patientId, rezeptId);
      await queuePersistRuntimeData();
      showPatientDetailView({ onLock, homeId, patientId, returnTo });
    } catch (err) {
      console.error(err);
      alert(err?.message || "Rezept konnte nicht gelöscht werden.");
    }
  };
}

export function showRezeptDetailView({ onLock, homeId, patientId, rezeptId, returnTo = null }) {
  bindLockButton(onLock);
  setCurrentView("rezept-detail", { homeId, patientId, rezeptId, returnTo });

  const runtimeData = getRuntimeData();
  const home = getHomeById(runtimeData, homeId);
  const patient = getPatientById(home, patientId);
  const rezept = getRezeptById(patient, rezeptId);

  if (!home || !patient || !rezept) {
    showPatientDetailView({ onLock, homeId, patientId, returnTo });
    return;
  }

  const frist = getRezeptFristInfo(rezept);
  const timeEntries = getRezeptTimeEntries(rezept);
  const timeSummary = getRezeptTimeSummary(rezept);
  const pruefung = validateRezeptPflichtfelder(rezept);

  render(`
    <div class="card">
      <h2>Rezept</h2>
      <p><strong>Patient:</strong> ${escapeHtml(formatPatientName(patient) || "—")}</p>
      <button id="backPatientBtn" class="secondary">Zurück zum Patienten</button>
    </div>

    <div class="card">
      <h3>Rezeptprüfung</h3>
      ${renderRezeptPruefungPanel(pruefung, rezept)}
    </div>

    <details class="accordion">
      <summary>
        <span>Rezeptdaten</span>
        <span class="muted">${escapeHtml(rezeptSummary(rezept))}</span>
      </summary>
      <div class="accordion-body">
        <p><strong>Leistungen:</strong> ${escapeHtml(rezeptSummary(rezept))}</p>
        <p><strong>Arzt:</strong> ${escapeHtml(rezept.arzt || "—")}</p>
        <p><strong>Ausstellungsdatum:</strong> ${escapeHtml(rezept.ausstell || "—")}</p>
        <p><strong>ICD-10 Code:</strong> ${escapeHtml(rezept.icd10 || "—")}</p>
        ${rezept.icd10b ? `<p><strong>2. ICD-10 Code:</strong> ${escapeHtml(rezept.icd10b)}</p>` : ""}
        <p><strong>Leitsymptomatik:</strong> ${escapeHtml(rezept.leitsymptomatik || "—")}</p>
        <p><strong>Privat:</strong> ${rezept.privat ? "Ja" : "Nein"}</p>
        <p><strong>Hausbesuch:</strong> ${rezept.hausbesuch === "ja" ? "Ja" : rezept.hausbesuch === "nein" ? "Nein" : "—"}</p>
        <p><strong>Arzt-Stempel vorhanden:</strong> ${rezept.arztStempel === "ja" ? "Ja" : rezept.arztStempel === "nein" ? "Nein" : "—"}</p>
        <p><strong>Arzt-Unterschrift vorhanden:</strong> ${rezept.arztUnterschrift === "ja" ? "Ja" : rezept.arztUnterschrift === "nein" ? "Nein" : "—"}</p>
        <p><strong>BG:</strong> ${rezept.bg ? "Ja" : "Nein"}</p>
        <p><strong>Doppeltermin:</strong> ${rezept.dt ? "Ja" : "Nein"}</p>
        <p><strong>Dringender Bedarf:</strong> ${rezept.dringend ? "Ja" : "Nein"}</p>
        <p><strong>Abgegeben:</strong> ${rezept.abgegeben === true ? "Ja" : "Nein"}</p>
        <p><strong>Zeit gesamt:</strong> ${escapeHtml(formatMinutesLabel(timeSummary.totalMinutes))}</p>
        <p><strong>Zeit-Einträge:</strong> ${timeSummary.totalEntries}</p>
      </div>
    </details>

    <details class="accordion">
      <summary>
        <span>Fristenhinweis</span>
        <span class="muted">${rezept.privat ? "Privatrezept — keine Frist" : escapeHtml(frist.statusText || "—")}</span>
      </summary>
      <div class="accordion-body">
        ${rezept.privat ? `<p class="muted">Für Privatrezepte gelten keine Kassenfristen.</p>` : `
          <p><strong>Status:</strong> ${escapeHtml(frist.statusText || "—")}</p>
          <p><strong>Hinweis:</strong> ${escapeHtml(frist.detailsText || "—")}</p>
          <p><strong>Spätester Beginn:</strong> ${escapeHtml(frist.latestStartText || "—")}</p>
          <p><strong>Gültig bis:</strong> ${escapeHtml(frist.validUntilText || "—")}</p>
        `}
      </div>
    </details>

    <div class="card">
      <h3>Rezeptstatus</h3>
      ${rezept.abgegeben === true ? `<p class="muted">Dieses Rezept ist als abgegeben markiert und erscheint nicht mehr in der SchnellDoku.</p><button id="markRezeptAbgegebenBtn" class="secondary">Abgegeben ✓ — zurücksetzen</button>` : `<p class="muted">Als abgegeben markierte Rezepte bleiben hier vollständig erhalten, verschwinden aber aus der SchnellDoku.</p><button id="markRezeptAbgegebenBtn" class="secondary">Rezept als abgegeben markieren</button>`}
    </div>

    <details class="accordion">
      <summary>
        <span>Vorhandene Einträge</span>
        <span class="muted">${rezept.entries.length}</span>
      </summary>
      <div class="accordion-body">
        ${rezept.entries.length === 0 ? `<p class="muted">Noch keine Dokumentation zu diesem Rezept.</p>` : ""}
        ${rezept.entries.map(entry => `
          <div class="card" style="margin-bottom:12px;padding:16px;">
            <p><strong>${escapeHtml(entry.date || "Ohne Datum")}</strong></p>
            <p>${escapeHtml(entry.text || "")}</p>
            <div class="row" style="margin-top:10px;">
              <button class="editEntryBtn secondary" data-entry-id="${entry.entryId}">Eintrag bearbeiten</button>
              <button class="deleteEntryBtn danger" data-entry-id="${entry.entryId}">Eintrag löschen</button>
            </div>
          </div>
        `).join("")}
      </div>
    </details>

    <details class="accordion">
      <summary>
        <span>Zeit-Einträge</span>
        <span class="muted">${escapeHtml(formatMinutesLabel(timeSummary.totalMinutes))}</span>
      </summary>
      <div class="accordion-body">
        <p class="muted">Gesamtzeit: ${escapeHtml(formatMinutesLabel(timeSummary.totalMinutes))}</p>
        ${timeEntries.length === 0 ? `<p class="muted">Noch keine Zeit zu diesem Rezept erfasst.</p>` : ""}
        ${timeEntries.map(item => `
          <div class="card" style="margin-bottom:12px;padding:16px;">
            <p><strong>${escapeHtml(item.date || "Ohne Datum")}</strong> · ${escapeHtml(formatMinutesLabel(item.minutes))}</p>
            <p class="muted">Typ: ${escapeHtml(getTimeTypeLabel(item.type))}</p>
            <p class="muted">Status: ${item.confirmed ? "Bestätigt" : "Offen"}</p>
            ${item.note ? `<p>${escapeHtml(item.note)}</p>` : ""}
            <div class="row" style="margin-top:10px;">
              <button class="deleteTimeEntryBtn secondary" data-time-entry-id="${item.timeEntryId}">Zeiteintrag löschen</button>
            </div>
          </div>
        `).join("")}
      </div>
    </details>
  `);

  document.getElementById("backPatientBtn").onclick = () => {
    showPatientDetailView({ onLock, homeId, patientId, returnTo });
  };

  const markRezeptAbgegebenBtn = document.getElementById("markRezeptAbgegebenBtn");
  if (markRezeptAbgegebenBtn) {
    markRezeptAbgegebenBtn.onclick = async () => {
      const isCurrentlyAbgegeben = rezept.abgegeben === true;
      const ok = window.confirm(
        isCurrentlyAbgegeben
          ? "Markierung 'abgegeben' wirklich zurücksetzen?\n\nDas Rezept erscheint danach wieder in der SchnellDoku."
          : "Dieses Rezept als abgegeben markieren?\n\nEs verschwindet danach aus der SchnellDoku, bleibt aber in der großen Doku erhalten."
      );
      if (!ok) return;

      try {
        if (isCurrentlyAbgegeben) {
          unmarkRezeptAbgegeben(homeId, patientId, rezeptId);
        } else {
          markRezeptAbgegeben(homeId, patientId, rezeptId);
        }
        await queuePersistRuntimeData();
        showRezeptDetailView({ onLock, homeId, patientId, rezeptId, returnTo });
      } catch (err) {
        console.error(err);
        alert(err?.message || "Rezeptstatus konnte nicht geändert werden.");
      }
    };
  }

  document.querySelectorAll(".editEntryBtn").forEach((btn) => {
    btn.onclick = () => {
      showEditRezeptEntryView({
        onLock,
        homeId,
        patientId,
        rezeptId,
        entryId: btn.dataset.entryId,
        returnTo
      });
    };
  });

  document.querySelectorAll(".deleteEntryBtn").forEach((btn) => {
    btn.onclick = async () => {
      const ok = window.confirm("Dokumentationseintrag wirklich löschen?");
      if (!ok) return;

      try {
        deleteRezeptEntry(homeId, patientId, rezeptId, btn.dataset.entryId);
        await queuePersistRuntimeData();
        showRezeptDetailView({ onLock, homeId, patientId, rezeptId, returnTo });
      } catch (err) {
        console.error(err);
        alert(err?.message || "Dokumentationseintrag konnte nicht gelöscht werden.");
      }
    };
  });

  document.querySelectorAll(".deleteTimeEntryBtn").forEach((btn) => {
    btn.onclick = async () => {
      const ok = window.confirm("Zeiteintrag wirklich löschen?");
      if (!ok) return;

      try {
        deleteRezeptTimeEntry(homeId, patientId, rezeptId, btn.dataset.timeEntryId);
        await queuePersistRuntimeData();
        showRezeptDetailView({ onLock, homeId, patientId, rezeptId, returnTo });
      } catch (err) {
        console.error(err);
        alert(err?.message || "Zeiteintrag konnte nicht gelöscht werden.");
      }
    };
  });
}

export function showEditRezeptEntryView({ onLock, homeId, patientId, rezeptId, entryId, returnTo = null }) {
  bindLockButton(onLock);
  setCurrentView("entry-edit", { homeId, patientId, rezeptId, entryId, returnTo });

  const runtimeData = getRuntimeData();
  const home = getHomeById(runtimeData, homeId);
  const patient = getPatientById(home, patientId);
  const rezept = getRezeptById(patient, rezeptId);
  const entry = (rezept?.entries || []).find((item) => item.entryId === entryId);

  if (!home || !patient || !rezept || !entry) {
    showRezeptDetailView({ onLock, homeId, patientId, rezeptId, returnTo });
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
    showRezeptDetailView({ onLock, homeId, patientId, rezeptId, returnTo });
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
      showRezeptDetailView({ onLock, homeId, patientId, rezeptId, returnTo });
    } catch (err) {
      console.error(err);
      msg.textContent = "Eintrag konnte nicht aktualisiert werden.";
    }
  };
}

function formatAbgabeZusatz(row) {
  const extras = [];
  if (row?.befreit) extras.push("Befreit");
  if (row?.dt) extras.push("Doppelstunde");
  if (row?.bg) extras.push("BG");
  return extras.join(", ");
}

function sortAbgabeRowsForOutput(rows) {
  return [...(rows || [])].sort((a, b) => {
    const last = String(a.patientLastName || "").localeCompare(String(b.patientLastName || ""), "de");
    if (last !== 0) return last;
    const first = String(a.patientFirstName || "").localeCompare(String(b.patientFirstName || ""), "de");
    if (first !== 0) return first;
    const homeCompare = String(a.heim || "").localeCompare(String(b.heim || ""), "de");
    if (homeCompare !== 0) return homeCompare;
    return String(a.leistung || "").localeCompare(String(b.leistung || ""), "de");
  });
}


function renderAbgabeSheetHtml(rows, options = {}) {
  const normalizedRows = sortAbgabeRowsForOutput(rows || []);
  const therapistName = String(options?.therapistName || "").trim() || "—";
  const createdAtLabel = formatIsoDateShort(options?.createdAt);

  return `
    <div style="border-bottom:1px solid #d1d5db; padding:0 0 12px 0; margin-bottom:14px;">
      <div><strong>Therapeut:</strong> ${escapeHtml(therapistName)}</div>
      <div><strong>Erstellt am:</strong> ${escapeHtml(createdAtLabel)}</div>
    </div>
    ${normalizedRows.map((row) => {
      // Rahmen-Hervorhebung nur im PDF/Ausdruck, nicht in der App-Ansicht:
      // ausschließlich Befreit (orange) - die frühere blaue
      // Doppeltermin-Hervorhebung wurde auf Nutzerwunsch entfernt.
      const highlightStyle = row.befreit
        ? "border:2px solid #c2410c; border-radius:8px; padding:8px 10px;"
        : "";
      return `
      <div class="row" style="${highlightStyle}">
        <strong>${escapeHtml(row.patient || "—")}</strong> · ${escapeHtml(row.heim || "—")}
        <span class="pill" style="font-size:11px; margin-left:4px;">${escapeHtml(row.hbPauschale || "HB")}</span><br>
        <span class="muted">Arzt: ${escapeHtml(row.arzt || "—")}</span><br>
        <span class="muted">Ausstellung: ${escapeHtml(row.ausstell || "—")}</span><br>
        <span class="muted">Leistung: ${escapeHtml(row.leistung || "—")} ${escapeHtml(row.anzahl || "")}</span><br>
        ${formatAbgabeZusatz(row) ? `<span class="muted">${escapeHtml(formatAbgabeZusatz(row))}</span>` : ""}
      </div>
    `;
    }).join("")}
  `;
}

export function showAbgabeView({ onLock, searchText = "", selectedIds = [] }) {
  bindLockButton(onLock);
  setCurrentView("abgabe", { searchText, selectedIds });

  const data = getRuntimeData();
  const nurAktive = !!data?.settings?.nurAktiveRezepte;
  const tree = buildAbgabeTree(data);
  const allRows = nurAktive
    ? buildAbgabeRows(data).filter(row => {
        const home = (data.homes || []).find(h => h.homeId === row.homeId);
        const patient = (home?.patients || []).find(p => p.patientId === row.patientId);
        return hatAktivesRezept(patient);
      })
    : buildAbgabeRows(data);
  const filteredRows = filterAbgabeRows(allRows, searchText);
  const allowedIds = new Set(filteredRows.map((row) => row.rowId));
  const selected = new Set(selectedIds);

  render(`
    <div class="card">
      <h2>Abgabeliste</h2>
      <button id="backDashboardBtn" class="secondary">Zurück zum Dashboard</button>
    </div>

    <details class="accordion">
      <summary>
        <span>Suche</span>
        <span class="muted">Filter</span>
      </summary>
      <div class="accordion-body">
        <input id="abgabeSearch" type="text" value="${escapeHtml(searchText)}" placeholder="Patient, Heim, Leistung, Arzt">
        <div class="row">
          <button id="runAbgabeSearchBtn" class="secondary">Suchen</button>
          <button id="clearAbgabeSearchBtn" class="secondary">Suche löschen</button>
        </div>
      </div>
    </details>

    <div class="card">
      <h3>Abgabe-Auswahl</h3>

      <label class="check-chip" style="justify-content:flex-start; margin-bottom:12px;">
        <input type="checkbox" id="abgabeFilterAktiv" ${nurAktive ? "checked" : ""}>
        <span>Nur Patienten mit aktivem Rezept</span>
      </label>

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

                    ${rezeptRows.map(rawRow => {
                      // "befreit" steckt im Baum am Patienten, nicht am Rezept selbst.
                      const row = { ...rawRow, befreit: patient.befreit };
                      return `
                      <div class="compact-card selectable-card">
                        <label style="display:flex; gap:10px; align-items:flex-start; font-weight:normal;">
                          <input class="abgabeCheck" type="checkbox" data-row-id="${row.rowId}" style="width:auto;" ${selected.has(row.rowId) ? "checked" : ""}>
                          <span>
                            <strong>${escapeHtml(row.leistung || "—")} ${escapeHtml(row.anzahl || "")}</strong><br>
                            <span class="muted">Arzt: ${escapeHtml(row.arzt || "—")}</span><br>
                            <span class="muted">Ausstellung: ${escapeHtml(row.ausstell || "—")}</span><br>
                            ${formatAbgabeZusatz(row) ? `<span class="muted">${escapeHtml(formatAbgabeZusatz(row))}</span>` : ""}
                          </span>
                        </label>
                      </div>
                    `;
                    }).join("")}
                  </div>
                </details>
              `;
            }).filter(Boolean).join("");

            if (!patientBlocks) return "";

            return `
              <details class="accordion">
                <summary>
                  <span>${escapeHtml(home.homeName || "Heim")} <span class="pill" style="font-size:11px;">${escapeHtml(home.hbPauschale || "HB")}</span></span>
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
        ${(data.abgabeHistory || []).slice(0, 20).map(item => `
          <div class="compact-card">
            <div style="font-weight:600;">${escapeHtml(item.title || "Abgabeliste")}</div>
            <div class="compact-meta">
              Datum: ${escapeHtml(formatIsoDateShort(item.createdAt))}<br>
              ${item.rows?.length || 0} Zeile(n)
            </div>
            <div class="row" style="margin-top:10px;">
              <button class="secondary abgabe-history-open-btn" data-history-id="${escapeHtml(item.id)}">Öffnen</button>
              <button class="secondary abgabe-history-print-btn" data-history-id="${escapeHtml(item.id)}">Drucken</button>
              <button class="secondary abgabe-history-delete-btn" data-history-id="${escapeHtml(item.id)}">Löschen</button>
            </div>
          </div>
        `).join("")}
      </div>
    </details>
  `);

  bindSelectableCardChecks(app);
  bindCheckChipToggles(app);

  document.getElementById("backDashboardBtn").onclick = () => showDashboardView({ onLock });

  document.getElementById("abgabeFilterAktiv")?.addEventListener("change", async (e) => {
    mutateRuntimeData(d => { d.settings.nurAktiveRezepte = e.target.checked; });
    await queuePersistRuntimeData();
    showAbgabeView({ onLock, searchText, selectedIds });
  });

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
    const chosenRows = sortAbgabeRowsForOutput(allRows.filter((row) => chosenIds.includes(row.rowId)));

    if (chosenRows.length === 0) {
      msg.textContent = "Bitte mindestens einen Eintrag auswählen.";
      return;
    }

    try {
      const createdAt = new Date().toISOString();
      const therapistName = String(getRuntimeData()?.settings?.therapistName || "").trim() || "—";
      const bodyHtml = renderAbgabeSheetHtml(chosenRows, { therapistName, createdAt });
      saveAbgabeHistory(`Abgabeliste ${formatIsoDateShort(createdAt)}`, chosenRows, {
        createdAt,
        snapshotHtml: bodyHtml
      });
      chosenRows.forEach((row) => {
        if (row.homeId && row.patientId && row.rezeptId) {
          markRezeptAbgegeben(row.homeId, row.patientId, row.rezeptId);
        }
      });
      await queuePersistRuntimeData();
      showAbgabeView({ onLock, searchText, selectedIds: [] });
    } catch (err) {
      console.error(err);
      msg.textContent = "Abgabe-Historie konnte nicht gespeichert werden.";
    }
  };

  document.getElementById("printAbgabeSelectionBtn").onclick = () => {
    const chosenIds = Array.from(document.querySelectorAll(".abgabeCheck:checked")).map((el) => el.dataset.rowId);
    const chosenRows = sortAbgabeRowsForOutput(allRows.filter((row) => chosenIds.includes(row.rowId)));

    if (chosenRows.length === 0) {
      alert("Bitte mindestens einen Eintrag auswählen.");
      return;
    }

    const therapistName = String(getRuntimeData()?.settings?.therapistName || "").trim() || "—";
    const bodyHtml = renderAbgabeSheetHtml(chosenRows, {
      therapistName,
      createdAt: new Date().toISOString()
    });

    const printWindow = openHtmlDocument("Abgabeliste", bodyHtml, { autoPrint: false });
    if (!printWindow) return;

    let statusUpdated = false;
    printWindow.onafterprint = async () => {
      if (statusUpdated) return;
      statusUpdated = true;

      try {
        chosenRows.forEach((row) => {
          if (row.homeId && row.patientId && row.rezeptId) {
            markRezeptAbgegeben(row.homeId, row.patientId, row.rezeptId);
          }
        });
        await queuePersistRuntimeData();
        showAbgabeView({ onLock, searchText, selectedIds: [] });
      } catch (err) {
        console.error(err);
        alert("Abgabeliste wurde erstellt, aber der Rezeptstatus konnte nicht automatisch auf abgegeben gesetzt werden.");
      }
    };

    printWindow.print();
  };

  document.querySelectorAll('.abgabe-history-open-btn').forEach((button) => {
    button.onclick = () => {
      const historyId = button.dataset.historyId || '';
      const item = (getRuntimeData().abgabeHistory || []).find((entry) => entry.id === historyId);
      if (!item) return;
      const therapistName = String(getRuntimeData()?.settings?.therapistName || "").trim() || "—";
      const bodyHtml = item.snapshotHtml || renderAbgabeSheetHtml(item.rows || [], {
        therapistName,
        createdAt: item.createdAt
      });
      openLetterPreview(item.title || 'Abgabeliste', bodyHtml);
    };
  });

  document.querySelectorAll('.abgabe-history-print-btn').forEach((button) => {
    button.onclick = () => {
      const historyId = button.dataset.historyId || '';
      const item = (getRuntimeData().abgabeHistory || []).find((entry) => entry.id === historyId);
      if (!item) return;
      const therapistName = String(getRuntimeData()?.settings?.therapistName || "").trim() || "—";
      const bodyHtml = item.snapshotHtml || renderAbgabeSheetHtml(item.rows || [], {
        therapistName,
        createdAt: item.createdAt
      });
      openHtmlDocument(item.title || 'Abgabeliste', bodyHtml, { autoPrint: true });
    };
  });

  document.querySelectorAll('.abgabe-history-delete-btn').forEach((button) => {
    button.onclick = async () => {
      const historyId = button.dataset.historyId || '';
      if (!historyId) return;
      if (!confirm('Diesen Abgabe-Historieneintrag wirklich löschen?')) return;
      deleteAbgabeHistoryItem(historyId);
      await queuePersistRuntimeData();
      showAbgabeView({ onLock, searchText, selectedIds: [] });
    };
  });
}

// Patienten eines Arztes: alle (nicht verstorbenen) Patienten, die
// mindestens ein Rezept mit exakt diesem Arztnamen haben - unabhängig davon,
// ob das Rezept noch offen oder bereits abgegeben ist, damit die Übersicht
// auch bei einem gerade abgegebenen/aufgebrauchten Rezept den Patienten noch
// zeigt.
function getPatientsForDoctor(data, doctorName) {
  return collectAllPatients(data).filter(({ patient }) =>
    (patient.rezepte || []).some((rezept) => String(rezept.arzt || "").trim() === doctorName)
  );
}

export function showArztuebersichtView({ onLock, searchText = "" } = {}) {
  bindLockButton(onLock);
  setCurrentView("arzt-uebersicht", { searchText });

  const runtimeData = getRuntimeData();
  const q = String(searchText || "").trim().toLowerCase();
  const doctors = getArztRegistry(runtimeData)
    .map((arzt) => ({ ...arzt, patientCount: getPatientsForDoctor(runtimeData, arzt.name).length }))
    .filter((arzt) => !q || arzt.name.toLowerCase().includes(q));

  render(`
    <div class="card">
      <h2>Ärzte</h2>
      <p class="muted">${doctors.length} Arzt/Ärzte, alphabetisch sortiert.</p>
      <button id="backDashboardBtn" class="secondary">Zurück zum Dashboard</button>
    </div>

    <div class="card">
      <label for="arztUebersichtSearch">Suche nach Arztname</label>
      <input id="arztUebersichtSearch" type="text" value="${escapeHtml(searchText)}" placeholder="z.B. Dr. Müller">
      <div class="row">
        <button id="runArztUebersichtSearchBtn" class="secondary">Suchen</button>
        <button id="clearArztUebersichtSearchBtn" class="secondary">Suche löschen</button>
      </div>
    </div>

    <div class="card">
      <div class="list-stack">
        ${doctors.length === 0 ? `<p class="muted">Keine passenden Ärzte gefunden.</p>` : ""}
        ${doctors.map((arzt) => `
          <div class="openArztDetailBtn compact-card" style="cursor:pointer;" data-doctor-name="${escapeHtml(arzt.name)}">
            <div style="font-weight:600;">${escapeHtml(arzt.name)}</div>
            <div class="compact-meta">${arzt.patientCount} Patient(en)${arzt.email ? ` · ${escapeHtml(arzt.email)}` : ""}</div>
          </div>
        `).join("")}
      </div>
    </div>
  `);

  document.getElementById("backDashboardBtn").onclick = () => showDashboardView({ onLock });

  const runSearch = () => {
    showArztuebersichtView({ onLock, searchText: document.getElementById("arztUebersichtSearch").value });
  };
  document.getElementById("runArztUebersichtSearchBtn").onclick = runSearch;
  document.getElementById("arztUebersichtSearch").addEventListener("keydown", (e) => {
    if (e.key === "Enter") runSearch();
  });
  document.getElementById("clearArztUebersichtSearchBtn").onclick = () => {
    showArztuebersichtView({ onLock, searchText: "" });
  };

  document.querySelectorAll(".openArztDetailBtn").forEach((btn) => {
    btn.onclick = () => {
      showArztDetailView({ onLock, doctorName: btn.dataset.doctorName, searchText });
    };
  });
}

export function showArztDetailView({ onLock, doctorName, searchText = "" }) {
  bindLockButton(onLock);
  setCurrentView("arzt-detail", { doctorName, searchText });

  const runtimeData = getRuntimeData();
  const arzt = getArztRegistry(runtimeData).find((a) => a.name === doctorName);

  if (!arzt) {
    render(`
      <div class="card">
        <p class="error">Arzt nicht gefunden.</p>
        <button id="backArztListeBtn" class="secondary">Zurück zur Arztübersicht</button>
      </div>
    `);
    document.getElementById("backArztListeBtn").onclick = () => showArztuebersichtView({ onLock, searchText });
    return;
  }

  const patients = getPatientsForDoctor(runtimeData, doctorName);

  render(`
    <div class="card">
      <h2>${escapeHtml(arzt.name)}</h2>
      <button id="backArztListeBtn" class="secondary">Zurück zur Arztübersicht</button>
    </div>

    <div class="card">
      <h3>Arztdaten</h3>
      <label for="arztDetailName">Name</label>
      <input id="arztDetailName" type="text" value="${escapeHtml(arzt.name)}">
      ${renderArztAdresseFields(arzt.adresse, arzt.email)}
      <button id="saveArztDetailBtn" style="margin-top:12px;">Speichern</button>
      <div id="arztDetailMsg"></div>
    </div>

    <div class="card">
      <h3>Patienten (${patients.length})</h3>
      <div class="list-stack">
        ${patients.length === 0 ? `<p class="muted">Keine Patienten für diesen Arzt gefunden.</p>` : ""}
        ${patients.map(({ patient, homeName }) => `
          <div class="compact-card">
            <div style="font-weight:600;">${escapeHtml(formatPatientName(patient) || "Ohne Namen")}</div>
            <div class="compact-meta">${escapeHtml(homeName)}${patient.birthDate ? ` · geb. ${escapeHtml(patient.birthDate)}` : ""}</div>
          </div>
        `).join("")}
      </div>
    </div>
  `);

  document.getElementById("backArztListeBtn").onclick = () => showArztuebersichtView({ onLock, searchText });

  document.getElementById("saveArztDetailBtn").onclick = async () => {
    const msg = document.getElementById("arztDetailMsg");
    msg.className = "error";
    msg.textContent = "";

    const newName = document.getElementById("arztDetailName").value.trim();
    if (!newName) {
      msg.textContent = "Bitte einen Namen eingeben.";
      return;
    }
    const newAdresse = collectArztAdresseFromForm();
    const newEmail = collectArztEmailFromForm();

    try {
      if (newName !== arzt.name) {
        renameArzt(arzt.name, newName);
      }
      upsertArztAdresse(newName, newAdresse, newEmail);
      await queuePersistRuntimeData();
      showToast("Arztdaten gespeichert");
      showArztDetailView({ onLock, doctorName: newName, searchText });
    } catch (err) {
      console.error(err);
      msg.textContent = err?.message || "Arztdaten konnten nicht gespeichert werden.";
    }
  };
}

export function showNachbestellungView({ onLock, doctorFilter = "", textFilter = "", selectedIds = [] }) {
  bindLockButton(onLock);

  const data = getRuntimeData();
  const doctors = getDoctorList(data);
  const allRows = buildNachbestellRows(data);
  const filteredRows = filterNachbestellRows(allRows, doctorFilter, textFilter);
  const normalizedSelectedIds = normalizeSelectedRowIds(selectedIds, filteredRows);
  const tree = buildNachbestellTree(data, doctorFilter, textFilter);
  const selected = new Set(normalizedSelectedIds);
  const therapistName = data?.settings?.therapistName || "";

  setCurrentView("nachbestellung", { doctorFilter, textFilter, selectedIds: normalizedSelectedIds });

  render(`
    <div class="card">
      <h2>Nachbestellung</h2>
      <button id="backDashboardBtn" class="secondary">Zurück zum Dashboard</button>
    </div>

    <details class="accordion">
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
        <input id="nachbestellTextFilter" type="text" value="${escapeHtml(textFilter)}" placeholder="Patient, Heim, Text">

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
                        <div class="compact-card selectable-card ${selected.has(row.rowId) ? "is-selected" : ""}">
                          <label style="display:flex; gap:10px; align-items:flex-start; font-weight:normal; width:100%; cursor:pointer;">
                            <input class="nachbestellCheck" type="checkbox" data-row-id="${row.rowId}" style="width:auto;" ${selected.has(row.rowId) ? "checked" : ""}>
                            <span>
                              <strong>${escapeHtml(row.text || "—")}</strong><br>
                              <span class="muted">Ausstellung: ${escapeHtml(row.ausstell || "—")}</span><br>
                              ${formatAbgabeZusatz(row) ? `<span class="muted">${escapeHtml(formatAbgabeZusatz(row))}</span>` : ""}
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

      <div class="compact-card" style="margin-top:16px;">
        <div style="font-weight:600; margin-bottom:8px;">Zustellung</div>
        ${renderRadioGroup("nachbestellVersandart", [
          { val: "fax", label: "Per Fax an mich / Original zur Einrichtung" },
          { val: "abholen", label: "Ich hole die Rezepte selbst ab" },
          { val: "post", label: "Original per Post an die Praxis" },
          { val: "email", label: "Per E-Mail an den Arzt senden" }
          // Diese Option war zwischenzeitlich (26.09.2026) ausgeblendet, weil
          // mailto: auf dem Gerät den dort hinterlegten Standard-Mail-Anbieter
          // öffnete (z.B. GMX/Web.de), NICHT das geschäftliche
          // Strato-Postfach. Gelöst - nicht im Code, sondern durch
          // Geräte-Einrichtung: das Strato-Postfach (imap.strato.de /
          // smtp.strato.de) wurde als eigenes Konto in einer echten
          // Mail-App (z.B. Gmail-App: "Weiteres Konto hinzufügen" -> "Andere"
          // -> IMAP) eingerichtet und diese App als Standard-Mail-App des
          // Geräts festgelegt - seitdem öffnet mailto: zuverlässig mit der
          // korrekten Absenderadresse. Diese Einrichtung muss auf JEDEM
          // Gerät einmalig gemacht werden, das die Nachbestellung per E-Mail
          // nutzen soll.
        ], "fax")}
        <div id="nachbestellAbholDatumWrap" style="display:none; margin-top:8px;">
          <label for="nachbestellAbholDatum">Abholdatum</label>
          <input id="nachbestellAbholDatum" type="text" value="${escapeHtml(formatCurrentDateShort())}" placeholder="TT.MM.JJJJ" inputmode="numeric">
        </div>
      </div>

      <div class="row" style="margin-top:12px;">
        <button id="createNachbestellLetterBtn">Nachbestellzettel erzeugen</button>
        <button id="printNachbestellSelectionBtn" class="secondary">Aktuelle Auswahl drucken</button>
      </div>

      <div id="nachbestellMsg"></div>
    </div>

    <details class="accordion">
      <summary>
        <span>Nachbestell-Historie</span>
        <span class="muted">${(data.nachbestellHistory || []).length}</span>
      </summary>
      <div class="accordion-body">
        ${((data.nachbestellHistory || []).length === 0) ? `<p class="muted">Noch keine gespeicherten Nachbestellzettel.</p>` : ""}
        ${(data.nachbestellHistory || []).slice(0, 20).map((item) => `
          <div class="compact-card">
            <div style="font-weight:600;">${escapeHtml(item.title || "Nachbestellung")}</div>
            <div class="compact-meta">
              Arzt: ${escapeHtml(item.doctor || "—")}<br>
              Datum: ${escapeHtml(formatIsoDateShort(item.createdAt))}<br>
              ${Number(item.patientCount || 0)} Patient(en) · ${Number(item.rezeptCount || item.lines?.length || 0)} Rezept(e)
            </div>
            <div class="row" style="margin-top:10px;">
              <button class="secondary history-open-btn" data-history-id="${escapeHtml(item.id)}">Öffnen</button>
              <button class="secondary history-print-btn" data-history-id="${escapeHtml(item.id)}">Drucken</button>
              <button class="secondary history-delete-btn" data-history-id="${escapeHtml(item.id)}">Löschen</button>
            </div>
          </div>
        `).join("")}
      </div>
    </details>
  `);

  function getChosenRows() {
    const chosenIds = getCheckedRowIds(".nachbestellCheck", app);
    return filteredRows.filter((row) => chosenIds.includes(row.rowId));
  }

  function getNachbestellVersandOptions() {
    const versandart = getRadioValue("nachbestellVersandart") || "fax";
    if (versandart === "abholen") {
      const raw = document.getElementById("nachbestellAbholDatum").value.trim();
      const abholDatum = normalizeDeDateInput(raw) || raw;
      if (!abholDatum || !parseDeDate(abholDatum)) {
        throw new Error("Bitte ein gültiges Abholdatum eingeben (TT.MM.JJJJ).");
      }
      return { versandart, abholDatum };
    }
    return { versandart };
  }

  function buildCurrentLetter() {
    const chosenRows = getChosenRows();
    if (chosenRows.length === 0) throw new Error("Bitte mindestens einen Eintrag auswählen.");
    const versandOptions = getNachbestellVersandOptions();
    const letterData = buildNachbestellLetterData(getRuntimeData(), chosenRows);
    return {
      letterData,
      bodyHtml: renderNachbestellLetterHtml(letterData, versandOptions),
      lines: flattenNachbestellLines(letterData)
    };
  }

  document.querySelectorAll('input[name="nachbestellVersandart"]').forEach((el) => {
    el.addEventListener("change", () => {
      const wrap = document.getElementById("nachbestellAbholDatumWrap");
      wrap.style.display = getRadioValue("nachbestellVersandart") === "abholen" ? "block" : "none";
    });
  });

  document.getElementById("backDashboardBtn").onclick = () => showDashboardView({ onLock });

  document.getElementById("runDoctorFilterBtn").onclick = () => {
    const doctorValue = document.getElementById("doctorFilter").value;
    const textValue = document.getElementById("nachbestellTextFilter").value;
    const nextSelected = getCheckedRowIds(".nachbestellCheck", app);

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

  bindSelectableCardChecks(app);
  bindCheckChipToggles(app);

  document.querySelectorAll('.nachbestellCheck').forEach((check) => {
    if (check.dataset.boundSelectionState === '1') return;
    check.dataset.boundSelectionState = '1';
    check.addEventListener('change', () => {
      const nextSelected = getCheckedRowIds('.nachbestellCheck', app);
      setCurrentView('nachbestellung', { doctorFilter, textFilter, selectedIds: nextSelected });
    });
  });

  // Die Zustellart "email" (Auswahl oben bei "Zustellung") wird hier direkt
  // mit ausgeführt statt über einen eigenen, zweiten Button - vorher gab es
  // sowohl diese Auswahl als auch einen separaten "Per E-Mail an Arzt
  // senden"-Button, die beide letztlich denselben Vorgang anstießen (Zettel
  // öffnen + mailto), aber unabhängig voneinander bedient werden mussten und
  // sich bei abweichender Auswahl sogar widersprechen konnten (Brieftext
  // "per Fax", Versand aber trotzdem per Mail-Button).
  document.getElementById("createNachbestellLetterBtn").onclick = () => {
    const msg = document.getElementById("nachbestellMsg");
    msg.className = "error";
    msg.textContent = "";

    try {
      const { letterData, bodyHtml, lines } = buildCurrentLetter();
      const versandart = getRadioValue("nachbestellVersandart") || "fax";

      let arztEmail = "";
      if (versandart === "email") {
        arztEmail = getArztRegistry(getRuntimeData()).find((a) => a.name === letterData.doctor)?.email || "";
        if (!arztEmail) {
          msg.textContent = `Für ${letterData.doctor} ist keine E-Mail-Adresse hinterlegt. Bitte beim Anlegen/Bearbeiten eines Rezepts für diesen Arzt ergänzen.`;
          return;
        }
      }

      // openLetterPreview() (window.open) muss synchron direkt im Klick-Handler
      // aufgerufen werden - ein await davor (z.B. für das Speichern) lässt den
      // Browser die Nutzeraktion "verlieren" und blockiert das Popup lautlos,
      // vor allem als installierte PWA auf Android.
      openLetterPreview(letterData.title, bodyHtml);
      saveNachbestellHistorySnapshot({
        title: `Nachbestellung ${letterData.doctor} · ${formatIsoDateShort(letterData.createdAt)}`,
        doctor: letterData.doctor,
        createdAt: letterData.createdAt,
        rezeptCount: letterData.rezeptCount,
        patientCount: letterData.patientCount,
        snapshotHtml: bodyHtml,
        lines
      });

      if (versandart === "email") {
        // Ein per JavaScript gesetztes window.location.href = "mailto:..."
        // öffnet auf vielen Geräten (v.a. als installierte PWA auf Android)
        // KEINEN Mail-Client, wenn direkt zuvor im selben Klick bereits ein
        // window.open() (die Zettel-Vorschau) lief - der Browser lässt dann
        // offenbar nur eine der beiden "privilegierten" Aktionen pro
        // Nutzer-Geste durch. Ein echter <a href="mailto:...">-Link, den der
        // Nutzer selbst anklickt, funktioniert zuverlässig (genau dieses
        // Muster nutzen bereits "Urlaub/Krank" und "Freikuvert bestellen").
        // Die Ansicht wird deshalb hier NICHT sofort zurückgesetzt, damit
        // dieser Link sichtbar und klickbar bleibt.
        const mailtoHref = buildNachbestellMailtoLink({ letterData, lines, arztEmail, therapistName });
        msg.className = "";
        msg.innerHTML = `
          <p>Nachbestellzettel geöffnet - bitte als PDF speichern, dann unten auf "E-Mail öffnen" klicken und die PDF-Datei anhängen.</p>
          <a href="${mailtoHref}"><button type="button" id="openNachbestellMailtoBtn">E-Mail an ${escapeHtml(letterData.doctor)} öffnen</button></a>
        `;
        queuePersistRuntimeData();
        return;
      }

      queuePersistRuntimeData().then(() => {
        showNachbestellungView({
          onLock,
          doctorFilter: "",
          textFilter: "",
          selectedIds: []
        });
      });
    } catch (err) {
      console.error(err);
      msg.textContent = err?.message || "Nachbestellzettel konnte nicht erzeugt werden.";
    }
  };

  document.getElementById("printNachbestellSelectionBtn").onclick = () => {
    try {
      const { letterData, bodyHtml } = buildCurrentLetter();
      openHtmlDocument(letterData.title, bodyHtml, { autoPrint: true });
    } catch (err) {
      alert(err?.message || 'Nachbestellzettel konnte nicht gedruckt werden.');
    }
  };

  document.querySelectorAll('.history-open-btn').forEach((button) => {
    button.onclick = () => {
      const historyId = button.dataset.historyId || '';
      const item = (getRuntimeData().nachbestellHistory || []).find((entry) => entry.id === historyId);
      if (!item?.snapshotHtml) {
        alert('Dieser Historieneintrag enthält keinen gespeicherten Zettel.');
        return;
      }
      openLetterPreview(item.title || 'Nachbestellung', item.snapshotHtml);
    };
  });

  document.querySelectorAll('.history-print-btn').forEach((button) => {
    button.onclick = () => {
      const historyId = button.dataset.historyId || '';
      const item = (getRuntimeData().nachbestellHistory || []).find((entry) => entry.id === historyId);
      if (!item?.snapshotHtml) {
        alert('Dieser Historieneintrag enthält keinen gespeicherten Zettel.');
        return;
      }
      openHtmlDocument(item.title || 'Nachbestellung', item.snapshotHtml, { autoPrint: true });
    };
  });

  document.querySelectorAll('.history-delete-btn').forEach((button) => {
    button.onclick = async () => {
      const historyId = button.dataset.historyId || '';
      if (!historyId) return;
      if (!confirm('Diesen Nachbestell-Historieneintrag wirklich löschen?')) return;
      deleteNachbestellHistoryItem(historyId);
      await queuePersistRuntimeData();
      showNachbestellungView({ onLock, doctorFilter, textFilter, selectedIds: normalizedSelectedIds });
    };
  });
}

export function showKilometerView({ onLock, summaryFrom = "", summaryTo = "", editTravelId = "" }) {
  bindLockButton(onLock);
  setCurrentView("kilometer", { summaryFrom, summaryTo, editTravelId });

  const overview = getKilometerOverview();
  const pointOptions = getKilometerPointOptions();
  const summary = getKilometerPeriodSummary(summaryFrom, summaryTo);
  const therapistName = getRuntimeData()?.settings?.therapistName || "";
  const kmExports = [...(overview.kmExports || [])].sort((a, b) =>
    String(b?.erstelltAm || "").localeCompare(String(a?.erstelltAm || ""), 'de')
  );

  const travelLog = [...(overview.travelLog || [])].sort((a, b) =>
    compareDeDates(String(b?.date || ""), String(a?.date || ""))
    || collatorDE.compare(String(b?.createdAt || ""), String(a?.createdAt || ""))
  );
  const knownRouteMap = new Map();
  (overview.knownRoutes || []).forEach((route) => {
    const from = String(route?.fromPointId || "");
    const to = String(route?.toPointId || "");
    if (!from || !to) return;
    const key = [from, to].sort().join("|");
    if (!knownRouteMap.has(key)) knownRouteMap.set(key, route);
  });
  const knownRoutes = [...knownRouteMap.values()].sort((a, b) =>
    collatorDE.compare(`${a.fromLabel || ""} ${a.toLabel || ""}`, `${b.fromLabel || ""} ${b.toLabel || ""}`)
  );
  const editingItem = editTravelId ? travelLog.find((item) => item.travelId === editTravelId) || null : null;
  const formTitle = editingItem ? "Fahrt bearbeiten" : "Fahrt eintragen";
  const formHint = editingItem
    ? "Kilometer, Datum und Strecke dieser Fahrt können hier korrigiert werden."
    : "Strecke auswählen oder neu anlegen. Bekannte Strecken werden automatisch mit ihrer hinterlegten Kilometerzahl vorausgefüllt.";
  const formButtonLabel = editingItem ? "Fahrt aktualisieren" : "Fahrt speichern";
  const formDateValue = editingItem?.date || formatCurrentDateShort();
  const formFromValue = editingItem?.fromPointId || "";
  const formToValue = editingItem?.toPointId || "";
  const formKmValue = editingItem ? String(editingItem.km ?? "") : "";
  const formReasonValue = editingItem?.note || "";

  // Für das Vorausfüllen der Kilometer im Formular: Map von "von|nach" auf km
  const knownRouteKmMap = {};
  (overview.knownRoutes || []).forEach((route) => {
    const from = String(route?.fromPointId || "");
    const to = String(route?.toPointId || "");
    if (!from || !to) return;
    knownRouteKmMap[`${from}|${to}`] = Number(route.km || 0);
  });

  render(`
    <div class="card">
      <h2>Kilometer</h2>
      <button id="backDashboardBtn" class="secondary">Zurück zum Dashboard</button>
    </div>

    <details class="accordion" ${editingItem ? 'open' : ''}>
      <summary>
        <span>${escapeHtml(formTitle)}</span>
        <span class="muted">${editingItem ? 'Korrektur' : ''}</span>
      </summary>
      <div class="accordion-body">
      <h3>${escapeHtml(formTitle)}</h3>
      <p class="muted">${escapeHtml(formHint)}</p>

      <label for="manualKmDate">Datum</label>
      <input id="manualKmDate" type="text" value="${escapeHtml(formDateValue)}" placeholder="TT.MM.JJJJ">

      <label for="manualKmFrom">Von</label>
      <select id="manualKmFrom">
        <option value="">Bitte wählen</option>
        ${pointOptions.map((point) => `<option value="${escapeHtml(point.pointId)}" ${point.pointId === formFromValue ? 'selected' : ''}>${escapeHtml(point.label)}${point.address ? ` – ${escapeHtml(point.address)}` : ""}</option>`).join("")}
      </select>

      <label for="manualKmTo">Nach</label>
      <select id="manualKmTo">
        <option value="">Bitte wählen</option>
        ${pointOptions.map((point) => `<option value="${escapeHtml(point.pointId)}" ${point.pointId === formToValue ? 'selected' : ''}>${escapeHtml(point.label)}${point.address ? ` – ${escapeHtml(point.address)}` : ""}</option>`).join("")}
      </select>

      <label for="manualKmValue">Kilometer</label>
      <input id="manualKmValue" type="number" min="0" step="0.1" value="${escapeHtml(formKmValue)}" placeholder="z.B. 7.5">
      <p id="manualKmAutoHint" class="muted" style="margin-top:4px; display:none;"></p>

      <label for="manualKmReason">Notiz (optional)</label>
      <input id="manualKmReason" type="text" value="${escapeHtml(formReasonValue)}" placeholder="z.B. Umweg wegen Stau">

      <div class="row">
        <button id="saveManualKmBtn">${escapeHtml(formButtonLabel)}</button>
        ${editingItem ? '<button id="cancelKmEditBtn" class="secondary">Bearbeitung abbrechen</button>' : ''}
      </div>
      <div id="manualKmMsg"></div>
      </div>
    </details>

    <details class="accordion">
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
            <div class="compact-meta">Typ: ${item.source === "auto" ? "Automatisch" : "Manuell"}${item.manualAdjusted ? ' · manuell korrigiert' : ''}${item.abgerechnet ? ` · abgerechnet am ${escapeHtml(item.abgerechnetAm || "—")}` : ''}</div>
            ${item.note ? `<div class="compact-meta">${escapeHtml(item.note)}</div>` : ""}
            <div class="row" style="margin-top:10px;">
              <button class="secondary editTravelBtn" data-travel-id="${escapeHtml(item.travelId || "")}">Fahrt bearbeiten</button>
              <button class="secondary deleteTravelBtn" data-travel-id="${escapeHtml(item.travelId || "")}">Fahrt löschen</button>
            </div>
          </div>
        `).join("")}
      </div>
    </details>

    <details class="accordion">
      <summary>
        <span>Bekannte Strecken</span>
        <span class="muted">${knownRoutes.length}</span>
      </summary>
      <div class="accordion-body">
        ${knownRoutes.length === 0 ? `<p class="muted">Noch keine gespeicherten Strecken vorhanden.</p>` : ""}
        ${knownRoutes.map((route, index) => `
          <div class="compact-card">
            <div style="font-weight:600;">${escapeHtml(route.fromLabel || "—")} → ${escapeHtml(route.toLabel || "—")}</div>
            <label for="knownRouteKm${index}">Kilometer</label>
            <input id="knownRouteKm${index}" type="number" min="0" step="0.1" value="${escapeHtml(String(route.km ?? ""))}" placeholder="z.B. 7.5">
            <button class="secondary saveKnownRouteKmBtn" data-input-id="knownRouteKm${index}" data-from-point-id="${escapeHtml(route.fromPointId || "")}" data-to-point-id="${escapeHtml(route.toPointId || "")}" data-from-label="${escapeHtml(route.fromLabel || "")}" data-to-label="${escapeHtml(route.toLabel || "")}">Kilometer speichern</button>
          </div>
        `).join("")}
        <div id="knownRoutesMsg"></div>
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
        <input id="kmSummaryFrom" type="text" value="${escapeHtml(summaryFrom)}" placeholder="TT.MM.JJJJ">

        <label for="kmSummaryTo">Bis</label>
        <input id="kmSummaryTo" type="text" value="${escapeHtml(summaryTo)}" placeholder="TT.MM.JJJJ">

        <div class="row">
          <button id="runKmSummaryBtn">Auswertung anzeigen</button>
          <button id="printKmSummaryBtn" class="secondary">Kilometerzettel drucken</button>
        </div>

        <div class="compact-card" style="margin-top:12px;">
          <div style="font-weight:600;">Kilometerkonto</div>
          <div class="compact-meta">Gesamtkilometer: ${escapeHtml(formatKm(summary.totalKm))}</div>
          <div class="compact-meta">Vergütung: ${escapeHtml(formatEuro(summary.totalAmount))}</div>
          <div class="compact-meta">Zeitraum: ${escapeHtml(summary.fromDate || "—")} bis ${escapeHtml(summary.toDate || "—")}</div>
          <div class="compact-meta">Es werden nur noch nicht abgerechnete Fahrten berücksichtigt.</div>
        </div>

        ${summary.rows.length === 0 ? `<p class="muted" style="margin-top:10px;">Keine offenen Fahrten im gewählten Zeitraum.</p>` : ""}
        ${summary.rows.map((item) => `
          <div class="compact-card">
            <div style="font-weight:600;">${escapeHtml(item.date || "Ohne Datum")} · ${escapeHtml(formatKm(item.km || 0))}</div>
            <div class="compact-meta">${escapeHtml(item.fromLabel || "—")} → ${escapeHtml(item.toLabel || "—")}</div>
            <div class="compact-meta">Typ: ${item.source === "manual" ? "Manuell" : "Automatisch"}${item.manualAdjusted ? ' · manuell korrigiert' : ''}</div>
            ${item.note ? `<div class="compact-meta">Begründung: ${escapeHtml(item.note)}</div>` : ""}
          </div>
        `).join("")}
      </div>
    </details>

    <details class="accordion">
      <summary>
        <span>Kilometerzettel-Historie</span>
        <span class="muted">${escapeHtml(String(kmExports.length))}</span>
      </summary>
      <div class="accordion-body">
        ${kmExports.length === 0 ? `<p class="muted">Noch keine abgeschlossenen Kilometerzettel.</p>` : ""}
        ${kmExports.map((item) => `
          <div class="compact-card">
            <div style="font-weight:600;">Nr. ${escapeHtml(item.number || "—")}</div>
            <div class="compact-meta">
              Zeitraum: ${escapeHtml(item.von || "—")} bis ${escapeHtml(item.bis || "—")}<br>
              Erstellt: ${escapeHtml(formatIsoDateShort(item.erstelltAm))}<br>
              ${escapeHtml(formatKm(item.gesamtKm))} · ${escapeHtml(formatEuro(item.gesamtVerguetung))}
            </div>
            <div class="row" style="margin-top:10px;">
              <button class="secondary km-history-open-btn" data-history-id="${escapeHtml(item.id)}">Öffnen</button>
              <button class="secondary km-history-print-btn" data-history-id="${escapeHtml(item.id)}">Drucken</button>
            </div>
          </div>
        `).join("")}
      </div>
    </details>
  `);

  bindSelectableCardChecks(app);

  document.getElementById("backDashboardBtn").onclick = () => showDashboardView({ onLock });

  function updateManualKmAutoFill() {
    const fromValue = document.getElementById("manualKmFrom").value;
    const toValue = document.getElementById("manualKmTo").value;
    const hint = document.getElementById("manualKmAutoHint");
    if (!fromValue || !toValue || fromValue === toValue) {
      hint.style.display = "none";
      return;
    }
    const knownKm = knownRouteKmMap[`${fromValue}|${toValue}`];
    if (knownKm !== undefined) {
      document.getElementById("manualKmValue").value = String(knownKm);
      hint.textContent = `Bekannte Strecke: ${formatKm(knownKm)} (kann bei Bedarf überschrieben werden)`;
      hint.style.display = "block";
    } else {
      hint.textContent = "Neue Strecke – wird nach dem Speichern für künftige Fahrten gemerkt.";
      hint.style.display = "block";
    }
  }

  document.getElementById("manualKmFrom").addEventListener("change", updateManualKmAutoFill);
  document.getElementById("manualKmTo").addEventListener("change", updateManualKmAutoFill);
  // Nur bei neuen Einträgen automatisch vorausfüllen. Beim Bearbeiten eines
  // bestehenden Eintrags soll der dort gespeicherte (ggf. bewusst
  // abweichende) km-Wert nicht durch den Strecken-Standard überschrieben
  // werden.
  if (!editingItem && formFromValue && formToValue) updateManualKmAutoFill();

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
      showKilometerView({ onLock, summaryFrom, summaryTo, editTravelId });
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

  document.getElementById("printKmSummaryBtn").onclick = async () => {
    const fromValue = document.getElementById("kmSummaryFrom").value.trim();
    const toValue = document.getElementById("kmSummaryTo").value.trim();
    const currentSummary = getKilometerPeriodSummary(fromValue, toValue);

    if (currentSummary.rows.length === 0) {
      alert("Keine offenen Fahrten im gewählten Zeitraum.");
      return;
    }

    const nextNumber = previewNextKilometerZettelNumber();
    const zettelHtml = buildKilometerZettelHtml({
      number: nextNumber,
      therapistName,
      fromDate: fromValue || currentSummary.rows[0]?.date,
      toDate: toValue || currentSummary.rows[currentSummary.rows.length - 1]?.date,
      rows: currentSummary.rows,
      totalKm: currentSummary.totalKm,
      totalAmount: currentSummary.totalAmount
    });

    openHtmlDocument(`FaSt Kilometer ${nextNumber}`, zettelHtml, { autoPrint: true });

    try {
      finalizeKilometerExport(fromValue, toValue, { snapshotHtml: zettelHtml, number: nextNumber });
      await queuePersistRuntimeData();
      showKilometerView({ onLock, summaryFrom: fromValue, summaryTo: toValue });
    } catch (err) {
      console.error(err);
      alert(err?.message || "Kilometerzettel konnte nicht abgeschlossen werden.");
    }
  };

  document.querySelectorAll(".km-history-open-btn").forEach((btn) => {
    btn.onclick = () => {
      const item = kmExports.find((entry) => entry.id === btn.dataset.historyId);
      if (!item?.snapshotHtml) return;
      openLetterPreview(`FaSt Kilometer ${item.number || ''}`.trim(), item.snapshotHtml);
    };
  });

  document.querySelectorAll(".km-history-print-btn").forEach((btn) => {
    btn.onclick = () => {
      const item = kmExports.find((entry) => entry.id === btn.dataset.historyId);
      if (!item?.snapshotHtml) return;
      openHtmlDocument(`FaSt Kilometer ${item.number || ''}`.trim(), item.snapshotHtml, { autoPrint: true });
    };
  });

  document.getElementById("saveManualKmBtn").onclick = async () => {
    const msg = document.getElementById("manualKmMsg");
    msg.className = "error";
    msg.textContent = "";

    try {
      const payload = {
        date: document.getElementById("manualKmDate").value.trim(),
        fromPointId: document.getElementById("manualKmFrom").value,
        toPointId: document.getElementById("manualKmTo").value,
        km: document.getElementById("manualKmValue").value,
        note: document.getElementById("manualKmReason").value.trim()
      };

      if (editingItem) {
        updateKilometerTravel(editingItem.travelId, payload);
      } else {
        addManualKilometerTravel(payload);
      }

      await queuePersistRuntimeData();
      showKilometerView({ onLock, summaryFrom, summaryTo });
    } catch (err) {
      console.error(err);
      msg.textContent = err?.message || (editingItem ? "Fahrt konnte nicht aktualisiert werden." : "Manuelle Fahrt konnte nicht gespeichert werden.");
    }
  };

  if (editingItem) {
    document.getElementById("cancelKmEditBtn").onclick = () => {
      showKilometerView({ onLock, summaryFrom, summaryTo });
    };
  }

  document.querySelectorAll(".editTravelBtn").forEach((btn) => {
    btn.onclick = () => {
      showKilometerView({ onLock, summaryFrom, summaryTo, editTravelId: btn.dataset.travelId || "" });
    };
  });

  document.querySelectorAll(".saveKnownRouteKmBtn").forEach((btn) => {
    btn.onclick = async () => {
      const msg = document.getElementById("knownRoutesMsg");
      if (msg) {
        msg.className = "error";
        msg.textContent = "";
      }

      try {
        const input = document.getElementById(btn.dataset.inputId || "");
        saveKnownKilometerRoute({
          fromPointId: btn.dataset.fromPointId || "",
          toPointId: btn.dataset.toPointId || "",
          fromLabel: btn.dataset.fromLabel || "",
          toLabel: btn.dataset.toLabel || "",
          km: input ? input.value : ""
        });
        await queuePersistRuntimeData();
        showKilometerView({ onLock, summaryFrom, summaryTo, editTravelId });
      } catch (err) {
        console.error(err);
        if (msg) msg.textContent = err?.message || "Strecke konnte nicht gespeichert werden.";
      }
    };
  });

  document.querySelectorAll(".deleteTravelBtn").forEach((btn) => {
    btn.onclick = async () => {
      const ok = window.confirm("Diese Fahrt wirklich löschen?");
      if (!ok) return;

      try {
        deleteKilometerTravel(btn.dataset.travelId);
        await queuePersistRuntimeData();
        showKilometerView({ onLock, summaryFrom, summaryTo, editTravelId: editTravelId === (btn.dataset.travelId || '') ? '' : editTravelId });
      } catch (err) {
        console.error(err);
        alert(err?.message || "Fahrt konnte nicht gelöscht werden.");
      }
    };
  });
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
      patientId: context.patientId,
      returnTo: context.returnTo || null
    });
  }

  if (view === "rezept-create") {
    return showCreateRezeptView({
      onLock,
      homeId: context.homeId,
      patientId: context.patientId,
      returnTo: context.returnTo || null
    });
  }

  if (view === "rezept-edit") {
    return showEditRezeptView({
      onLock,
      homeId: context.homeId,
      patientId: context.patientId,
      rezeptId: context.rezeptId,
      returnTo: context.returnTo || null
    });
  }

  if (view === "rezept-detail") {
    return showRezeptDetailView({
      onLock,
      homeId: context.homeId,
      patientId: context.patientId,
      rezeptId: context.rezeptId,
      returnTo: context.returnTo || null
    });
  }

  if (view === "entry-edit") {
    return showEditRezeptEntryView({
      onLock,
      homeId: context.homeId,
      patientId: context.patientId,
      rezeptId: context.rezeptId,
      entryId: context.entryId,
      returnTo: context.returnTo || null
    });
  }

  if (view === "doctor-report-editor") {
    return showDoctorReportEditorView({
      onLock,
      homeId: context.homeId,
      patientId: context.patientId,
      rezeptId: context.rezeptId,
      reportId: context.reportId,
      searchText: context.searchText || ""
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
    return showKilometerView({ onLock, summaryFrom: context.summaryFrom || "", summaryTo: context.summaryTo || "", editTravelId: context.editTravelId || "" });
  }

  if (view === "settings") {
    return showSettingsView({ onLock });
  }

  if (view === "zeiterfassung") {
    return showZeiterfassungView({
      onLock,
      selectedHomeId: context.selectedHomeId || null,
      selectedPatientId: context.selectedPatientId || null,
      selectedRezeptId: context.selectedRezeptId || null
    });
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
// ─────────────────────────────────────────────
// ZEITERFASSUNG – Phase 2
// ─────────────────────────────────────────────

// Gemeinsamer mailto-Baustein für alle E-Mail-Versand-Stellen der App
// (Abwesenheit, Freikuvert, Nachbestellung).
function buildMailtoLink({ to, subject, body }) {
  const params = [`subject=${encodeURIComponent(subject)}`, `body=${encodeURIComponent(body)}`];
  return `mailto:${encodeURIComponent(to || "")}?${params.join("&")}`;
}

function buildAbwesenheitMailtoLink({ email, therapistName, type, from, to }) {
  const artLabel = type === "krank" ? "Krank" : "Urlaub";
  const subject = `Abwesenheitsmeldung – ${therapistName || "FaSt"}`;
  const body = [
    "Guten Tag,",
    "",
    "hiermit informiere ich über folgende Abwesenheit:",
    "",
    `Therapeut:  ${therapistName || "—"}`,
    `Art:        ${artLabel}`,
    `Zeitraum:   ${from} bis ${to}`,
    "",
    "Mit freundlichen Grüßen",
    therapistName || "—"
  ].join("\n");
  return buildMailtoLink({ to: email, subject, body });
}

export function showAbwesenheitView({ onLock }) {
  bindLockButton(onLock);
  setCurrentView("abwesenheit");

  const runtimeData = getRuntimeData();
  const homes = sortHomesAlpha(runtimeData?.homes || []);
  const therapistName = runtimeData?.settings?.therapistName || "";
  let confirmData = null;

  function renderForm() {
    render(`
      <div class="card">
        <h2>Krankmeldung &amp; Urlaub</h2>
        <button id="backDashboardBtn" class="secondary">Zurück zum Dashboard</button>
      </div>

      <div class="card">
        <label>Art der Abwesenheit</label>
        <div class="checkbox-row">
          <label class="check-chip"><input type="radio" name="abwesenheitTyp" id="typKrank" value="krank" checked> <span>Krank</span></label>
          <label class="check-chip"><input type="radio" name="abwesenheitTyp" id="typUrlaub" value="urlaub"> <span>Urlaub</span></label>
        </div>

        <label for="abwesenheitVon">Von</label>
        <input id="abwesenheitVon" type="text" placeholder="TT.MM.JJJJ" inputmode="numeric">

        <label for="abwesenheitBis">Bis</label>
        <input id="abwesenheitBis" type="text" placeholder="TT.MM.JJJJ" inputmode="numeric">

        <label style="margin-top:20px;">Einrichtungen informieren</label>
        ${homes.length === 0 ? `<p class="muted">Keine Einrichtungen vorhanden.</p>` : `
          <div class="list-stack">
            ${homes.map((home) => `
              <label class="check-chip" style="justify-content:flex-start;">
                <input type="checkbox" class="abwesenheitHomeCheck" value="${escapeHtml(home.homeId)}">
                <span>${escapeHtml(home.name || "Ohne Name")}${!home.verwaltungsEmail ? ' <span class="muted" style="font-weight:400;">(keine E-Mail hinterlegt)</span>' : ''}</span>
              </label>
            `).join("")}
          </div>
        `}

        <button id="weiterAbwesenheitBtn" style="margin-top:16px;">Weiter</button>
        <div id="abwesenheitMsg" class="error"></div>
      </div>
    `);

    document.getElementById("backDashboardBtn").onclick = () => showDashboardView({ onLock });
    bindDateAutoFormat(document.getElementById("abwesenheitVon"));
    bindDateAutoFormat(document.getElementById("abwesenheitBis"));
    bindCheckChipToggles(app);

    document.getElementById("weiterAbwesenheitBtn").onclick = () => {
      const msg = document.getElementById("abwesenheitMsg");
      msg.textContent = "";

      const type = document.querySelector('input[name="abwesenheitTyp"]:checked')?.value || "krank";
      const fromValue = document.getElementById("abwesenheitVon").value.trim();
      const toValue = document.getElementById("abwesenheitBis").value.trim();
      const normalizedFrom = parseDeDate(fromValue);
      const normalizedTo = parseDeDate(toValue);

      if (!normalizedFrom || !normalizedTo) {
        msg.textContent = "Bitte gültige Von- und Bis-Daten eingeben.";
        return;
      }
      if (normalizedTo < normalizedFrom) {
        msg.textContent = "Bis darf nicht vor Von liegen.";
        return;
      }

      const selectedHomeIds = Array.from(document.querySelectorAll(".abwesenheitHomeCheck:checked")).map((el) => el.value);
      if (selectedHomeIds.length === 0) {
        msg.textContent = "Bitte mindestens eine Einrichtung zum Informieren auswählen (oder ohne Benachrichtigung nur intern eintragen).";
      }

      confirmData = { type, from: fromValue, to: toValue, selectedHomeIds };
      renderConfirm();
    };
  }

  function renderConfirm() {
    const { type, from, to, selectedHomeIds } = confirmData;
    const artLabel = type === "krank" ? "Krank" : "Urlaub";
    const selectedHomes = homes.filter((home) => selectedHomeIds.includes(home.homeId));

    render(`
      <div class="card">
        <h2>Krankmeldung &amp; Urlaub</h2>
        <p class="muted">Bitte prüfen und bestätigen.</p>
      </div>

      <div class="card">
        <p><strong>Art:</strong> ${escapeHtml(artLabel)}</p>
        <p><strong>Zeitraum:</strong> ${escapeHtml(from)} bis ${escapeHtml(to)}</p>
        <p><strong>Therapeut:</strong> ${escapeHtml(therapistName || "—")}</p>
        <p style="margin-top:12px;"><strong>E-Mail an ausgewählte Einrichtungen senden?</strong></p>
        ${selectedHomes.length === 0
          ? `<p class="muted">Keine Einrichtung ausgewählt – es wird nur intern eingetragen, keine E-Mail versendet.</p>`
          : `<ul>${selectedHomes.map((home) => `<li>${escapeHtml(home.name || "Ohne Name")}</li>`).join("")}</ul>`}

        <div class="row" style="margin-top:16px;">
          <button id="confirmAbwesenheitBtn">Ja, bestätigen</button>
          <button id="cancelAbwesenheitBtn" class="secondary">Abbrechen</button>
        </div>
      </div>
    `);

    document.getElementById("cancelAbwesenheitBtn").onclick = () => renderForm();

    document.getElementById("confirmAbwesenheitBtn").onclick = async () => {
      try {
        createAbwesenheit({ type, from, to });
        await queuePersistRuntimeData();
        renderMailtoLinks({ type, from, to, homes: selectedHomes });
      } catch (err) {
        console.error(err);
        alert(err?.message || "Eintrag konnte nicht gespeichert werden.");
      }
    };
  }

  function renderMailtoLinks({ type, from, to, homes: selectedHomes }) {
    const homesWithEmail = selectedHomes.filter((home) => home.verwaltungsEmail);
    const homesWithoutEmail = selectedHomes.filter((home) => !home.verwaltungsEmail);

    render(`
      <div class="card">
        <h2>Krankmeldung &amp; Urlaub</h2>
        <p class="muted">Eintrag gespeichert. Bitte pro Einrichtung die E-Mail öffnen und versenden.</p>
        <button id="backDashboardBtn2" class="secondary">Zurück zum Dashboard</button>
      </div>

      ${homesWithEmail.length === 0 ? "" : `
        <div class="card">
          <h3>E-Mails öffnen</h3>
          <p class="muted">Öffnet das E-Mail-Programm mit vorausgefülltem Text. Enthält keine Patientennamen.</p>
          <div class="list-stack">
            ${homesWithEmail.map((home) => `
              <div class="compact-card" style="display:flex; justify-content:space-between; align-items:center; gap:10px;">
                <div>${escapeHtml(home.name || "Ohne Name")}</div>
                <a class="mailtoAbwesenheitLink" style="width:auto;" href="${buildAbwesenheitMailtoLink({ email: home.verwaltungsEmail, therapistName, type, from, to })}"><button type="button" style="width:auto; margin:0;">E-Mail öffnen</button></a>
              </div>
            `).join("")}
          </div>
        </div>
      `}

      ${homesWithoutEmail.length === 0 ? "" : `
        <div class="card">
          <h3>Keine Verwaltungs-E-Mail hinterlegt</h3>
          <p class="muted">Für folgende Einrichtungen fehlt die Verwaltungs-E-Mail (Einrichtungen → Heim bearbeiten):</p>
          <ul>${homesWithoutEmail.map((home) => `<li>${escapeHtml(home.name || "Ohne Name")}</li>`).join("")}</ul>
        </div>
      `}
    `);

    document.getElementById("backDashboardBtn2").onclick = () => showDashboardView({ onLock });
  }

  renderForm();
}

function buildFreikuvertMailtoLink({ bueroEmail, arztName, arztAdresse, therapistName }) {
  const subject = `Freikuvert-Bestellung – ${arztName}`;
  const body = [
    `Bitte Freikuverts senden an: ${arztName} ${arztAdresse || ""}`.trim(),
    `Bestellt von: ${therapistName || "—"}`
  ].join("\n");
  return buildMailtoLink({ to: bueroEmail, subject, body });
}

// mailto kann keine Datei anhängen - der Nachbestellzettel wird deshalb vorher
// als Druckvorschau geöffnet (dort kann der Therapeut z.B. "Als PDF speichern"
// wählen), und die E-Mail listet die angefragten Verordnungen als Text auf,
// mit dem Hinweis, den soeben geöffneten Zettel manuell anzuhängen.
function buildNachbestellMailtoLink({ letterData, lines, arztEmail, therapistName }) {
  const subject = `Rezeptnachbestellung Physiotherapie – ${therapistName || "FaSt"}`;
  const body = [
    `Sehr geehrte(r) ${letterData.doctor || ""},`,
    "",
    "anbei die Anfrage zur Nachbestellung folgender Heilmittelverordnungen (bitte den soeben geöffneten/heruntergeladenen Nachbestellzettel als PDF anhängen):",
    "",
    ...lines.map((line) => `- ${line.patient}${line.geb ? ` (geb. ${line.geb})` : ""} – ${line.heim ? `${line.heim} – ` : ""}${line.text}`),
    "",
    `Vielen Dank,`,
    therapistName || ""
  ].join("\n");
  return buildMailtoLink({ to: arztEmail, subject, body });
}

export function showFreikuvertView({ onLock }) {
  bindLockButton(onLock);
  setCurrentView("freikuvert");

  const runtimeData = getRuntimeData();
  const aerzte = getArztRegistry(runtimeData);
  const therapistName = runtimeData?.settings?.therapistName || "";
  const bueroEmail = runtimeData?.settings?.buero?.email || "";

  function renderForm(message = "") {
    render(`
      <div class="card">
        <h2>Freikuvert bestellen</h2>
        <button id="backDashboardBtn" class="secondary">Zurück zum Dashboard</button>
      </div>

      ${!bueroEmail ? `<div class="card"><p class="error" style="margin:0;">Keine Büro-E-Mail-Adresse in den Einstellungen hinterlegt. Bitte zuerst in den Einstellungen ergänzen.</p></div>` : ""}

      <div class="card">
        <label for="freikuvertArzt">Arzt</label>
        <select id="freikuvertArzt">
          <option value="">Bitte wählen</option>
          ${aerzte.map((arzt) => `<option value="${escapeHtml(arzt.name)}" data-adresse="${escapeHtml(arzt.adresse || "")}">${escapeHtml(arzt.name)}</option>`).join("")}
        </select>
        <div id="freikuvertArztAdresseHinweis" class="compact-meta"></div>

        <button id="freikuvertWeiterBtn" style="margin-top:12px;" ${bueroEmail ? "" : "disabled"}>Freikuvert bestellen</button>
        <div id="freikuvertMsg" class="error">${escapeHtml(message)}</div>
      </div>
    `);

    document.getElementById("backDashboardBtn").onclick = () => showDashboardView({ onLock });

    const arztSelect = document.getElementById("freikuvertArzt");
    const adresseHinweis = document.getElementById("freikuvertArztAdresseHinweis");
    const updateAdresseHinweis = () => {
      const adresse = arztSelect.selectedOptions[0]?.dataset.adresse || "";
      adresseHinweis.textContent = arztSelect.value
        ? (adresse ? `Adresse: ${adresse}` : "Keine Adresse hinterlegt – bitte beim Anlegen eines Rezepts für diesen Arzt ergänzen.")
        : "";
    };
    arztSelect.onchange = updateAdresseHinweis;

    document.getElementById("freikuvertWeiterBtn").onclick = () => {
      const arztName = arztSelect.value.trim();
      const arztAdresse = arztSelect.selectedOptions[0]?.dataset.adresse || "";
      const msg = document.getElementById("freikuvertMsg");
      msg.textContent = "";

      if (!arztName) {
        msg.textContent = "Bitte einen Arzt auswählen.";
        return;
      }
      if (!arztAdresse) {
        msg.textContent = "Für diesen Arzt ist keine Adresse hinterlegt. Bitte beim Anlegen eines Rezepts für diesen Arzt ergänzen.";
        return;
      }

      renderConfirm({ arztName, arztAdresse });
    };
  }

  function renderConfirm({ arztName, arztAdresse }) {
    render(`
      <div class="card">
        <h2>Freikuvert bestellen</h2>
        <p class="muted">Bitte prüfen und bestätigen.</p>
      </div>

      <div class="card">
        <p><strong>Freikuverts an ${escapeHtml(arztName)} bestellen?</strong></p>
        <p><strong>Adresse:</strong> ${escapeHtml(arztAdresse)}</p>
        <p><strong>Anzahl:</strong> 10 Stück</p>
        <p><strong>Bestellt von:</strong> ${escapeHtml(therapistName || "—")}</p>

        <div class="row" style="margin-top:16px;">
          <button id="confirmFreikuvertBtn">Ja, bestellen</button>
          <button id="cancelFreikuvertBtn" class="secondary">Abbrechen</button>
        </div>
      </div>
    `);

    document.getElementById("cancelFreikuvertBtn").onclick = () => renderForm();

    document.getElementById("confirmFreikuvertBtn").onclick = async () => {
      try {
        upsertArztAdresse(arztName, arztAdresse);
        saveFreikuvertBestellung({ arztName, arztAdresse, therapistName });
        await queuePersistRuntimeData();
        renderMailtoLink({ arztName, arztAdresse });
      } catch (err) {
        console.error(err);
        alert(err?.message || "Bestellung konnte nicht gespeichert werden.");
      }
    };
  }

  function renderMailtoLink({ arztName, arztAdresse }) {
    render(`
      <div class="card">
        <h2>Freikuvert bestellen</h2>
        <p class="muted">Bestellung gespeichert. Bitte E-Mail ans Büro öffnen und versenden.</p>
        <button id="backDashboardBtn2" class="secondary">Zurück zum Dashboard</button>
      </div>

      <div class="card">
        <a href="${buildFreikuvertMailtoLink({ bueroEmail, arztName, arztAdresse, therapistName })}"><button type="button">E-Mail ans Büro öffnen</button></a>
      </div>
    `);

    document.getElementById("backDashboardBtn2").onclick = () => showDashboardView({ onLock });
  }

  renderForm();
}

const FAQ_CHECKLISTE_ITEMS = [
  "Name Patient vorhanden",
  "ICD-10 Code vorhanden",
  "Leitsymptomatik vorhanden",
  "Heilmittel + Anzahl vorhanden",
  "Hausbesuch angekreuzt ja/nein",
  "Arzt-Stempel vorhanden",
  "Arzt-Unterschrift vorhanden"
];

export function showFaqView({ onLock }) {
  bindLockButton(onLock);
  setCurrentView("faq");

  render(`
    <div class="card">
      <h2>FAQ</h2>
      <p class="muted">Häufige Fragen rund um Rezepte und GKV-Regeln.</p>
      <button id="backDashboardBtn" class="secondary">Zurück zum Dashboard</button>
    </div>

    <details class="accordion">
      <summary>
        <span>Rezeptgültigkeit</span>
        <span class="muted">Fristen je Rezepttyp</span>
      </summary>
      <div class="accordion-body">
        <table style="width:100%; border-collapse:collapse; font-size:14px;">
          <tr style="border-bottom:1px solid var(--border);"><th style="text-align:left; padding:6px 4px;">Rezepttyp</th><th style="text-align:left; padding:6px 4px;">Gültigkeit</th></tr>
          <tr style="border-bottom:1px solid var(--border);"><td style="padding:6px 4px;">GKV normal</td><td style="padding:6px 4px;">28 Kalendertage ab Ausstellungsdatum</td></tr>
          <tr style="border-bottom:1px solid var(--border);"><td style="padding:6px 4px;">GKV dringender Bedarf</td><td style="padding:6px 4px;">14 Kalendertage ab Ausstellungsdatum</td></tr>
          <tr style="border-bottom:1px solid var(--border);"><td style="padding:6px 4px;">BG-Rezept</td><td style="padding:6px 4px;">14 Kalendertage ab Ausstellungsdatum</td></tr>
          <tr><td style="padding:6px 4px;">Blanko-VO</td><td style="padding:6px 4px;">16 Wochen ab Ausstellungsdatum</td></tr>
        </table>
      </div>
    </details>

    <details class="accordion">
      <summary>
        <span>Spätestes Anfangsdatum berechnen</span>
        <span class="muted">Ausstellungsdatum + Rezepttyp</span>
      </summary>
      <div class="accordion-body">
        <label for="faqAusstell">Ausstellungsdatum</label>
        <input id="faqAusstell" type="text" placeholder="TT.MM.JJJJ" inputmode="numeric">

        <label for="faqRezepttyp">Rezepttyp</label>
        <select id="faqRezepttyp">
          <option value="normal">GKV normal</option>
          <option value="dringend">GKV dringender Bedarf</option>
          <option value="bg">BG-Rezept</option>
        </select>

        <button id="faqBerechnenBtn" style="margin-top:12px;">Berechnen</button>
        <div id="faqBerechnenResult" style="margin-top:12px;"></div>
      </div>
    </details>

    <details class="accordion">
      <summary>
        <span>Unterbrechungsfristen</span>
        <span class="muted">Nach Anzahl Behandlungen</span>
      </summary>
      <div class="accordion-body">
        <table style="width:100%; border-collapse:collapse; font-size:14px;">
          <tr style="border-bottom:1px solid var(--border);"><th style="text-align:left; padding:6px 4px;">Anzahl Behandlungen</th><th style="text-align:left; padding:6px 4px;">Unterbrechungsfrist</th></tr>
          <tr style="border-bottom:1px solid var(--border);"><td style="padding:6px 4px;">Bis 6 Behandlungen</td><td style="padding:6px 4px;">3 Monate ab erster Behandlung</td></tr>
          <tr style="border-bottom:1px solid var(--border);"><td style="padding:6px 4px;">Mehr als 6 Behandlungen</td><td style="padding:6px 4px;">6 Monate ab erster Behandlung</td></tr>
          <tr style="border-bottom:1px solid var(--border);"><td style="padding:6px 4px;">BG-Rezept</td><td style="padding:6px 4px;">28 Kalendertage ab Ausstellungsdatum</td></tr>
          <tr><td style="padding:6px 4px;">Blanko-VO</td><td style="padding:6px 4px;">Keine Regelung</td></tr>
        </table>
      </div>
    </details>

    <details class="accordion">
      <summary>
        <span>Rezept-Checkliste</span>
        <span class="muted">Pflichtangaben</span>
      </summary>
      <div class="accordion-body">
        <ul style="margin:0; padding-left:20px; line-height:1.7;">
          ${FAQ_CHECKLISTE_ITEMS.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
        </ul>
      </div>
    </details>
  `);

  document.getElementById("backDashboardBtn").onclick = () => showDashboardView({ onLock });

  bindDateAutoFormat(document.getElementById("faqAusstell"));
  bindCheckChipToggles(app);

  document.getElementById("faqBerechnenBtn").onclick = () => {
    const ausstell = document.getElementById("faqAusstell").value.trim();
    const typ = document.getElementById("faqRezepttyp").value;
    const resultEl = document.getElementById("faqBerechnenResult");

    const fakeRezept = {
      ausstell,
      bg: typ === "bg",
      dringend: typ === "dringend",
      items: [{ type: "KG", count: "6" }]
    };

    const frist = getRezeptFristInfo(fakeRezept);
    if (frist.mode === "unknown") {
      resultEl.innerHTML = `<p class="error" style="margin:0;">Bitte ein gültiges Ausstellungsdatum eingeben.</p>`;
      return;
    }

    resultEl.innerHTML = `
      <p class="pill-green" style="display:block;">Spätester Behandlungsbeginn: ${escapeHtml(frist.latestStartText)}</p>
      <p class="muted">${escapeHtml(frist.detailsText)}</p>
    `;
  };

}

// ─────────────────────────────────────────────
// SUPPORT-SEITE (Leitfaden, siehe data/hilfe-inhalt.js)
// ─────────────────────────────────────────────

// ä/ae, ö/oe, ü/ue, ß/ss werden auf dieselbe Schreibweise gebracht, damit
// z.B. "ueberstunden" (ohne Umlaut eingetippt) dieselben Treffer liefert
// wie "überstunden" - wird auf Such-Eingabe UND auf den durchsuchten Text
// gleichermaßen angewendet, siehe buildSupportSearchIndex().
function normalizeSupportSearchText(value) {
  return String(value || "")
    .toLowerCase()
    .replaceAll("ä", "ae")
    .replaceAll("ö", "oe")
    .replaceAll("ü", "ue")
    .replaceAll("ß", "ss");
}

function stripHilfeBold(value) {
  return String(value || "").replaceAll("**", "");
}

function hilfeBlockPlainText(block) {
  if (block.typ === "text" || block.typ === "ueberschrift") return stripHilfeBold(block.text);
  if (block.typ === "liste" || block.typ === "schritte") return block.items.map(stripHilfeBold).join(" ");
  if (block.typ === "tabelle") {
    return [...block.kopf, ...block.zeilen.flat()].map(stripHilfeBold).join(" ");
  }
  return "";
}

// Baut aus den **…**-Markierungen in hilfe-inhalt.js <strong>-Tags, nachdem
// der Text bereits escaped (und ggf. mit <mark> markiert) wurde - die
// **-Zeichen selbst sind für escapeHtml() unsichtbar, deshalb ist diese
// Reihenfolge unproblematisch.
function boldifyHilfeText(escapedHtml) {
  return escapedHtml.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

function highlightHilfeMatches(escapedHtml, rawQuery) {
  const query = (rawQuery || "").trim();
  if (!query) return escapedHtml;
  const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!escapedQuery) return escapedHtml;
  return escapedHtml.replace(new RegExp(`(${escapedQuery})`, "gi"), `<mark style="background:#fde68a; color:inherit; padding:0 2px; border-radius:2px;">$1</mark>`);
}

function renderHilfeInlineText(rawText, query) {
  return boldifyHilfeText(highlightHilfeMatches(escapeHtml(rawText), query));
}

function renderHilfeBloecke(bloecke, query) {
  return bloecke.map((block) => {
    if (block.typ === "text") {
      return `<p style="margin:10px 0;">${renderHilfeInlineText(block.text, query)}</p>`;
    }
    if (block.typ === "ueberschrift") {
      return `<h4 style="margin:18px 0 8px;">${renderHilfeInlineText(block.text, query)}</h4>`;
    }
    if (block.typ === "liste") {
      return `<ul style="margin:10px 0; padding-left:20px; line-height:1.7;">${block.items.map((item) => `<li>${renderHilfeInlineText(item, query)}</li>`).join("")}</ul>`;
    }
    if (block.typ === "schritte") {
      return `<ol style="margin:10px 0; padding-left:20px; line-height:1.7;">${block.items.map((item) => `<li>${renderHilfeInlineText(item, query)}</li>`).join("")}</ol>`;
    }
    if (block.typ === "tabelle") {
      const kopf = `<tr style="border-bottom:1px solid var(--border);">${block.kopf.map((h) => `<th style="text-align:left; padding:6px 4px;">${renderHilfeInlineText(h, query)}</th>`).join("")}</tr>`;
      const zeilen = block.zeilen.map((row) => `<tr style="border-bottom:1px solid var(--border);">${row.map((cell) => `<td style="padding:6px 4px;">${renderHilfeInlineText(cell, query)}</td>`).join("")}</tr>`).join("");
      return `<table style="width:100%; border-collapse:collapse; font-size:14px; margin:10px 0;">${kopf}${zeilen}</table>`;
    }
    return "";
  }).join("");
}

// Flacher Such-Index über alle Abschnitte aller Kapitel, einmal beim Laden
// des Moduls aus HILFE_KAPITEL (data/hilfe-inhalt.js) aufgebaut. Ändert
// jemand dort Text oder Stichwörter, übernimmt die Support-Seite das beim
// nächsten Laden automatisch - an dieser Stelle muss nichts angepasst
// werden.
const HILFE_SUCH_INDEX = HILFE_KAPITEL.flatMap((kapitel) =>
  kapitel.abschnitte.map((abschnitt) => {
    const plainText = abschnitt.bloecke.map(hilfeBlockPlainText).join(" ");
    const haystack = normalizeSupportSearchText([
      abschnitt.titel,
      kapitel.titel,
      plainText,
      ...(abschnitt.stichwoerter || [])
    ].join(" "));
    return {
      kapitelNummer: kapitel.nummer,
      kapitelTitel: kapitel.titel,
      anker: abschnitt.anker,
      titel: abschnitt.titel,
      plainText,
      haystack
    };
  })
);

function buildHilfeExcerpt(plainText, rawQuery) {
  const query = (rawQuery || "").trim();
  const maxLen = 140;
  let idx = -1;
  if (query) {
    idx = plainText.toLowerCase().indexOf(query.toLowerCase());
  }
  if (idx < 0) {
    return plainText.length > maxLen ? `${plainText.slice(0, maxLen).trim()}…` : plainText;
  }
  const start = Math.max(0, idx - 40);
  const end = Math.min(plainText.length, idx + query.length + 80);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < plainText.length ? "…" : "";
  return `${prefix}${plainText.slice(start, end).trim()}${suffix}`;
}

function renderSupportTocHtml() {
  return `
    <div class="list-stack">
      ${HILFE_KAPITEL.map((kapitel) => `
        <div class="compact-card supportTocItem" data-kapitel="${escapeHtml(kapitel.nummer)}" style="cursor:pointer; display:flex; justify-content:space-between; align-items:center; gap:10px;">
          <div style="font-weight:600;">${escapeHtml(kapitel.nummer)}. ${escapeHtml(kapitel.titel)}</div>
          <div class="muted">›</div>
        </div>
      `).join("")}
    </div>
  `;
}

function renderSupportResultsHtml(rawQuery) {
  const query = normalizeSupportSearchText(rawQuery);
  const treffer = HILFE_SUCH_INDEX.filter((item) => item.haystack.includes(query));

  if (treffer.length === 0) {
    return `<p class="muted">Nichts gefunden. Versuch ein anderes Wort oder schau ins Inhaltsverzeichnis.</p>`;
  }

  return `
    <div class="list-stack">
      ${treffer.map((item) => `
        <div class="compact-card supportResultItem" data-anker="${escapeHtml(item.anker)}" style="cursor:pointer;">
          <div style="font-weight:700;">${escapeHtml(item.kapitelNummer)}. ${renderHilfeInlineText(item.titel, rawQuery)}</div>
          <div class="compact-meta" style="margin-top:4px;">${renderHilfeInlineText(buildHilfeExcerpt(item.plainText, rawQuery), rawQuery)}</div>
        </div>
      `).join("")}
    </div>
  `;
}

function renderSupportKapitelHtml(query) {
  return HILFE_KAPITEL.map((kapitel) => `
    <details class="accordion" id="hilfeKapitel-${escapeHtml(kapitel.nummer)}">
      <summary>
        <span>${escapeHtml(kapitel.nummer)}. ${escapeHtml(kapitel.titel)}</span>
      </summary>
      <div class="accordion-body">
        ${kapitel.abschnitte.map((abschnitt) => {
          const zeigeEigeneUeberschrift = !(abschnitt.anker === kapitel.nummer && abschnitt.titel === kapitel.titel);
          return `
            <div id="abschnitt-${escapeHtml(abschnitt.anker)}">
              ${zeigeEigeneUeberschrift ? `<h3 style="margin:20px 0 8px;">${renderHilfeInlineText(abschnitt.titel, query)}</h3>` : ""}
              ${renderHilfeBloecke(abschnitt.bloecke, query)}
            </div>
          `;
        }).join("")}
      </div>
    </details>
  `).join("");
}

export function showSupportView({ onLock } = {}) {
  bindLockButton(onLock);
  setCurrentView("support");

  render(`
    <div class="card">
      <h2>Support</h2>
      <p class="muted">Leitfaden zur App, zum Nachschlagen – auch offline.</p>
      <button id="backDashboardBtn" class="secondary">Zurück zum Dashboard</button>
    </div>

    <div class="card">
      <label for="supportSearchInput">Suche</label>
      <input id="supportSearchInput" type="text" placeholder="z. B. Frist, PIN, Kuvert …" autocomplete="off">
    </div>

    <div id="supportTocResultContainer"></div>

    <div id="supportKapitelContainer"></div>
  `);

  document.getElementById("backDashboardBtn").onclick = () => showDashboardView({ onLock });

  const tocResultContainer = document.getElementById("supportTocResultContainer");
  const kapitelContainer = document.getElementById("supportKapitelContainer");
  const searchInput = document.getElementById("supportSearchInput");

  function openSupportKapitel(nummer) {
    const details = document.getElementById(`hilfeKapitel-${nummer}`);
    if (!details) return;
    details.open = true;
    details.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function openSupportAbschnitt(anker) {
    const eintrag = HILFE_SUCH_INDEX.find((item) => item.anker === anker);
    if (!eintrag) return;
    const details = document.getElementById(`hilfeKapitel-${eintrag.kapitelNummer}`);
    if (details) details.open = true;
    const target = document.getElementById(`abschnitt-${anker}`);
    if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function refreshSupportView(query) {
    tocResultContainer.innerHTML = query.trim() ? renderSupportResultsHtml(query) : renderSupportTocHtml();

    const offeneKapitel = Array.from(kapitelContainer.querySelectorAll("details[open]")).map((d) => d.id);
    kapitelContainer.innerHTML = renderSupportKapitelHtml(query);
    offeneKapitel.forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.open = true;
    });
  }

  refreshSupportView("");

  searchInput.oninput = () => refreshSupportView(searchInput.value);

  tocResultContainer.addEventListener("click", (e) => {
    const tocItem = e.target.closest(".supportTocItem");
    if (tocItem) {
      openSupportKapitel(tocItem.dataset.kapitel);
      return;
    }
    const resultItem = e.target.closest(".supportResultItem");
    if (resultItem) {
      openSupportAbschnitt(resultItem.dataset.anker);
    }
  });
}

export function showStundenkontoView({
  onLock,
  calYear = null,
  calMonth = null,
  rangeStart = "",
  rangeEnd = "",
  pendingStart = "",
  timeSummaryFrom = "",
  timeSummaryTo = "",
  showAbsenceForm = false,
  showHolidayForm = false,
  showAbgleichForm = false,
  msgText = ""
} = {}) {
  bindLockButton(onLock);
  setCurrentView("stundenkonto", { calYear, calMonth, rangeStart, rangeEnd, pendingStart, timeSummaryFrom, timeSummaryTo, showAbsenceForm, showHolidayForm, showAbgleichForm });

  const runtimeData = getRuntimeData();
  const timePeriodSummary = getTimePeriodSummary(runtimeData, timeSummaryFrom, timeSummaryTo);
  const absenceRows = timePeriodSummary.absenceRows;
  const specialDayRows = timePeriodSummary.specialDayRows;
  const stundenAbgleichRows = timePeriodSummary.stundenAbgleichRows || [];

  // Kalender-Daten für Zeitraum-Auswahl
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const calYearResolved = calYear || today.getFullYear();
  const calMonthResolved = calMonth || (today.getMonth() + 1);
  const todayComparable = getComparableFromDate(today);
  const grid = buildCalendarMonthGrid(calYearResolved, calMonthResolved);
  const weekDayLabels = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
  const hasRange = Boolean(rangeStart && rangeEnd);
  const fromDe = rangeStart ? formatDeDate(rangeStart) : '';
  const toDe = rangeEnd ? formatDeDate(rangeEnd) : '';

  // Wenn Kalenderbereich gewählt → in Datum-Felder übernehmen
  const effectiveFrom = hasRange ? fromDe : timeSummaryFrom;
  const effectiveTo = hasRange ? toDe : timeSummaryTo;

  // Patienten-Liste im gewählten Zeitraum
  const patientsInRange = hasRange ? getPatientsInDateRange(runtimeData, fromDe, toDe) : [];
  const totalMinutesInRange = patientsInRange.reduce((sum, row) => sum + row.totalMinutes, 0);
  const groupedByDate = new Map();
  patientsInRange.forEach((row) => {
    if (!groupedByDate.has(row.date)) groupedByDate.set(row.date, []);
    groupedByDate.get(row.date).push(row);
  });
  const sortedDates = Array.from(groupedByDate.keys()).sort((a, b) => compareDeDates(a, b));

  render(`
    <div class="card">
      <h2>Stundenkonto</h2>
      <button id="stundenkontoBackDashboardBtn" class="secondary">Zurück zum Dashboard</button>
    </div>

    <div class="card">
      <div class="row" style="margin-top:0;">
        <button id="quickThisWeekBtn" class="secondary" style="margin-top:0;">Diese Woche</button>
        <button id="quickLastWeekBtn" class="secondary" style="margin-top:0;">Letzte Woche</button>
      </div>
      <div class="row" style="margin-top:12px;">
        <button id="quickThisMonthBtn" class="secondary" style="margin-top:0;">Dieser Monat</button>
        <button id="quickLastMonthBtn" class="secondary" style="margin-top:0;">Letzter Monat</button>
      </div>

      <div style="display:flex; align-items:center; justify-content:space-between; margin-top:18px;">
        <button id="calPrevMonthBtn" class="secondary" style="width:auto; margin-top:0; padding:8px 14px;">‹</button>
        <div style="font-weight:700; font-size:16px;">${escapeHtml(getMonthLabelDe(calYearResolved, calMonthResolved))}</div>
        <button id="calNextMonthBtn" class="secondary" style="width:auto; margin-top:0; padding:8px 14px;">›</button>
      </div>

      <div style="display:grid; grid-template-columns:repeat(7, 1fr); gap:4px; margin-top:12px; text-align:center;">
        ${weekDayLabels.map(label => `<div class="compact-meta" style="font-weight:600;">${label}</div>`).join('')}
        ${grid.map(cellDate => {
          if (!cellDate) return `<div></div>`;
          const dayNum = Number(cellDate.slice(-2));
          const isToday = cellDate === todayComparable;
          const isStart = cellDate === rangeStart;
          const isEnd = cellDate === rangeEnd;
          const isPending = cellDate === pendingStart;
          const isInRange = hasRange && cellDate > rangeStart && cellDate < rangeEnd;

          let bg = 'transparent';
          let color = 'var(--text)';
          let fontWeight = '500';
          if (isStart || isEnd || isPending) { bg = 'var(--primary)'; color = '#fff'; fontWeight = '700'; }
          else if (isInRange) { bg = 'rgba(37,99,235,.12)'; }
          else if (isToday) { bg = 'rgba(37,99,235,.08)'; fontWeight = '700'; }

          return `<button class="cal-day-btn" data-date="${cellDate}" style="margin-top:0; padding:10px 0; border-radius:8px; background:${bg}; color:${color}; font-weight:${fontWeight}; font-size:14px;">${dayNum}</button>`;
        }).join('')}
      </div>

      <p class="muted" style="margin-top:14px; margin-bottom:0;">
        ${pendingStart && !hasRange
          ? `Start: ${escapeHtml(formatDeDate(pendingStart))} — jetzt Endtag antippen.`
          : hasRange
            ? `Zeitraum: ${escapeHtml(fromDe)} – ${escapeHtml(toDe)}`
            : 'Tippe einen Tag an, oder zwei Tage für einen Zeitraum.'
        }
      </p>
      ${hasRange ? `<button id="clearRangeBtn" class="secondary" style="margin-top:10px;">Auswahl zurücksetzen</button>` : ''}
    </div>

    ${hasRange ? `
      <div class="card">
        <h3>Gesamtzeit</h3>
        <div style="font-weight:700; font-size:20px; color:var(--primary);">${escapeHtml(formatHoursClockLabel(totalMinutesInRange))}</div>
        <div class="compact-meta">${escapeHtml(fromDe)} – ${escapeHtml(toDe)}</div>
      </div>

      <div class="card">
        <h3>Behandelte Patienten</h3>
        ${patientsInRange.length === 0
          ? `<p class="muted">Keine Zeiteinträge im gewählten Zeitraum.</p>`
          : sortedDates.map(date => `
              <details class="accordion">
                <summary>
                  <span>${escapeHtml(date)}</span>
                  <span class="muted">${escapeHtml(formatMinutesLabel(groupedByDate.get(date).reduce((s, r) => s + r.totalMinutes, 0)))}</span>
                </summary>
                <div class="accordion-body">
                  <div class="list-stack">
                    ${groupedByDate.get(date).map(row => `
                      <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; padding:10px 0; border-bottom:1px solid var(--border);">
                        <div style="min-width:0;">
                          <div style="font-weight:600; font-size:15px;">${escapeHtml(row.patientName)}</div>
                          <div class="compact-meta">${escapeHtml(row.rezeptLabel || '—')}</div>
                        </div>
                        <div style="display:flex; align-items:center; gap:10px; flex-shrink:0;">
                          <div style="font-weight:700; color:var(--primary); font-size:15px; white-space:nowrap;">${escapeHtml(formatMinutesLabel(row.totalMinutes))}</div>
                          <button
                            class="delete-zeitraum-entry-btn danger"
                            style="padding:6px 10px; font-size:13px; white-space:nowrap;"
                            data-home-id="${escapeHtml(row.homeId)}"
                            data-patient-id="${escapeHtml(row.patientId)}"
                            data-rezept-id="${escapeHtml(row.rezeptId)}"
                            data-time-entry-id="${escapeHtml(row.timeEntryId)}"
                          >Löschen</button>
                        </div>
                      </div>
                    `).join('')}
                  </div>
                </div>
              </details>
            `).join('')
        }
      </div>
    ` : ''}

    <div class="card">
      <label for="stundenkontoFrom">Von</label>
      <input id="stundenkontoFrom" type="text" value="${escapeHtml(effectiveFrom)}" placeholder="TT.MM.JJJJ" inputmode="numeric">

      <label for="stundenkontoTo">Bis</label>
      <input id="stundenkontoTo" type="text" value="${escapeHtml(effectiveTo)}" placeholder="TT.MM.JJJJ" inputmode="numeric">

      <button id="runStundenkontoBtn" style="margin-top:16px;">Auswertung anzeigen</button>

      ${timeSummaryFrom || timeSummaryTo ? `
      <div class="compact-card" style="margin-top:16px; padding:16px;">
        <div style="font-size:18px; font-weight:700; margin-bottom:12px;">Zeitsaldo</div>

        <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 0; border-bottom:1px solid var(--border);">
          <div class="compact-meta">Geleistet</div>
          <div style="font-weight:700; font-size:15px;">${escapeHtml(formatHoursClockLabel(timePeriodSummary.totalMinutes))}</div>
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 0; border-bottom:1px solid var(--border);">
          <div class="compact-meta">Soll</div>
          <div style="font-weight:700; font-size:15px;">${escapeHtml(formatHoursClockLabel(timePeriodSummary.plannedMinutes))}</div>
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 0 4px 0;">
          <div style="font-weight:700;">Saldo</div>
          <div style="font-weight:700; font-size:17px; color:${timePeriodSummary.saldoMinutes >= 0 ? 'var(--primary)' : 'var(--danger)'};">
            ${timePeriodSummary.saldoMinutes >= 0 ? '+' : ''}${escapeHtml(getSignedMinutesLabel(timePeriodSummary.saldoMinutes))}
          </div>
        </div>
      </div>
      ` : `<p class="muted" style="margin-top:16px;">Zeitraum eingeben und "Auswertung anzeigen" tippen.</p>`}
    </div>

    <div class="card">
      <h3>Urlaub / Krank</h3>
      ${!showAbsenceForm ? `<button id="openAbsenceFormBtn" class="secondary">Eintragen</button>` : `
        <label for="stundenkontoAbsenceFrom">Von</label>
        <input id="stundenkontoAbsenceFrom" type="text" placeholder="TT.MM.JJJJ" inputmode="numeric">

        <label for="stundenkontoAbsenceTo">Bis</label>
        <input id="stundenkontoAbsenceTo" type="text" placeholder="TT.MM.JJJJ" inputmode="numeric">

        <div class="row" style="margin-top:12px;">
          <button id="saveAsUrlaubBtn">Urlaub</button>
          <button id="saveAsKrankBtn">Krank</button>
        </div>
        <button id="cancelAbsenceFormBtn" class="secondary">Abbrechen</button>
        <div id="absenceMsg" class="error"></div>
      `}

      <details class="accordion" style="margin-top:16px;">
        <summary>
          <span>Erfasste Einträge</span>
          <span class="muted">${escapeHtml(String(absenceRows.length))}</span>
        </summary>
        <div class="accordion-body">
          <div class="list-stack">
            ${absenceRows.length === 0 ? `<p class="muted" style="margin:0;">Keine Einträge im gewählten Zeitraum.</p>` : ''}
            ${absenceRows.map((item) => `
              <div class="compact-card" style="margin:0; padding:12px;">
                <div style="font-weight:700; font-size:16px; margin-bottom:4px;">${escapeHtml(item.type === 'krank' ? 'Krank' : 'Urlaub')}</div>
                <div class="compact-meta">${escapeHtml(item.from || '—')} bis ${escapeHtml(item.to || '—')}</div>
                <button class="delete-absence-btn secondary" data-absence-id="${escapeHtml(item.id || '')}" style="margin-top:12px; width:100%;">Löschen</button>
              </div>
            `).join('')}
          </div>
        </div>
      </details>
    </div>

    <div class="card">
      <h3>Feiertage</h3>
      ${!showHolidayForm ? `<button id="openHolidayFormBtn" class="secondary">Eintragen</button>` : `
        <label for="stundenkontoHolidayDate">Datum</label>
        <input id="stundenkontoHolidayDate" type="text" placeholder="TT.MM.JJJJ" inputmode="numeric">

        <div class="row" style="margin-top:12px;">
          <button id="saveHolidayBtn">Speichern</button>
          <button id="cancelHolidayFormBtn" class="secondary">Abbrechen</button>
        </div>
        <div id="holidayMsg" class="error"></div>
      `}

      <details class="accordion" style="margin-top:16px;">
        <summary>
          <span>Erfasste Feiertage</span>
          <span class="muted">${escapeHtml(String(specialDayRows.length))}</span>
        </summary>
        <div class="accordion-body">
          <div class="list-stack">
            ${specialDayRows.length === 0 ? `<p class="muted" style="margin:0;">Keine Feiertage im gewählten Zeitraum.</p>` : ''}
            ${specialDayRows.map((item) => `
              <div class="compact-card" style="margin:0; padding:12px;">
                <div style="font-weight:700; font-size:16px; margin-bottom:4px;">Feiertag</div>
                <div class="compact-meta">${escapeHtml(item.date || '—')}</div>
                <button class="delete-special-day-btn secondary" data-special-day-id="${escapeHtml(item.id || '')}" style="margin-top:12px; width:100%;">Löschen</button>
              </div>
            `).join('')}
          </div>
        </div>
      </details>
    </div>

    <div class="card">
      <h3>Stundenabgleich</h3>
      ${!showAbgleichForm ? `<button id="openAbgleichFormBtn" class="secondary">Eintragen</button>` : `
        <label for="stundenkontoAbgleichTyp">Art</label>
        <select id="stundenkontoAbgleichTyp">
          <option value="auszahlung">Auszahlung</option>
          <option value="frei">Überstundenfrei</option>
        </select>

        <label for="stundenkontoAbgleichDatum">Datum</label>
        <input id="stundenkontoAbgleichDatum" type="text" placeholder="TT.MM.JJJJ" inputmode="numeric">

        <label for="stundenkontoAbgleichStunden">Stunden</label>
        <input id="stundenkontoAbgleichStunden" type="text" inputmode="numeric" placeholder="z. B. 30:00">

        <label for="stundenkontoAbgleichNotiz">Notiz</label>
        <input id="stundenkontoAbgleichNotiz" type="text" placeholder="optional">

        <div class="row" style="margin-top:12px;">
          <button id="saveAbgleichBtn">Speichern</button>
          <button id="cancelAbgleichFormBtn" class="secondary">Abbrechen</button>
        </div>
        <div id="abgleichMsg" class="error"></div>
      `}

      <details class="accordion" style="margin-top:16px;">
        <summary>
          <span>Erfasste Abgleiche</span>
          <span class="muted">${escapeHtml(String(stundenAbgleichRows.length))}</span>
        </summary>
        <div class="accordion-body">
          <div class="list-stack">
            ${stundenAbgleichRows.length === 0 ? `<p class="muted" style="margin:0;">Keine Abgleiche im gewählten Zeitraum.</p>` : ''}
            ${stundenAbgleichRows.map((item) => `
              <div class="compact-card" style="margin:0; padding:12px;">
                <div style="font-weight:700; font-size:16px; margin-bottom:4px;">${escapeHtml(getStundenAbgleichTypLabel(item.typ))}</div>
                <div class="compact-meta">${escapeHtml(item.datum || '—')} · -${escapeHtml(formatHoursClockLabel(item.minuten || 0))}</div>
                ${item.notiz ? `<div class="compact-meta">${escapeHtml(item.notiz)}</div>` : ''}
                <button class="delete-stunden-abgleich-btn secondary" data-abgleich-id="${escapeHtml(item.id || '')}" style="margin-top:12px; width:100%;">Löschen</button>
              </div>
            `).join('')}
          </div>
        </div>
      </details>
    </div>
  `);

  document.getElementById("stundenkontoBackDashboardBtn").onclick = () => {
    setCurrentView("dashboard", {});
    showDashboardView({ onLock });
  };

  document.getElementById("calPrevMonthBtn").onclick = () => {
    const prev = shiftMonth(calYearResolved, calMonthResolved, -1);
    showStundenkontoView({ onLock, calYear: prev.year, calMonth: prev.month, rangeStart, rangeEnd, pendingStart, timeSummaryFrom, timeSummaryTo });
  };
  document.getElementById("calNextMonthBtn").onclick = () => {
    const next = shiftMonth(calYearResolved, calMonthResolved, 1);
    showStundenkontoView({ onLock, calYear: next.year, calMonth: next.month, rangeStart, rangeEnd, pendingStart, timeSummaryFrom, timeSummaryTo });
  };

  document.querySelectorAll(".cal-day-btn").forEach((btn) => {
    btn.onclick = () => {
      const clickedDate = btn.dataset.date;
      if (!pendingStart) {
        showStundenkontoView({ onLock, calYear: calYearResolved, calMonth: calMonthResolved, rangeStart: "", rangeEnd: "", pendingStart: clickedDate, timeSummaryFrom, timeSummaryTo });
        return;
      }
      const start = clickedDate < pendingStart ? clickedDate : pendingStart;
      const end = clickedDate < pendingStart ? pendingStart : clickedDate;
      showStundenkontoView({ onLock, calYear: calYearResolved, calMonth: calMonthResolved, rangeStart: start, rangeEnd: end, pendingStart: "", timeSummaryFrom, timeSummaryTo });
    };
  });

  const clearBtn = document.getElementById("clearRangeBtn");
  if (clearBtn) {
    clearBtn.onclick = () => {
      showStundenkontoView({ onLock, calYear: calYearResolved, calMonth: calMonthResolved, rangeStart: "", rangeEnd: "", pendingStart: "", timeSummaryFrom, timeSummaryTo });
    };
  }

  document.getElementById("quickThisWeekBtn").onclick = () => {
    const range = getQuickRangeDates('thisWeek');
    const refDate = parseComparableDate(range.from);
    showStundenkontoView({ onLock, calYear: refDate.getFullYear(), calMonth: refDate.getMonth() + 1, rangeStart: range.from, rangeEnd: range.to, pendingStart: "", timeSummaryFrom, timeSummaryTo });
  };
  document.getElementById("quickLastWeekBtn").onclick = () => {
    const range = getQuickRangeDates('lastWeek');
    const refDate = parseComparableDate(range.from);
    showStundenkontoView({ onLock, calYear: refDate.getFullYear(), calMonth: refDate.getMonth() + 1, rangeStart: range.from, rangeEnd: range.to, pendingStart: "", timeSummaryFrom, timeSummaryTo });
  };
  document.getElementById("quickThisMonthBtn").onclick = () => {
    const range = getQuickRangeDates('thisMonth');
    const refDate = parseComparableDate(range.from);
    showStundenkontoView({ onLock, calYear: refDate.getFullYear(), calMonth: refDate.getMonth() + 1, rangeStart: range.from, rangeEnd: range.to, pendingStart: "", timeSummaryFrom, timeSummaryTo });
  };
  document.getElementById("quickLastMonthBtn").onclick = () => {
    const range = getQuickRangeDates('lastMonth');
    const refDate = parseComparableDate(range.from);
    showStundenkontoView({ onLock, calYear: refDate.getFullYear(), calMonth: refDate.getMonth() + 1, rangeStart: range.from, rangeEnd: range.to, pendingStart: "", timeSummaryFrom, timeSummaryTo });
  };

  document.querySelectorAll(".delete-zeitraum-entry-btn").forEach((btn) => {
    btn.onclick = async () => {
      const { homeId, patientId, rezeptId, timeEntryId } = btn.dataset;
      if (!homeId || !patientId || !rezeptId || !timeEntryId) return;
      if (!confirm("Diesen Zeiteintrag wirklich löschen?")) return;
      try {
        deleteRezeptTimeEntry(homeId, patientId, rezeptId, timeEntryId);
        await queuePersistRuntimeData();
        showStundenkontoView({ onLock, calYear: calYearResolved, calMonth: calMonthResolved, rangeStart, rangeEnd, pendingStart, timeSummaryFrom, timeSummaryTo });
      } catch (err) {
        console.error(err);
        alert(err?.message || "Zeiteintrag konnte nicht gelöscht werden.");
      }
    };
  });

  document.getElementById("runStundenkontoBtn").onclick = () => {
    const fromValue = document.getElementById("stundenkontoFrom").value.trim();
    const toValue = document.getElementById("stundenkontoTo").value.trim();
    showStundenkontoView({ onLock, calYear: calYearResolved, calMonth: calMonthResolved, rangeStart, rangeEnd, pendingStart, timeSummaryFrom: fromValue, timeSummaryTo: toValue });
  };

  function currentFromTo() {
    return {
      from: document.getElementById("stundenkontoFrom").value.trim(),
      to: document.getElementById("stundenkontoTo").value.trim()
    };
  }

  const openAbsenceFormBtn = document.getElementById("openAbsenceFormBtn");
  if (openAbsenceFormBtn) {
    openAbsenceFormBtn.onclick = () => {
      const { from, to } = currentFromTo();
      showStundenkontoView({ onLock, calYear: calYearResolved, calMonth: calMonthResolved, rangeStart, rangeEnd, pendingStart, timeSummaryFrom: from, timeSummaryTo: to, showAbsenceForm: true });
    };
  }
  const cancelAbsenceFormBtn = document.getElementById("cancelAbsenceFormBtn");
  if (cancelAbsenceFormBtn) {
    cancelAbsenceFormBtn.onclick = () => {
      const { from, to } = currentFromTo();
      showStundenkontoView({ onLock, calYear: calYearResolved, calMonth: calMonthResolved, rangeStart, rangeEnd, pendingStart, timeSummaryFrom: from, timeSummaryTo: to, showAbsenceForm: false });
    };
  }

  async function saveAbsence(type) {
    const msg = document.getElementById("absenceMsg");
    const fromValue = document.getElementById("stundenkontoAbsenceFrom").value.trim();
    const toValue = document.getElementById("stundenkontoAbsenceTo").value.trim();
    const normalizedFrom = parseDeDate(fromValue);
    const normalizedTo = parseDeDate(toValue);
    msg.textContent = "";

    if (!normalizedFrom || !normalizedTo) {
      msg.textContent = "Bitte gültige Von- und Bis-Daten eingeben.";
      return;
    }
    if (normalizedTo < normalizedFrom) {
      msg.textContent = "Bis darf nicht vor Von liegen.";
      return;
    }

    try {
      mutateRuntimeData((data) => {
        if (!Array.isArray(data.abwesenheiten)) data.abwesenheiten = [];
        data.abwesenheiten.push({
          id: `abwesenheit_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
          type,
          from: fromValue,
          to: toValue,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
      });
      await queuePersistRuntimeData();
      const { from, to } = currentFromTo();
      showStundenkontoView({ onLock, calYear: calYearResolved, calMonth: calMonthResolved, rangeStart, rangeEnd, pendingStart, timeSummaryFrom: from, timeSummaryTo: to, showAbsenceForm: false });
    } catch (err) {
      console.error(err);
      msg.textContent = err?.message || "Eintrag konnte nicht gespeichert werden.";
    }
  }

  const saveAsUrlaubBtn = document.getElementById("saveAsUrlaubBtn");
  if (saveAsUrlaubBtn) saveAsUrlaubBtn.onclick = () => saveAbsence("urlaub");
  const saveAsKrankBtn = document.getElementById("saveAsKrankBtn");
  if (saveAsKrankBtn) saveAsKrankBtn.onclick = () => saveAbsence("krank");

  const openHolidayFormBtn = document.getElementById("openHolidayFormBtn");
  if (openHolidayFormBtn) {
    openHolidayFormBtn.onclick = () => {
      const { from, to } = currentFromTo();
      showStundenkontoView({ onLock, calYear: calYearResolved, calMonth: calMonthResolved, rangeStart, rangeEnd, pendingStart, timeSummaryFrom: from, timeSummaryTo: to, showHolidayForm: true });
    };
  }
  const cancelHolidayFormBtn = document.getElementById("cancelHolidayFormBtn");
  if (cancelHolidayFormBtn) {
    cancelHolidayFormBtn.onclick = () => {
      const { from, to } = currentFromTo();
      showStundenkontoView({ onLock, calYear: calYearResolved, calMonth: calMonthResolved, rangeStart, rangeEnd, pendingStart, timeSummaryFrom: from, timeSummaryTo: to, showHolidayForm: false });
    };
  }
  const saveHolidayBtn = document.getElementById("saveHolidayBtn");
  if (saveHolidayBtn) {
    saveHolidayBtn.onclick = async () => {
      const msg = document.getElementById("holidayMsg");
      const dateValue = document.getElementById("stundenkontoHolidayDate").value.trim();
      const normalizedDate = parseDeDate(dateValue);
      msg.textContent = "";

      if (!normalizedDate) {
        msg.textContent = "Bitte ein gültiges Datum eingeben.";
        return;
      }

      try {
        mutateRuntimeData((data) => {
          if (!Array.isArray(data.specialDays)) data.specialDays = [];
          const existingIndex = data.specialDays.findIndex((item) => item?.date === dateValue);
          const nowIso = new Date().toISOString();
          const nextItem = {
            id: existingIndex >= 0 && data.specialDays[existingIndex]?.id
              ? data.specialDays[existingIndex].id
              : `specialday_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
            type: "holiday",
            date: dateValue,
            createdAt: existingIndex >= 0 && data.specialDays[existingIndex]?.createdAt
              ? data.specialDays[existingIndex].createdAt
              : nowIso,
            updatedAt: nowIso
          };
          if (existingIndex >= 0) {
            data.specialDays[existingIndex] = nextItem;
          } else {
            data.specialDays.push(nextItem);
          }
        });
        await queuePersistRuntimeData();
        const { from, to } = currentFromTo();
        showStundenkontoView({ onLock, calYear: calYearResolved, calMonth: calMonthResolved, rangeStart, rangeEnd, pendingStart, timeSummaryFrom: from, timeSummaryTo: to, showHolidayForm: false });
      } catch (err) {
        console.error(err);
        msg.textContent = err?.message || "Feiertag konnte nicht gespeichert werden.";
      }
    };
  }

  const openAbgleichFormBtn = document.getElementById("openAbgleichFormBtn");
  if (openAbgleichFormBtn) {
    openAbgleichFormBtn.onclick = () => {
      const { from, to } = currentFromTo();
      showStundenkontoView({ onLock, calYear: calYearResolved, calMonth: calMonthResolved, rangeStart, rangeEnd, pendingStart, timeSummaryFrom: from, timeSummaryTo: to, showAbgleichForm: true });
    };
  }
  const cancelAbgleichFormBtn = document.getElementById("cancelAbgleichFormBtn");
  if (cancelAbgleichFormBtn) {
    cancelAbgleichFormBtn.onclick = () => {
      const { from, to } = currentFromTo();
      showStundenkontoView({ onLock, calYear: calYearResolved, calMonth: calMonthResolved, rangeStart, rangeEnd, pendingStart, timeSummaryFrom: from, timeSummaryTo: to, showAbgleichForm: false });
    };
  }
  const saveAbgleichBtn = document.getElementById("saveAbgleichBtn");
  if (saveAbgleichBtn) {
    saveAbgleichBtn.onclick = async () => {
      const msg = document.getElementById("abgleichMsg");
      const typ = document.getElementById("stundenkontoAbgleichTyp").value === "frei" ? "frei" : "auszahlung";
      const datumValue = document.getElementById("stundenkontoAbgleichDatum").value.trim();
      const stundenValue = document.getElementById("stundenkontoAbgleichStunden").value.trim();
      const notiz = document.getElementById("stundenkontoAbgleichNotiz").value.trim();
      const normalizedDate = parseDeDate(datumValue);
      const minuten = Math.abs(parseStundenStartsaldoInput(stundenValue));
      msg.textContent = "";

      if (!normalizedDate) {
        msg.textContent = "Bitte ein gültiges Datum eingeben.";
        return;
      }
      if (!Number.isFinite(minuten) || minuten <= 0) {
        msg.textContent = "Bitte Stunden im Format HH:MM eingeben, z. B. 30:00.";
        return;
      }

      try {
        mutateRuntimeData((data) => {
          if (!Array.isArray(data.stundenAbgleiche)) data.stundenAbgleiche = [];
          data.stundenAbgleiche.push({
            id: `stundenabgleich_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
            typ,
            datum: datumValue,
            minuten,
            notiz,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          });
        });
        await queuePersistRuntimeData();
        const { from, to } = currentFromTo();
        showStundenkontoView({ onLock, calYear: calYearResolved, calMonth: calMonthResolved, rangeStart, rangeEnd, pendingStart, timeSummaryFrom: from, timeSummaryTo: to, showAbgleichForm: false });
      } catch (err) {
        console.error(err);
        msg.textContent = err?.message || "Abgleich konnte nicht gespeichert werden.";
      }
    };
  }

  document.querySelectorAll('.delete-absence-btn').forEach((button) => {
    button.onclick = async () => {
      const absenceId = button.dataset.absenceId || '';
      if (!absenceId) return;
      if (!confirm('Diesen Eintrag wirklich löschen?')) return;
      mutateRuntimeData((data) => {
        data.abwesenheiten = (data.abwesenheiten || []).filter((item) => item.id !== absenceId);
      });
      await queuePersistRuntimeData();
      const { from, to } = currentFromTo();
      showStundenkontoView({ onLock, calYear: calYearResolved, calMonth: calMonthResolved, rangeStart, rangeEnd, pendingStart, timeSummaryFrom: from, timeSummaryTo: to });
    };
  });

  document.querySelectorAll('.delete-special-day-btn').forEach((button) => {
    button.onclick = async () => {
      const specialDayId = button.dataset.specialDayId || '';
      if (!specialDayId) return;
      if (!confirm('Diesen Feiertag wirklich löschen?')) return;
      mutateRuntimeData((data) => {
        data.specialDays = (data.specialDays || []).filter((item) => item.id !== specialDayId);
      });
      await queuePersistRuntimeData();
      const { from, to } = currentFromTo();
      showStundenkontoView({ onLock, calYear: calYearResolved, calMonth: calMonthResolved, rangeStart, rangeEnd, pendingStart, timeSummaryFrom: from, timeSummaryTo: to });
    };
  });

  document.querySelectorAll('.delete-stunden-abgleich-btn').forEach((button) => {
    button.onclick = async () => {
      const abgleichId = button.dataset.abgleichId || '';
      if (!abgleichId) return;
      if (!confirm('Diesen Abgleich wirklich löschen?')) return;
      mutateRuntimeData((data) => {
        data.stundenAbgleiche = (data.stundenAbgleiche || []).filter((item) => item.id !== abgleichId);
      });
      await queuePersistRuntimeData();
      const { from, to } = currentFromTo();
      showStundenkontoView({ onLock, calYear: calYearResolved, calMonth: calMonthResolved, rangeStart, rangeEnd, pendingStart, timeSummaryFrom: from, timeSummaryTo: to });
    };
  });
}

export function showZeiterfassungView({ onLock, selectedHomeId = null, selectedPatientId = null, selectedRezeptId = null, successMsg = "", scrollTo = 0 } = {}) {
  bindLockButton(onLock);

  const runtimeData = getRuntimeData();
  const homes = sortHomesAlpha(runtimeData?.homes || []);
  const today = formatCurrentDateShort();
  const nurAktive = !!runtimeData?.settings?.nurAktiveRezepte;

  // Schritt 1: Einrichtung wählen
  if (!selectedHomeId) {
    setCurrentView("zeiterfassung", { selectedHomeId: null, selectedPatientId: null, selectedRezeptId: null });
    render(`
      <div class="card">
        <h2>Zeiterfassung</h2>
        <div style="margin-bottom:12px;">
          <label class="check-chip" style="justify-content:flex-start;">
            <input type="checkbox" id="zeitFilterAktiv" ${nurAktive ? "checked" : ""}>
            <span>Nur Patienten mit aktivem Rezept</span>
          </label>
        </div>
        <p class="muted">Einrichtung auswählen:</p>
        <div class="list-stack">
          ${homes.length === 0
            ? `<p class="muted">Keine Einrichtungen vorhanden.</p>`
            : homes.map(home => {
                const aktivePatients = (home.patients || []).filter(p => !isPatientInactive(p) && (!nurAktive || hatAktivesRezept(p)));
                return `
                  <div class="compact-card selectable-card zeit-home-btn" data-home-id="${escapeHtml(home.homeId || '')}">
                    <div style="font-weight:700; font-size:16px;">${escapeHtml(home.name || '—')}</div>
                    <div class="compact-meta">${aktivePatients.length} Patient(en)</div>
                  </div>`;
              }).join('')
          }
        </div>
        <div class="row" style="margin-top:16px;">
          <button id="zeitBackDashboardBtn" class="secondary">Zurück</button>
        </div>
      </div>
    `);

    bindCheckChipToggles(app);

    document.getElementById("zeitFilterAktiv")?.addEventListener("change", async (e) => {
      mutateRuntimeData(d => { d.settings.nurAktiveRezepte = e.target.checked; });
      await queuePersistRuntimeData();
      showZeiterfassungView({ onLock });
    });
    document.querySelectorAll(".zeit-home-btn").forEach(el => {
      el.onclick = () => showZeiterfassungView({ onLock, selectedHomeId: el.dataset.homeId });
    });
    document.getElementById("zeitBackDashboardBtn").onclick = () => {
      setCurrentView("dashboard", {});
      showDashboardView({ onLock });
    };
    return;
  }

  // Schritt 2: Patient wählen
  const home = homes.find(h => h.homeId === selectedHomeId);
  if (!home) return showZeiterfassungView({ onLock });

  const aktivePatients = sortPatientsAlpha(
    (home.patients || []).filter(p => !isPatientInactive(p) && (!nurAktive || hatAktivesRezept(p)))
  );

  if (!selectedPatientId) {
    setCurrentView("zeiterfassung", { selectedHomeId, selectedPatientId: null, selectedRezeptId: null });
    render(`
      <div class="card">
        <h2>Zeiterfassung</h2>
        <div style="font-weight:700; margin-bottom:12px;">${escapeHtml(home.name || '—')}</div>
        <div style="margin-bottom:12px;">
          <label class="check-chip" style="justify-content:flex-start;">
            <input type="checkbox" id="zeitFilterAktiv" ${nurAktive ? "checked" : ""}>
            <span>Nur Patienten mit aktivem Rezept</span>
          </label>
        </div>
        <p class="muted">Patient auswählen:</p>
        <div class="list-stack">
          ${aktivePatients.length === 0
            ? `<p class="muted">Keine aktiven Patienten.</p>`
            : aktivePatients.map(patient => {
                const aktiveRezepte = (patient.rezepte || []).filter(r => !r.abgegeben);
                return `
                  <div class="compact-card selectable-card zeit-patient-btn" data-patient-id="${escapeHtml(patient.patientId || '')}">
                    <div style="font-weight:700; font-size:16px;">${escapeHtml(`${patient.lastName || ''}, ${patient.firstName || ''}`.replace(/^,\s*/, '').trim() || '—')}</div>
                    <div class="compact-meta">${aktiveRezepte.length} aktive${aktiveRezepte.length === 1 ? 's' : ''} Rezept${aktiveRezepte.length !== 1 ? 'e' : ''}</div>
                  </div>`;
              }).join('')
          }
        </div>
        <div class="row" style="margin-top:16px;">
          <button id="zeitBackHomeBtn" class="secondary">Zurück</button>
        </div>
      </div>
    `);

    bindCheckChipToggles(app);

    document.getElementById("zeitFilterAktiv")?.addEventListener("change", async (e) => {
      mutateRuntimeData(d => { d.settings.nurAktiveRezepte = e.target.checked; });
      await queuePersistRuntimeData();
      showZeiterfassungView({ onLock, selectedHomeId });
    });
    document.querySelectorAll(".zeit-patient-btn").forEach(el => {
      el.onclick = () => showZeiterfassungView({ onLock, selectedHomeId, selectedPatientId: el.dataset.patientId, scrollTo: window.scrollY });
    });
    document.getElementById("zeitBackHomeBtn").onclick = () => {
      setCurrentView("zeiterfassung", { selectedHomeId: null, selectedPatientId: null, selectedRezeptId: null });
      showZeiterfassungView({ onLock });
    };
    if (scrollTo > 0) window.scrollTo(0, scrollTo);
    return;
  }

  // Schritt 3: Rezept wählen (falls mehrere) oder direkt buchen
  const patient = aktivePatients.find(p => p.patientId === selectedPatientId);
  if (!patient) return showZeiterfassungView({ onLock, selectedHomeId });

  const patientName = `${patient.lastName || ''}, ${patient.firstName || ''}`.replace(/^,\s*/, '').trim() || '—';
  const aktiveRezepte = (patient.rezepte || []).filter(r => !r.abgegeben);

  if (!selectedRezeptId) {
    if (aktiveRezepte.length === 0) {
      render(`
        <div class="card">
          <h2>Zeiterfassung</h2>
          <div style="font-weight:700; margin-bottom:4px;">${escapeHtml(patientName)}</div>
          <div class="compact-meta" style="margin-bottom:12px;">${escapeHtml(home.name || '—')}</div>
          <p class="muted">Keine aktiven Rezepte vorhanden.</p>
          <p class="muted">Falls das Rezept noch nicht eingetippt wurde (z.B. aus Zeitgründen), kann die Zeit trotzdem schon erfasst werden - die Rezeptangaben lassen sich später über Einrichtung → Patient → Rezept nachtragen.</p>
          <button id="zeitOhneRezeptBtn" class="secondary">Zeit ohne Rezept-Angaben buchen</button>
          <div class="row" style="margin-top:16px;">
            <button id="zeitBackPatientBtn" class="secondary">Zurück</button>
          </div>
        </div>
      `);
      document.getElementById("zeitOhneRezeptBtn").onclick = async () => {
        // Platzhalter-Rezept (siehe createRezept() in modules/homes.js) -
        // die Zeit braucht technisch ein Rezept, zum Buchen selbst müssen
        // aber keine Rezeptangaben vorliegen; FaSti erinnert über die
        // bestehende "Rezept unvollständig"-Meldung ans Nachtragen.
        const neuRezeptId = createRezept(selectedHomeId, selectedPatientId, {});
        await queuePersistRuntimeData();
        showZeiterfassungView({ onLock, selectedHomeId, selectedPatientId, selectedRezeptId: neuRezeptId, scrollTo });
      };
      document.getElementById("zeitBackPatientBtn").onclick = () => {
        setCurrentView("zeiterfassung", { selectedHomeId, selectedPatientId: null, selectedRezeptId: null });
        showZeiterfassungView({ onLock, selectedHomeId, scrollTo });
      };
      return;
    }

    if (aktiveRezepte.length === 1) {
      setCurrentView("zeiterfassung", { selectedHomeId, selectedPatientId, selectedRezeptId: null });
      return showZeiterfassungView({ onLock, selectedHomeId, selectedPatientId, selectedRezeptId: aktiveRezepte[0].rezeptId, scrollTo });
    }

    // Mehrere Rezepte – Auswahl anzeigen
    setCurrentView("zeiterfassung", { selectedHomeId, selectedPatientId, selectedRezeptId: null });
    render(`
      <div class="card">
        <h2>Zeiterfassung</h2>
        <div style="font-weight:700; margin-bottom:4px;">${escapeHtml(patientName)}</div>
        <div class="compact-meta" style="margin-bottom:12px;">${escapeHtml(home.name || '—')}</div>
        <p class="muted">Rezept auswählen:</p>
        <div class="list-stack">
          ${aktiveRezepte.map(rezept => {
            const autoMin = getAutomaticTreatmentMinutesForZeit(rezept);
            return `
              <div class="compact-card selectable-card zeit-rezept-btn" data-rezept-id="${escapeHtml(rezept.rezeptId || '')}">
                <div style="font-weight:700; font-size:15px;">${escapeHtml(rezeptSummary(rezept))}</div>
                <div class="compact-meta">Ausgestellt: ${escapeHtml(rezept.ausstell || '—')}</div>
                <div class="compact-meta" style="color:var(--primary); font-weight:600;">${autoMin > 0 ? `${autoMin} Minuten` : 'Zeit nicht erkannt'}</div>
              </div>`;
          }).join('')}
        </div>
        <div class="row" style="margin-top:16px;">
          <button id="zeitBackPatientBtn" class="secondary">Zurück</button>
        </div>
      </div>
    `);

    document.querySelectorAll(".zeit-rezept-btn").forEach(el => {
      el.onclick = () => showZeiterfassungView({ onLock, selectedHomeId, selectedPatientId, selectedRezeptId: el.dataset.rezeptId, scrollTo });
    });
    document.getElementById("zeitBackPatientBtn").onclick = () => {
      setCurrentView("zeiterfassung", { selectedHomeId, selectedPatientId: null, selectedRezeptId: null });
      showZeiterfassungView({ onLock, selectedHomeId, scrollTo });
    };
    return;
  }

  // Schritt 4: Zeit buchen
  const rezept = aktiveRezepte.find(r => r.rezeptId === selectedRezeptId);
  if (!rezept) return showZeiterfassungView({ onLock, selectedHomeId, selectedPatientId });

  const autoMin = getAutomaticTreatmentMinutesForZeit(rezept);

  render(`
    <div class="card">
      <h2>Zeit buchen</h2>
      <div style="font-weight:700; margin-bottom:4px;">${escapeHtml(patientName)}</div>
      <div class="compact-meta">${escapeHtml(home.name || '—')}</div>
      <div class="compact-meta" style="margin-bottom:16px;">${escapeHtml(rezeptSummary(rezept))}</div>

      ${successMsg ? `<div style="background:#e6f4ea; color:#1a7f37; padding:10px 14px; border-radius:8px; margin-bottom:16px; font-weight:600;">${escapeHtml(successMsg)}</div>` : ''}

      <label for="zeitDatumInput">Datum</label>
      <input id="zeitDatumInput" type="text" value="${escapeHtml(today)}" placeholder="TT.MM.JJJJ" inputmode="numeric" style="margin-bottom:16px;">

      <label>Dauer</label>
      ${renderRadioGroup("zeitDauer", [
        { val: "20", label: "20 Min" },
        { val: "40", label: "40 Min" },
        { val: "60", label: "60 Min" }
      ], String([20, 40, 60].includes(autoMin) ? autoMin : 20))}
      ${rezept.dt ? `<div class="compact-meta" style="margin-top:-6px; margin-bottom:12px;">Doppelbehandlung berücksichtigt</div>` : ''}

      <input id="zeitNotizInput" type="text" placeholder="Notiz optional: z. B. Hausbesuch ...">

      <button id="zeitBuchenBtn">Zeit buchen</button>
      <button id="zeitBackRezeptBtn" class="secondary">Zurück</button>
      <div id="zeitBuchenMsg" class="muted" style="margin-top:10px;"></div>
    </div>
  `);
  bindCheckChipToggles(app);

  const backBtn = document.getElementById("zeitBackRezeptBtn");
  const goBackToPatientList = (e) => {
    e.preventDefault();
    setCurrentView("zeiterfassung", { selectedHomeId, selectedPatientId: null, selectedRezeptId: null });
    showZeiterfassungView({ onLock, selectedHomeId, scrollTo });
  };
  backBtn.addEventListener("touchend", goBackToPatientList);
  backBtn.addEventListener("click", goBackToPatientList);

  document.getElementById("zeitBuchenBtn").onclick = async () => {
    const notiz = document.getElementById("zeitNotizInput").value.trim();
    const datumInput = document.getElementById("zeitDatumInput").value.trim();
    const msg = document.getElementById("zeitBuchenMsg");
    const minutes = Number(getRadioValue("zeitDauer")) || 20;

    const normalizedDatum = normalizeDeDateInput(datumInput) || datumInput;
    if (!normalizedDatum || !parseDeDate(normalizedDatum)) {
      msg.textContent = "Bitte ein gültiges Datum eingeben (TT.MM.JJJJ).";
      return;
    }

    msg.textContent = "Wird gespeichert...";

    try {
      mutateRuntimeData(data => {
        const h = (data.homes || []).find(x => x.homeId === selectedHomeId);
        if (!h) return;
        const p = (h.patients || []).find(x => x.patientId === selectedPatientId);
        if (!p) return;
        const r = (p.rezepte || []).find(x => x.rezeptId === selectedRezeptId);
        if (!r) return;
        if (!Array.isArray(r.timeEntries)) r.timeEntries = [];
        r.timeEntries.push({
          timeEntryId: generateId("time"),
          date: normalizedDatum,
          type: "behandlung",
          minutes,
          note: notiz || "",
          createdAt: new Date().toISOString()
        });
      });
      await queuePersistRuntimeData();

      showZeiterfassungView({
        onLock,
        selectedHomeId,
        successMsg: `✓ ${minutes} Min für ${patientName} am ${normalizedDatum} gebucht`,
        scrollTo
      });
    } catch (err) {
      msg.textContent = "Fehler beim Speichern: " + err.message;
    }
  };
}

// Hilfsfunktion für Zeiterfassung – berechnet Minuten aus Rezept
function getAutomaticTreatmentMinutesForZeit(rezept) {
  const items = Array.isArray(rezept?.items) ? rezept.items : [];
  if (items.length === 0) return 0;

  function norm(type) {
    return String(type || "").trim().toUpperCase().replace(/\s+/g, "").replace(/–/g, "-").replace(/—/g, "-");
  }
  function singleMin(type) {
    const k = norm(type);
    if (["KG", "MT", "KG-ZNS", "KGZNS", "KG-ATEMTHERAPIE", "KGAT", "MLD30", "BLANKO"].includes(k)) return 20;
    if (k === "MLD45") return 40;
    if (k === "MLD60") return 60;
    return 0;
  }

  if (rezept?.bg) {
    return items.reduce((sum, item) => sum + singleMin(item?.type), 0);
  }

  const hasBlanko = items.some(item => norm(item?.type) === "BLANKO");
  if (hasBlanko) return 20;

  const first = items.find(item => singleMin(item?.type) > 0);
  if (!first) return 0;
  const firstMin = singleMin(first.type);
  const firstKey = norm(first.type);
  const isFixedMLD = firstKey === "MLD45" || firstKey === "MLD60";

  if (rezept?.dt && !isFixedMLD) return firstMin * 2;
  return firstMin;
}

// ============================================================
// FaSti - Widget, Chat-Panel, CSS-Animationen (siehe modules/fasti.js für
// die eigentliche Analyse-/Intent-/Aktionslogik, die hier nur aufgerufen und
// dargestellt wird). Button + Panel werden bewusst direkt an document.body
// gehängt (nicht in #app), da render()/renderTherapistBody & Co. bei jedem
// Ansichtswechsel #app.innerHTML komplett ersetzen - ein Element innerhalb
// von #app würde also bei jeder Navigation verschwinden.
// ============================================================
let fastiChatHistory = [];
let fastiPendingAction = null;
let fastiPendingInput = null;
let fastiCurrentNotices = [];
let fastiAnimationTimer = null;
let fastiOnLock = null;

// Von core/boot.js einmalig nach dem Login gesetzt (lockApp-Referenz), damit
// FaSti-Navigationsbefehle dieselben show*View()-Funktionen wie die normale
// Menüführung aufrufen können - die brauchen alle onLock, das sonst nur
// entlang der regulären View-Kette (resumeCurrentView usw.) weitergereicht
// wird und FaSti als eigenständiges, an document.body gehängtes Widget
// sonst nicht zur Verfügung stünde.
export function setFastiOnLock(onLock) {
  fastiOnLock = onLock;
}

const FASTI_SVG = `
  <svg class="fasti-figure idle" viewBox="0 0 60 100" aria-hidden="true">
    <path class="fasti-clip-body" d="M30 8
      C43 8 51 17 51 29
      L51 68
      C51 82 40 90 29 90
      C18 90 11 82 11 71
      L11 33
      C11 25 17 20 24 20
      C31 20 36 25 36 33
      L36 64" fill="none" stroke="#15803d" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
    <ellipse class="fasti-eye" cx="21" cy="17" rx="5.5" ry="7.5" fill="#fff" stroke="#0f172a" stroke-width="1.5"/>
    <ellipse class="fasti-eye" cx="38" cy="17" rx="5.5" ry="7.5" fill="#fff" stroke="#0f172a" stroke-width="1.5"/>
    <circle class="fasti-pupil" cx="22.5" cy="18" r="2.4" fill="#0f172a"/>
    <circle class="fasti-pupil" cx="39.5" cy="18" r="2.4" fill="#0f172a"/>
  </svg>
`;

function ensureFastiStyles() {
  if (document.getElementById("fastiStyles")) return;
  const style = document.createElement("style");
  style.id = "fastiStyles";
  style.textContent = `
    :root{ --fasti-color:#15803d; }
    .fasti-btn{
      position:fixed; right:18px; bottom:calc(18px + env(safe-area-inset-bottom, 0px));
      width:58px; height:58px; border-radius:50%; background:#fff;
      border:2px solid var(--fasti-color); box-shadow:0 6px 18px rgba(15,23,42,0.28);
      display:flex; align-items:center; justify-content:center; cursor:grab; z-index:9990;
      touch-action:none; user-select:none;
    }
    .fasti-btn:active{ cursor:grabbing; }
    .fasti-btn svg{ width:32px; height:52px; overflow:visible; }
    .fasti-badge{
      position:absolute; top:-4px; right:-4px; min-width:20px; height:20px; padding:0 5px;
      border-radius:999px; background:#b91c1c; color:#fff; font-size:12px; font-weight:700;
      display:flex; align-items:center; justify-content:center; line-height:1; box-shadow:0 1px 4px rgba(0,0,0,0.3);
    }
    .fasti-panel{
      position:fixed; right:16px; bottom:calc(84px + env(safe-area-inset-bottom, 0px));
      width:360px; max-width:calc(100vw - 32px);
      /* vh bemisst sich auf vielen mobilen Browsern (v.a. Android Chrome) am
         GRÖSSTEN möglichen Viewport (Adressleiste ausgeblendet), nicht am
         gerade sichtbaren - dadurch konnte der obere Rand des (von unten
         verankerten) Panels über den sichtbaren Bildschirm hinausragen und
         wurde abgeschnitten, sobald die Adressleiste eingeblendet war. dvh
         (dynamic viewport height) verfolgt den tatsächlich sichtbaren
         Viewport live mit - die vh-Zeile bleibt als Fallback für ältere
         Browser ohne dvh-Unterstützung stehen, die zweite (dvh) gewinnt
         überall dort, wo sie unterstützt wird. calc(100dvh - 120px) sorgt
         zusätzlich dafür, dass oben immer mindestens etwas Rand bleibt.
      */
      max-height:min(72vh, 640px);
      max-height:min(72dvh, 640px, calc(100dvh - 120px));
      background:#fff; border-radius:16px; border:1px solid #dbe3ee;
      box-shadow:0 14px 44px rgba(15,23,42,0.32); z-index:9991;
      display:flex; flex-direction:column; overflow:hidden;
    }
    .fasti-panel-header{
      background:var(--fasti-color); color:#fff; padding:12px 14px; font-weight:700;
      display:flex; justify-content:space-between; align-items:center; flex-shrink:0; gap:8px;
    }
    .fasti-header-actions{ display:flex; align-items:center; gap:8px; flex-shrink:0; }
    .fasti-dismiss-all-btn{
      background:rgba(255,255,255,0.16); border:1px solid rgba(255,255,255,0.55); color:#fff;
      font-size:11px; font-weight:600; padding:5px 9px; border-radius:8px; cursor:pointer;
      white-space:nowrap; width:auto; margin-top:0;
    }
    .fasti-close-btn{ background:transparent; border:none; color:#fff; font-size:18px; line-height:1; cursor:pointer; padding:2px 4px; width:auto; margin-top:0; }
    .fasti-notices{ padding:10px 12px; border-bottom:1px solid #eee; height:220px; max-height:60vh; overflow-y:auto; flex-shrink:0; }
    .fasti-notice{ border-radius:10px; padding:8px 10px; margin-bottom:8px; font-size:13px; line-height:1.4; }
    .fasti-notice:last-child{ margin-bottom:0; }
    .fasti-notice.rot{ background:#fee2e2; color:#991b1b; }
    .fasti-notice.orange{ background:#ffedd5; color:#9a3412; }
    .fasti-notice.gelb{ background:#fef9c3; color:#854d0e; }
    .fasti-notice-actions{ margin-top:6px; display:flex; gap:6px; flex-wrap:wrap; }
    .fasti-notice-actions button{ font-size:12px; padding:5px 10px; margin-top:0; }
    .fasti-notices-resizer{
      height:12px; flex-shrink:0; background:#f8fafc; border-bottom:1px solid #eee;
      cursor:row-resize; touch-action:none; position:relative;
    }
    .fasti-notices-resizer::after{
      content:""; position:absolute; left:50%; top:50%; width:36px; height:4px;
      transform:translate(-50%,-50%); border-radius:2px; background:#cbd5e1;
    }
    .fasti-chat-log{ flex:1; overflow-y:auto; padding:10px 12px; display:flex; flex-direction:column; gap:8px; min-height:70px; }
    .fasti-msg{ max-width:88%; padding:8px 10px; border-radius:12px; font-size:13px; white-space:pre-line; line-height:1.4; }
    .fasti-msg.user{ align-self:flex-end; background:var(--primary,#2563eb); color:#fff; }
    .fasti-msg.fasti{ align-self:flex-start; background:#f1f5f9; color:#0f172a; }
    .fasti-msg .fasti-notice-actions button{ margin-top:8px; }
    .fasti-chat-input-row{
      display:flex; gap:8px; padding:10px 12px; border-top:1px solid #eee; flex-shrink:0;
      padding-bottom:calc(10px + env(safe-area-inset-bottom, 0px));
    }
    .fasti-chat-input-row input{ flex:1; min-width:0; padding:8px 10px; border-radius:10px; border:1px solid #dbe3ee; font-size:14px; }
    /* Ohne explizites width/flex hier gewinnt die globale "button{ width:100% }"-Regel
       (siehe index.html) gegen das Eingabefeld: der Button beansprucht als Flex-Item
       ohne eigenes flex-basis seine volle width:100% als Basisgröße, wodurch für das
       Eingabefeld (flex:1, flex-basis:0) kaum noch Platz übrig bleibt - es schrumpft
       auf einen winzigen Kreis statt der erwarteten Zeile. */
    .fasti-chat-input-row button{ flex:0 0 auto; width:auto; padding:8px 14px; margin-top:0; white-space:nowrap; }

    /* [hidden] hat dieselbe CSS-Spezifität wie eine Klasse - ohne diese
       Regel würde z.B. ".fasti-badge{ display:flex }" das hidden-Attribut
       per Ladereihenfolge überstimmen und das Element trotz el.hidden=true
       sichtbar lassen. */
    .fasti-btn[hidden], .fasti-panel[hidden], .fasti-badge[hidden], .fasti-notices[hidden]{ display:none !important; }

    @keyframes fastiIdleSway{ 0%,100%{ transform:rotate(-3deg); } 50%{ transform:rotate(3deg); } }
    @keyframes fastiBlink{ 0%,90%,100%{ transform:scaleY(1); } 95%{ transform:scaleY(0.12); } }
    @keyframes fastiAufwachen{ 0%,100%{ transform:rotate(-11deg); } 50%{ transform:rotate(11deg); } }
    @keyframes fastiNicken{ 0%{ transform:rotate(0deg); } 30%{ transform:rotate(16deg); } 60%{ transform:rotate(-8deg); } 100%{ transform:rotate(0deg); } }
    .fasti-figure{ transform-origin:50% 92%; }
    .fasti-figure.idle{ animation:fastiIdleSway 3.2s ease-in-out infinite; }
    .fasti-figure.idle .fasti-eye{ animation:fastiBlink 5s ease-in-out infinite; transform-origin:center; }
    .fasti-figure.aufwachen{ animation:fastiAufwachen 0.45s ease-in-out 4; }
    .fasti-figure.nicken{ animation:fastiNicken 0.6s ease-in-out 1; }
  `;
  document.head.appendChild(style);
}

function setFastiAnimation(state) {
  const svg = document.querySelector("#fastiWidgetBtn .fasti-figure");
  if (!svg) return;
  svg.classList.remove("idle", "aufwachen", "nicken");
  void svg.offsetWidth; // Reflow erzwingen, damit dieselbe Animation erneut von vorne startet
  svg.classList.add(state);

  if (fastiAnimationTimer) clearTimeout(fastiAnimationTimer);
  if (state !== "idle") {
    fastiAnimationTimer = setTimeout(() => setFastiAnimation("idle"), state === "nicken" ? 650 : 1900);
  }
}

function setFastiPanelOpen(open) {
  const panel = document.getElementById("fastiPanel");
  if (!panel) return;
  panel.hidden = !open;
  if (open) document.getElementById("fastiChatInput")?.focus();
}

function toggleFastiPanel() {
  const panel = document.getElementById("fastiPanel");
  setFastiPanelOpen(panel ? panel.hidden : true);
}

function fastiActionLabel(action) {
  if (action?.type === "nachbestellung_vorschlagen" || action?.type === "nachbestellzettel_erzeugen") return "Nachbestellzettel vorbereiten";
  if (action?.type === "assessment_verschieben") return "Neues Datum setzen (+90 Tage)";
  if (action?.type === "zeit_eintrag_anlegen") return "Zeit buchen";
  if (action?.type === "doku_eintrag_anlegen") return "Eintragen";
  if (action?.type === "abwesenheit_anlegen") return "Eintragen";
  if (action?.type === "patient_ausgeschieden_setzen") return action.value ? "Als ausgeschieden markieren" : "Wieder aktivieren";
  if (action?.type === "doku_nachtragen") return "Dokumentieren";
  if (action?.type === "rezept_bearbeiten") return "Rezept bearbeiten";
  return "Bestätigen";
}

// Jede Meldung bekommt IMMER einen "Ignorieren"-Button, unabhängig davon, ob
// zusätzlich eine Aktion (z.B. "Nachbestellzettel vorbereiten") möglich ist -
// vorher fehlte der Dismiss-Button komplett bei Meldungen ohne Aktion (z.B.
// die orangen Fristen-/Assessment-Hinweise), die dadurch nicht einzeln
// ignorierbar waren.
function renderFastiNoticeItem(notice) {
  const confirmHtml = notice.action
    ? `<button class="fastiNoticeConfirmBtn" data-notice-id="${escapeHtml(notice.id)}">${escapeHtml(fastiActionLabel(notice.action))}</button>`
    : "";
  return `
    <div class="fasti-notice ${escapeHtml(notice.priority)}" data-notice-id="${escapeHtml(notice.id)}">
      <div>${escapeHtml(notice.text)}</div>
      <div class="fasti-notice-actions">
        ${confirmHtml}
        <button class="secondary fastiNoticeDismissBtn" data-notice-id="${escapeHtml(notice.id)}">Ignorieren</button>
      </div>
    </div>
  `;
}

function bindFastiNoticeButtons() {
  document.querySelectorAll(".fastiNoticeConfirmBtn").forEach((btn) => {
    btn.onclick = () => {
      const notice = fastiCurrentNotices.find((n) => n.id === btn.dataset.noticeId);
      removeFastiNotice(btn.dataset.noticeId);
      if (!notice?.action) return;
      if (notice.action.type === "nachbestellung_vorschlagen") {
        // Läuft nicht mehr direkt über executeFastiAction(), da vorher noch
        // eine Kette von Optimierungs-Rückfragen kommen kann (siehe
        // startNachbestellungVorschlag() in modules/fasti.js) - das Ergebnis
        // wird deshalb wie ein Chat-Ergebnis über handleFastiResult()
        // dargestellt, nicht als einfache Bestätigungs-Aktion.
        const runtimeData = getRuntimeData();
        if (!runtimeData) return;
        setFastiPanelOpen(true);
        let result;
        try {
          result = startNachbestellungVorschlag(notice.action, runtimeData);
        } catch (err) {
          console.error(err);
          result = { reply: `Da ist etwas schiefgelaufen: ${err?.message || err}` };
        }
        handleFastiResult(result);
        return;
      }
      if (notice.action.type === "doku_nachtragen") {
        // Reine Navigation statt Mutation - läuft deshalb nicht über
        // runFastiAction()/executeFastiAction(), sondern öffnet direkt die
        // Doku-Schreiben-Ansicht mit dem fehlenden Datum vorausgefüllt.
        setFastiPanelOpen(false);
        showDokuSchreibenView({
          onLock: fastiOnLock,
          homeId: notice.action.homeId,
          patientId: notice.action.patientId,
          prefillDate: notice.action.date,
          prefillRezeptId: notice.action.rezeptId
        });
        return;
      }
      if (notice.action.type === "rezept_bearbeiten") {
        // Reine Navigation - öffnet das betroffene Rezept direkt zur
        // Bearbeitung, damit ICD-10/Arzt/Leitsymptomatik nachgetragen werden
        // können.
        setFastiPanelOpen(false);
        showEditRezeptView({
          onLock: fastiOnLock,
          homeId: notice.action.homeId,
          patientId: notice.action.patientId,
          rezeptId: notice.action.rezeptId
        });
        return;
      }
      runFastiAction(notice.action);
    };
  });
  document.querySelectorAll(".fastiNoticeDismissBtn").forEach((btn) => {
    btn.onclick = () => removeFastiNotice(btn.dataset.noticeId);
  });
}

function removeFastiNotice(noticeId) {
  fastiCurrentNotices = fastiCurrentNotices.filter((n) => n.id !== noticeId);
  const badge = document.getElementById("fastiBadge");
  const noticesEl = document.getElementById("fastiNotices");
  if (!badge || !noticesEl) return;

  if (fastiCurrentNotices.length === 0) {
    badge.hidden = true;
    noticesEl.innerHTML = "";
    setFastiNoticesVisible(false);
  } else {
    badge.textContent = String(fastiCurrentNotices.length);
    noticesEl.innerHTML = fastiCurrentNotices.map(renderFastiNoticeItem).join("");
    bindFastiNoticeButtons();
  }
}

function appendFastiMessage(role, text) {
  fastiChatHistory.push({ role, text });
  const log = document.getElementById("fastiChatLog");
  if (!log) return;
  const div = document.createElement("div");
  div.className = `fasti-msg ${role}`;
  div.textContent = text;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}

function appendFastiPendingActionMessage(reply, action) {
  fastiPendingAction = action;
  fastiChatHistory.push({ role: "fasti", text: reply });
  const log = document.getElementById("fastiChatLog");
  if (!log) return;

  const div = document.createElement("div");
  div.className = "fasti-msg fasti";
  div.innerHTML = `
    <div>${escapeHtml(reply)}</div>
    <div class="fasti-notice-actions">
      <button id="fastiConfirmActionBtn">${escapeHtml(fastiActionLabel(action))}</button>
      <button class="secondary" id="fastiCancelActionBtn">Abbrechen</button>
    </div>
  `;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;

  document.getElementById("fastiConfirmActionBtn").onclick = () => {
    div.querySelector(".fasti-notice-actions")?.remove();
    fastiPendingAction = null;
    runFastiAction(action);
  };
  document.getElementById("fastiCancelActionBtn").onclick = () => {
    div.querySelector(".fasti-notice-actions")?.remove();
    fastiPendingAction = null;
    appendFastiMessage("fasti", "Abgebrochen.");
  };
}

// Rückfrage bei Mehrdeutigkeit (z.B. mehrere Patienten mit demselben Namen,
// oder ein Patient mit mehreren offenen Rezepten) - jeder Kandidat ist ein
// Button statt eines Freitext-Felds, da erneutes Schlüsselwort-Matching auf
// eine Freitext-Antwort ("den zweiten") zu fehleranfällig wäre. Ein Klick
// setzt den ursprünglichen Befehl über resumeFastiChoice() mit dem jetzt
// aufgelösten Kontext fort - das Ergebnis kann erneut choices, eine action
// oder ein navigate sein, daher der Umweg über handleFastiResult().
function appendFastiChoicesMessage(reply, choices) {
  fastiChatHistory.push({ role: "fasti", text: reply });
  const log = document.getElementById("fastiChatLog");
  if (!log) return;

  const div = document.createElement("div");
  div.className = "fasti-msg fasti";
  div.innerHTML = `
    <div>${escapeHtml(reply)}</div>
    <div class="fasti-notice-actions" style="flex-direction:column; align-items:stretch;">
      ${choices.map((c, idx) => `<button class="secondary fastiChoiceBtn" data-choice-index="${idx}">${escapeHtml(c.label)}</button>`).join("")}
    </div>
  `;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;

  div.querySelectorAll(".fastiChoiceBtn").forEach((btn) => {
    btn.onclick = () => {
      div.querySelector(".fasti-notice-actions")?.remove();
      const choice = choices[Number(btn.dataset.choiceIndex)];
      const runtimeData = getRuntimeData();
      if (!choice || !runtimeData) return;

      let result;
      try {
        result = resumeFastiChoice(choice.resume, runtimeData);
      } catch (err) {
        console.error(err);
        result = { reply: `Da ist etwas schiefgelaufen: ${err?.message || err}` };
      }
      handleFastiResult(result);
    };
  });
}

// Rückfrage nach fehlendem Freitext (z.B. der einzutragende Doku-Text) - im
// Gegensatz zu appendFastiChoicesMessage() gibt es hier keine feste Auswahl,
// die nächste Chat-Nachricht wird als Antwort erwartet (siehe
// handleFastiSend()). Ein "Abbrechen"-Button bleibt trotzdem nötig, damit
// eine unbeabsichtigt hängende Rückfrage nicht die nächste, eigentlich
// unabhängige Nachricht verschluckt.
function appendFastiAwaitingInputMessage(reply) {
  fastiChatHistory.push({ role: "fasti", text: reply });
  const log = document.getElementById("fastiChatLog");
  if (!log) return;

  const div = document.createElement("div");
  div.className = "fasti-msg fasti";
  div.innerHTML = `
    <div>${escapeHtml(reply)}</div>
    <div class="fasti-notice-actions">
      <button class="secondary" id="fastiCancelInputBtn">Abbrechen</button>
    </div>
  `;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;

  document.getElementById("fastiCancelInputBtn").onclick = () => {
    div.querySelector(".fasti-notice-actions")?.remove();
    fastiPendingInput = null;
    appendFastiMessage("fasti", "Abgebrochen.");
  };
}

// Springt zur passenden Ansicht - genau die show*View()-Funktionen, die
// auch die reguläre Menüführung aufruft, mit der über setFastiOnLock()
// hinterlegten onLock-Referenz. Das Panel wird dabei geschlossen, damit es
// die neue Ansicht nicht verdeckt.
function runFastiNavigate(navigate) {
  const onLock = fastiOnLock;
  if (navigate.view === "rezeptoptimierer") {
    showRezeptoptimierungView({ onLock, homeId: navigate.homeId, patientId: navigate.patientId });
  } else if (navigate.view === "patient-detail") {
    showPatientDetailView({ onLock, homeId: navigate.homeId, patientId: navigate.patientId });
  } else if (navigate.view === "rezept-create") {
    showCreateRezeptView({ onLock, homeId: navigate.homeId, patientId: navigate.patientId });
  } else if (navigate.view === "assessment-abfrage") {
    showAssessmentAbfrageView({ onLock, homeId: navigate.homeId, patientId: navigate.patientId });
  } else if (navigate.view === "arztbericht") {
    showArztberichtView({ onLock, homeId: navigate.homeId, patientId: navigate.patientId });
  } else if (navigate.view === "abgabe") {
    showAbgabeView({ onLock });
  } else if (navigate.view === "nachbestellung") {
    showNachbestellungView({ onLock });
  } else if (navigate.view === "kilometer") {
    showKilometerView({ onLock });
  } else if (navigate.view === "stundenkonto") {
    showStundenkontoView({ onLock });
  } else if (navigate.view === "patientenliste") {
    showPatientenListeView({ onLock });
  } else if (navigate.view === "doku-liste") {
    showDokuPatientenListeView({ onLock });
  } else if (navigate.view === "patient-create") {
    showCreatePatientRezeptView({ onLock, homeId: navigate.homeId });
  } else if (navigate.view === "homes") {
    showHomesView({ onLock });
  }
}

// Gemeinsame Weiche für jedes Ergebnis von answerFastiChat()/
// resumeFastiChoice() - genau eines von reply-only, choices, action oder
// navigate ist gesetzt.
function handleFastiResult(result) {
  fastiPendingInput = null;

  // Bisher hat nur runFastiAction() (der Bestätigen/Abbrechen-Weg) persistiert -
  // seit der Doku+Zeitbuchung-Rückfrage (answerDokuZeitBuchenChoice()) kann
  // aber auch eine direkt aus einer choices-Auswahl aufgelöste Antwort schon
  // eine echte Mutation sein (kein zweiter Bestätigungsklick nötig, da die
  // choice selbst schon die explizite Nutzerentscheidung ist).
  if (result.needsPersist) queuePersistRuntimeData();

  if (result.choices) {
    appendFastiChoicesMessage(result.reply, result.choices);
  } else if (result.action) {
    appendFastiPendingActionMessage(result.reply, result.action);
  } else if (result.navigate) {
    appendFastiMessage("fasti", result.reply);
    setFastiPanelOpen(false);
    runFastiNavigate(result.navigate);
  } else if (result.awaitingInput) {
    fastiPendingInput = result.awaitingInput;
    appendFastiAwaitingInputMessage(result.reply);
  } else {
    appendFastiMessage("fasti", result.reply);
  }
}

// Führt eine bestätigte FaSti-Aktion aus. Bei einer Nachbestellung MUSS
// openLetterPreview() synchron in derselben Klick-Handler-Kette aufgerufen
// werden (siehe createNachbestellLetterBtn weiter oben) - deshalb hier kein
// await vor dem window.open()-Aufruf.
function runFastiAction(action) {
  const runtimeData = getRuntimeData();
  if (!runtimeData) return;

  try {
    const result = executeFastiAction(action, runtimeData);

    if (result.letterData) {
      const bodyHtml = renderNachbestellLetterHtml(result.letterData, { versandart: "fax" });
      openLetterPreview(result.letterData.title, bodyHtml);
      saveNachbestellHistorySnapshot({
        title: `Nachbestellung ${result.letterData.doctor} · ${formatIsoDateShort(result.letterData.createdAt)}`,
        doctor: result.letterData.doctor,
        createdAt: result.letterData.createdAt,
        rezeptCount: result.letterData.rezeptCount,
        patientCount: result.letterData.patientCount,
        snapshotHtml: bodyHtml,
        lines: flattenNachbestellLines(result.letterData)
      });
      queuePersistRuntimeData();
    } else if (result.needsPersist) {
      queuePersistRuntimeData();
    }

    appendFastiMessage("fasti", result.message);
    setFastiAnimation("nicken");

    // Manche Aktionen (aktuell: Doku-Eintrag anlegen) stellen direkt danach
    // eine Anschlussfrage, z.B. ob dafür auch Zeit gebucht werden soll.
    if (result.followUp) {
      appendFastiChoicesMessage(result.followUp.reply, result.followUp.choices);
    }
  } catch (err) {
    console.error(err);
    appendFastiMessage("fasti", `Aktion fehlgeschlagen: ${err?.message || err}`);
  }
}

function handleFastiSend() {
  const input = document.getElementById("fastiChatInput");
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  appendFastiMessage("user", text);

  const runtimeData = getRuntimeData();
  if (!runtimeData) {
    appendFastiMessage("fasti", "Ich habe gerade keinen Zugriff auf die App-Daten.");
    return;
  }

  let result;
  try {
    if (fastiPendingInput) {
      // Vorherige Rückfrage nach Freitext (z.B. Doku-Inhalt oder
      // Abwesenheits-Zeitraum) wartet - diese Nachricht ist die Antwort
      // darauf, nicht ein neuer Befehl.
      const resume = { ...fastiPendingInput.resume, freeTextAnswer: text };
      fastiPendingInput = null;
      result = resumeFastiChoice(resume, runtimeData);
    } else {
      result = answerFastiChat(text, runtimeData);
    }
  } catch (err) {
    console.error(err);
    result = { reply: `Da ist etwas schiefgelaufen: ${err?.message || err}` };
  }

  handleFastiResult(result);
}

// Geräteweite Anzeige-Präferenzen (Button-Position, Meldungen-Höhe) - bewusst
// in localStorage statt in den synchronisierten App-Daten, da es sich um
// reine Display-Einstellungen dieses einen Geräts/Browsers handelt, keine
// Praxisdaten.
const FASTI_BTN_POS_KEY = "fastiBtnPos";
const FASTI_NOTICES_HEIGHT_KEY = "fastiNoticesHeight";
const FASTI_NOTICES_MIN_HEIGHT = 60;
const FASTI_NOTICES_MAX_HEIGHT = 420;
let fastiBtnHasCustomPos = false;

function clampFastiBtnPos(x, y, btn) {
  const margin = 4;
  const w = btn.offsetWidth || 58;
  const h = btn.offsetHeight || 58;
  const maxX = Math.max(margin, window.innerWidth - w - margin);
  const maxY = Math.max(margin, window.innerHeight - h - margin);
  return { x: Math.min(Math.max(x, margin), maxX), y: Math.min(Math.max(y, margin), maxY) };
}

function applyFastiBtnPos(btn, x, y) {
  btn.style.left = `${x}px`;
  btn.style.top = `${y}px`;
  btn.style.right = "auto";
  btn.style.bottom = "auto";
}

// Macht den FaSti-Button per Zeigereingabe (Maus/Touch) frei verschiebbar.
// Ein Tap (kein nennenswertes Verschieben) öffnet weiterhin das Panel über
// onTap() - es gibt bewusst KEINEN separaten "click"-Listener mehr, um nicht
// doppelt (Drag-Ende UND Klick) zu reagieren.
function makeFastiButtonDraggable(btn, onTap) {
  try {
    const raw = localStorage.getItem(FASTI_BTN_POS_KEY);
    if (raw) {
      const pos = JSON.parse(raw);
      if (Number.isFinite(pos?.x) && Number.isFinite(pos?.y)) {
        const clamped = clampFastiBtnPos(pos.x, pos.y, btn);
        applyFastiBtnPos(btn, clamped.x, clamped.y);
        fastiBtnHasCustomPos = true;
      }
    }
  } catch {}

  let dragging = false;
  let moved = false;
  let startClientX = 0;
  let startClientY = 0;
  let startLeft = 0;
  let startTop = 0;

  btn.addEventListener("pointerdown", (e) => {
    dragging = true;
    moved = false;
    const rect = btn.getBoundingClientRect();
    startClientX = e.clientX;
    startClientY = e.clientY;
    startLeft = rect.left;
    startTop = rect.top;
    try { btn.setPointerCapture(e.pointerId); } catch {}
  });

  btn.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - startClientX;
    const dy = e.clientY - startClientY;
    if (!moved && (Math.abs(dx) > 6 || Math.abs(dy) > 6)) moved = true;
    if (moved) {
      const clamped = clampFastiBtnPos(startLeft + dx, startTop + dy, btn);
      applyFastiBtnPos(btn, clamped.x, clamped.y);
    }
  });

  function endDrag(e) {
    if (!dragging) return;
    dragging = false;
    if (moved) {
      fastiBtnHasCustomPos = true;
      const rect = btn.getBoundingClientRect();
      try { localStorage.setItem(FASTI_BTN_POS_KEY, JSON.stringify({ x: rect.left, y: rect.top })); } catch {}
    } else {
      onTap();
    }
    try { btn.releasePointerCapture(e.pointerId); } catch {}
  }

  btn.addEventListener("pointerup", endDrag);
  btn.addEventListener("pointercancel", endDrag);

  // Nur re-clampen, wenn der Nutzer den Button zuvor bewusst verschoben hat -
  // sonst bliebe die normale rechts/unten-Standardposition unnötig angetastet.
  window.addEventListener("resize", () => {
    if (!fastiBtnHasCustomPos) return;
    const rect = btn.getBoundingClientRect();
    const clamped = clampFastiBtnPos(rect.left, rect.top, btn);
    applyFastiBtnPos(btn, clamped.x, clamped.y);
  });
}

function clampFastiNoticesHeight(h) {
  return Math.min(FASTI_NOTICES_MAX_HEIGHT, Math.max(FASTI_NOTICES_MIN_HEIGHT, h));
}

function applyFastiNoticesHeight(h) {
  const noticesEl = document.getElementById("fastiNotices");
  if (noticesEl) noticesEl.style.height = `${h}px`;
}

// Macht die Trennlinie zwischen Meldungen und Chat-Verlauf per Zeigereingabe
// höhenverstellbar, damit wahlweise mehr Meldungen oder mehr Chat sichtbar
// ist - die gewählte Höhe wird geräteweit gemerkt (siehe FASTI_NOTICES_HEIGHT_KEY).
function makeFastiNoticesResizable() {
  const resizer = document.getElementById("fastiNoticesResizer");
  const noticesEl = document.getElementById("fastiNotices");
  if (!resizer || !noticesEl) return;

  try {
    const raw = localStorage.getItem(FASTI_NOTICES_HEIGHT_KEY);
    if (raw) applyFastiNoticesHeight(clampFastiNoticesHeight(Number(raw)));
  } catch {}

  let dragging = false;
  let startY = 0;
  let startHeight = 0;

  resizer.addEventListener("pointerdown", (e) => {
    dragging = true;
    startY = e.clientY;
    startHeight = noticesEl.getBoundingClientRect().height;
    try { resizer.setPointerCapture(e.pointerId); } catch {}
  });

  resizer.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    applyFastiNoticesHeight(clampFastiNoticesHeight(startHeight + (e.clientY - startY)));
  });

  function endResize(e) {
    if (!dragging) return;
    dragging = false;
    const h = Math.round(noticesEl.getBoundingClientRect().height);
    try { localStorage.setItem(FASTI_NOTICES_HEIGHT_KEY, String(h)); } catch {}
    try { resizer.releasePointerCapture(e.pointerId); } catch {}
  }

  resizer.addEventListener("pointerup", endResize);
  resizer.addEventListener("pointercancel", endResize);
}

// Liefert dieselbe Höhenformel wie ".fasti-panel{ max-height: ... }" in
// ensureFastiStyles() - dvh (dynamic viewport height) statt vh, damit der
// obere Rand des von unten verankerten Panels nicht über den tatsächlich
// sichtbaren Bildschirm hinausragt, sobald die mobile Adressleiste
// eingeblendet ist (vh bemisst sich auf vielen mobilen Browsern am GRÖSSTEN
// möglichen Viewport, nicht am gerade sichtbaren). Ein per .style gesetzter
// Wert kennt anders als eine CSS-Datei keine "zweite Zeile als Fallback" -
// deshalb hier eine echte Feature-Prüfung statt nur der Hoffnung, dass der
// Browser eine unbekannte Einheit stillschweigend ignoriert.
function fastiPanelExpandedHeight() {
  const supportsDvh = typeof CSS !== "undefined" && CSS.supports && CSS.supports("height", "1dvh");
  return supportsDvh ? "min(72dvh, 640px, calc(100dvh - 120px))" : "min(72vh, 640px)";
}

// Blendet Meldungsliste, Resize-Griff und "Alle Meldungen aus"-Button
// gemeinsam ein/aus - die drei gehören immer zusammen (kein Sinn, den
// Resize-Griff zu zeigen, wenn es nichts zum Anzeigen gibt).
function setFastiNoticesVisible(visible) {
  const panel = document.getElementById("fastiPanel");
  const noticesEl = document.getElementById("fastiNotices");
  const resizer = document.getElementById("fastiNoticesResizer");
  const dismissAllBtn = document.getElementById("fastiDismissAllBtn");
  if (noticesEl) noticesEl.hidden = !visible;
  if (resizer) resizer.hidden = !visible;
  if (dismissAllBtn) dismissAllBtn.hidden = !visible;
  // Ohne Meldungen darf das Panel weiterhin kompakt auf seinen Inhalt
  // schrumpfen (nur max-height als Obergrenze). Mit Meldungen MUSS das Panel
  // dagegen eine feste Höhe bekommen, sonst hat der Chat-Log (flex:1) keinen
  // erzwungenen Restplatz, in den er hineinwachsen könnte, wenn die
  // Meldungsliste per Drag-Griff verkleinert wird - das Panel würde dann nur
  // insgesamt kürzer, statt dass der Chat-Teil größer wird (siehe
  // makeFastiNoticesResizable()).
  if (panel) panel.style.height = visible ? fastiPanelExpandedHeight() : "";
}

// Verwirft auf einen Schlag alle aktuell angezeigten Hinweise (Button im
// grünen Header) - Pendant zum einzelnen "Ignorieren" pro Meldung.
function dismissAllFastiNotices() {
  fastiCurrentNotices = [];
  const badge = document.getElementById("fastiBadge");
  const noticesEl = document.getElementById("fastiNotices");
  if (badge) badge.hidden = true;
  if (noticesEl) noticesEl.innerHTML = "";
  setFastiNoticesVisible(false);
}

function ensureFastiWidget() {
  ensureFastiStyles();
  if (document.getElementById("fastiWidgetBtn")) return;

  const btn = document.createElement("div");
  btn.id = "fastiWidgetBtn";
  btn.className = "fasti-btn";
  btn.hidden = true;
  btn.innerHTML = `${FASTI_SVG}<span id="fastiBadge" class="fasti-badge" hidden>0</span>`;
  document.body.appendChild(btn);
  makeFastiButtonDraggable(btn, () => toggleFastiPanel());

  const panel = document.createElement("div");
  panel.id = "fastiPanel";
  panel.className = "fasti-panel";
  panel.hidden = true;
  panel.innerHTML = `
    <div class="fasti-panel-header">
      <span>FaSti</span>
      <div class="fasti-header-actions">
        <button id="fastiDismissAllBtn" class="fasti-dismiss-all-btn" hidden>Alle Meldungen aus</button>
        <button id="fastiCloseBtn" class="fasti-close-btn" aria-label="Schließen">✕</button>
      </div>
    </div>
    <div id="fastiNotices" class="fasti-notices" hidden></div>
    <div id="fastiNoticesResizer" class="fasti-notices-resizer" hidden></div>
    <div id="fastiChatLog" class="fasti-chat-log"></div>
    <div class="fasti-chat-input-row">
      <input id="fastiChatInput" type="text" placeholder="Frag FaSti…" autocomplete="off">
      <button id="fastiSendBtn">Senden</button>
    </div>
  `;
  document.body.appendChild(panel);

  document.getElementById("fastiCloseBtn").onclick = () => setFastiPanelOpen(false);
  document.getElementById("fastiDismissAllBtn").onclick = () => dismissAllFastiNotices();
  document.getElementById("fastiSendBtn").onclick = handleFastiSend;
  document.getElementById("fastiChatInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleFastiSend();
  });
  makeFastiNoticesResizable();
}

// Von core/boot.js nach dem Login mit den frisch berechneten Hinweisen
// (modules/fasti.js: buildFastiNotices()) aufzurufen. Das Chat-Panel bleibt
// dabei bewusst GESCHLOSSEN (Nutzer-Feedback: "Chatfenster soll beim Start
// der App geschlossen sein") - nur der Button + Badge werden gezeigt, die
// Aufwach-Animation macht kurz auf neue Hinweise aufmerksam, ohne das Panel
// aufzudrängen. Der Nutzer öffnet es bei Bedarf selbst per Klick/Tap.
export function showFastiNotices(notices) {
  ensureFastiWidget();
  document.getElementById("fastiWidgetBtn").hidden = false;
  fastiCurrentNotices = Array.isArray(notices) ? notices : [];

  const badge = document.getElementById("fastiBadge");
  const noticesEl = document.getElementById("fastiNotices");
  if (!badge || !noticesEl) return;

  if (fastiCurrentNotices.length === 0) {
    badge.hidden = true;
    noticesEl.innerHTML = "";
    setFastiNoticesVisible(false);
    return;
  }

  badge.hidden = false;
  badge.textContent = String(fastiCurrentNotices.length);
  noticesEl.innerHTML = fastiCurrentNotices.map(renderFastiNoticeItem).join("");
  setFastiNoticesVisible(true);
  bindFastiNoticeButtons();

  setFastiAnimation("aufwachen");
}

// Von core/boot.js beim Sperren aufzurufen: blendet das Widget nicht nur
// aus, sondern verwirft auch Chat-Verlauf/Hinweise, da diese Patientennamen
// enthalten können und sonst über die Sperre hinweg im DOM stehen blieben.
export function hideFastiWidget() {
  const btn = document.getElementById("fastiWidgetBtn");
  const panel = document.getElementById("fastiPanel");
  if (btn) btn.hidden = true;
  if (panel) panel.hidden = true;

  fastiChatHistory = [];
  fastiPendingAction = null;
  fastiPendingInput = null;
  fastiCurrentNotices = [];

  const log = document.getElementById("fastiChatLog");
  if (log) log.innerHTML = "";
  const noticesEl = document.getElementById("fastiNotices");
  if (noticesEl) noticesEl.innerHTML = "";
  setFastiNoticesVisible(false);
  const badge = document.getElementById("fastiBadge");
  if (badge) badge.hidden = true;
}
