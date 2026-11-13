import { getRuntimeData, mutateRuntimeData } from "../core/app-core.js";
import { compareDeDates, isDateInRange, parseComparableDate, getComparableFromDate } from "../core/date-utils.js";
import { generateId, getRezeptAusstellungsdatum, formatPatientName } from "../core/utils.js";
import { REMINDER_INTERVAL_DAYS } from "./assessment.js";

function normalizeTimeType(type) {
  return ["behandlung", "dokumentation", "besprechung", "manuell"].includes(String(type || "").trim())
    ? String(type || "").trim()
    : "behandlung";
}

function normalizeLeistungName(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/–/g, "-")
    .replace(/—/g, "-");
}

function getSingleLeistungMinutes(type) {
  const key = normalizeLeistungName(type);

  if (["KG", "MT", "KG-ZNS", "KGZNS", "KG-ATEMTHERAPIE", "KGAT", "MLD30", "BLANKO"].includes(key)) return 20;
  if (key === "MLD45") return 40;
  if (key === "MLD60") return 60;

  return 0;
}

function getAutomaticTreatmentMinutes(rezept) {
  const items = Array.isArray(rezept?.items) ? rezept.items : [];
  if (items.length === 0) return 0;

  if (rezept?.bg) {
    return items.reduce((sum, item) => sum + getSingleLeistungMinutes(item?.type), 0);
  }

  const hasBlanko = items.some((item) => normalizeLeistungName(item?.type) === "BLANKO");
  if (hasBlanko) {
    return 20;
  }

  const firstRelevant = items.find((item) => getSingleLeistungMinutes(item?.type) > 0);
  const firstMinutes = firstRelevant ? getSingleLeistungMinutes(firstRelevant.type) : 0;
  if (!firstMinutes) return 0;

  const firstKey = normalizeLeistungName(firstRelevant?.type);
  const isFixedMLD = firstKey === "MLD45" || firstKey === "MLD60";

  if (rezept?.dt && !isFixedMLD) {
    return firstMinutes * 2;
  }

  return firstMinutes;
}

function getEffectiveRezeptTimeEntryMinutes(rezept, entry) {
  const storedMinutes = Number(entry?.minutes || 0);
  const fallbackMinutes = Number.isFinite(storedMinutes) && storedMinutes > 0 ? storedMinutes : 0;
  const isAutomaticTreatmentEntry = String(entry?.type || "") === "behandlung" && String(entry?.sourceEntryId || "").trim();

  if (!isAutomaticTreatmentEntry) {
    return fallbackMinutes;
  }

  const currentRecipeMinutes = getAutomaticTreatmentMinutes(rezept);
  return currentRecipeMinutes > 0 ? currentRecipeMinutes : fallbackMinutes;
}

function createTimeEntryObject(payload = {}) {
  const now = new Date().toISOString();
  const minutes = Number(payload.minutes);
  return {
    timeEntryId: generateId("time"),
    date: String(payload.date || "").trim(),
    minutes: Number.isFinite(minutes) && minutes > 0 ? minutes : 0,
    type: normalizeTimeType(payload.type),
    note: String(payload.note || "").trim(),
    sourceEntryId: String(payload.sourceEntryId || "").trim(),
    confirmed: payload.confirmed !== false,
    createdAt: now,
    updatedAt: now
  };
}

function ensureRezeptTimeState(rezept) {
  if (!Array.isArray(rezept.timeEntries)) {
    rezept.timeEntries = [];
  }

  if (!rezept.zeitMeta || typeof rezept.zeitMeta !== "object") {
    rezept.zeitMeta = {
      plannedTimeMinutes: 0,
      lastTimeEntryAt: "",
      kilometerRelevant: true
    };
  }
}


function getTodayDateString() {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const yyyy = now.getFullYear();
  return `${dd}.${mm}.${yyyy}`;
}

function normalizeDateString(value) {
  const s = String(value || "").trim();
  return s || getTodayDateString();
}

// Hält rezept.entries chronologisch sortiert (frühestes Datum zuerst) -
// wichtig, weil rückwirkend nachgetragene Einträge (z.B. heute für einen
// Termin vor Wochen dokumentiert) sonst am Ende der Liste in
// Eingabe-Reihenfolge statt Behandlungs-Reihenfolge stehen würden. Das würde
// u.a. die Fristenprüfung ("1. Behandlung", siehe modules/fristen.js) auf
// das zuletzt eingegebene statt das tatsächlich früheste Datum beziehen.
function sortRezeptEntriesByDate(rezept) {
  if (!Array.isArray(rezept?.entries)) return;
  rezept.entries.sort((a, b) => compareDeDates(a?.date, b?.date));
}

function ensureKilometerState(data) {
  if (!data.kilometer || typeof data.kilometer !== "object") {
    data.kilometer = {
      startPoint: { label: "", address: "" },
      knownRoutes: [],
      travelLog: []
    };
  }

  if (!data.kilometer.startPoint || typeof data.kilometer.startPoint !== "object") {
    data.kilometer.startPoint = { label: "", address: "" };
  }

  if (!Array.isArray(data.kilometer.knownRoutes)) {
    data.kilometer.knownRoutes = [];
  }

  if (!Array.isArray(data.kilometer.travelLog)) {
    data.kilometer.travelLog = [];
  }

  if (!Array.isArray(data.kilometer.kmExports)) {
    data.kilometer.kmExports = [];
  }

  return data.kilometer;
}

function getPointForPatient(home, patient, kilometerState) {
  const hbAddress = String(patient?.hbAddress || "").trim();
  if (patient?.hb && hbAddress) {
    return {
      pointId: `hb:${patient.patientId}`,
      label: formatPatientName(patient) || "Hausbesuch",
      address: hbAddress,
      kind: "hb"
    };
  }

  return {
    pointId: `home:${home.homeId}`,
    label: String(home?.name || "Einrichtung").trim() || "Einrichtung",
    address: String(home?.adresse || "").trim(),
    kind: "home"
  };
}

function collectKilometerPoints(data) {
  const kilometerState = ensureKilometerState(data);
  const points = [];
  const seen = new Set();

  const addPoint = (point) => {
    if (!point || !point.pointId || seen.has(point.pointId)) return;
    seen.add(point.pointId);
    points.push({
      pointId: String(point.pointId || '').trim(),
      label: String(point.label || '').trim(),
      address: String(point.address || '').trim(),
      kind: String(point.kind || '').trim() || 'custom'
    });
  };

  addPoint({
    pointId: 'start',
    label: kilometerState.startPoint.label || 'Startpunkt',
    address: kilometerState.startPoint.address || '',
    kind: 'start'
  });

  (data.homes || []).forEach((home) => {
    addPoint({
      pointId: `home:${home.homeId}`,
      label: String(home?.name || 'Einrichtung').trim() || 'Einrichtung',
      address: String(home?.adresse || '').trim(),
      kind: 'home'
    });

    (home.patients || []).forEach((patient) => {
      if (patient?.hb && String(patient?.hbAddress || '').trim()) {
        addPoint({
          pointId: `hb:${patient.patientId}`,
          label: formatPatientName(patient) || 'Hausbesuch',
          address: String(patient.hbAddress || '').trim(),
          kind: 'hb'
        });
      }
    });
  });

  return points.sort((a, b) => `${a.label} ${a.address}`.localeCompare(`${b.label} ${b.address}`, 'de'));
}


function findKnownRoute(kilometerState, fromPointId, toPointId) {
  return (kilometerState?.knownRoutes || []).find((route) =>
    route.fromPointId === fromPointId && route.toPointId === toPointId
  ) || null;
}

function getLastTravelForDate(kilometerState, date) {
  const items = (kilometerState?.travelLog || []).filter((item) => item.date === date);
  return items.length ? items[items.length - 1] : null;
}

function isKilometerAutoDateAllowed(dateInput) {
  const entryDate = normalizeDateString(dateInput);
  return entryDate === getTodayDateString();
}

function buildPendingKilometerContextFromData(data, homeId, patientId, dateInput) {
  const home = getHomeById(data, homeId);
  if (!home) throw new Error("Heim nicht gefunden");

  const patient = getPatientById(home, patientId);
  if (!patient) throw new Error("Patient nicht gefunden");

  const kilometerState = ensureKilometerState(data);
  const date = normalizeDateString(dateInput);
  const currentPoint = getPointForPatient(home, patient, kilometerState);
  const lastTravel = getLastTravelForDate(kilometerState, date);

  let fromPointId = "start";
  let fromLabel = kilometerState.startPoint.label || "Startpunkt";
  let fromAddress = kilometerState.startPoint.address || "";

  if (lastTravel?.toPointId) {
    fromPointId = lastTravel.toPointId;
    fromLabel = lastTravel.toLabel;
    fromAddress = "";
  }

  if (fromPointId === currentPoint.pointId) {
    return {
      date,
      needsTravel: false,
      samePoint: true,
      fromPointId,
      toPointId: currentPoint.pointId,
      fromLabel,
      toLabel: currentPoint.label,
      knownRoute: null
    };
  }

  const knownRoute = findKnownRoute(kilometerState, fromPointId, currentPoint.pointId);

  return {
    date,
    needsTravel: true,
    samePoint: false,
    fromPointId,
    toPointId: currentPoint.pointId,
    fromLabel,
    toLabel: currentPoint.label,
    fromAddress,
    toAddress: currentPoint.address,
    knownRoute,
    needsKmInput: !knownRoute,
    knownKm: knownRoute ? Number(knownRoute.km || 0) : 0
  };
}

function appendTravelLogIfPossible(data, homeId, patientId, dateInput, relatedEntryId) {
  if (!isKilometerAutoDateAllowed(dateInput)) return null;

  const context = buildPendingKilometerContextFromData(data, homeId, patientId, dateInput);
  if (!context.needsTravel || context.samePoint || !context.knownRoute) return null;

  const kilometerState = ensureKilometerState(data);
  const duplicate = (kilometerState.travelLog || []).some((item) =>
    item.date === context.date &&
    item.fromPointId === context.fromPointId &&
    item.toPointId === context.toPointId &&
    item.relatedEntryId === relatedEntryId
  );
  if (duplicate) return null;

  const travel = {
    travelId: generateId("travel"),
    date: context.date,
    fromPointId: context.fromPointId,
    toPointId: context.toPointId,
    fromLabel: context.fromLabel,
    toLabel: context.toLabel,
    km: Number(context.knownRoute.km || 0),
    source: "auto",
    relatedEntryId: relatedEntryId || "",
    note: "Automatisch aus Dokumentation",
    createdAt: new Date().toISOString()
  };

  kilometerState.travelLog.push(travel);
  return travel;
}

export function saveKilometerStartPoint(payload) {
  mutateRuntimeData((data) => {
    const kilometerState = ensureKilometerState(data);
    kilometerState.startPoint.label = String(payload?.label || "Startpunkt").trim() || "Startpunkt";
    kilometerState.startPoint.address = String(payload?.address || "").trim();
  });
}

export function saveKnownKilometerRoute(payload) {
  mutateRuntimeData((data) => {
    const kilometerState = ensureKilometerState(data);
    const km = Number(payload?.km);
    if (!Number.isFinite(km) || km <= 0) {
      throw new Error("Bitte gültige Kilometer eingeben.");
    }

    const fromPointId = String(payload?.fromPointId || "").trim();
    const toPointId = String(payload?.toPointId || "").trim();
    if (!fromPointId || !toPointId) {
      throw new Error("Route ist unvollständig.");
    }

    const now = new Date().toISOString();
    const upsert = (a, b, aLabel, bLabel) => {
      const existing = findKnownRoute(kilometerState, a, b);
      if (existing) {
        existing.km = km;
        existing.updatedAt = now;
        existing.fromLabel = aLabel;
        existing.toLabel = bLabel;
      } else {
        kilometerState.knownRoutes.push({
          routeId: generateId("route"),
          fromPointId: a,
          toPointId: b,
          fromLabel: aLabel,
          toLabel: bLabel,
          km,
          createdAt: now,
          updatedAt: now
        });
      }
    };

    const fromLabel = String(payload?.fromLabel || "").trim();
    const toLabel = String(payload?.toLabel || "").trim();

    upsert(fromPointId, toPointId, fromLabel, toLabel);
    upsert(toPointId, fromPointId, toLabel, fromLabel);

    (kilometerState.travelLog || []).forEach((item) => {
      const isSameDirection = item.fromPointId === fromPointId && item.toPointId === toPointId;
      const isOppositeDirection = item.fromPointId === toPointId && item.toPointId === fromPointId;
      if (!isSameDirection && !isOppositeDirection) return;
      if (item.manualAdjusted === true) return;

      item.km = km;
      item.updatedAt = now;
    });
  });
}

export function getKilometerOverview() {
  const data = getRuntimeData();
  if (!data) throw new Error("Kein runtimeData Zustand vorhanden");
  const kilometerState = ensureKilometerState(data);
  return {
    startPoint: kilometerState.startPoint,
    knownRoutes: [...kilometerState.knownRoutes],
    travelLog: [...kilometerState.travelLog],
    kmExports: [...kilometerState.kmExports]
  };
}

export function getKilometerPointOptions() {
  const data = getRuntimeData();
  if (!data) throw new Error('Kein runtimeData Zustand vorhanden');
  return collectKilometerPoints(data);
}

export function previewNextKilometerZettelNumber() {
  const data = getRuntimeData();
  if (!data) throw new Error('Kein runtimeData Zustand vorhanden');
  const kilometerState = ensureKilometerState(data);
  return getNextKilometerZettelNumber(kilometerState, new Date().getFullYear());
}

export function addManualKilometerTravel(payload) {
  mutateRuntimeData((data) => {
    const kilometerState = ensureKilometerState(data);
    const points = collectKilometerPoints(data);
    const pointMap = new Map(points.map((point) => [point.pointId, point]));

    const date = normalizeDateString(payload?.date);
    const fromPointId = String(payload?.fromPointId || '').trim();
    const toPointId = String(payload?.toPointId || '').trim();
    const note = String(payload?.note || '').trim();
    const km = Number(payload?.km);

    if (!fromPointId || !toPointId) throw new Error('Bitte Start- und Zielpunkt auswählen.');
    if (fromPointId === toPointId) throw new Error('Start- und Zielpunkt dürfen nicht identisch sein.');
    if (!Number.isFinite(km) || km <= 0) throw new Error('Bitte gültige Kilometer eingeben.');

    const fromPoint = pointMap.get(fromPointId);
    const toPoint = pointMap.get(toPointId);
    if (!fromPoint || !toPoint) throw new Error('Ausgewählte Strecke ist ungültig.');

    // Eine bisher unbekannte Strecke wird automatisch für künftige Fahrten
    // gemerkt (in beide Richtungen, wie auch saveKnownKilometerRoute es tut).
    // Ist die Strecke bereits bekannt, bleibt der gemerkte Wert unverändert -
    // ein abweichender km-Wert gilt dann nur für diese eine Fahrt (z.B.
    // Umweg), nicht als neuer Standard.
    if (!findKnownRoute(kilometerState, fromPointId, toPointId)) {
      const now = new Date().toISOString();
      kilometerState.knownRoutes.push({
        routeId: generateId('route'),
        fromPointId,
        toPointId,
        fromLabel: fromPoint.label,
        toLabel: toPoint.label,
        km,
        createdAt: now,
        updatedAt: now
      });
      kilometerState.knownRoutes.push({
        routeId: generateId('route'),
        fromPointId: toPointId,
        toPointId: fromPointId,
        fromLabel: toPoint.label,
        toLabel: fromPoint.label,
        km,
        createdAt: now,
        updatedAt: now
      });
    }

    kilometerState.travelLog.push({
      travelId: generateId('travel'),
      date,
      fromPointId,
      toPointId,
      fromLabel: fromPoint.label,
      toLabel: toPoint.label,
      km,
      source: 'manual',
      relatedEntryId: '',
      note,
      createdAt: new Date().toISOString()
    });
  });
}

export function updateKilometerTravel(travelId, payload) {
  mutateRuntimeData((data) => {
    const kilometerState = ensureKilometerState(data);
    const points = collectKilometerPoints(data);
    const pointMap = new Map(points.map((point) => [point.pointId, point]));

    const id = String(travelId || '').trim();
    if (!id) throw new Error('Fahrt nicht gefunden.');

    const item = (kilometerState.travelLog || []).find((row) => row.travelId === id);
    if (!item) throw new Error('Fahrt nicht gefunden.');

    const date = normalizeDateString(payload?.date);
    const fromPointId = String(payload?.fromPointId || '').trim();
    const toPointId = String(payload?.toPointId || '').trim();
    const note = String(payload?.note || '').trim();
    const km = Number(payload?.km);

    if (!fromPointId || !toPointId) throw new Error('Bitte Start- und Zielpunkt auswählen.');
    if (fromPointId === toPointId) throw new Error('Start- und Zielpunkt dürfen nicht identisch sein.');
    if (!Number.isFinite(km) || km <= 0) throw new Error('Bitte gültige Kilometer eingeben.');

    const fromPoint = pointMap.get(fromPointId);
    const toPoint = pointMap.get(toPointId);
    if (!fromPoint || !toPoint) throw new Error('Ausgewählte Strecke ist ungültig.');

    item.date = date;
    item.fromPointId = fromPointId;
    item.toPointId = toPointId;
    item.fromLabel = fromPoint.label;
    item.toLabel = toPoint.label;
    item.km = km;
    item.note = note;
    item.updatedAt = new Date().toISOString();
    item.manualAdjusted = true;
  });
}

export function deleteKilometerTravel(travelId) {
  mutateRuntimeData((data) => {
    const kilometerState = ensureKilometerState(data);
    const id = String(travelId || '').trim();
    if (!id) throw new Error('Fahrt nicht gefunden.');

    const before = kilometerState.travelLog.length;
    kilometerState.travelLog = kilometerState.travelLog.filter((item) => item.travelId !== id);

    if (kilometerState.travelLog.length === before) {
      throw new Error('Fahrt nicht gefunden.');
    }
  });
}

export function getKilometerPeriodSummary(fromDate, toDate) {
  const data = getRuntimeData();
  if (!data) throw new Error('Kein runtimeData Zustand vorhanden');
  const kilometerState = ensureKilometerState(data);
  const rows = (kilometerState.travelLog || [])
    .filter((item) => item?.abgerechnet !== true)
    .filter((item) => isDateInRange(item.date, fromDate, toDate))
    .sort((a, b) => compareDeDates(a?.date, b?.date) || String(a?.createdAt || '').localeCompare(String(b?.createdAt || ''), 'de'));

  const totalKm = rows.reduce((sum, item) => sum + (Number(item.km) || 0), 0);
  const totalAmount = totalKm * 0.3;

  return {
    fromDate: String(fromDate || '').trim(),
    toDate: String(toDate || '').trim(),
    rows,
    totalKm,
    totalAmount
  };
}

function getNextKilometerZettelNumber(kilometerState, year) {
  const prefix = `${year}-`;
  const existingNumbers = (kilometerState.kmExports || [])
    .map((item) => String(item.number || ''))
    .filter((num) => num.startsWith(prefix))
    .map((num) => Number(num.slice(prefix.length)))
    .filter((num) => Number.isFinite(num));

  const nextNumber = existingNumbers.length > 0 ? Math.max(...existingNumbers) + 1 : 1;
  return `${prefix}${String(nextNumber).padStart(3, '0')}`;
}

export function finalizeKilometerExport(fromDate, toDate, { snapshotHtml = '', number = '' } = {}) {
  return mutateRuntimeData((data) => {
    const kilometerState = ensureKilometerState(data);
    const now = new Date().toISOString();
    const exportId = generateId('kmexport');
    const rows = (kilometerState.travelLog || [])
      .filter((item) => item?.abgerechnet !== true)
      .filter((item) => isDateInRange(item.date, fromDate, toDate))
      .sort((a, b) => compareDeDates(a?.date, b?.date) || String(a?.createdAt || '').localeCompare(String(b?.createdAt || ''), 'de'));

    if (rows.length === 0) {
      throw new Error('Keine nicht abgerechneten Fahrten im gewählten Zeitraum.');
    }

    const totalKm = rows.reduce((sum, item) => sum + (Number(item.km) || 0), 0);
    const totalAmount = totalKm * 0.3;
    const firstDate = rows[0]?.date || String(fromDate || '').trim();
    const lastDate = rows[rows.length - 1]?.date || String(toDate || '').trim();
    const fahrtIds = rows.map((item) => String(item.travelId || '')).filter(Boolean);
    const currentYear = new Date().getFullYear();
    const zettelNumber = String(number || '').trim() || getNextKilometerZettelNumber(kilometerState, currentYear);

    rows.forEach((item) => {
      item.abgerechnet = true;
      item.abgerechnetAm = getTodayDateString();
      item.kmExportId = exportId;
      item.updatedAt = now;
    });

    const exportItem = {
      id: exportId,
      number: zettelNumber,
      therapistName: String(data?.settings?.therapistName || '').trim(),
      von: String(fromDate || '').trim() || firstDate,
      bis: String(toDate || '').trim() || lastDate,
      erstesFahrtdatum: firstDate,
      letztesFahrtdatum: lastDate,
      erstelltAm: now,
      gesamtKm: totalKm,
      gesamtVerguetung: totalAmount,
      fahrtIds,
      snapshotHtml: String(snapshotHtml || '')
    };

    kilometerState.kmExports.push(exportItem);
    return exportItem;
  });
}


export function createHome({ name, adresse, verwaltungsEmail = "", hbPauschale = "HB" }) {
  mutateRuntimeData((data) => {
    data.homes.push({
      homeId: generateId("home"),
      name: name.trim(),
      adresse: adresse.trim(),
      verwaltungsEmail: String(verwaltungsEmail || "").trim(),
      hbPauschale: ["HB", "HBHP"].includes(hbPauschale) ? hbPauschale : "HB",
      patients: []
    });
  });
}

export function updateHomeAddress(homeId, adresse) {
  mutateRuntimeData((data) => {
    const home = getHomeById(data, homeId);
    if (!home) throw new Error("Heim nicht gefunden");
    home.adresse = String(adresse || "").trim();
  });
}

export function updateHomePauschale(homeId, hbPauschale) {
  mutateRuntimeData((data) => {
    const home = getHomeById(data, homeId);
    if (!home) throw new Error("Heim nicht gefunden");
    home.hbPauschale = ["HB", "HBHP"].includes(hbPauschale) ? hbPauschale : "HB";
  });
}

export function deleteHome(homeId) {
  mutateRuntimeData((data) => {
    const home = getHomeById(data, homeId);
    if (!home) throw new Error("Heim nicht gefunden");

    const patientIds = new Set((home.patients || []).map((patient) => String(patient?.patientId || "")).filter(Boolean));
    const entryIds = new Set();

    (home.patients || []).forEach((patient) => {
      (patient.rezepte || []).forEach((rezept) => {
        (rezept.entries || []).forEach((entry) => {
          const id = String(entry?.entryId || "").trim();
          if (id) entryIds.add(id);
        });
      });
    });

    ensureKilometerState(data);
    data.kilometer.travelLog = (data.kilometer.travelLog || []).filter((item) => {
      const relatedEntryId = String(item?.relatedEntryId || "").trim();
      const fromPointId = String(item?.fromPointId || "").trim();
      const toPointId = String(item?.toPointId || "").trim();

      if (relatedEntryId && entryIds.has(relatedEntryId)) return false;
      if (fromPointId === `home:${homeId}` || toPointId === `home:${homeId}`) return false;
      if ([fromPointId, toPointId].some((pointId) => pointId.startsWith('hb:') && patientIds.has(pointId.slice(3)))) return false;
      return true;
    });

    data.kilometer.knownRoutes = (data.kilometer.knownRoutes || []).filter((route) => {
      const fromPointId = String(route?.fromPointId || "").trim();
      const toPointId = String(route?.toPointId || "").trim();
      if (fromPointId === `home:${homeId}` || toPointId === `home:${homeId}`) return false;
      if ([fromPointId, toPointId].some((pointId) => pointId.startsWith('hb:') && patientIds.has(pointId.slice(3)))) return false;
      return true;
    });

    const beforeLength = (data.homes || []).length;
    data.homes = (data.homes || []).filter((item) => item.homeId !== homeId);

    if (data.homes.length === beforeLength) {
      throw new Error("Heim nicht gefunden");
    }
  });
}

export function getHomeById(data, homeId) {
  return (data.homes || []).find((home) => home.homeId === homeId) || null;
}

export function createPatient(homeId, payload) {
  const patientId = generateId("patient");

  mutateRuntimeData((data) => {
    const home = getHomeById(data, homeId);
    if (!home) throw new Error("Heim nicht gefunden");

    home.patients.push({
      patientId,
      firstName: (payload.firstName || "").trim(),
      lastName: (payload.lastName || "").trim(),
      anrede: ["frau", "herr"].includes(payload.anrede) ? payload.anrede : "",
      birthDate: (payload.birthDate || "").trim(),
      befreit: !!payload.befreit,
      verstorben: !!payload.verstorben,
      ausgeschieden: !!payload.ausgeschieden,
      zuzahlungsstatus: "",
      zuzahlungsstatusSetAt: "",
      zuzahlungReminderAt: "",
      entries: [],
      rezepte: [],
      diagnoseZuordnung: [],
      zeitMeta: {}
    });
  });

  return patientId;
}


export function updatePatient(homeId, patientId, payload) {
  mutateRuntimeData((data) => {
    const home = getHomeById(data, homeId);
    if (!home) throw new Error("Heim nicht gefunden");

    const patient = getPatientById(home, patientId);
    if (!patient) throw new Error("Patient nicht gefunden");

    patient.firstName = String(payload.firstName || "").trim();
    patient.lastName = String(payload.lastName || "").trim();
    patient.birthDate = String(payload.birthDate || "").trim();
    if (payload.befreit !== undefined) {
      patient.befreit = !!payload.befreit;
    }
    patient.verstorben = !!payload.verstorben;
    if (payload.ausgeschieden !== undefined) {
      patient.ausgeschieden = !!payload.ausgeschieden;
    }
  });
}

// Eigener, schlanker Setter für "Ausgeschieden" (statt über updatePatient()) -
// so kann FaSti diesen Status per Chat setzen, ohne gleichzeitig auch
// Vorname/Nachname/Geburtsdatum mitschicken zu müssen, die updatePatient()
// sonst als Pflichtfelder erwartet und sonst überschreiben würde.
export function setPatientAusgeschieden(homeId, patientId, value) {
  mutateRuntimeData((data) => {
    const home = getHomeById(data, homeId);
    if (!home) throw new Error("Heim nicht gefunden");

    const patient = getPatientById(home, patientId);
    if (!patient) throw new Error("Patient nicht gefunden");

    patient.ausgeschieden = !!value;
  });
}

export function getPatientById(home, patientId) {
  return (home?.patients || []).find((patient) => patient.patientId === patientId) || null;
}

function addDaysToComparable(comparable, days) {
  const date = parseComparableDate(comparable);
  if (!date) return "";
  const d = new Date(date.getTime());
  d.setDate(d.getDate() + days);
  return getComparableFromDate(d);
}

// Zwischenspeichern eines noch nicht abgeschlossenen Assessment-Durchlaufs
// (auf Nutzerwunsch: ein Auto-Lock mitten in der Erfassung darf nicht mehr
// alle bereits eingegebenen Werte löschen). draft enthält den kompletten
// Wizard-Zustand aus ui/views.js sowie den Zeitpunkt der letzten Änderung.
export function saveAssessmentDraft(homeId, patientId, draft) {
  mutateRuntimeData((data) => {
    const home = getHomeById(data, homeId);
    if (!home) throw new Error("Heim nicht gefunden");

    const patient = getPatientById(home, patientId);
    if (!patient) throw new Error("Patient nicht gefunden");

    patient.assessmentDraft = draft;
  });
}

export function clearAssessmentDraft(homeId, patientId) {
  mutateRuntimeData((data) => {
    const home = getHomeById(data, homeId);
    if (!home) return;

    const patient = getPatientById(home, patientId);
    if (!patient) return;

    patient.assessmentDraft = null;
  });
}

export function scheduleAssessment(homeId, patientId, dueDateComparable) {
  mutateRuntimeData((data) => {
    const home = getHomeById(data, homeId);
    if (!home) throw new Error("Heim nicht gefunden");

    const patient = getPatientById(home, patientId);
    if (!patient) throw new Error("Patient nicht gefunden");

    patient.nextAssessmentDueAt = String(dueDateComparable || "").trim();
  });
}

// assessmentPayload: vollständiges strukturiertes Assessment-Ergebnis (siehe
// modules/assessment.js für die Testdefinitionen). intervalMonths steuert das
// Folgeintervall: 3 -> 90 Tage, 6 -> 180 Tage (Vorgabe: "alle 90 Tage").
export function saveAssessmentResult(homeId, patientId, assessmentPayload, intervalMonths) {
  mutateRuntimeData((data) => {
    const home = getHomeById(data, homeId);
    if (!home) throw new Error("Heim nicht gefunden");

    const patient = getPatientById(home, patientId);
    if (!patient) throw new Error("Patient nicht gefunden");

    if (!Array.isArray(patient.assessments)) patient.assessments = [];
    patient.assessments.unshift({
      id: generateId("assessment"),
      createdAt: new Date().toISOString(),
      ...assessmentPayload
    });

    const mrcPosition = assessmentPayload?.neuro?.mrc?.position;
    if (mrcPosition && !patient.assessmentMrcPosition) {
      patient.assessmentMrcPosition = mrcPosition;
    }

    const days = REMINDER_INTERVAL_DAYS[intervalMonths] || REMINDER_INTERVAL_DAYS[3];
    patient.nextAssessmentDueAt = addDaysToComparable(assessmentPayload.date, days);
  });
}

export function getFaelligeAssessmentErinnerungen(data) {
  const today = getComparableFromDate(new Date());
  const result = [];

  (data?.homes || []).forEach((home) => {
    (home.patients || []).forEach((patient) => {
      if (patient.verstorben || patient.ausgeschieden) return;
      const dueAt = String(patient.nextAssessmentDueAt || "").trim();
      if (dueAt && dueAt <= today) {
        result.push({
          homeId: home.homeId,
          patientId: patient.patientId,
          patientName: `${patient.lastName || ""}, ${patient.firstName || ""}`.replace(/^,\s*/, "").trim() || "Ohne Namen",
          dueAt
        });
      }
    });
  });

  return result;
}

export function getArztRegistry(data) {
  const namesFromRezepte = getDoctorList(data);
  const registryByName = new Map();

  (data?.aerzte || []).forEach((arzt) => {
    const name = String(arzt?.name || "").trim();
    if (name) registryByName.set(name, { adresse: arzt.adresse || "", email: arzt.email || "" });
  });

  namesFromRezepte.forEach((name) => {
    if (!registryByName.has(name)) registryByName.set(name, { adresse: "", email: "" });
  });

  return Array.from(registryByName.entries())
    .map(([name, { adresse, email }]) => ({ name, adresse, email }))
    .sort((a, b) => a.name.localeCompare(b.name, "de"));
}

// email ist bewusst optional (dritter Parameter): wird er weggelassen
// (undefined), bleibt eine bereits hinterlegte E-Mail-Adresse unangetastet -
// die meisten Aufrufer (Rezept anlegen/bearbeiten) pflegen nur die Adresse,
// nicht die E-Mail, und sollen eine dort separat gepflegte E-Mail nicht
// versehentlich leeren.
export function upsertArztAdresse(name, adresse, email) {
  const normalizedName = String(name || "").trim();
  if (!normalizedName) throw new Error("Arztname fehlt");

  mutateRuntimeData((data) => {
    if (!Array.isArray(data.aerzte)) data.aerzte = [];
    const existing = data.aerzte.find((arzt) => String(arzt.name || "").trim() === normalizedName);

    if (existing) {
      existing.adresse = String(adresse || "").trim();
      if (email !== undefined) existing.email = String(email || "").trim();
      existing.updatedAt = new Date().toISOString();
    } else {
      data.aerzte.push({
        id: generateId("arzt"),
        name: normalizedName,
        adresse: String(adresse || "").trim(),
        email: email !== undefined ? String(email || "").trim() : "",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    }
  });
}

// Ärzte werden überall nur über den Namensstring referenziert (rezept.arzt),
// es gibt keine arztId - eine Umbenennung muss deshalb den neuen Namen in
// JEDES betroffene Rezept zurückschreiben, sonst würde der Arzt beim
// Speichern nur der Registry-Eintrag umbenannt, während alle Rezepte/
// Patienten weiterhin auf den alten (jetzt verwaisten) Namen verweisen und
// aus der Arztübersicht/Nachbestellung verschwinden. Eine Umbenennung auf
// einen bereits existierenden anderen Arztnamen wird abgelehnt statt
// stillschweigend zusammenzuführen, um versehentliches Vermischen zweier
// Ärzte zu vermeiden.
export function renameArzt(oldName, newName) {
  const trimmedOld = String(oldName || "").trim();
  const trimmedNew = String(newName || "").trim();
  if (!trimmedNew) throw new Error("Arztname darf nicht leer sein.");
  if (trimmedOld === trimmedNew) return;

  mutateRuntimeData((data) => {
    const collision = getDoctorList(data).includes(trimmedNew)
      || (data.aerzte || []).some((arzt) => String(arzt.name || "").trim() === trimmedNew);
    if (collision) {
      throw new Error(`Es gibt bereits einen Arzt namens "${trimmedNew}".`);
    }

    (data.homes || []).forEach((home) => {
      (home.patients || []).forEach((patient) => {
        (patient.rezepte || []).forEach((rezept) => {
          if (String(rezept.arzt || "").trim() === trimmedOld) {
            rezept.arzt = trimmedNew;
          }
        });
      });
    });

    if (!Array.isArray(data.aerzte)) data.aerzte = [];
    const entry = data.aerzte.find((arzt) => String(arzt.name || "").trim() === trimmedOld);
    if (entry) {
      entry.name = trimmedNew;
      entry.updatedAt = new Date().toISOString();
    } else {
      data.aerzte.push({
        id: generateId("arzt"),
        name: trimmedNew,
        adresse: "",
        email: "",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    }
  });
}

export function saveFreikuvertBestellung({ arztName, arztAdresse, therapistName }) {
  const entry = {
    id: generateId("freikuvert"),
    arztName: String(arztName || "").trim(),
    arztAdresse: String(arztAdresse || "").trim(),
    anzahl: 10,
    therapistName: String(therapistName || "").trim(),
    createdAt: new Date().toISOString()
  };

  mutateRuntimeData((data) => {
    if (!Array.isArray(data.freikuvertHistory)) data.freikuvertHistory = [];
    data.freikuvertHistory.unshift(entry);
  });

  return entry;
}

export function createAbwesenheit({ type, from, to }) {
  const entry = {
    id: generateId("abwesenheit"),
    type: type === "krank" ? "krank" : "urlaub",
    from: String(from || "").trim(),
    to: String(to || "").trim(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  mutateRuntimeData((data) => {
    if (!Array.isArray(data.abwesenheiten)) data.abwesenheiten = [];
    data.abwesenheiten.push(entry);
  });

  return entry;
}

const ZUZAHLUNG_REMINDER_INTERVAL_DAYS = 7;

export function setZuzahlungsstatus(homeId, patientId, status) {
  const normalized = ["ja", "nein", "ungeklaert"].includes(status) ? status : "";

  mutateRuntimeData((data) => {
    const home = getHomeById(data, homeId);
    if (!home) throw new Error("Heim nicht gefunden");

    const patient = getPatientById(home, patientId);
    if (!patient) throw new Error("Patient nicht gefunden");

    patient.zuzahlungsstatus = normalized;
    patient.zuzahlungsstatusSetAt = new Date().toISOString();
    patient.befreit = normalized === "ja";

    if (normalized === "ungeklaert") {
      const reminder = new Date();
      reminder.setDate(reminder.getDate() + ZUZAHLUNG_REMINDER_INTERVAL_DAYS);
      patient.zuzahlungReminderAt = reminder.toISOString();
    } else {
      patient.zuzahlungReminderAt = "";
    }
  });
}

export function acknowledgeZuzahlungReminder(homeId, patientId) {
  mutateRuntimeData((data) => {
    const home = getHomeById(data, homeId);
    if (!home) return;

    const patient = getPatientById(home, patientId);
    if (!patient || patient.zuzahlungsstatus !== "ungeklaert") return;

    const reminder = new Date();
    reminder.setDate(reminder.getDate() + ZUZAHLUNG_REMINDER_INTERVAL_DAYS);
    patient.zuzahlungReminderAt = reminder.toISOString();
  });
}

export function getFaelligeZuzahlungErinnerungen(data) {
  const now = Date.now();
  const result = [];

  (data?.homes || []).forEach((home) => {
    (home.patients || []).forEach((patient) => {
      if (patient.verstorben || patient.ausgeschieden) return;
      if (patient.zuzahlungsstatus !== "ungeklaert") return;

      const reminderAt = patient.zuzahlungReminderAt ? new Date(patient.zuzahlungReminderAt).getTime() : 0;
      if (reminderAt && reminderAt <= now) {
        result.push({
          homeId: home.homeId,
          patientId: patient.patientId,
          patientName: `${patient.lastName || ""}, ${patient.firstName || ""}`.replace(/^,\s*/, "").trim() || "Ohne Namen"
        });
      }
    });
  });

  return result;
}

export function saveDiagnoseZuordnung(homeId, patientId, entry) {
  mutateRuntimeData((data) => {
    const home = getHomeById(data, homeId);
    if (!home) throw new Error("Heim nicht gefunden");

    const patient = getPatientById(home, patientId);
    if (!patient) throw new Error("Patient nicht gefunden");

    if (!Array.isArray(patient.diagnoseZuordnung)) {
      patient.diagnoseZuordnung = [];
    }

    patient.diagnoseZuordnung.unshift({
      id: generateId("diagzuordnung"),
      input: (entry?.input || "").trim(),
      icd10: (entry?.icd10 || "").trim(),
      gruppe: (entry?.gruppe || "").trim(),
      gruppeLabel: (entry?.gruppeLabel || "").trim(),
      empfehlung: (entry?.empfehlung || "").trim(),
      createdAt: new Date().toISOString()
    });

    patient.diagnoseZuordnung = patient.diagnoseZuordnung.slice(0, 20);
  });
}

export function deleteDiagnoseZuordnung(homeId, patientId, entryId) {
  mutateRuntimeData((data) => {
    const home = getHomeById(data, homeId);
    if (!home) throw new Error("Heim nicht gefunden");

    const patient = getPatientById(home, patientId);
    if (!patient) throw new Error("Patient nicht gefunden");

    patient.diagnoseZuordnung = (patient.diagnoseZuordnung || []).filter((item) => item.id !== entryId);
  });
}

export function deletePatient(homeId, patientId) {
  mutateRuntimeData((data) => {
    const home = getHomeById(data, homeId);
    if (!home) throw new Error("Heim nicht gefunden");

    const patient = getPatientById(home, patientId);
    if (!patient) throw new Error("Patient nicht gefunden");

    const entryIds = new Set();
    (patient.rezepte || []).forEach((rezept) => {
      (rezept.entries || []).forEach((entry) => {
        const id = String(entry?.entryId || "").trim();
        if (id) entryIds.add(id);
      });
    });

    ensureKilometerState(data);
    data.kilometer.travelLog = (data.kilometer.travelLog || []).filter((item) => {
      const relatedEntryId = String(item?.relatedEntryId || "").trim();
      const fromPointId = String(item?.fromPointId || "").trim();
      const toPointId = String(item?.toPointId || "").trim();

      if (relatedEntryId && entryIds.has(relatedEntryId)) return false;
      if ([fromPointId, toPointId].some((pointId) => pointId === `hb:${patientId}`)) return false;
      return true;
    });

    data.kilometer.knownRoutes = (data.kilometer.knownRoutes || []).filter((route) => {
      const fromPointId = String(route?.fromPointId || "").trim();
      const toPointId = String(route?.toPointId || "").trim();
      if ([fromPointId, toPointId].some((pointId) => pointId === `hb:${patientId}`)) return false;
      return true;
    });

    const beforeLength = (home.patients || []).length;
    home.patients = (home.patients || []).filter((item) => item.patientId !== patientId);

    if (home.patients.length === beforeLength) {
      throw new Error("Patient nicht gefunden");
    }
  });
}

// Jedes Feld fällt auf einen leeren/falschen Default zurück, wenn payload
// es nicht enthält - ein Aufruf mit payload={} legt deshalb bewusst ein
// vollständig leeres "Platzhalter-Rezept" an (siehe "Zeit/Doku ohne
// Rezept-Angaben" in ui/views.js: Zeiterfassung/SchnellDoku, die ein
// Rezept technisch brauchen, aber dem Therapeuten erlauben sollen, die
// eigentlichen Rezeptangaben erst später nachzutragen). Gibt die neue
// rezeptId zurück, damit Aufrufer direkt mit diesem Rezept weiterarbeiten
// können, ohne den Datenstand erneut danach durchsuchen zu müssen.
export function createRezept(homeId, patientId, payload) {
  const rezeptId = generateId("rezept");
  mutateRuntimeData((data) => {
    const home = getHomeById(data, homeId);
    if (!home) throw new Error("Heim nicht gefunden");

    const patient = getPatientById(home, patientId);
    if (!patient) throw new Error("Patient nicht gefunden");

    const items = (payload.items || [])
      .map((item) => ({
        itemId: generateId("item"),
        type: (item.type || "").trim(),
        count: item.type === "Blanko" ? "" : String(item.count || "").trim()
      }))
      .filter((item) => item.type);

    patient.rezepte.push({
      rezeptId,
      arzt: (payload.arzt || "").trim(),
      ausstell: (payload.ausstell || "").trim(),
      bg: !!payload.bg,
      dt: !!payload.dt,
      dringend: !!payload.dringend,
      icd10: (payload.icd10 || "").trim(),
      icd10b: (payload.icd10b || "").trim(),
      leitsymptomatik: (payload.leitsymptomatik || "").trim(),
      hausbesuch: payload.hausbesuch === "ja" || payload.hausbesuch === "nein" ? payload.hausbesuch : "",
      arztStempel: payload.arztStempel === "ja" || payload.arztStempel === "nein" ? payload.arztStempel : "",
      arztUnterschrift: payload.arztUnterschrift === "ja" || payload.arztUnterschrift === "nein" ? payload.arztUnterschrift : "",
      privat: payload.privat === true,
      abgegeben: false,
      items,
      entries: [],
      zeitMeta: {
        plannedTimeMinutes: 0,
        lastTimeEntryAt: "",
        kilometerRelevant: true
      },
      exportMeta: {
        exportReady: true,
        viewerLabel: "",
        lastExportAt: ""
      },
      timeEntries: [],
      doctorReports: []
    });
  });
  return rezeptId;
}

export function updateRezept(homeId, patientId, rezeptId, payload) {
  mutateRuntimeData((data) => {
    const home = getHomeById(data, homeId);
    if (!home) throw new Error("Heim nicht gefunden");

    const patient = getPatientById(home, patientId);
    if (!patient) throw new Error("Patient nicht gefunden");

    const rezept = getRezeptById(patient, rezeptId);
    if (!rezept) throw new Error("Rezept nicht gefunden");

    const items = (payload.items || [])
      .map((item) => ({
        itemId: item.itemId || generateId("item"),
        type: (item.type || "").trim(),
        count: item.type === "Blanko" ? "" : String(item.count || "").trim()
      }))
      .filter((item) => item.type);

    rezept.arzt = (payload.arzt || "").trim();
    rezept.ausstell = (payload.ausstell || "").trim();
    rezept.bg = !!payload.bg;
    rezept.dt = !!payload.dt;
    rezept.dringend = !!payload.dringend;
    rezept.icd10 = (payload.icd10 || "").trim();
    rezept.icd10b = (payload.icd10b || "").trim();
    rezept.leitsymptomatik = (payload.leitsymptomatik || "").trim();
    rezept.hausbesuch = payload.hausbesuch === "ja" || payload.hausbesuch === "nein" ? payload.hausbesuch : "";
    rezept.arztStempel = payload.arztStempel === "ja" || payload.arztStempel === "nein" ? payload.arztStempel : "";
    rezept.arztUnterschrift = payload.arztUnterschrift === "ja" || payload.arztUnterschrift === "nein" ? payload.arztUnterschrift : "";
    rezept.privat = payload.privat === true;
    rezept.abgegeben = rezept.abgegeben === true;
    rezept.items = items;

    if (!rezept.zeitMeta || typeof rezept.zeitMeta !== "object") {
      rezept.zeitMeta = {
        plannedTimeMinutes: 0,
        lastTimeEntryAt: "",
        kilometerRelevant: true
      };
    }

    if (!rezept.exportMeta || typeof rezept.exportMeta !== "object") {
      rezept.exportMeta = {
        exportReady: true,
        viewerLabel: "",
        lastExportAt: ""
      };
    }

    if (!Array.isArray(rezept.doctorReports)) {
      rezept.doctorReports = [];
    }

    ensureRezeptTimeState(rezept);
  });
}

export function markRezeptAbgegeben(homeId, patientId, rezeptId) {
  mutateRuntimeData((data) => {
    const home = getHomeById(data, homeId);
    if (!home) throw new Error("Heim nicht gefunden");

    const patient = getPatientById(home, patientId);
    if (!patient) throw new Error("Patient nicht gefunden");

    const rezept = getRezeptById(patient, rezeptId);
    if (!rezept) throw new Error("Rezept nicht gefunden");

    rezept.abgegeben = true;
  });
}

export function unmarkRezeptAbgegeben(homeId, patientId, rezeptId) {
  mutateRuntimeData((data) => {
    const home = getHomeById(data, homeId);
    if (!home) throw new Error("Heim nicht gefunden");

    const patient = getPatientById(home, patientId);
    if (!patient) throw new Error("Patient nicht gefunden");

    const rezept = getRezeptById(patient, rezeptId);
    if (!rezept) throw new Error("Rezept nicht gefunden");

    rezept.abgegeben = false;
  });
}

export function deleteRezept(homeId, patientId, rezeptId) {
  mutateRuntimeData((data) => {
    const home = getHomeById(data, homeId);
    if (!home) throw new Error("Heim nicht gefunden");

    const patient = getPatientById(home, patientId);
    if (!patient) throw new Error("Patient nicht gefunden");

    const rezept = getRezeptById(patient, rezeptId);
    if (!rezept) throw new Error("Rezept nicht gefunden");

    ensureRezeptTimeState(rezept);

    const entryIds = new Set((rezept.entries || []).map((entry) => String(entry?.entryId || "")).filter(Boolean));
    const timeEntryIds = new Set((rezept.timeEntries || []).map((item) => String(item?.timeEntryId || "")).filter(Boolean));

    ensureKilometerState(data);
    data.kilometer.travelLog = (data.kilometer.travelLog || []).filter((item) => {
      const relatedEntryId = String(item?.relatedEntryId || "");
      return !relatedEntryId || !entryIds.has(relatedEntryId);
    });

    const beforeLength = patient.rezepte.length;
    patient.rezepte = patient.rezepte.filter((item) => item.rezeptId !== rezeptId);

    if (patient.rezepte.length === beforeLength) {
      throw new Error("Rezept nicht gefunden");
    }

    patient.rezepte.forEach((otherRezept) => {
      ensureRezeptTimeState(otherRezept);

      (otherRezept.entries || []).forEach((entry) => {
        if (timeEntryIds.has(String(entry?.linkedTimeEntryId || ""))) {
          entry.linkedTimeEntryId = "";
        }
      });

      otherRezept.timeEntries = (otherRezept.timeEntries || []).filter((item) =>
        !entryIds.has(String(item?.sourceEntryId || ""))
      );

      const lastTimeEntry = otherRezept.timeEntries
        .slice()
        .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))[0];

      otherRezept.zeitMeta.lastTimeEntryAt = lastTimeEntry?.createdAt || "";
    });
  });
}

export function getRezeptById(patient, rezeptId) {
  return (patient?.rezepte || []).find((rezept) => rezept.rezeptId === rezeptId) || null;
}

// Gibt die erzeugte entryId zurück (z.B. damit FaSti einen im selben Zug
// gebuchten Zeiteintrag nachträglich damit verknüpfen kann - siehe
// createFastiTimeEntry() in modules/fasti.js).
export function createRezeptEntry(homeId, patientId, rezeptId, payload) {
  let createdEntryId = "";

  mutateRuntimeData((data) => {
    const home = getHomeById(data, homeId);
    if (!home) throw new Error("Heim nicht gefunden");

    const patient = getPatientById(home, patientId);
    if (!patient) throw new Error("Patient nicht gefunden");

    const rezept = getRezeptById(patient, rezeptId);
    if (!rezept) throw new Error("Rezept nicht gefunden");

    ensureRezeptTimeState(rezept);

    const entryId = generateId("entry");
    const entryDate = normalizeDateString(payload.date);
    createdEntryId = entryId;

    rezept.entries.push({
      entryId,
      date: entryDate,
      behandlungsDatum: entryDate,
      text: (payload.text || "").trim(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      linkedTimeEntryId: "",
      autoTimeMinutes: 0
    });

    // Rückwirkend nachgetragene Doku-Einträge (z.B. erst heute für ein Datum
    // vor Wochen erfasst) sollen nach Datum sortiert erscheinen, nicht in der
    // Reihenfolge, in der sie eingegeben wurden - sonst würde z.B. die
    // Fristenprüfung ("1. Behandlung") den zuletzt eingetragenen statt den
    // tatsächlich frühesten Termin für die Frist heranziehen.
    sortRezeptEntriesByDate(rezept);

    appendTravelLogIfPossible(data, homeId, patientId, payload.date, entryId);
  });

  return createdEntryId;
}

export function updateRezeptEntry(homeId, patientId, rezeptId, entryId, payload) {
  mutateRuntimeData((data) => {
    const home = getHomeById(data, homeId);
    if (!home) throw new Error("Heim nicht gefunden");

    const patient = getPatientById(home, patientId);
    if (!patient) throw new Error("Patient nicht gefunden");

    const rezept = getRezeptById(patient, rezeptId);
    if (!rezept) throw new Error("Rezept nicht gefunden");

    const entry = (rezept.entries || []).find((item) => item.entryId === entryId);
    if (!entry) throw new Error("Eintrag nicht gefunden");

    entry.date = (payload.date || "").trim();
    entry.text = (payload.text || "").trim();
    entry.updatedAt = new Date().toISOString();

    sortRezeptEntriesByDate(rezept);
  });
}

export function deleteRezeptEntry(homeId, patientId, rezeptId, entryId) {
  mutateRuntimeData((data) => {
    const home = getHomeById(data, homeId);
    if (!home) throw new Error("Heim nicht gefunden");

    const patient = getPatientById(home, patientId);
    if (!patient) throw new Error("Patient nicht gefunden");

    const rezept = getRezeptById(patient, rezeptId);
    if (!rezept) throw new Error("Rezept nicht gefunden");

    ensureRezeptTimeState(rezept);

    const entry = (rezept.entries || []).find((item) => item.entryId === entryId);
    if (!entry) throw new Error("Eintrag nicht gefunden");

    rezept.entries = (rezept.entries || []).filter((item) => item.entryId !== entryId);

    if (entry.linkedTimeEntryId) {
      rezept.timeEntries = (rezept.timeEntries || []).filter((item) => item.timeEntryId !== entry.linkedTimeEntryId);
    }

    ensureKilometerState(data);
    data.kilometer.travelLog = (data.kilometer.travelLog || []).filter((item) => String(item?.relatedEntryId || "") !== entryId);

    const lastTimeEntry = (rezept.timeEntries || [])
      .slice()
      .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))[0];

    rezept.zeitMeta.lastTimeEntryAt = lastTimeEntry?.createdAt || "";
  });
}

export function rezeptSummary(rezept) {
  const items = rezept?.items || [];
  const parts = items.map((item) => {
    if (item.type === "Blanko") return "Blanko";
    return item.count ? `${item.type} ${item.count}x` : item.type;
  });

  let suffix = "";
  if (rezept?.dt) suffix += " · DT";
  if (rezept?.bg) suffix += " · BG";

  return `${parts.join(", ") || "Keine Leistung"}${suffix}`;
}

export function searchPatientsInHome(home, query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return home?.patients || [];

  return (home?.patients || []).filter((patient) => {
    const haystack = [
      patient.firstName || "",
      patient.lastName || "",
      patient.birthDate || ""
    ].join(" ").toLowerCase();

    return haystack.includes(q);
  });
}

function comparePatientsByLastName(a, b) {
  const last = String(a?.patientLastName || "").localeCompare(String(b?.patientLastName || ""), "de");
  if (last !== 0) return last;
  const first = String(a?.patientFirstName || "").localeCompare(String(b?.patientFirstName || ""), "de");
  if (first !== 0) return first;
  const displayA = String(a?.patient || a?.patientName || "");
  const displayB = String(b?.patient || b?.patientName || "");
  return displayA.localeCompare(displayB, "de");
}

function buildAbgabeLeistungText(rezept) {
  const parts = (rezept?.items || []).map((item) => {
    if (!item) return "";
    if (item.type === "Blanko") return "Blanko";
    return item.count ? `${item.type} ${item.count}x` : (item.type || "");
  }).filter(Boolean);

  return parts.join(", ");
}

export function buildAbgabeRows(data) {
  const rows = [];

  (data.homes || []).forEach((home) => {
    (home.patients || []).forEach((patient) => {
      (patient.rezepte || []).forEach((rezept) => {
        if (rezept?.abgegeben === true) return;
        rows.push({
          rowId: `${home.homeId}_${patient.patientId}_${rezept.rezeptId}`,
          heim: home.name || "",
          hbPauschale: home.hbPauschale || "HB",
          patient: `${patient.lastName || ""}, ${patient.firstName || ""}`.replace(/^,\s*/, "").trim(),
          patientFirstName: patient.firstName || "",
          patientLastName: patient.lastName || "",
          geb: patient.birthDate || "",
          ausstell: getRezeptAusstellungsdatum(rezept),
          leistung: buildAbgabeLeistungText(rezept),
          anzahl: "",
          menge: "",
          arzt: rezept.arzt || rezept.doctor || "",
          befreit: !!patient.befreit,
          bg: !!rezept.bg,
          dt: !!rezept.dt,
          rezeptId: rezept.rezeptId,
          patientId: patient.patientId,
          homeId: home.homeId
        });
      });
    });
  });

  return rows.sort((a, b) => {
    const last = String(a.patientLastName || "").localeCompare(String(b.patientLastName || ""), "de");
    if (last !== 0) return last;
    const first = String(a.patientFirstName || "").localeCompare(String(b.patientFirstName || ""), "de");
    if (first !== 0) return first;
    const homeCompare = String(a.heim || "").localeCompare(String(b.heim || ""), "de");
    if (homeCompare !== 0) return homeCompare;
    return String(a.leistung || "").localeCompare(String(b.leistung || ""), "de");
  });
}

export function filterAbgabeRows(rows, query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return rows;

  return rows.filter((row) => {
    const haystack = [
      row.heim,
      row.patient,
      row.geb,
      row.ausstell,
      row.leistung,
      row.anzahl,
      row.arzt
    ].join(" ").toLowerCase();

    return haystack.includes(q);
  });
}


function findNachbestellContext(data, row) {
  const home = (data.homes || []).find((item) => item.homeId === row.homeId);
  const patient = (home?.patients || []).find((item) => item.patientId === row.patientId);
  const rezept = (patient?.rezepte || []).find((item) => item.rezeptId === row.rezeptId);
  return { home, patient, rezept };
}

export function buildNachbestellLetterData(data, rows) {
  const safeRows = Array.isArray(rows) ? rows.filter(Boolean) : [];
  if (safeRows.length === 0) {
    throw new Error('Bitte mindestens ein Rezept auswählen.');
  }

  const doctors = Array.from(new Set(safeRows.map((row) => String(row.doctor || '').trim()).filter(Boolean)));
  if (doctors.length !== 1) {
    throw new Error('Es kann nur ein Nachbestellzettel pro Arzt erzeugt werden.');
  }

  const doctor = doctors[0];
  const groups = new Map();
  let rezeptCount = 0;
  let patientCount = 0;

  safeRows.forEach((row) => {
    const { home, patient, rezept } = findNachbestellContext(data, row);
    if (!home || !patient || !rezept) return;

    const groupKey = `home:${home.homeId}`;

    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        groupKey,
        type: 'heim',
        title: String(home.name || '').trim(),
        address: String(home.adresse || '').trim(),
        patients: new Map()
      });
    }

    const group = groups.get(groupKey);
    if (!group.patients.has(patient.patientId)) {
      group.patients.set(patient.patientId, {
        patientId: patient.patientId,
        patientName: `${String(patient.lastName || '').trim()}, ${String(patient.firstName || '').trim()}`.replace(/^,\s*/, '').trim(),
        geb: String(patient.birthDate || '').trim(),
        rezepte: []
      });
      patientCount += 1;
    }

    group.patients.get(patient.patientId).rezepte.push({
      rezeptId: rezept.rezeptId,
      text: `${rezeptSummary(rezept)} + HB`
    });
    rezeptCount += 1;
  });

  const normalizedGroups = Array.from(groups.values())
    .map((group) => ({
      ...group,
      patients: Array.from(group.patients.values())
        .map((patient) => ({
          ...patient,
          rezepte: patient.rezepte.sort((a, b) => String(a.text || '').localeCompare(String(b.text || ''), 'de'))
        }))
        .sort(comparePatientsByLastName)
    }))
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === 'heim' ? -1 : 1;
      return `${a.title} ${a.address}`.localeCompare(`${b.title} ${b.address}`, 'de');
    });

  return {
    createdAt: new Date().toISOString(),
    doctor,
    title: `Nachbestellung ${doctor}`,
    praxis: {
      name: 'Physio Strobl',
      department: 'Abteilung FaSt',
      address: String(data?.settings?.practiceAddress || '').trim(),
      phone: String(data?.settings?.practicePhone || '').trim(),
      fax: String(data?.settings?.therapistFax || '').trim(),
      therapistName: String(data?.settings?.therapistName || '').trim()
    },
    groups: normalizedGroups,
    patientCount,
    rezeptCount
  };
}

export function saveNachbestellHistorySnapshot(snapshot) {
  const source = snapshot && typeof snapshot === 'object' ? snapshot : {};
  mutateRuntimeData((data) => {
    data.nachbestellHistory.unshift({
      id: generateId('nachbestellung'),
      createdAt: String(source.createdAt || new Date().toISOString()),
      title: String(source.title || 'Nachbestellung').trim(),
      doctor: String(source.doctor || '').trim(),
      rezeptCount: Number.isFinite(Number(source.rezeptCount)) ? Number(source.rezeptCount) : 0,
      patientCount: Number.isFinite(Number(source.patientCount)) ? Number(source.patientCount) : 0,
      snapshotHtml: String(source.snapshotHtml || ''),
      lines: Array.isArray(source.lines) ? source.lines.map((line) => ({
        patient: String(line?.patient || '').trim(),
        geb: String(line?.geb || '').trim(),
        heim: String(line?.heim || '').trim(),
        text: String(line?.text || '').trim()
      })) : []
    });
  });
}


export function deleteNachbestellHistoryItem(historyId) {
  const targetId = String(historyId || '').trim();
  if (!targetId) return;
  mutateRuntimeData((data) => {
    data.nachbestellHistory = (data.nachbestellHistory || []).filter((item) => item.id !== targetId);
  });
}

export function buildNachbestellRows(data) {
  const rows = [];

  (data.homes || []).forEach((home) => {
    (home.patients || []).forEach((patient) => {
      // Ausgeschiedene Patienten gelten nicht mehr als aktiv - weder FaSti
      // noch die manuelle Nachbestellungs-Ansicht sollen für sie noch eine
      // Nachbestellung erwarten oder vorschlagen (siehe patient.ausgeschieden).
      if (patient.ausgeschieden) return;
      (patient.rezepte || []).forEach((rezept) => {
        rows.push({
          rowId: `${home.homeId}_${patient.patientId}_${rezept.rezeptId}`,
          doctor: rezept.arzt || "",
          patient: formatPatientName(patient),
          patientFirstName: patient.firstName || "",
          patientLastName: patient.lastName || "",
          geb: patient.birthDate || "",
          heim: home.name || "",
          text: rezeptSummary(rezept),
          ausstell: getRezeptAusstellungsdatum(rezept),
          rezeptId: rezept.rezeptId,
          patientId: patient.patientId,
          homeId: home.homeId
        });
      });
    });
  });

  return rows.sort((a, b) => {
    const patientCompare = comparePatientsByLastName(a, b);
    if (patientCompare !== 0) return patientCompare;
    const homeCompare = String(a.heim || "").localeCompare(String(b.heim || ""), "de");
    if (homeCompare !== 0) return homeCompare;
    return String(a.text || "").localeCompare(String(b.text || ""), "de");
  });
}

export function filterNachbestellRows(rows, doctorQuery, textQuery = "") {
  const dq = String(doctorQuery || "").trim().toLowerCase();
  const tq = String(textQuery || "").trim().toLowerCase();

  return rows.filter((row) => {
    const doctorOk = !dq || String(row.doctor || "").toLowerCase().includes(dq);
    const textOk = !tq || [
      row.doctor,
      row.patient,
      row.geb,
      row.heim,
      row.text
    ].join(" ").toLowerCase().includes(tq);

    return doctorOk && textOk;
  });
}

export function getDoctorList(data) {
  const set = new Set();

  (data.homes || []).forEach((home) => {
    (home.patients || []).forEach((patient) => {
      (patient.rezepte || []).forEach((rezept) => {
        const arzt = String(rezept.arzt || "").trim();
        if (arzt) set.add(arzt);
      });
    });
  });

  return Array.from(set).sort((a, b) => a.localeCompare(b, "de"));
}

export function saveAbgabeHistory(title, rows, options = {}) {
  const source = options && typeof options === 'object' ? options : {};
  mutateRuntimeData((data) => {
    data.abgabeHistory.unshift({
      id: generateId("abgabe"),
      createdAt: String(source.createdAt || new Date().toISOString()),
      title: title || "Abgabeliste",
      snapshotHtml: String(source.snapshotHtml || ""),
      rows: rows.map((row) => ({
        heim: row.heim || "",
        patient: row.patient || "",
        patientFirstName: row.patientFirstName || "",
        patientLastName: row.patientLastName || "",
        geb: row.geb || "",
        ausstell: row.ausstell || "",
        leistung: row.leistung || "",
        anzahl: row.anzahl || "",
        menge: row.menge || "",
        arzt: row.arzt || "",
        befreit: !!row.befreit,
        bg: !!row.bg,
        dt: !!row.dt
      }))
    });
  });
}

export function deleteAbgabeHistoryItem(historyId) {
  const targetId = String(historyId || '').trim();
  if (!targetId) return;
  mutateRuntimeData((data) => {
    data.abgabeHistory = (data.abgabeHistory || []).filter((item) => item.id !== targetId);
  });
}

export function buildAbgabeTree(data) {
  const homes = [];

  (data.homes || []).forEach((home) => {
    const patients = [];

    (home.patients || []).forEach((patient) => {
      const rezepte = [];

      (patient.rezepte || []).forEach((rezept) => {
        if (rezept?.abgegeben === true) return;
        rezepte.push({
          rowId: `${home.homeId}_${patient.patientId}_${rezept.rezeptId}`,
          rezeptId: rezept.rezeptId,
          arzt: rezept.arzt || rezept.doctor || "",
          ausstell: rezept.ausstell || "",
          bg: !!rezept.bg,
          dt: !!rezept.dt,
          leistung: buildAbgabeLeistungText(rezept),
          anzahl: "",
          menge: ""
        });
      });

      if (rezepte.length > 0) {
        patients.push({
          patientId: patient.patientId,
          patientName: `${patient.lastName || ""}, ${patient.firstName || ""}`.replace(/^,\s*/, "").trim(),
          patientFirstName: patient.firstName || "",
          patientLastName: patient.lastName || "",
          geb: patient.birthDate || "",
          befreit: !!patient.befreit,
          rezepte
        });
      }
    });

    if (patients.length > 0) {
      homes.push({
        homeId: home.homeId,
        homeName: home.name || "",
        hbPauschale: home.hbPauschale || "HB",
        patients: patients.sort((a, b) => {
          const last = String(a.patientLastName || "").localeCompare(String(b.patientLastName || ""), "de");
          if (last !== 0) return last;
          return String(a.patientFirstName || "").localeCompare(String(b.patientFirstName || ""), "de");
        })
      });
    }
  });

  return homes.sort((a, b) => String(a.homeName).localeCompare(String(b.homeName), "de"));
}

export function buildNachbestellTree(data, doctorFilter = "", textFilter = "") {
  const filtered = filterNachbestellRows(buildNachbestellRows(data), doctorFilter, textFilter);
  const map = new Map();

  filtered.forEach((row) => {
    const doctorKey = row.doctor || "Ohne Arzt";

    if (!map.has(doctorKey)) {
      map.set(doctorKey, {
        doctor: doctorKey,
        patients: new Map()
      });
    }

    const doctorGroup = map.get(doctorKey);
    const patientKey = `${row.heim}__${row.patient}__${row.geb}`;

    if (!doctorGroup.patients.has(patientKey)) {
      doctorGroup.patients.set(patientKey, {
        patient: row.patient || "",
        patientFirstName: row.patientFirstName || "",
        patientLastName: row.patientLastName || "",
        geb: row.geb || "",
        heim: row.heim || "",
        rows: []
      });
    }

    doctorGroup.patients.get(patientKey).rows.push(row);
  });

  return Array.from(map.values())
    .map((group) => ({
      doctor: group.doctor,
      patients: Array.from(group.patients.values()).sort(comparePatientsByLastName)
    }))
    .sort((a, b) => String(a.doctor).localeCompare(String(b.doctor), "de"));
}


export function createRezeptTimeEntry(homeId, patientId, rezeptId, payload) {
  mutateRuntimeData((data) => {
    const home = getHomeById(data, homeId);
    if (!home) throw new Error("Heim nicht gefunden");

    const patient = getPatientById(home, patientId);
    if (!patient) throw new Error("Patient nicht gefunden");

    const rezept = getRezeptById(patient, rezeptId);
    if (!rezept) throw new Error("Rezept nicht gefunden");

    ensureRezeptTimeState(rezept);

    const timeEntry = createTimeEntryObject({
      ...payload,
      type: "besprechung",
      confirmed: true
    });

    if (!timeEntry.minutes) {
      throw new Error("Besprechungszeit muss größer als 0 Minuten sein");
    }

    rezept.timeEntries.push(timeEntry);
    rezept.zeitMeta.lastTimeEntryAt = timeEntry.createdAt;
  });
}



export function deleteRezeptTimeEntry(homeId, patientId, rezeptId, timeEntryId) {
  mutateRuntimeData((data) => {
    const home = getHomeById(data, homeId);
    if (!home) throw new Error("Heim nicht gefunden");

    const patient = getPatientById(home, patientId);
    if (!patient) throw new Error("Patient nicht gefunden");

    const rezept = getRezeptById(patient, rezeptId);
    if (!rezept) throw new Error("Rezept nicht gefunden");

    ensureRezeptTimeState(rezept);

    const beforeLength = rezept.timeEntries.length;
    rezept.timeEntries = rezept.timeEntries.filter((item) => item.timeEntryId !== timeEntryId);

    if (rezept.timeEntries.length === beforeLength) {
      throw new Error("Zeiteintrag nicht gefunden");
    }

    (rezept.entries || []).forEach((entry) => {
      if (entry.linkedTimeEntryId === timeEntryId) {
        entry.linkedTimeEntryId = "";
      }
    });

    const lastTimeEntry = rezept.timeEntries
      .slice()
      .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))[0];

    rezept.zeitMeta.lastTimeEntryAt = lastTimeEntry?.createdAt || "";
  });
}

export function getRezeptTimeEntries(rezept) {
  return [...(rezept?.timeEntries || [])]
    .map((entry) => ({
      ...entry,
      minutes: getEffectiveRezeptTimeEntryMinutes(rezept, entry)
    }))
    .sort((a, b) =>
      compareDeDates(String(b?.date || ""), String(a?.date || ""))
      || String(b?.createdAt || "").localeCompare(String(a?.createdAt || ""), "de")
    );
}

export function getRezeptTimeSummary(rezept) {
  const entries = getRezeptTimeEntries(rezept);
  const totalMinutes = entries.reduce((sum, item) => sum + (Number(item.minutes) || 0), 0);
  const totalEntries = entries.length;
  return { totalMinutes, totalEntries };
}
