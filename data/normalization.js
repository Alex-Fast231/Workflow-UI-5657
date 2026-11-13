import { createEmptyAppData, APP_SCHEMA_VERSION, APP_VERSION, APP_MODULE, PRACTICE_ADDRESS } from "./schema.js";
import { formatDeDate, parseDeDate, compareDeDates } from "../core/date-utils.js";
import { generateId, getRezeptAusstellungsdatum } from "../core/utils.js";

function ensureString(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function ensureBoolean(value, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

function ensureJaNein(value) {
  return value === "ja" || value === "nein" ? value : "";
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}
function ensureWorkDays(value) {
  const allowed = new Set(["MO", "DI", "MI", "DO", "FR"]);
  return ensureArray(value)
    .map((item) => ensureString(item).trim().toUpperCase())
    .filter((item, index, array) => allowed.has(item) && array.indexOf(item) === index);
}


function ensureDeDateString(value) {
  const normalized = formatDeDate(value);
  return parseDeDate(normalized) ? normalized : "";
}

function ensureIsoString(value, fallback = "") {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return fallback;
    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }

  return fallback;
}

function ensureWeeklyHours(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === "string") {
    return value.trim();
  }
  return "";
}

function ensureIntegerNumber(value, fallback = 0) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? Math.round(numberValue) : fallback;
}

function normalizeEntry(entry) {
  const now = new Date().toISOString();
  const item = entry && typeof entry === "object" ? entry : {};

  return {
    entryId: ensureString(item.entryId) || generateId("entry"),
    date: ensureDeDateString(item.date),
    text: ensureString(item.text),
    createdAt: ensureIsoString(item.createdAt, now),
    updatedAt: ensureIsoString(item.updatedAt, now),
    linkedTimeEntryId: ensureString(item.linkedTimeEntryId),
    autoTimeMinutes: Number.isFinite(Number(item.autoTimeMinutes)) ? Number(item.autoTimeMinutes) : 0
  };
}

// Defensiv beim Laden: SchnellDoku-Einträge chronologisch sortieren
// (frühestes Datum zuerst), unabhängig von der ursprünglichen
// Eingabe-Reihenfolge - z.B. für Backups/Importe, die vor der Sortierung
// beim Speichern (siehe modules/homes.js: createRezeptEntry) entstanden sind.
function sortEntriesChronologically(entries) {
  return [...entries].sort((a, b) => compareDeDates(a?.date, b?.date));
}

function normalizeItem(item) {
  const source = item && typeof item === "object" ? item : {};
  const type = ensureString(source.type).trim();
  if (!type) return null;

  return {
    itemId: ensureString(source.itemId) || generateId("item"),
    type,
    count: type === "Blanko" ? "" : ensureString(source.count)
  };
}

function getNormalizedRezeptAusstellungsdatum(source) {
  return ensureDeDateString(getRezeptAusstellungsdatum(source));
}

function normalizeRezept(rezept) {
  const source = rezept && typeof rezept === "object" ? rezept : {};
  let items = [];

  if (Array.isArray(source.items)) {
    items = source.items.map(normalizeItem).filter(Boolean);
  } else {
    const leistung = ensureString(source.leistung).trim();
    if (leistung) {
      items = [
        normalizeItem({
          type: leistung,
          count: source.anzahl ?? ""
        })
      ].filter(Boolean);
    }
  }

return {
  rezeptId: ensureString(source.rezeptId || source.id) || generateId("rezept"),
  arzt: ensureString(source.arzt || source.doctor),
  ausstell: getNormalizedRezeptAusstellungsdatum(source),
  bg: ensureBoolean(source.bg, false),
  dt: ensureBoolean(source.dt, false),
  dringend: ensureBoolean(source.dringend, false),
  icd10: ensureString(source.icd10),
  icd10b: ensureString(source.icd10b),
  leitsymptomatik: ensureString(source.leitsymptomatik),
  hausbesuch: ensureJaNein(source.hausbesuch),
  arztStempel: ensureJaNein(source.arztStempel),
  arztUnterschrift: ensureJaNein(source.arztUnterschrift),
  privat: ensureBoolean(source.privat, false),
  abgegeben: ensureBoolean(source.abgegeben, false),
  items,
  entries: sortEntriesChronologically(ensureArray(source.entries).map(normalizeEntry)),
  zeitMeta: source.zeitMeta && typeof source.zeitMeta === "object"
    ? source.zeitMeta
    : {
        plannedTimeMinutes: 0,
        lastTimeEntryAt: "",
        kilometerRelevant: true
      },
  exportMeta: source.exportMeta && typeof source.exportMeta === "object"
    ? source.exportMeta
    : {
        exportReady: true,
        viewerLabel: "",
        lastExportAt: ""
      },
  timeEntries: ensureArray(source.timeEntries).map((item) => {
    const now = new Date().toISOString();
    const entry = item && typeof item === "object" ? item : {};
    return {
      timeEntryId: ensureString(entry.timeEntryId) || generateId("time"),
      date: ensureDeDateString(entry.date),
      minutes: Number.isFinite(Number(entry.minutes)) ? Number(entry.minutes) : 0,
      type: ["behandlung", "dokumentation", "besprechung", "manuell"].includes(ensureString(entry.type))
        ? ensureString(entry.type)
        : "behandlung",
      note: ensureString(entry.note),
      sourceEntryId: ensureString(entry.sourceEntryId),
      confirmed: ensureBoolean(entry.confirmed, true),
      createdAt: ensureIsoString(entry.createdAt, now),
      updatedAt: ensureIsoString(entry.updatedAt, now)
    };
  }),
  doctorReports: ensureArray(source.doctorReports).map((item) => {
    const now = new Date().toISOString();
    const report = item && typeof item === "object" ? item : {};
    return {
      reportId: ensureString(report.reportId || report.id) || generateId("report"),
      content: ensureString(report.content || report.text),
      therapieziele: ensureArray(report.therapieziele).map((v) => ensureString(v)).filter(Boolean),
      therapiezielFreitext: ensureString(report.therapiezielFreitext),
      compliance: ensureEnum(report.compliance, ["gut", "eingeschraenkt", "nicht_vorhanden", "keine_angabe"], ""),
      complianceFreitext: ensureString(report.complianceFreitext),
      verlauf: ensureEnum(report.verlauf, ["verbessert", "stabil", "status_quo", "verschlechtert"], ""),
      verlaufFreitext: ensureString(report.verlaufFreitext),
      therapieWeiterfuehren: ensureEnum(report.therapieWeiterfuehren, ["ja", "nein"], ""),
      therapieNutzen: ensureEnum(report.therapieNutzen, ["ja", "nein", "teilweise"], ""),
      therapieText: ensureString(report.therapieText),
      bemerkungen: ensureString(report.bemerkungen),
      createdAt: ensureIsoString(report.createdAt, now),
      updatedAt: ensureIsoString(report.updatedAt, now)
    };
  })
};
}

function normalizeDiagnoseZuordnung(item) {
  const source = item && typeof item === "object" ? item : {};
  return {
    id: ensureString(source.id) || generateId("diagzuordnung"),
    input: ensureString(source.input),
    icd10: ensureString(source.icd10),
    gruppe: ensureString(source.gruppe),
    gruppeLabel: ensureString(source.gruppeLabel),
    empfehlung: ensureString(source.empfehlung),
    createdAt: ensureIsoString(source.createdAt, new Date().toISOString())
  };
}

function ensureZuzahlungsstatus(value) {
  return ["ja", "nein", "ungeklaert"].includes(value) ? value : "";
}

function ensureComparableDateString(value) {
  const raw = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : "";
}

function ensureEnum(value, allowed, fallback = "") {
  return allowed.includes(value) ? value : fallback;
}

function ensureNullableInt(value, min, max) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const rounded = Math.round(n);
  if (min !== undefined && rounded < min) return null;
  if (max !== undefined && rounded > max) return null;
  return rounded;
}

function ensureNullableFloat(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function normalizeBbs7Items(items) {
  const source = items && typeof items === "object" ? items : {};
  const result = {};
  ["sitzenZuStehen", "freiesStehen", "freiesSitzen", "stehenZuSitzen", "transfer", "augenGeschlossen", "tandemstand"].forEach((key) => {
    const entry = source[key] && typeof source[key] === "object" ? source[key] : {};
    result[key] = {
      score: ensureNullableInt(entry.score, 0, 4),
      nichtDurchfuehrbar: ensureBoolean(entry.nichtDurchfuehrbar, false)
    };
  });
  return result;
}

const BBS_ITEM_KEYS = [
  "sitzenZuStehen", "freiesStehen", "freiesSitzen", "stehenZuSitzen", "transfer",
  "augenGeschlossen", "fuesseZusammen", "reichweite", "gegenstandAufheben", "umschauen",
  "drehung360", "stufeWechsel", "tandemstand", "einbeinstand"
];

function normalizeBbs14Items(items) {
  const source = items && typeof items === "object" ? items : {};
  const result = {};
  BBS_ITEM_KEYS.forEach((key) => {
    const entry = source[key] && typeof source[key] === "object" ? source[key] : {};
    result[key] = {
      score: ensureNullableInt(entry.score, 0, 4),
      nichtDurchfuehrbar: ensureBoolean(entry.nichtDurchfuehrbar, false)
    };
  });
  return result;
}

function normalizeMrcGruppen(gruppen) {
  const source = gruppen && typeof gruppen === "object" ? gruppen : {};
  const result = {};
  ["schulter", "ellbogen", "huefte", "knie"].forEach((key) => {
    const entry = source[key] && typeof source[key] === "object" ? source[key] : {};
    result[key] = {
      links: ensureNullableInt(entry.links, 0, 5),
      rechts: ensureNullableInt(entry.rechts, 0, 5)
    };
  });
  return result;
}

function normalizeRomListe(list, allowedKeys) {
  return ensureArray(list)
    .map((item) => ({
      gelenk: ensureString(item?.gelenk),
      bewertung: ensureEnum(item?.bewertung, ["frei", "eingeschraenkt", "aufgehoben"], "")
    }))
    .filter((item) => item.gelenk && (!allowedKeys || allowedKeys.includes(item.gelenk)));
}

function normalizeBesdValues(besd) {
  const source = besd && typeof besd === "object" ? besd : {};
  const result = {};
  ["atmung", "lautaeusserungen", "gesichtsausdruck", "koerpersprache", "trost"].forEach((key) => {
    result[key] = ensureNullableInt(source[key], 0, 2);
  });
  return result;
}

function normalizeAssessment(item) {
  const source = item && typeof item === "object" ? item : {};
  const ebene0Source = source.ebene0 && typeof source.ebene0 === "object" ? source.ebene0 : {};
  const orientierungSource = ebene0Source.orientierung && typeof ebene0Source.orientierung === "object" ? ebene0Source.orientierung : {};
  const barthelSource = source.barthel && typeof source.barthel === "object" ? source.barthel : {};
  const tugSource = source.tug && typeof source.tug === "object" ? source.tug : {};
  const neuroSource = source.neuro && typeof source.neuro === "object" ? source.neuro : {};
  const bbs7Source = neuroSource.bbs7 && typeof neuroSource.bbs7 === "object" ? neuroSource.bbs7 : {};
  const rmiSource = neuroSource.rmi && typeof neuroSource.rmi === "object" ? neuroSource.rmi : {};
  const mrcNeuroSource = neuroSource.mrc && typeof neuroSource.mrc === "object" ? neuroSource.mrc : {};
  const orthoSource = source.ortho && typeof source.ortho === "object" ? source.ortho : {};
  const sppbSource = orthoSource.sppb && typeof orthoSource.sppb === "object" ? orthoSource.sppb : {};
  const sppbBalanceSource = sppbSource.balance && typeof sppbSource.balance === "object" ? sppbSource.balance : {};
  const schmerzLokSource = orthoSource.schmerzLokalisation && typeof orthoSource.schmerzLokalisation === "object" ? orthoSource.schmerzLokalisation : {};
  const schwerstSource = source.schwerst && typeof source.schwerst === "object" ? source.schwerst : {};
  const mrcSchwerstSource = schwerstSource.mrc && typeof schwerstSource.mrc === "object" ? schwerstSource.mrc : {};
  const kontrakturenSource = schwerstSource.kontrakturen && typeof schwerstSource.kontrakturen === "object" ? schwerstSource.kontrakturen : {};

  return {
    id: ensureString(source.id) || generateId("assessment"),
    date: ensureComparableDateString(source.date),
    content: ensureString(source.content),
    createdAt: ensureIsoString(source.createdAt, new Date().toISOString()),

    ebene0: {
      orientierung: {
        zeitlich: ensureBoolean(orientierungSource.zeitlich, false),
        oertlich: ensureBoolean(orientierungSource.oertlich, false),
        person: ensureBoolean(orientierungSource.person, false),
        situation: ensureBoolean(orientierungSource.situation, false),
        nicht: ensureBoolean(orientierungSource.nicht, false)
      },
      gedaechtnis: ensureEnum(ebene0Source.gedaechtnis, ["unauffaellig", "kurzzeit", "langzeit", "nicht_beurteilbar"], ""),
      kommunikation: ensureEnum(ebene0Source.kommunikation, ["verbal", "verbal_eingeschraenkt", "nonverbal", "nicht_moeglich"], ""),
      kooperation: ensureEnum(ebene0Source.kooperation, ["gut", "eingeschraenkt", "nicht_moeglich"], "")
    },

    barthel: {
      essen: ensureNullableInt(barthelSource.essen, 0, 10),
      baden: ensureNullableInt(barthelSource.baden, 0, 5),
      koerperpflege: ensureNullableInt(barthelSource.koerperpflege, 0, 5),
      ankleiden: ensureNullableInt(barthelSource.ankleiden, 0, 10),
      stuhlkontinenz: ensureNullableInt(barthelSource.stuhlkontinenz, 0, 10),
      harnkontinenz: ensureNullableInt(barthelSource.harnkontinenz, 0, 10),
      toilette: ensureNullableInt(barthelSource.toilette, 0, 10),
      transfer: ensureNullableInt(barthelSource.transfer, 0, 15),
      gehen: ensureNullableInt(barthelSource.gehen, 0, 15),
      treppen: ensureNullableInt(barthelSource.treppen, 0, 10)
    },

    schmerzTyp: ensureEnum(source.schmerzTyp, ["nrs", "besd"], "nrs"),
    nrs: ensureNullableInt(source.nrs, 0, 10),
    nrsNichtBeurteilbar: ensureBoolean(source.nrsNichtBeurteilbar, false),
    besd: normalizeBesdValues(source.besd),

    tug: {
      sekunden: ensureNullableFloat(tugSource.sekunden),
      hilfsmittel: ensureString(tugSource.hilfsmittel),
      nichtDurchfuehrbar: ensureBoolean(tugSource.nichtDurchfuehrbar, false)
    },

    weiche: ensureEnum(source.weiche, ["neurologisch", "orthopaedisch", "schwerstbetroffen", "bbs"], ""),

    bbs14: normalizeBbs14Items(source.bbs14),

    neuro: {
      bbs7: normalizeBbs7Items(bbs7Source),
      rmi: {
        antworten: ensureArray(rmiSource.antworten).map((v) => !!v),
        beobachtung: ensureBoolean(rmiSource.beobachtung, false)
      },
      mrc: {
        position: ensureEnum(mrcNeuroSource.position, ["sitzen", "liegen"], ""),
        gruppen: normalizeMrcGruppen(mrcNeuroSource.gruppen),
        spastik: ensureEnum(mrcNeuroSource.spastik, ["nein", "links", "rechts", "beidseitig"], ""),
        nichtDurchfuehrbar: ensureBoolean(mrcNeuroSource.nichtDurchfuehrbar, false)
      }
    },

    ortho: {
      sppb: {
        balance: {
          seitNebeneinanderSek: ensureNullableFloat(sppbBalanceSource.seitNebeneinanderSek),
          semitandemSek: ensureNullableFloat(sppbBalanceSource.semitandemSek),
          tandemSek: ensureNullableFloat(sppbBalanceSource.tandemSek),
          nichtMoeglich: ensureBoolean(sppbBalanceSource.nichtMoeglich, false)
        },
        gehgeschwindigkeitSek: ensureNullableFloat(sppbSource.gehgeschwindigkeitSek),
        hilfsmittel: ensureString(sppbSource.hilfsmittel),
        chairStandSek: ensureNullableFloat(sppbSource.chairStandSek),
        chairStandNichtMoeglich: ensureBoolean(sppbSource.chairStandNichtMoeglich, false)
      },
      schmerzLokalisation: {
        zonen: ensureArray(schmerzLokSource.zonen).map((z) => ensureString(z)).filter(Boolean),
        qualitaet: ensureArray(schmerzLokSource.qualitaet).map((q) => ensureString(q)).filter(Boolean)
      },
      romAktiv: normalizeRomListe(orthoSource.romAktiv)
    },

    schwerst: {
      mrc: {
        gruppen: normalizeMrcGruppen(mrcSchwerstSource.gruppen),
        spastik: ensureEnum(mrcSchwerstSource.spastik, ["nein", "links", "rechts", "beidseitig"], ""),
        nichtDurchfuehrbar: ensureBoolean(mrcSchwerstSource.nichtDurchfuehrbar, false)
      },
      kontrakturen: {
        vorhanden: ensureBoolean(kontrakturenSource.vorhanden, false),
        liste: ensureArray(kontrakturenSource.liste).map((k) => ensureString(k)).filter(Boolean)
      },
      dekubitusrisiko: ensureEnum(schwerstSource.dekubitusrisiko, ["ja", "nein"], ""),
      besd: normalizeBesdValues(schwerstSource.besd),
      romPassiv: normalizeRomListe(schwerstSource.romPassiv),
      schmerzBeiBewegung: ensureBoolean(schwerstSource.schmerzBeiBewegung, false),
      spastikWiderstand: ensureBoolean(schwerstSource.spastikWiderstand, false)
    }
  };
}

function normalizePatient(patient) {
  const source = patient && typeof patient === "object" ? patient : {};

  return {
    patientId: ensureString(source.patientId || source.id) || generateId("patient"),
    firstName: ensureString(source.firstName),
    lastName: ensureString(source.lastName),
    anrede: ensureEnum(source.anrede, ["frau", "herr"], ""),
    birthDate: ensureDeDateString(source.birthDate),
    befreit: ensureBoolean(source.befreit, false),
    verstorben: ensureBoolean(source.verstorben, false),
    ausgeschieden: ensureBoolean(source.ausgeschieden, false),
    zuzahlungsstatus: ensureZuzahlungsstatus(source.zuzahlungsstatus),
    zuzahlungsstatusSetAt: ensureIsoString(source.zuzahlungsstatusSetAt),
    zuzahlungReminderAt: ensureIsoString(source.zuzahlungReminderAt),
    assessments: ensureArray(source.assessments).map(normalizeAssessment),
    nextAssessmentDueAt: ensureComparableDateString(source.nextAssessmentDueAt),
    assessmentMrcPosition: ensureEnum(source.assessmentMrcPosition, ["sitzen", "liegen"], ""),
    entries: ensureArray(source.entries).map(normalizeEntry),
    rezepte: ensureArray(source.rezepte).map(normalizeRezept),
    diagnoseZuordnung: ensureArray(source.diagnoseZuordnung).map(normalizeDiagnoseZuordnung),
    zeitMeta: source.zeitMeta && typeof source.zeitMeta === "object" ? source.zeitMeta : {},
    // Zwischenstand eines noch nicht fertig ausgefüllten Assessment-Wizards
    // (siehe modules/homes.js saveAssessmentDraft/clearAssessmentDraft) -
    // überlebt damit einen Auto-Lock oder ein Schließen der App mitten in
    // der Erfassung, statt alle bereits eingegebenen Werte zu verlieren.
    // Bewusst ohne Feld-Validierung, da die innere Struktur exakt dem
    // Wizard-Objekt in ui/views.js entspricht und sich mit den Tests dort
    // weiterentwickelt.
    assessmentDraft: source.assessmentDraft && typeof source.assessmentDraft === "object" ? source.assessmentDraft : null
  };
}

function normalizeHome(home) {
  const source = home && typeof home === "object" ? home : {};

  return {
    homeId: ensureString(source.homeId || source.id) || generateId("home"),
    name: ensureString(source.name),
    adresse: ensureString(source.adresse || source.address),
    verwaltungsEmail: ensureString(source.verwaltungsEmail),
    hbPauschale: ["HB", "HBHP"].includes(source.hbPauschale) ? source.hbPauschale : "HB",
    patients: ensureArray(source.patients).map(normalizePatient)
  };
}

function normalizeAbgabeHistory(items) {
  return ensureArray(items).map((item) => {
    const source = item && typeof item === "object" ? item : {};
    return {
      id: ensureString(source.id) || generateId("abgabe"),
      createdAt: ensureIsoString(source.createdAt),
      title: ensureString(source.title),
      snapshotHtml: ensureString(source.snapshotHtml),
      rows: ensureArray(source.rows).map((row) => ({
        heim: ensureString(row?.heim),
        patient: ensureString(row?.patient),
        patientFirstName: ensureString(row?.patientFirstName),
        patientLastName: ensureString(row?.patientLastName),
        geb: ensureDeDateString(row?.geb),
        ausstell: ensureDeDateString(row?.ausstell),
        leistung: ensureString(row?.leistung),
        anzahl: ensureString(row?.anzahl),
        menge: ensureString(row?.menge),
        arzt: ensureString(row?.arzt || row?.doctor),
        befreit: ensureBoolean(row?.befreit, false),
        bg: ensureBoolean(row?.bg, false),
        dt: ensureBoolean(row?.dt, false)
      }))
    };
  });
}


function normalizeKilometerState(state) {
  const source = state && typeof state === "object" ? state : {};
  return {
    startPoint: {
      label: ensureString(source.startPoint?.label),
      address: ensureString(source.startPoint?.address)
    },
    knownRoutes: ensureArray(source.knownRoutes).map((item) => ({
      routeId: ensureString(item?.routeId) || generateId("route"),
      fromPointId: ensureString(item?.fromPointId),
      toPointId: ensureString(item?.toPointId),
      fromLabel: ensureString(item?.fromLabel),
      toLabel: ensureString(item?.toLabel),
      km: Number.isFinite(Number(item?.km)) ? Number(item.km) : 0,
      createdAt: ensureIsoString(item?.createdAt, new Date().toISOString()),
      updatedAt: ensureIsoString(item?.updatedAt, new Date().toISOString())
    })),
    travelLog: ensureArray(source.travelLog).map((item) => ({
      travelId: ensureString(item?.travelId) || generateId("travel"),
      date: ensureDeDateString(item?.date),
      fromPointId: ensureString(item?.fromPointId),
      toPointId: ensureString(item?.toPointId),
      fromLabel: ensureString(item?.fromLabel),
      toLabel: ensureString(item?.toLabel),
      km: Number.isFinite(Number(item?.km)) ? Number(item.km) : 0,
      source: ensureString(item?.source, "auto") || "auto",
      relatedEntryId: ensureString(item?.relatedEntryId),
      note: ensureString(item?.note),
      createdAt: ensureIsoString(item?.createdAt, new Date().toISOString()),
      updatedAt: ensureIsoString(item?.updatedAt),
      manualAdjusted: Boolean(item?.manualAdjusted),
      abgerechnet: item?.abgerechnet === true,
      abgerechnetAm: ensureString(item?.abgerechnetAm),
      kmExportId: ensureString(item?.kmExportId)
    })),
    kmExports: ensureArray(source.kmExports).map((item) => ({
      id: ensureString(item?.id) || generateId("kmexport"),
      number: ensureString(item?.number),
      therapistName: ensureString(item?.therapistName),
      von: ensureDeDateString(item?.von),
      bis: ensureDeDateString(item?.bis),
      erstesFahrtdatum: ensureDeDateString(item?.erstesFahrtdatum),
      letztesFahrtdatum: ensureDeDateString(item?.letztesFahrtdatum),
      erstelltAm: ensureIsoString(item?.erstelltAm, new Date().toISOString()),
      gesamtKm: Number.isFinite(Number(item?.gesamtKm)) ? Number(item.gesamtKm) : 0,
      gesamtVerguetung: Number.isFinite(Number(item?.gesamtVerguetung)) ? Number(item.gesamtVerguetung) : 0,
      fahrtIds: ensureArray(item?.fahrtIds).map((id) => ensureString(id)).filter(Boolean),
      snapshotHtml: ensureString(item?.snapshotHtml)
    }))
  };
}


function normalizeAbwesenheiten(items) {
  return ensureArray(items).map((item) => {
    const source = item && typeof item === "object" ? item : {};
    const type = ensureString(source.type).trim().toLowerCase() === "krank" ? "krank" : "urlaub";
    return {
      id: ensureString(source.id) || generateId("abwesenheit"),
      type,
      from: ensureDeDateString(source.from || source.von),
      to: ensureDeDateString(source.to || source.bis),
      createdAt: ensureIsoString(source.createdAt, new Date().toISOString()),
      updatedAt: ensureIsoString(source.updatedAt, new Date().toISOString())
    };
  });
}

function normalizeSpecialDays(items) {
  return ensureArray(items).map((item) => {
    const source = item && typeof item === "object" ? item : {};
    return {
      id: ensureString(source.id) || generateId("specialday"),
      type: "holiday",
      date: ensureDeDateString(source.date || source.datum),
      createdAt: ensureIsoString(source.createdAt, new Date().toISOString()),
      updatedAt: ensureIsoString(source.updatedAt, new Date().toISOString())
    };
  }).filter((item) => item.date);
}

function normalizeStundenAbgleiche(items) {
  return ensureArray(items).map((item) => {
    const source = item && typeof item === "object" ? item : {};
    const typ = ensureString(source.typ || source.type).trim().toLowerCase() === "frei" ? "frei" : "auszahlung";
    const minuten = ensureIntegerNumber(source.minuten || source.minutes, 0);
    return {
      id: ensureString(source.id) || generateId("stundenabgleich"),
      typ,
      datum: ensureDeDateString(source.datum || source.date),
      minuten: Math.max(0, Math.abs(minuten)),
      notiz: ensureString(source.notiz || source.note),
      createdAt: ensureIsoString(source.createdAt, new Date().toISOString()),
      updatedAt: ensureIsoString(source.updatedAt, new Date().toISOString())
    };
  }).filter((item) => item.datum && item.minuten > 0);
}

function normalizeNachbestellHistory(items) {
  return ensureArray(items).map((item) => {
    const source = item && typeof item === "object" ? item : {};
    return {
      id: ensureString(source.id) || generateId("nachbestellung"),
      createdAt: ensureIsoString(source.createdAt),
      title: ensureString(source.title),
      doctor: ensureString(source.doctor),
      rezeptCount: Number.isFinite(Number(source.rezeptCount)) ? Number(source.rezeptCount) : 0,
      patientCount: Number.isFinite(Number(source.patientCount)) ? Number(source.patientCount) : 0,
      snapshotHtml: ensureString(source.snapshotHtml),
      lines: ensureArray(source.lines).map((line) => ({
        patient: ensureString(line?.patient),
        geb: ensureDeDateString(line?.geb),
        heim: ensureString(line?.heim),
        text: ensureString(line?.text)
      }))
    };
  });
}

function normalizeArzt(item) {
  const source = item && typeof item === "object" ? item : {};
  return {
    id: ensureString(source.id) || generateId("arzt"),
    name: ensureString(source.name),
    adresse: ensureString(source.adresse),
    email: ensureString(source.email),
    createdAt: ensureIsoString(source.createdAt, new Date().toISOString()),
    updatedAt: ensureIsoString(source.updatedAt, new Date().toISOString())
  };
}

function normalizeFreikuvertHistory(items) {
  return ensureArray(items).map((item) => {
    const source = item && typeof item === "object" ? item : {};
    return {
      id: ensureString(source.id) || generateId("freikuvert"),
      arztName: ensureString(source.arztName),
      arztAdresse: ensureString(source.arztAdresse),
      anzahl: Number.isFinite(Number(source.anzahl)) ? Number(source.anzahl) : 10,
      therapistName: ensureString(source.therapistName),
      createdAt: ensureIsoString(source.createdAt, new Date().toISOString())
    };
  });
}

function normalizeAutoExportHistory(items) {
  return ensureArray(items).map((item) => {
    const source = item && typeof item === "object" ? item : {};
    return {
      id: ensureString(source.id) || generateId("autoexport"),
      createdAt: ensureIsoString(source.createdAt, new Date().toISOString()),
      status: ["handled", "postponed", "auto-download"].includes(source.status) ? source.status : "postponed",
      message: ensureString(source.message)
    };
  }).slice(0, 20);
}

export function finalizeAppStructure(data) {
  const base = createEmptyAppData();
  const source = data && typeof data === "object" ? data : {};
  const now = new Date().toISOString();

  const settings = source.settings && typeof source.settings === "object" ? source.settings : {};

  const result = {
    ...base,
    ...source,

    schemaVersion: APP_SCHEMA_VERSION,
    appVersion: APP_VERSION,
    module: APP_MODULE,
    viewerCompatible: true,
    exportTimestamp: ensureIsoString(source.exportTimestamp),

    settings: {
      therapistId: ensureString(settings.therapistId) || generateId("therapist"),
      therapistName: ensureString(settings.therapistName),
      therapistFax: ensureString(settings.therapistFax),
      practicePhone: ensureString(settings.practicePhone),
      practiceAddress: ensureString(settings.practiceAddress, PRACTICE_ADDRESS),
      workDays: ensureWorkDays(settings.workDays),
      weeklyHours: ensureWeeklyHours(settings.weeklyHours),
      fastStartDatum: ensureString(settings.fastStartDatum),
      stundenStartsaldoMinuten: ensureIntegerNumber(settings.stundenStartsaldoMinuten, 0),
      jahresurlaubTage: ensureIntegerNumber(settings.jahresurlaubTage, 0),
      fastiEnabled: ensureBoolean(settings.fastiEnabled, true),
      dokuPruefungDeaktiviert: ensureBoolean(settings.dokuPruefungDeaktiviert, false),
      zertifikate: {
        kgzns: ensureBoolean(settings.zertifikate?.kgzns, false),
        mt: ensureBoolean(settings.zertifikate?.mt, false),
        mld: ensureBoolean(settings.zertifikate?.mld, false)
      },
      supportUrl: ensureString(settings.supportUrl),
      buero: {
        email: ensureString(settings.buero?.email)
      },
      assessmentIntervalMonths: [3, 6].includes(Number(settings.assessmentIntervalMonths)) ? Number(settings.assessmentIntervalMonths) : 3,
      nurAktiveRezepte: ensureBoolean(settings.nurAktiveRezepte, false),
      createdAt: ensureIsoString(settings.createdAt, now),
      updatedAt: ensureIsoString(settings.updatedAt, now) || now
    },

    homes: ensureArray(source.homes).map(normalizeHome),

    doku: {
      version: 1
    },

    zeit: {
      version: 1,
      therapists: ensureArray(source.zeit?.therapists),
      workModels: ensureArray(source.zeit?.workModels),
      timeEntries: ensureArray(source.zeit?.timeEntries),
      approvals: ensureArray(source.zeit?.approvals),
      kilometer: ensureArray(source.zeit?.kilometer),
      reports: ensureArray(source.zeit?.reports)
    },

    kilometer: normalizeKilometerState(source.kilometer),

    abwesenheiten: normalizeAbwesenheiten(source.abwesenheiten),
    specialDays: normalizeSpecialDays(source.specialDays),
    stundenAbgleiche: normalizeStundenAbgleiche(source.stundenAbgleiche),

    abgabeHistory: normalizeAbgabeHistory(source.abgabeHistory),
    nachbestellHistory: normalizeNachbestellHistory(source.nachbestellHistory),
    aerzte: ensureArray(source.aerzte).map(normalizeArzt),
    freikuvertHistory: normalizeFreikuvertHistory(source.freikuvertHistory),
    autoExportHistory: normalizeAutoExportHistory(source.autoExportHistory),

    security: {
      log: ensureArray(source.security?.log),
      lastSecurityChangeAt: ensureIsoString(source.security?.lastSecurityChangeAt)
    },

    ui: {
      lastBackupAt: ensureIsoString(source.ui?.lastBackupAt),
      lastAutoExportAt: ensureIsoString(source.ui?.lastAutoExportAt),
      lastAutoBackupDownloadAt: ensureIsoString(source.ui?.lastAutoBackupDownloadAt),
      lastDataChangeAt: ensureIsoString(source.ui?.lastDataChangeAt),
      lastFastiWeeklySummaryAt: ensureIsoString(source.ui?.lastFastiWeeklySummaryAt)
    }
  };

  return result;
}

export function normalizeAppData(data) {
  return finalizeAppStructure(data);
}