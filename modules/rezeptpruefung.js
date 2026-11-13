import { parseDeDate } from "../core/date-utils.js";
import { getRezeptFristInfo } from "./fristen.js";

const JA_NEIN_LABELS = {
  icd10: "ICD-10 Code",
  leitsymptomatik: "Leitsymptomatik",
  arzt: "Arzt",
  items: "Heilmittel",
  hausbesuch: "Hausbesuch",
  arztStempel: "Arzt-Stempel",
  arztUnterschrift: "Arzt-Unterschrift",
  ausstell: "Ausstellungsdatum"
};

export function validateRezeptPflichtfelder(rezept) {
  const r = rezept || {};

  // Privatrezepte unterliegen keinen Kassenregeln (keine Pflichtfelder,
  // keine Behandlungsfristen) - auf Nutzerwunsch komplett von der Prüfung
  // ausgenommen.
  if (r.privat) {
    return { ok: true, errors: [], fristInfo: getRezeptFristInfo(r), privat: true };
  }

  const errors = [];

  if (!String(r.icd10 || "").trim()) {
    errors.push({ field: "icd10", message: `${JA_NEIN_LABELS.icd10} fehlt.` });
  }

  if (!String(r.leitsymptomatik || "").trim()) {
    errors.push({ field: "leitsymptomatik", message: `${JA_NEIN_LABELS.leitsymptomatik} fehlt.` });
  }

  if (!String(r.arzt || "").trim()) {
    errors.push({ field: "arzt", message: `${JA_NEIN_LABELS.arzt} fehlt.` });
  }

  const items = Array.isArray(r.items) ? r.items : [];
  if (items.length === 0) {
    errors.push({ field: "items", message: "Heilmittel fehlt." });
  } else if (items.some((item) => item.type !== "Blanko" && !String(item.count || "").trim())) {
    errors.push({ field: "items", message: "Anzahl der Behandlungen fehlt bei mindestens einer Leistung." });
  }

  if (r.hausbesuch !== "ja" && r.hausbesuch !== "nein") {
    errors.push({ field: "hausbesuch", message: "Hausbesuch: bitte Ja oder Nein auswählen." });
  }

  if (r.arztStempel !== "ja" && r.arztStempel !== "nein") {
    errors.push({ field: "arztStempel", message: "Arzt-Stempel vorhanden: bitte Ja oder Nein auswählen." });
  }

  if (r.arztUnterschrift !== "ja" && r.arztUnterschrift !== "nein") {
    errors.push({ field: "arztUnterschrift", message: "Arzt-Unterschrift vorhanden: bitte Ja oder Nein auswählen." });
  }

  const ausstellValid = !!parseDeDate(r.ausstell || "");
  if (!ausstellValid) {
    errors.push({ field: "ausstell", message: "Ausstellungsdatum fehlt oder ungültig." });
  }

  const fristInfo = getRezeptFristInfo(r);
  if (ausstellValid && fristInfo.mode !== "unknown" && Number(fristInfo.daysRemaining) < 0) {
    errors.push({
      field: "frist",
      message: `Frist für den Behandlungsbeginn ist bereits überschritten (spätester Beginn: ${fristInfo.latestStartText}).`
    });
  }

  return {
    ok: errors.length === 0,
    errors,
    fristInfo
  };
}
