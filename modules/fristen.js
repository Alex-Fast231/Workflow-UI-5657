import { parseDeDate, parseComparableDate, formatDeDate, getComparableFromDate } from "../core/date-utils.js";

function parseDEDateToDate(str) {
  const comparable = parseDeDate(str);
  return comparable ? parseComparableDate(comparable) : null;
}

function addDays(date, days) {
  const d = new Date(date.getTime());
  d.setDate(d.getDate() + days);
  return d;
}

function addMonthsSafe(date, months) {
  const d = new Date(date.getTime());
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, lastDay));
  return d;
}

function totalAnwendungsmenge(items) {
  let sum = 0;
  (items || []).forEach((item) => {
    if (!item || item.type === "Blanko") return;
    const n = Number(item.count);
    if (Number.isFinite(n)) sum += n;
  });
  return sum;
}

function isBlanko(rezept) {
  return (rezept?.items || []).some((item) => item.type === "Blanko");
}

function diffDays(fromDate, toDate) {
  const ms = toDate.getTime() - fromDate.getTime();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

function getTrafficLevel(daysRemaining) {
  if (daysRemaining <= 7) return "red";
  if (daysRemaining <= 21) return "orange";
  return "green";
}

// Ermittelt das früheste dokumentierte Behandlungsdatum eines Rezepts - über
// SchnellDoku-Einträge (rezept.entries) UND Zeiterfassungs-Einträge vom Typ
// "behandlung" (rezept.timeEntries) hinweg, da beide als Behandlungstag
// zählen (siehe countBehandlungstage() in modules/fasti.js). Wichtig für die
// Fristenprüfung: die tatsächliche "1. Behandlung" kann rückwirkend
// nachgetragen worden sein (z.B. heute für einen Termin vor Wochen erfasst)
// und muss dann trotzdem als die früheste zählen, nicht die zuletzt
// eingegebene - siehe sortRezeptEntriesByDate() in modules/homes.js, die
// dafür sorgt, dass rezept.entries ohnehin chronologisch sortiert ist, hier
// aber zur Sicherheit trotzdem über alle Einträge hinweg das Minimum bildet.
function getErsteBehandlungDatum(rezept) {
  let earliest = null;
  (rezept?.entries || []).forEach((entry) => {
    const d = parseDEDateToDate(entry?.date);
    if (d && (!earliest || d < earliest)) earliest = d;
  });
  (rezept?.timeEntries || []).forEach((entry) => {
    if (entry?.type !== "behandlung") return;
    const d = parseDEDateToDate(entry?.date);
    if (d && (!earliest || d < earliest)) earliest = d;
  });
  return earliest;
}

// Baut das gemeinsame Ergebnis für alle vier Rezepttypen (normal/dringend/bg/
// blanko): ist bereits eine erste Behandlung dokumentiert, wird die Frist
// GEGEN DIESES tatsächliche Datum geprüft ("eingehalten"/"verspätet" statt
// eines Countdowns) - das ist die eigentliche fachliche Prüfung. Ohne
// dokumentierte Behandlung bleibt es wie bisher ein Countdown ab heute
// (Warnung "muss bald beginnen"/"Frist bereits verstrichen, aber noch nichts
// dokumentiert"). In beiden Fällen bedeutet daysRemaining < 0 einen echten
// Fristverstoß - das nutzt buildRezeptNotices() (modules/fasti.js) bereits
// unverändert für die Konflikt-Erkennung.
function buildFristResult({ mode, latestStart, detailsText, validUntilText, ersteBehandlung, today }) {
  if (ersteBehandlung) {
    const daysRemaining = diffDays(ersteBehandlung, latestStart);
    const eingehalten = daysRemaining >= 0;
    return {
      mode,
      beginnErfolgt: true,
      beginnEingehalten: eingehalten,
      statusText: eingehalten
        ? `Beginn erfolgt am ${formatDeDate(ersteBehandlung)} - innerhalb der Frist (spätestens ${formatDeDate(latestStart)})`
        : `Beginn verspätet: ${formatDeDate(ersteBehandlung)} statt spätestens ${formatDeDate(latestStart)}`,
      detailsText,
      latestStartText: formatDeDate(latestStart),
      validUntilText,
      traffic: eingehalten ? "green" : "red",
      daysRemaining
    };
  }

  const daysRemaining = diffDays(today, latestStart);
  return {
    mode,
    beginnErfolgt: false,
    beginnEingehalten: null,
    statusText: `Beginn bis ${formatDeDate(latestStart)}`,
    detailsText,
    latestStartText: formatDeDate(latestStart),
    validUntilText,
    traffic: getTrafficLevel(daysRemaining),
    daysRemaining
  };
}

// Schätzt das Ende der Gültigkeit eines Rezepts als vergleichbares
// YYYY-MM-DD (nicht formatierter Text wie validUntilText) - genutzt vom
// FaSt-Startdatum-Filter in buildRezeptNotices() (modules/fasti.js), um
// Alt-Rezepte zu erkennen, deren Gültigkeit schon vor dem Startdatum
// endete ("...auch wenn das Ausstellungsdatum und Behandlungen vorher
// waren, aber die Gültigkeitsfrist über das Startdatum hinausreicht").
// Ohne dokumentierte erste Behandlung wird ersatzweise das
// Ausstellungsdatum als Basis verwendet (wie bei den Fristen bg/blanko
// ohnehin immer der Fall) - bei GKV normal/dringend ist das nur eine
// Annäherung, aber genau die richtige für den Zweck: ein nie begonnenes,
// uraltes Rezept soll als abgelaufener Alt-Fall gelten statt endlos als
// "laufend" mitgezählt zu werden.
export function getRezeptGueltigBisComparable(rezept) {
  const ausstellDate = parseDEDateToDate(rezept?.ausstell || "");
  if (!ausstellDate) return null;

  if (rezept?.bg) return getComparableFromDate(addMonthsSafe(ausstellDate, 2));
  if (isBlanko(rezept)) return getComparableFromDate(addMonthsSafe(ausstellDate, 4));

  const ersteBehandlung = getErsteBehandlungDatum(rezept);
  const basis = ersteBehandlung || ausstellDate;
  const total = totalAnwendungsmenge(rezept?.items || []);
  const gueltigMonate = total <= 6 ? 3 : 6;
  return getComparableFromDate(addMonthsSafe(basis, gueltigMonate));
}

export function getRezeptFristInfo(rezept) {
  const today = new Date();
  const ausstellDate = parseDEDateToDate(rezept?.ausstell || "");

  if (!ausstellDate) {
    return {
      mode: "unknown",
      statusText: "Ausstellungsdatum fehlt",
      detailsText: "Fristen nicht berechenbar",
      latestStartText: null,
      validUntilText: null,
      traffic: "red",
      daysRemaining: null
    };
  }

  const ersteBehandlung = getErsteBehandlungDatum(rezept);

  if (rezept?.bg) {
    const latestStart = addDays(ausstellDate, 14);
    const validUntil = addMonthsSafe(ausstellDate, 2);
    return buildFristResult({
      mode: "bg",
      latestStart,
      detailsText: "BG: Beginn innerhalb 14 Tagen · gültig 2 Monate ab Ausstellungsdatum",
      validUntilText: formatDeDate(validUntil),
      ersteBehandlung,
      today
    });
  }

  if (rezept?.dringend) {
    const latestStart = addDays(ausstellDate, 14);
    const total = totalAnwendungsmenge(rezept?.items || []);
    const gueltigMonate = total <= 6 ? 3 : 6;
    // "Gültig bis" lässt sich erst als echtes Datum berechnen, sobald die
    // erste Behandlung feststeht (Basis der Frist ist "1. Behandlung", nicht
    // das Ausstellungsdatum) - vorher bleibt es die textliche Regel aus der FAQ.
    const validUntilText = ersteBehandlung
      ? formatDeDate(addMonthsSafe(ersteBehandlung, gueltigMonate))
      : `1. Behandlung + ${gueltigMonate} Monate`;
    return buildFristResult({
      mode: "dringend",
      latestStart,
      detailsText: `GKV dringender Bedarf: Beginn innerhalb 14 Tagen · Gesamtmenge ${total}x · 1. Behandlung + ${gueltigMonate} Monate`,
      validUntilText,
      ersteBehandlung,
      today
    });
  }

  if (isBlanko(rezept)) {
    const latestStart = addDays(ausstellDate, 28);
    const validUntil = addMonthsSafe(ausstellDate, 4);
    return buildFristResult({
      mode: "blanko",
      latestStart,
      detailsText: "Blanko: Beginn innerhalb 28 Tagen · gültig 4 Monate ab Ausstellungsdatum",
      validUntilText: formatDeDate(validUntil),
      ersteBehandlung,
      today
    });
  }

  const latestStart = addDays(ausstellDate, 28);
  const total = totalAnwendungsmenge(rezept?.items || []);
  const gueltigMonate = total <= 6 ? 3 : 6;
  const validUntilText = ersteBehandlung
    ? formatDeDate(addMonthsSafe(ersteBehandlung, gueltigMonate))
    : `1. Behandlung + ${gueltigMonate} Monate`;

  return buildFristResult({
    mode: "normal",
    latestStart,
    detailsText: `Gesamtmenge ${total}x · 1. Behandlung + ${gueltigMonate} Monate`,
    validUntilText,
    ersteBehandlung,
    today
  });
}
