// FaSt Assessment-System – Testdefinitionen und Scoring-Logik.
// Basierend auf "FaSt Assessment-Konzept + Therapiebericht" (August 2026).
// Reine Logik, keine DOM-Zugriffe, damit sie unabhängig testbar bleibt.

export const REMINDER_INTERVAL_DAYS = { 3: 90, 6: 180 };

// ============================================================
// Ebene 0 – Kognitiver / psychischer Status
// ============================================================
export const GEDAECHTNIS_OPTIONEN = [
  { val: "unauffaellig", label: "unauffällig" },
  { val: "kurzzeit", label: "Kurzzeitgedächtnis betroffen" },
  { val: "langzeit", label: "Langzeitgedächtnis betroffen" },
  { val: "nicht_beurteilbar", label: "nicht beurteilbar" }
];
export const KOMMUNIKATION_OPTIONEN = [
  { val: "verbal", label: "verbal unauffällig" },
  { val: "verbal_eingeschraenkt", label: "verbal eingeschränkt" },
  { val: "nonverbal", label: "nonverbal" },
  { val: "nicht_moeglich", label: "Kommunikation nicht möglich" }
];
export const KOOPERATION_OPTIONEN = [
  { val: "gut", label: "gut" },
  { val: "eingeschraenkt", label: "eingeschränkt" },
  { val: "nicht_moeglich", label: "nicht möglich" }
];

export function determineSchmerzTyp(ebene0) {
  return ["nonverbal", "nicht_moeglich"].includes(ebene0?.kommunikation) ? "besd" : "nrs";
}

// ============================================================
// Ebene 1 – Barthel-Index
// ============================================================
export const BARTHEL_KATEGORIEN = [
  { key: "essen", label: "Essen", options: [0, 5, 10] },
  { key: "baden", label: "Baden / Waschen", options: [0, 5] },
  { key: "koerperpflege", label: "Körperpflege", options: [0, 5] },
  { key: "ankleiden", label: "An- / Auskleiden", options: [0, 5, 10] },
  { key: "stuhlkontinenz", label: "Stuhlkontinenz", options: [0, 5, 10] },
  { key: "harnkontinenz", label: "Harnkontinenz", options: [0, 5, 10] },
  { key: "toilette", label: "Toilettenbenutzung", options: [0, 5, 10] },
  { key: "transfer", label: "Bett- / Stuhltransfer", options: [0, 5, 10, 15] },
  { key: "gehen", label: "Gehen / Rollstuhlfahren", options: [0, 5, 10, 15] },
  { key: "treppen", label: "Treppensteigen", options: [0, 5, 10] }
];
export const BARTHEL_MAX = 100;

export function computeBarthelTotal(values) {
  return BARTHEL_KATEGORIEN.reduce((sum, kat) => sum + (Number(values?.[kat.key]) || 0), 0);
}

export function classifyBarthel(total) {
  if (total >= 100) return "Vollständig selbstständig";
  if (total >= 65) return "Leichte Einschränkung";
  if (total >= 45) return "Erhebliche Einschränkung";
  return "Schwere Pflegebedürftigkeit";
}

// ============================================================
// Ebene 1 – Schmerz (NRS oder BESD)
// ============================================================
export const BESD_KATEGORIEN = [
  { key: "atmung", label: "Atmung", stufen: ["normal", "gelegentlich angestrengt", "laut / angestrengt"] },
  { key: "lautaeusserungen", label: "Lautäußerungen", stufen: ["keine", "gelegentlich stöhnen", "wiederholt rufen"] },
  { key: "gesichtsausdruck", label: "Gesichtsausdruck", stufen: ["entspannt", "angespannt", "grimassieren"] },
  { key: "koerpersprache", label: "Körpersprache", stufen: ["entspannt", "angespannt", "Abwehrbewegungen"] },
  { key: "trost", label: "Trost", stufen: ["nicht nötig", "ablenkbar", "nicht zu trösten"] }
];
export const BESD_MAX = 10;
export const NRS_MAX = 10;

export function computeBesdTotal(values) {
  return BESD_KATEGORIEN.reduce((sum, kat) => sum + (Number(values?.[kat.key]) || 0), 0);
}

export function classifyNrs(value) {
  if (value === null || value === undefined || value === "") return "";
  const n = Number(value);
  if (n === 0) return "Kein Schmerz";
  if (n <= 3) return "Leicht";
  if (n <= 6) return "Mittel, behandlungsrelevant";
  return "Stark, dringend";
}

export function classifyBesd(total) {
  return total >= 4 ? "Schmerzbehandlung indiziert" : "Kein dringender Handlungsbedarf";
}

// ============================================================
// Ebene 1 – Timed Up & Go
// ============================================================
export function classifyTug(seconds) {
  if (seconds === null || seconds === undefined || seconds === "") return "";
  const n = Number(seconds);
  if (n < 12) return "Unauffällig";
  if (n <= 20) return "Erhöhtes Sturzrisiko";
  return "Hohes Sturzrisiko";
}

// ============================================================
// Ebene 2a – Neurologisch
// ============================================================
export const BBS7_ITEMS = [
  { key: "sitzenZuStehen", label: "Vom Sitzen zum Stehen (ohne Hände wenn möglich)" },
  { key: "freiesStehen", label: "Freies Stehen 2 Minuten" },
  { key: "freiesSitzen", label: "Freies Sitzen ohne Rückenlehne 2 Minuten" },
  { key: "stehenZuSitzen", label: "Vom Stehen zum Sitzen (kontrolliert)" },
  { key: "transfer", label: "Transfer (Stuhl zu Stuhl / Liege seitlich)" },
  { key: "augenGeschlossen", label: "Stehen mit geschlossenen Augen 10 Sek." },
  { key: "tandemstand", label: "Stehen mit geschlossenen Füßen 30 Sek." }
];
export const BBS7_MAX = 28;

export function computeBbs7(items) {
  let total = 0;
  let maxPossible = 0;
  let notDurchfuehrbar = 0;

  BBS7_ITEMS.forEach((item) => {
    const entry = items?.[item.key];
    if (!entry || entry.nichtDurchfuehrbar) {
      notDurchfuehrbar += 1;
      return;
    }
    total += Number(entry.score) || 0;
    maxPossible += 4;
  });

  return { total, maxPossible, notDurchfuehrbar };
}

// maxPossible fällt kleiner als BBS7_MAX aus, sobald Items als "nicht
// durchführbar" markiert wurden (z.B. bei Schwerstbetroffenen) - die
// Schwellenwerte werden deshalb proportional zur tatsächlich erreichbaren
// Punktzahl skaliert, statt starr gegen die volle 28er-Skala zu prüfen.
export function classifyBbs7(total, maxPossible = BBS7_MAX) {
  const max = Number(maxPossible) > 0 ? Number(maxPossible) : BBS7_MAX;
  const ratio = Number(total) / max;
  if (ratio >= 21 / BBS7_MAX) return "Geringes Sturzrisiko";
  if (ratio >= 11 / BBS7_MAX) return "Mittleres Sturzrisiko";
  return "Hohes Sturzrisiko";
}

export const RMI_FRAGEN = [
  "Können Sie sich im Bett von einer Seite auf die andere drehen?",
  "Können Sie aus dem Liegen selbstständig zum Sitzen an der Bettkante kommen?",
  "Können Sie 10 Minuten ohne Halt sicher sitzen?",
  "Können Sie aus dem Bett aufstehen und 10 Minuten sitzen?",
  "Können Sie 10 Sekunden ohne fremde Hilfe stehen?",
  "Können Sie einen Transfer (z.B. Bett–Stuhl) durchführen?",
  "Können Sie im Zimmer gehen, mit Hilfsmittel wenn nötig?",
  "Können Sie Treppen steigen?",
  "Können Sie draußen auf ebenem Untergrund gehen?",
  "Können Sie auf unebenem Untergrund gehen (z.B. Rasen, Kies)?",
  "Können Sie in eine Badewanne ein- und wieder aussteigen?",
  "Können Sie vier Stufen ohne Geländer steigen?",
  "Können Sie 10 Meter gehen, mit Hilfsmittel wenn nötig?",
  "Können Sie sich beim Gehen bücken und einen Gegenstand vom Boden aufheben?"
];
export const RMI_MAX = 15;

export function computeRmiTotal(antworten, beobachtungBestanden) {
  const fragenSumme = RMI_FRAGEN.reduce((sum, _, idx) => sum + (antworten?.[idx] ? 1 : 0), 0);
  return fragenSumme + (beobachtungBestanden ? 1 : 0);
}

export function classifyRmi(total) {
  if (total >= 15) return "Volle funktionelle Mobilität";
  if (total < 7) return "Stark eingeschränkt";
  return "Teilweise eingeschränkt";
}

export const MRC_GRUPPEN = [
  { key: "schulter", label: "Schulter" },
  { key: "ellbogen", label: "Ellbogen" },
  { key: "huefte", label: "Hüfte" },
  { key: "knie", label: "Knie" }
];
export const SPASTIK_OPTIONEN = [
  { val: "nein", label: "Nein" },
  { val: "links", label: "Ja links" },
  { val: "rechts", label: "Ja rechts" },
  { val: "beidseitig", label: "Ja beidseitig" }
];

export function computeMrcTotal(gruppenWerte) {
  let total = 0;
  let count = 0;
  MRC_GRUPPEN.forEach((g) => {
    ["links", "rechts"].forEach((seite) => {
      const v = gruppenWerte?.[g.key]?.[seite];
      if (v !== null && v !== undefined && v !== "") {
        total += Number(v);
        count += 1;
      }
    });
  });
  return { total, count, max: MRC_GRUPPEN.length * 2 * 5 };
}

// ============================================================
// Ebene 2b – Orthopädisch (SPPB)
// ============================================================
export function scoreSppbBalance({ seitNebeneinanderSek, semitandemSek, tandemSek, nichtMoeglich }) {
  if (nichtMoeglich) return 0;
  const side = Number(seitNebeneinanderSek) || 0;
  if (side < 10) return 0;

  const semi = Number(semitandemSek) || 0;
  if (semi < 10) return 1;

  const tandem = Number(tandemSek) || 0;
  if (tandem >= 10) return 4;
  if (tandem >= 3) return 3;
  return 2;
}

export function scoreSppbGehgeschwindigkeit(seconds, nichtMoeglich) {
  if (nichtMoeglich) return 0;
  if (seconds === null || seconds === undefined || seconds === "") return 0;
  const s = Number(seconds);
  if (!Number.isFinite(s) || s <= 0) return 0;
  if (s <= 4.81) return 4;
  if (s <= 6.20) return 3;
  if (s <= 8.70) return 2;
  return 1;
}

export function scoreSppbChairStand(seconds, nichtMoeglich) {
  if (nichtMoeglich) return 0;
  const s = Number(seconds);
  if (!Number.isFinite(s) || s <= 0) return 0;
  if (s <= 11.19) return 4;
  if (s <= 13.69) return 3;
  if (s <= 16.69) return 2;
  return 1;
}

export const SPPB_MAX = 12;

export function computeSppbTotal(sppb) {
  const balance = scoreSppbBalance(sppb?.balance || {});
  const gehen = scoreSppbGehgeschwindigkeit(sppb?.gehgeschwindigkeitSek, sppb?.gehgeschwindigkeitNichtMoeglich);
  const chairStand = scoreSppbChairStand(sppb?.chairStandSek, sppb?.chairStandNichtMoeglich);
  return { balance, gehen, chairStand, total: balance + gehen + chairStand };
}

export function classifySppb(total) {
  if (total >= 10) return "Unauffällig";
  if (total >= 7) return "Leicht eingeschränkt";
  if (total >= 4) return "Mittel eingeschränkt";
  return "Stark eingeschränkt, hohes Sarkopenie-/Sturzrisiko";
}

export const SCHMERZ_ZONEN = [
  "Kopf / Nacken",
  "Schulter links", "Schulter rechts",
  "Oberarm links", "Oberarm rechts",
  "Ellbogen links", "Ellbogen rechts",
  "Unterarm links", "Unterarm rechts",
  "Hand links", "Hand rechts",
  "Brustkorb",
  "Oberer Rücken (BWS)",
  "Unterer Rücken (LWS)",
  "Becken / Hüfte links", "Becken / Hüfte rechts",
  "Oberschenkel links", "Oberschenkel rechts",
  "Knie links", "Knie rechts",
  "Unterschenkel links", "Unterschenkel rechts",
  "Fuß links", "Fuß rechts"
];

export const SCHMERZ_QUALITAET_OPTIONEN = [
  "Stechend",
  "Dumpf / drückend",
  "Brennend",
  "Ziehend",
  "Kribbeln / Taubheit",
  "Belastungsschmerz (nur bei Bewegung)",
  "Dauerschmerz (auch in Ruhe)"
];

export const ROM_AKTIV_GELENKE = [
  { key: "hws", label: "HWS", aufgabe: "Drehen Sie den Kopf nach links und rechts" },
  { key: "schulter", label: "Schulter", aufgabe: "Heben Sie beide Arme über den Kopf" },
  { key: "schulterRotation", label: "Schulter Rotation", aufgabe: "Fassen Sie mit der Hand zum gegenüberliegenden Schulterblatt" },
  { key: "ellbogen", label: "Ellbogen", aufgabe: "Beugen und strecken Sie den Ellbogen vollständig" },
  { key: "handgelenk", label: "Handgelenk", aufgabe: "Beugen und strecken Sie das Handgelenk" },
  { key: "finger", label: "Finger", aufgabe: "Machen Sie eine Faust und strecken Sie die Finger wieder aus" },
  { key: "bwsLws", label: "BWS / LWS", aufgabe: "Beugen Sie sich nach vorne, Hände Richtung Boden" },
  { key: "huefte", label: "Hüfte", aufgabe: "Heben Sie das Bein im Sitzen gestreckt an" },
  { key: "knie", label: "Knie", aufgabe: "Strecken Sie das Knie vollständig durch" },
  { key: "sprunggelenk", label: "Sprunggelenk", aufgabe: "Ziehen Sie den Fuß nach oben / drücken Sie ihn nach unten" }
];

export const ROM_PASSIV_GELENKE = [
  { key: "schulter", label: "Schulter" },
  { key: "ellbogen", label: "Ellbogen" },
  { key: "handgelenk", label: "Handgelenk" },
  { key: "finger", label: "Finger" },
  { key: "huefte", label: "Hüfte" },
  { key: "knie", label: "Knie" },
  { key: "sprunggelenk", label: "Sprunggelenk" },
  { key: "zehen", label: "Zehen" }
];

export const ROM_BEWERTUNG_OPTIONEN = [
  { val: "frei", label: "✅ Frei" },
  { val: "eingeschraenkt", label: "⚠️ Eingeschränkt" },
  { val: "aufgehoben", label: "❌ Aufgehoben" }
];

// ============================================================
// Ebene 2c – Schwerstbetroffene
// ============================================================
export const KONTRAKTUR_GELENKE = [
  { key: "fingerLinks", label: "Finger links" }, { key: "fingerRechts", label: "Finger rechts" },
  { key: "handgelenkLinks", label: "Handgelenk links" }, { key: "handgelenkRechts", label: "Handgelenk rechts" },
  { key: "ellbogenLinks", label: "Ellbogen links" }, { key: "ellbogenRechts", label: "Ellbogen rechts" },
  { key: "schulterLinks", label: "Schulter links" }, { key: "schulterRechts", label: "Schulter rechts" },
  { key: "zehenLinks", label: "Zehen links" }, { key: "zehenRechts", label: "Zehen rechts" },
  { key: "sprunggelenkLinks", label: "Sprunggelenk links" }, { key: "sprunggelenkRechts", label: "Sprunggelenk rechts" },
  { key: "knieLinks", label: "Knie links" }, { key: "knieRechts", label: "Knie rechts" },
  { key: "huefteLinks", label: "Hüfte links" }, { key: "huefteRechts", label: "Hüfte rechts" }
];

// ============================================================
// Weichenscreen / Auto-Routing
// ============================================================
export const WEICHEN_OPTIONEN = [
  { val: "neurologisch", label: "🧠 Gleichgewicht / Lähmung / Koordination", ebene: "2a" },
  { val: "orthopaedisch", label: "🦴 Schmerz / Kraft / Bewegung", ebene: "2b" },
  { val: "schwerstbetroffen", label: "🛏️ Bettlägerig / kaum aktiv", ebene: "2c" },
  { val: "bbs", label: "⚖️ Berg-Balance-Test", ebene: "bbs" }
];

// ============================================================
// Berg-Balance-Test (BBS) – vollständige 14-Item-Version. Ab jetzt der
// EINZIGE Assessment-Test in der App (Vorgabe des Nutzers: "Assessment
// reduzieren auf ausschließlich den Bergbalancetest"). Jedes Item wird 0-4
// bewertet (4 = am besten), Standardkriterien der Berg Balance Scale.
// ============================================================
export const BBS_ITEMS = [
  {
    key: "sitzenZuStehen",
    label: "Vom Sitzen zum Stehen",
    aufgabe: "Bitte stehen Sie auf. Versuchen Sie dabei, möglichst nicht mit den Händen nachzuhelfen.",
    scores: [
      { val: 4, text: "steht ohne Zuhilfenahme der Hände auf und stabilisiert sich selbstständig" },
      { val: 3, text: "steht selbstständig auf, benutzt dabei die Hände" },
      { val: 2, text: "steht nach mehreren Versuchen mit den Händen auf" },
      { val: 1, text: "benötigt minimale Hilfe, um aufzustehen oder sich zu stabilisieren" },
      { val: 0, text: "benötigt moderate oder maximale Unterstützung, um aufzustehen" }
    ]
  },
  {
    key: "freiesStehen",
    label: "Freies Stehen",
    aufgabe: "Bitte stehen Sie 2 Minuten lang, ohne sich festzuhalten.",
    scores: [
      { val: 4, text: "kann sicher 2 Minuten stehen" },
      { val: 3, text: "kann 2 Minuten unter Aufsicht stehen" },
      { val: 2, text: "kann 30 Sekunden ohne Festhalten stehen" },
      { val: 1, text: "benötigt mehrere Versuche, um 30 Sekunden ohne Festhalten zu stehen" },
      { val: 0, text: "kann ohne Hilfe nicht 30 Sekunden stehen" }
    ]
  },
  {
    key: "freiesSitzen",
    label: "Freies Sitzen (Füße auf dem Boden, ohne Rückenlehne)",
    aufgabe: "Bitte sitzen Sie 2 Minuten lang mit verschränkten Armen, ohne sich anzulehnen.",
    scores: [
      { val: 4, text: "kann sicher 2 Minuten sitzen" },
      { val: 3, text: "kann 2 Minuten unter Aufsicht sitzen" },
      { val: 2, text: "kann 30 Sekunden sitzen" },
      { val: 1, text: "kann 10 Sekunden sitzen" },
      { val: 0, text: "kann ohne Unterstützung nicht 10 Sekunden sitzen" }
    ]
  },
  {
    key: "stehenZuSitzen",
    label: "Vom Stehen zum Sitzen",
    aufgabe: "Bitte setzen Sie sich hin.",
    scores: [
      { val: 4, text: "setzt sich sicher mit minimaler Zuhilfenahme der Hände hin" },
      { val: 3, text: "kontrolliert das Hinsetzen durch Einsatz der Hände" },
      { val: 2, text: "nutzt die Rückseite der Beine gegen den Stuhl, um das Hinsetzen zu kontrollieren" },
      { val: 1, text: "setzt sich selbstständig, aber unkontrolliert hin" },
      { val: 0, text: "benötigt Hilfe beim Hinsetzen" }
    ]
  },
  {
    key: "transfer",
    label: "Transfer",
    aufgabe: "Transfer zwischen zwei Stühlen (einmal mit, einmal ohne Armlehne) bzw. Stuhl/Bett.",
    scores: [
      { val: 4, text: "kann sicher transferieren, Hände kaum nötig" },
      { val: 3, text: "kann sicher transferieren, Hände eindeutig nötig" },
      { val: 2, text: "kann mit verbaler Anleitung und/oder Aufsicht transferieren" },
      { val: 1, text: "benötigt eine Person zur Unterstützung" },
      { val: 0, text: "benötigt zwei Personen zur Unterstützung/Aufsicht" }
    ]
  },
  {
    key: "augenGeschlossen",
    label: "Stehen mit geschlossenen Augen",
    aufgabe: "Bitte schließen Sie die Augen und stehen Sie 10 Sekunden ruhig.",
    scores: [
      { val: 4, text: "kann sicher 10 Sekunden stehen" },
      { val: 3, text: "kann 10 Sekunden unter Aufsicht stehen" },
      { val: 2, text: "kann 3 Sekunden stehen" },
      { val: 1, text: "kann die Augen nicht 3 Sekunden geschlossen halten, bleibt aber sicher stehen" },
      { val: 0, text: "benötigt Hilfe, um einen Sturz zu vermeiden" }
    ]
  },
  {
    key: "fuesseZusammen",
    label: "Stehen mit geschlossenen Füßen",
    aufgabe: "Bitte stellen Sie die Füße zusammen und stehen Sie ohne Festhalten.",
    scores: [
      { val: 4, text: "kann die Füße selbstständig zusammenstellen und 1 Minute sicher stehen" },
      { val: 3, text: "kann die Füße selbstständig zusammenstellen und 1 Minute unter Aufsicht stehen" },
      { val: 2, text: "kann die Füße selbstständig zusammenstellen, hält die Position aber nicht 30 Sekunden" },
      { val: 1, text: "benötigt Hilfe, um die Position einzunehmen, hält sie dann aber 15 Sekunden" },
      { val: 0, text: "benötigt Hilfe, um die Position einzunehmen, und hält sie keine 15 Sekunden" }
    ]
  },
  {
    key: "reichweite",
    label: "Reichweite nach vorne im Stehen",
    aufgabe: "Arm auf 90° anheben, Finger strecken und so weit wie möglich nach vorne reichen, ohne die Füße zu bewegen.",
    scores: [
      { val: 4, text: "kann sicher mehr als 25 cm nach vorne reichen" },
      { val: 3, text: "kann sicher mehr als 12 cm nach vorne reichen" },
      { val: 2, text: "kann sicher mehr als 5 cm nach vorne reichen" },
      { val: 1, text: "reicht nach vorne, benötigt aber Aufsicht" },
      { val: 0, text: "verliert das Gleichgewicht beim Versuch / benötigt äußere Unterstützung" }
    ]
  },
  {
    key: "gegenstandAufheben",
    label: "Gegenstand vom Boden aufheben",
    aufgabe: "Heben Sie den vor Ihren Füßen liegenden Gegenstand (z.B. Hausschuh) auf.",
    scores: [
      { val: 4, text: "kann den Gegenstand sicher und einfach aufheben" },
      { val: 3, text: "kann den Gegenstand aufheben, benötigt aber Aufsicht" },
      { val: 2, text: "kann den Gegenstand nicht aufheben, reicht aber bis auf 2-5 cm heran und hält das Gleichgewicht selbstständig" },
      { val: 1, text: "kann den Gegenstand nicht aufheben, benötigt Aufsicht beim Versuch" },
      { val: 0, text: "kann es nicht versuchen / benötigt Hilfe, um Gleichgewichtsverlust oder Sturz zu vermeiden" }
    ]
  },
  {
    key: "umschauen",
    label: "Über die Schulter nach hinten schauen",
    aufgabe: "Drehen Sie sich um, um über die linke, dann über die rechte Schulter zu schauen.",
    scores: [
      { val: 4, text: "schaut nach beiden Seiten mit guter Gewichtsverlagerung zurück" },
      { val: 3, text: "schaut nur zu einer Seite zurück, zur anderen Seite geringere Gewichtsverlagerung" },
      { val: 2, text: "dreht sich nur zur Seite, hält aber das Gleichgewicht" },
      { val: 1, text: "benötigt Aufsicht beim Drehen" },
      { val: 0, text: "benötigt Hilfe, um Gleichgewichtsverlust oder Sturz zu vermeiden" }
    ]
  },
  {
    key: "drehung360",
    label: "360°-Drehung",
    aufgabe: "Drehen Sie sich einmal ganz um die eigene Achse. Pause. Dann in die andere Richtung drehen.",
    scores: [
      { val: 4, text: "kann sicher in ≤4 Sekunden zu beiden Seiten drehen" },
      { val: 3, text: "kann sicher in ≤4 Sekunden nur zu einer Seite drehen" },
      { val: 2, text: "kann sicher, aber langsam drehen" },
      { val: 1, text: "benötigt engmaschige Aufsicht oder verbale Anleitung" },
      { val: 0, text: "benötigt Hilfe während der Drehung" }
    ]
  },
  {
    key: "stufeWechsel",
    label: "Abwechselnd Fuß auf Stufe/Hocker stellen",
    aufgabe: "Stellen Sie abwechselnd jeden Fuß auf die Stufe/den Hocker, bis jeder Fuß viermal aufgesetzt hat.",
    scores: [
      { val: 4, text: "kann sicher und selbstständig stehen, schafft 8 Schritte in 20 Sekunden" },
      { val: 3, text: "kann selbstständig stehen, schafft 8 Schritte in mehr als 20 Sekunden" },
      { val: 2, text: "schafft 4 Schritte ohne Hilfsmittel, unter Aufsicht" },
      { val: 1, text: "schafft mehr als 2 Schritte, benötigt minimale Hilfe" },
      { val: 0, text: "benötigt Hilfe, um einen Sturz zu vermeiden / kann es nicht versuchen" }
    ]
  },
  {
    key: "tandemstand",
    label: "Stehen mit einem Fuß vor dem anderen (Tandemstand)",
    aufgabe: "Stellen Sie einen Fuß direkt vor den anderen. Falls das nicht geht: einen Fuß so weit vorsetzen, dass die Ferse vor den Zehen des anderen Fußes steht.",
    scores: [
      { val: 4, text: "kann die Füße selbstständig in Tandemstellung bringen und 30 Sekunden halten" },
      { val: 3, text: "kann einen Fuß selbstständig vorsetzen und 30 Sekunden halten" },
      { val: 2, text: "kann einen kleinen Schritt selbstständig machen und 30 Sekunden halten" },
      { val: 1, text: "benötigt Hilfe beim Schritt, kann die Position aber 15 Sekunden halten" },
      { val: 0, text: "verliert beim Schritt oder Stehen das Gleichgewicht" }
    ]
  },
  {
    key: "einbeinstand",
    label: "Einbeinstand",
    aufgabe: "Stehen Sie so lange wie möglich auf einem Bein, ohne sich festzuhalten.",
    scores: [
      { val: 4, text: "kann das Bein selbstständig anheben und länger als 10 Sekunden halten" },
      { val: 3, text: "kann das Bein selbstständig anheben und 5-10 Sekunden halten" },
      { val: 2, text: "kann das Bein selbstständig anheben und mindestens 3 Sekunden halten" },
      { val: 1, text: "versucht, das Bein anzuheben, hält es keine 3 Sekunden, steht aber selbstständig weiter" },
      { val: 0, text: "kann es nicht versuchen / benötigt Hilfe, um einen Sturz zu vermeiden" }
    ]
  }
];
export const BBS_MAX = 56;

export function computeBbsTotal(items) {
  let total = 0;
  let maxPossible = 0;
  let notDurchfuehrbar = 0;

  BBS_ITEMS.forEach((item) => {
    const entry = items?.[item.key];
    if (!entry || entry.nichtDurchfuehrbar) {
      notDurchfuehrbar += 1;
      return;
    }
    total += Number(entry.score) || 0;
    maxPossible += 4;
  });

  return { total, maxPossible, notDurchfuehrbar };
}

// maxPossible fällt kleiner als BBS_MAX aus, sobald Items als "nicht
// durchführbar" markiert wurden - die Schwellenwerte werden deshalb
// proportional zur tatsächlich erreichbaren Punktzahl skaliert (analog zu
// classifyBbs7 oben), statt starr gegen die volle 56er-Skala zu prüfen.
// Cutoffs entsprechen der üblichen klinischen Einteilung der Berg Balance
// Scale (41-56 gering, 21-40 mittel, 0-20 hoch).
export function classifyBbs(total, maxPossible = BBS_MAX) {
  const max = Number(maxPossible) > 0 ? Number(maxPossible) : BBS_MAX;
  const ratio = Number(total) / max;
  if (ratio >= 41 / BBS_MAX) return "Geringes Sturzrisiko";
  if (ratio >= 21 / BBS_MAX) return "Mittleres Sturzrisiko";
  return "Hohes Sturzrisiko";
}

// ============================================================
// Ampel-/Verlaufslogik
// ============================================================
// direction: "high" = höherer Wert ist besser (Barthel, BBS-7, RMI, MRC, SPPB)
//            "low"  = niedrigerer Wert ist besser (NRS, BESD)
export function computeAmpel({ current, previous, max, direction = "high" }) {
  if (current === null || current === undefined || previous === null || previous === undefined || !max) {
    return null;
  }

  const delta = direction === "high" ? current - previous : previous - current;
  if (delta >= 0) return "gruen";

  const percentDrop = (Math.abs(delta) / max) * 100;
  return percentDrop <= 15 ? "gelb" : "rot";
}

// ============================================================
// Therapiebericht – geführte Auswahlfelder (Teil 2 laut Konzept)
// ============================================================
export const THERAPIEZIEL_OPTIONEN = [
  "Mobilität",
  "Schmerzreduktion",
  "Kontrakturprophylaxe",
  "Sturzprävention",
  "Kraft",
  "Aktivierung"
];

export const COMPLIANCE_OPTIONEN = [
  { val: "gut", label: "Gut" },
  { val: "eingeschraenkt", label: "Eingeschränkt" },
  { val: "nicht_vorhanden", label: "Nicht vorhanden" },
  { val: "keine_angabe", label: "Keine Angabe" }
];

export const VERLAUF_OPTIONEN = [
  { val: "verbessert", label: "Verbessert" },
  { val: "stabil", label: "Stabil" },
  { val: "status_quo", label: "Status quo" },
  { val: "verschlechtert", label: "Verschlechtert" }
];

export const THERAPIE_WEITERFUEHREN_OPTIONEN = [
  { val: "ja", label: "Ja" },
  { val: "nein", label: "Nein" }
];

export const THERAPIE_NUTZEN_OPTIONEN = [
  { val: "ja", label: "Ja" },
  { val: "nein", label: "Nein" },
  { val: "teilweise", label: "Teilweise" }
];

export function ampelEmoji(ampel) {
  if (ampel === "gruen") return "🟢";
  if (ampel === "gelb") return "🟡";
  if (ampel === "rot") return "🔴";
  return "";
}
