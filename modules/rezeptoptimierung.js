// Portierte Regelkern-Logik aus FaSt-Verordnungscheck (verordnungschecker-entwicklung, v1.4)
// in die Vanilla-JS-Architektur der FaSt-Doku übernommen (Funktion 2: Rezeptoptimierung).

export const HEILMITTEL_KATALOG = {
  WS: { label: "Wirbelsäulenerkrankungen", vorrangig: ["KG", "MT"], maxProVO: 6, orientierendeMenge: 18 },
  EX: { label: "Extremitäten & Becken", vorrangig: ["KG", "MT"], maxProVO: 6, orientierendeMenge: 18 },
  CS: { label: "Chronifiziertes Schmerzsyndrom", vorrangig: ["KG"], maxProVO: 6, orientierendeMenge: 18 },
  ZN: { label: "ZNS-Erkrankungen / Neuromuskulär", vorrangig: ["KgZNS", "KG"], maxProVO: 10, orientierendeMenge: 30 },
  PN: { label: "Periphere Nervenläsionen", vorrangig: ["KG"], maxProVO: 10, orientierendeMenge: 30 },
  AT: { label: "Störungen der Atmung", vorrangig: ["KG"], maxProVO: 6, orientierendeMenge: 18 },
  GE: { label: "Arterielle Gefäßerkrankungen", vorrangig: ["KG"], maxProVO: 6, orientierendeMenge: 18 },
  LY: { label: "Lymphabflussstörungen", vorrangig: ["MLD"], maxProVO: 6, orientierendeMenge: 30 },
  SO1: { label: "Störung der Dickdarmfunktion", vorrangig: ["KG"], maxProVO: 6, orientierendeMenge: 18 },
  SO2: { label: "Ausscheidungsstörungen", vorrangig: ["KG"], maxProVO: 6, orientierendeMenge: 18 },
  SO3: { label: "Schwindel", vorrangig: ["KG"], maxProVO: 6, orientierendeMenge: 18 }
};

export const VERGUETUNG = {
  KgZNS: { label: "KG-ZNS (Bobath/Vojta/PNF)" },
  MT: { label: "Manuelle Therapie" },
  KG: { label: "Allgemeine Krankengymnastik" },
  MLD: { label: "Manuelle Lymphdrainage" }
};

// Zuordnung Empfehlung → Leistungswert im Rezeptformular (siehe REZEPT_ITEM_OPTIONS in ui/views.js)
export const EMPFEHLUNG_ZU_ITEM_TYPE = {
  KgZNS: "KG-ZNS",
  MT: "MT",
  MLD: "MLD30",
  KG: "KG"
};

const PRAEFIX_REGELN = [
  { praefix: "G10", gruppe: "ZN", diagnose: "Chorea Huntington", lhb: true },
  { praefix: "G11", gruppe: "ZN", diagnose: "Hereditäre Ataxie", lhb: true },
  { praefix: "G12", gruppe: "ZN", diagnose: "Spinale Muskelatrophie / ALS", lhb: true },
  { praefix: "G14", gruppe: "ZN", diagnose: "Postpoliosyndrom", lhb: true },
  { praefix: "G20", gruppe: "ZN", diagnose: "Primäres Parkinson-Syndrom", lhb: true },
  { praefix: "G21", gruppe: "ZN", diagnose: "Sekundäres Parkinson-Syndrom", lhb: true },
  { praefix: "G24", gruppe: "ZN", diagnose: "Dystonie", lhb: true },
  { praefix: "G35", gruppe: "ZN", diagnose: "Multiple Sklerose", lhb: true },
  { praefix: "G36", gruppe: "ZN", diagnose: "Akute Demyelinisation", lhb: true },
  { praefix: "G37", gruppe: "ZN", diagnose: "Demyelinisierende ZNS-Erkrankung", lhb: true },
  { praefix: "G60", gruppe: "PN", diagnose: "Hereditäre Neuropathie", lhb: true },
  { praefix: "G61", gruppe: "PN", diagnose: "Polyneuritis / Guillain-Barré", lhb: true },
  { praefix: "G70", gruppe: "ZN", diagnose: "Myasthenia gravis", lhb: true },
  { praefix: "G71", gruppe: "ZN", diagnose: "Muskeldystrophie / Myopathie", lhb: true },
  { praefix: "G72", gruppe: "PN", diagnose: "Muskelerkrankung", lhb: true },
  { praefix: "G80", gruppe: "ZN", diagnose: "Infantile Zerebralparese", lhb: true },
  { praefix: "G81", gruppe: "ZN", diagnose: "Hemiparese / Hemiplegie", lhb: true },
  { praefix: "G82", gruppe: "ZN", diagnose: "Paraparese / Tetraparese", lhb: true },
  { praefix: "G91", gruppe: "ZN", diagnose: "Normaldruckhydrozephalus", lhb: true },
  { praefix: "G93", gruppe: "ZN", diagnose: "Hirnschädigung / Apallisches Syndrom", lhb: true },
  { praefix: "G95", gruppe: "ZN", diagnose: "Syringomyelie", lhb: true },
  { praefix: "I60", gruppe: "ZN", diagnose: "Subarachnoidalblutung", lhb: true, bvb: "längstens 1 Jahr nach Akutereignis" },
  { praefix: "I61", gruppe: "ZN", diagnose: "Intrazerebrale Blutung", lhb: true, bvb: "längstens 1 Jahr nach Akutereignis" },
  { praefix: "I63", gruppe: "ZN", diagnose: "Hirninfarkt", lhb: true, bvb: "längstens 1 Jahr nach Akutereignis" },
  { praefix: "I64", gruppe: "ZN", diagnose: "Schlaganfall", lhb: true, bvb: "längstens 1 Jahr nach Akutereignis" },
  { praefix: "I69", gruppe: "ZN", diagnose: "Folgen zerebrovaskulärer Krankheit", lhb: true },
  { praefix: "I83", gruppe: "GE", diagnose: "Krampfadern", lhb: false },
  { praefix: "I89", gruppe: "LY", diagnose: "Lymphödem", lhb: true },
  { praefix: "I97", gruppe: "LY", diagnose: "Lymphödem nach med. Maßnahmen", lhb: true },
  { praefix: "I10", gruppe: "GE", diagnose: "Essentielle Hypertonie", lhb: false },
  { praefix: "I11", gruppe: "GE", diagnose: "Hypertensive Herzkrankheit", lhb: false },
  { praefix: "I20", gruppe: "GE", diagnose: "Angina pectoris", lhb: false },
  { praefix: "I21", gruppe: "GE", diagnose: "Akuter Myokardinfarkt", lhb: false },
  { praefix: "I25", gruppe: "GE", diagnose: "Koronare Herzkrankheit (KHK)", lhb: false },
  { praefix: "I48", gruppe: "GE", diagnose: "Vorhofflimmern", lhb: false },
  { praefix: "I50", gruppe: "GE", diagnose: "Herzinsuffizienz", lhb: false },
  { praefix: "I70", gruppe: "GE", diagnose: "Arteriosklerose / pAVK", lhb: false },
  { praefix: "I73", gruppe: "GE", diagnose: "Sonstige periphere Gefäßkrankheit", lhb: false },
  { praefix: "J44", gruppe: "AT", diagnose: "COPD", lhb: true },
  { praefix: "J45", gruppe: "AT", diagnose: "Asthma bronchiale", lhb: false },
  { praefix: "J84", gruppe: "AT", diagnose: "Interstitielle Lungenkrankheit", lhb: true },
  { praefix: "J96", gruppe: "AT", diagnose: "Respiratorische Insuffizienz", lhb: false },
  { praefix: "M05", gruppe: "WS", diagnose: "Seropositive chronische Polyarthritis", lhb: true },
  { praefix: "M06", gruppe: "WS", diagnose: "Seronegative chronische Polyarthritis", lhb: true },
  { praefix: "M07", gruppe: "WS", diagnose: "Arthritis psoriatica", lhb: true },
  { praefix: "M08", gruppe: "WS", diagnose: "Juvenile Arthritis", lhb: true },
  { praefix: "M15", gruppe: "EX", diagnose: "Polyarthrose", lhb: false },
  { praefix: "M16", gruppe: "EX", diagnose: "Koxarthrose (Hüfte)", lhb: false },
  { praefix: "M17", gruppe: "EX", diagnose: "Gonarthrose (Knie)", lhb: false },
  { praefix: "M18", gruppe: "EX", diagnose: "Rhizarthrose (Daumen)", lhb: false },
  { praefix: "M19", gruppe: "EX", diagnose: "Sonstige Arthrose", lhb: false },
  { praefix: "M20", gruppe: "EX", diagnose: "Erworbene Deformitäten Finger/Zehen", lhb: false },
  { praefix: "M23", gruppe: "EX", diagnose: "Binnenschaden Kniegelenk", lhb: false },
  { praefix: "M24", gruppe: "EX", diagnose: "Sonstige Gelenkschädigung", lhb: false },
  { praefix: "M25", gruppe: "EX", diagnose: "Gelenkerkrankung", lhb: false },
  { praefix: "M32", gruppe: "WS", diagnose: "Systemischer Lupus erythematodes", lhb: true },
  { praefix: "M33", gruppe: "WS", diagnose: "Dermatomyositis / Polymyositis", lhb: true },
  { praefix: "M34", gruppe: "WS", diagnose: "Systemische Sklerose", lhb: true },
  { praefix: "M40", gruppe: "WS", diagnose: "Kyphose / Lordose", lhb: true },
  { praefix: "M41", gruppe: "WS", diagnose: "Skoliose", lhb: true },
  { praefix: "M43", gruppe: "WS", diagnose: "Sonstige WS-Deformitäten", lhb: false },
  { praefix: "M45", gruppe: "WS", diagnose: "Spondylitis ankylosans", lhb: true },
  { praefix: "M46", gruppe: "WS", diagnose: "Sonstige entzündliche WS-Erkrankung", lhb: false },
  { praefix: "M47", gruppe: "WS", diagnose: "Spondylose", lhb: false, bvb: "längstens 6 Monate nach Akutereignis (mit Myelopathie)" },
  { praefix: "M48", gruppe: "WS", diagnose: "Spinalkanalstenose", lhb: false },
  { praefix: "M50", gruppe: "WS", diagnose: "Bandscheibenschaden HWS", lhb: false },
  { praefix: "M51", gruppe: "WS", diagnose: "Bandscheibenschaden LWS/BWS (Bandscheibenvorfall)", lhb: false },
  { praefix: "M54", gruppe: "WS", diagnose: "Rückenschmerzen / Ischialgie", lhb: false },
  { praefix: "M65", gruppe: "EX", diagnose: "Synovitis / Tenosynovitis", lhb: false },
  { praefix: "M66", gruppe: "EX", diagnose: "Sehnenruptur", lhb: false },
  { praefix: "M70", gruppe: "EX", diagnose: "Weichteilerkrankung durch Belastung", lhb: false },
  { praefix: "M71", gruppe: "EX", diagnose: "Bursopathie", lhb: false },
  { praefix: "M75", gruppe: "EX", diagnose: "Schulterläsion / Rotatorenmanschette", lhb: true },
  { praefix: "M76", gruppe: "EX", diagnose: "Enthesopathie untere Extremität", lhb: false },
  { praefix: "M77", gruppe: "EX", diagnose: "Sonstige Enthesopathie", lhb: false },
  { praefix: "M79", gruppe: "CS", diagnose: "Sonstige Weichteilerkrankung / Fibromyalgie", lhb: false },
  { praefix: "M80", gruppe: "WS", diagnose: "Osteoporose mit Fraktur", lhb: true },
  { praefix: "M81", gruppe: "WS", diagnose: "Osteoporose ohne Fraktur", lhb: false },
  { praefix: "M84", gruppe: "EX", diagnose: "Knochenveränderung / Frakturheilung", lhb: false },
  { praefix: "M89", gruppe: "EX", diagnose: "Algodystrophie / Knochenkrankheit", lhb: true, bvb: "längstens 1 Jahr nach Akutereignis" },
  { praefix: "S06", gruppe: "ZN", diagnose: "Intrakranielle Verletzung / SHT", lhb: true, bvb: "Folgen ab 1 Jahr" },
  { praefix: "S09", gruppe: "ZN", diagnose: "Sonstige Kopfverletzung", lhb: false },
  { praefix: "S12", gruppe: "WS", diagnose: "Fraktur HWS", lhb: false },
  { praefix: "S13", gruppe: "WS", diagnose: "Luxation HWS", lhb: false },
  { praefix: "S14", gruppe: "ZN", diagnose: "Verletzung Nerven/Rückenmark Hals", lhb: true, bvb: "längstens 1 Jahr nach Akutereignis" },
  { praefix: "S22", gruppe: "WS", diagnose: "Fraktur Rippe / Brustwirbel", lhb: false },
  { praefix: "S24", gruppe: "ZN", diagnose: "Verletzung Nerven/Rückenmark Thorax", lhb: true, bvb: "längstens 1 Jahr nach Akutereignis" },
  { praefix: "S32", gruppe: "WS", diagnose: "Fraktur LWS / Becken", lhb: false },
  { praefix: "S33", gruppe: "WS", diagnose: "Luxation LWS / Becken", lhb: false },
  { praefix: "S34", gruppe: "ZN", diagnose: "Verletzung Nerven/Rückenmark Lumbal", lhb: true, bvb: "längstens 1 Jahr nach Akutereignis" },
  { praefix: "S40", gruppe: "EX", diagnose: "Oberflächliche Verletzung Schulter", lhb: false },
  { praefix: "S41", gruppe: "EX", diagnose: "Offene Wunde Schulter", lhb: false },
  { praefix: "S42", gruppe: "EX", diagnose: "Fraktur Schulter / Oberarm", lhb: false },
  { praefix: "S43", gruppe: "EX", diagnose: "Luxation / Verstauchung Schulter", lhb: false },
  { praefix: "S46", gruppe: "EX", diagnose: "Verletzung Muskeln/Sehnen Schulter", lhb: false },
  { praefix: "S49", gruppe: "EX", diagnose: "Sonstige Verletzung Schulter/Oberarm", lhb: false },
  { praefix: "S50", gruppe: "EX", diagnose: "Oberflächliche Verletzung Unterarm", lhb: false },
  { praefix: "S52", gruppe: "EX", diagnose: "Fraktur Unterarm (Radius/Ulna)", lhb: false },
  { praefix: "S53", gruppe: "EX", diagnose: "Luxation Ellenbogen", lhb: false },
  { praefix: "S56", gruppe: "EX", diagnose: "Verletzung Muskeln/Sehnen Unterarm", lhb: false },
  { praefix: "S60", gruppe: "EX", diagnose: "Oberflächliche Verletzung Hand", lhb: false },
  { praefix: "S62", gruppe: "EX", diagnose: "Fraktur Hand / Finger", lhb: false },
  { praefix: "S63", gruppe: "EX", diagnose: "Luxation Handgelenk / Finger", lhb: false },
  { praefix: "S66", gruppe: "EX", diagnose: "Verletzung Sehnen Hand", lhb: false },
  { praefix: "S70", gruppe: "EX", diagnose: "Oberflächliche Verletzung Hüfte", lhb: false },
  { praefix: "S71", gruppe: "EX", diagnose: "Offene Wunde Hüfte / Oberschenkel", lhb: false },
  { praefix: "S72", gruppe: "EX", diagnose: "Fraktur Femur / Hüfte", lhb: false },
  { praefix: "S73", gruppe: "EX", diagnose: "Luxation Hüftgelenk", lhb: false },
  { praefix: "S76", gruppe: "EX", diagnose: "Verletzung Muskeln/Sehnen Hüfte", lhb: false },
  { praefix: "S79", gruppe: "EX", diagnose: "Sonstige Verletzung Hüfte/Oberschenkel", lhb: false },
  { praefix: "S80", gruppe: "EX", diagnose: "Oberflächliche Verletzung Knie", lhb: false },
  { praefix: "S82", gruppe: "EX", diagnose: "Fraktur Unterschenkel / Knie", lhb: false },
  { praefix: "S83", gruppe: "EX", diagnose: "Luxation / Verstauchung Knie", lhb: false },
  { praefix: "S86", gruppe: "EX", diagnose: "Verletzung Muskeln/Sehnen Unterschenkel", lhb: false },
  { praefix: "S90", gruppe: "EX", diagnose: "Oberflächliche Verletzung Fuß", lhb: false },
  { praefix: "S92", gruppe: "EX", diagnose: "Fraktur Fuß / Zehen", lhb: false },
  { praefix: "S93", gruppe: "EX", diagnose: "Luxation Sprunggelenk", lhb: false },
  { praefix: "S96", gruppe: "EX", diagnose: "Verletzung Sehnen Fuß", lhb: false },
  { praefix: "T09", gruppe: "ZN", diagnose: "Verletzung Rückenmark (Höhe unbekannt)", lhb: true, bvb: "längstens 1 Jahr nach Akutereignis" },
  { praefix: "T90", gruppe: "ZN", diagnose: "Folgen intrakranieller Verletzung", lhb: true },
  { praefix: "T91", gruppe: "WS", diagnose: "Folgen Verletzung Hals/Rumpf", lhb: false },
  { praefix: "T93", gruppe: "EX", diagnose: "Folgen Verletzung untere Extremität", lhb: false },
  { praefix: "T84", gruppe: "EX", diagnose: "Komplikation orthopädisches Implantat", lhb: false },
  { praefix: "Q01", gruppe: "ZN", diagnose: "Enzephalozele", lhb: true },
  { praefix: "Q03", gruppe: "ZN", diagnose: "Angeborener Hydrozephalus", lhb: true },
  { praefix: "Q04", gruppe: "ZN", diagnose: "Angeborene Fehlbildung Gehirn", lhb: true },
  { praefix: "Q05", gruppe: "ZN", diagnose: "Spina bifida", lhb: true },
  { praefix: "Q06", gruppe: "ZN", diagnose: "Angeborene Fehlbildung Rückenmark", lhb: true },
  { praefix: "Q66", gruppe: "EX", diagnose: "Angeborene Fußdeformität (Klumpfuß)", lhb: true },
  { praefix: "Q71", gruppe: "EX", diagnose: "Reduktionsdefekt obere Extremität", lhb: true },
  { praefix: "Q72", gruppe: "EX", diagnose: "Reduktionsdefekt untere Extremität", lhb: true },
  { praefix: "Q78", gruppe: "WS", diagnose: "Osteogenesis imperfecta", lhb: true },
  { praefix: "Q79", gruppe: "WS", diagnose: "Ehlers-Danlos-Syndrom", lhb: true },
  { praefix: "Q82", gruppe: "LY", diagnose: "Hereditäres Lymphödem", lhb: true },
  { praefix: "Q87", gruppe: "WS", diagnose: "Marfan-Syndrom / Fehlbildungssyndrom", lhb: true },
  { praefix: "Q90", gruppe: "ZN", diagnose: "Down-Syndrom (Trisomie 21)", lhb: true },
  { praefix: "Q91", gruppe: "ZN", diagnose: "Edwards- / Patau-Syndrom", lhb: true },
  { praefix: "Q96", gruppe: "ZN", diagnose: "Turner-Syndrom", lhb: true },
  { praefix: "F00", gruppe: "ZN", diagnose: "Demenz bei Alzheimer", lhb: true },
  { praefix: "F01", gruppe: "ZN", diagnose: "Vaskuläre Demenz", lhb: true },
  { praefix: "F02", gruppe: "ZN", diagnose: "Demenz bei sonstigen Krankheiten", lhb: true },
  { praefix: "F03", gruppe: "ZN", diagnose: "Nicht näher bezeichnete Demenz", lhb: true },
  { praefix: "F84", gruppe: "ZN", diagnose: "Tiefgreifende Entwicklungsstörung / Autismus", lhb: true },
  { praefix: "F04", gruppe: "ZN", diagnose: "Organisches amnestisches Syndrom", lhb: true },
  { praefix: "F05", gruppe: "ZN", diagnose: "Delir (nicht durch Alkohol/Drogen)", lhb: false },
  { praefix: "F06", gruppe: "ZN", diagnose: "Sonstige psychische Störung durch Hirnschädigung", lhb: true },
  { praefix: "F07", gruppe: "ZN", diagnose: "Persönlichkeitsstörung durch Hirnschädigung", lhb: true },
  { praefix: "F09", gruppe: "ZN", diagnose: "Nicht näher bezeichnete organische psychische Störung", lhb: false },
  { praefix: "F25", gruppe: "ZN", diagnose: "Schizoaffektive Störung", lhb: false },
  { praefix: "F41", gruppe: "ZN", diagnose: "Angststörung", lhb: true },
  { praefix: "F45", gruppe: "CS", diagnose: "Somatoforme / chronische Schmerzstörung", lhb: true },
  { praefix: "E88", gruppe: "LY", diagnose: "Lipödem", lhb: true, bvb: "befristet bis 31.12.2027" },
  { praefix: "E74", gruppe: "ZN", diagnose: "Glykogenspeicherkrankheit", lhb: true },
  { praefix: "E84", gruppe: "AT", diagnose: "Mukoviszidose", lhb: true },
  { praefix: "C00", gruppe: "LY", diagnose: "Bösartige Neubildung Lippe/Mundhöhle/Rachen", lhb: true },
  { praefix: "C18", gruppe: "LY", diagnose: "Dickdarmkarzinom (LY-Risiko)", lhb: true },
  { praefix: "C34", gruppe: "AT", diagnose: "Bronchialkarzinom / Lungenkarzinom", lhb: true },
  { praefix: "C43", gruppe: "LY", diagnose: "Malignes Melanom", lhb: true },
  { praefix: "C44", gruppe: "EX", diagnose: "Sonstige bösartige Neubildung Haut", lhb: false },
  { praefix: "C50", gruppe: "LY", diagnose: "Mammakarzinom (LY nach OP/Radiatio)", lhb: true },
  { praefix: "C51", gruppe: "LY", diagnose: "Genitalkarzinom (LY-Risiko)", lhb: true },
  { praefix: "C53", gruppe: "LY", diagnose: "Zervixkarzinom (LY-Risiko)", lhb: true },
  { praefix: "C54", gruppe: "LY", diagnose: "Uteruskarzinom (LY-Risiko)", lhb: true },
  { praefix: "C61", gruppe: "LY", diagnose: "Prostatakarzinom (LY-Risiko)", lhb: true },
  { praefix: "C71", gruppe: "ZN", diagnose: "Bösartige Neubildung Gehirn", lhb: true, bvb: "längstens 1 Jahr nach Akutereignis" },
  { praefix: "C72", gruppe: "ZN", diagnose: "Bösartige Neubildung Rückenmark/ZNS", lhb: true, bvb: "längstens 1 Jahr nach Akutereignis" },
  { praefix: "R13", gruppe: "ZN", diagnose: "Dysphagie (Schluckstörung)", lhb: true },
  { praefix: "R26", gruppe: "WS", diagnose: "Gangstörung / Gehbeschwerden", lhb: true },
  { praefix: "R29", gruppe: "WS", diagnose: "Sturzneigung", lhb: true },
  { praefix: "R42", gruppe: "SO3", diagnose: "Schwindel und Taumel", lhb: true },
  { praefix: "R52", gruppe: "CS", diagnose: "Chronischer Schmerz", lhb: true },
  { praefix: "R64", gruppe: "ZN", diagnose: "Kachexie", lhb: true },
  { praefix: "N39", gruppe: "SO2", diagnose: "Harninkontinenz / Belastungsinkontinenz", lhb: true },
  { praefix: "R15", gruppe: "SO2", diagnose: "Stuhlinkontinenz", lhb: true },
  { praefix: "R32", gruppe: "SO2", diagnose: "Harninkontinenz", lhb: true },
  { praefix: "Z99", gruppe: "ZN", diagnose: "Abhängigkeit Respirator / Langzeitbeatmung", lhb: true },
  { praefix: "Z96", gruppe: "EX", diagnose: "Vorhandensein Gelenkprothese", lhb: false },
  { praefix: "Z89", gruppe: "EX", diagnose: "Amputation / Extremitätenverlust", lhb: true, bvb: "längstens 12 Monate nach Akutereignis" },
  { praefix: "U09", gruppe: "AT", diagnose: "Post-COVID-Syndrom", lhb: true },
  { praefix: "B94", gruppe: "ZN", diagnose: "Folgezustände Infektionskrankheiten (z.B. Virusenzephalitis)", lhb: true },
  { praefix: "B91", gruppe: "ZN", diagnose: "Folgezustände Poliomyelitis", lhb: true },
  { praefix: "B20", gruppe: "PN", diagnose: "HIV-Erkrankung mit neurologischen Folgen", lhb: false },
  { praefix: "H81", gruppe: "SO3", diagnose: "Störung der Vestibularfunktion (Schwindel)", lhb: true },
  { praefix: "H82", gruppe: "SO3", diagnose: "Schwindelsyndrom bei anderenorts klassif. Krankheit", lhb: true },
  { praefix: "H83", gruppe: "SO3", diagnose: "Sonstige Erkrankungen des Innenohrs", lhb: false },
  { praefix: "K57", gruppe: "SO1", diagnose: "Divertikulose / Divertikulitis", lhb: false },
  { praefix: "K58", gruppe: "SO1", diagnose: "Colon irritabile", lhb: false },
  { praefix: "K59", gruppe: "SO1", diagnose: "Sonstige Dickdarmfunktionsstörung", lhb: false },
  { praefix: "K92", gruppe: "SO1", diagnose: "Sonstige Krankheiten Verdauungssystem", lhb: false },
  { praefix: "L90", gruppe: "EX", diagnose: "Atrophische Hautkrankheit / Narben", lhb: false },
  { praefix: "L94", gruppe: "EX", diagnose: "Sonstige lokalisierte Bindegewebskrankheiten", lhb: false },
  { praefix: "P27", gruppe: "AT", diagnose: "Bronchopulmonale Dysplasie (Perinatalperiode)", lhb: true },
  { praefix: "E10", gruppe: "PN", diagnose: "Diabetes mellitus Typ 1 mit Neuropathie", lhb: false },
  { praefix: "E11", gruppe: "PN", diagnose: "Diabetes mellitus Typ 2 mit Neuropathie", lhb: false },
  { praefix: "E14", gruppe: "PN", diagnose: "Diabetes mellitus mit Neuropathie", lhb: false },
  { praefix: "F10", gruppe: "ZN", diagnose: "Psychische Störung durch Alkohol", lhb: false },
  { praefix: "F20", gruppe: "ZN", diagnose: "Schizophrenie", lhb: false },
  { praefix: "F32", gruppe: "ZN", diagnose: "Depressive Episode", lhb: false },
  { praefix: "F33", gruppe: "ZN", diagnose: "Rezidivierende depressive Störung", lhb: false },
  { praefix: "C79", gruppe: "ZN", diagnose: "Sekundäre bösartige Neubildung ZNS/Knochen", lhb: true },
  { praefix: "C90", gruppe: "EX", diagnose: "Multiples Myelom / Plasmazellentumoren", lhb: false },
  { praefix: "N13", gruppe: "SO2", diagnose: "Obstruktive Uropathie", lhb: false },
  { praefix: "N30", gruppe: "SO2", diagnose: "Zystitis / Blasenentzündung", lhb: false },
  { praefix: "N40", gruppe: "SO2", diagnose: "Prostatahyperplasie", lhb: false },
  { praefix: "S00", gruppe: "ZN", diagnose: "Oberflächliche Verletzung Kopf", lhb: false },
  { praefix: "S01", gruppe: "ZN", diagnose: "Offene Wunde Kopf", lhb: false },
  { praefix: "S02", gruppe: "ZN", diagnose: "Fraktur Schädel / Gesichtsschädel", lhb: false },
  { praefix: "S10", gruppe: "WS", diagnose: "Oberflächliche Verletzung Hals", lhb: false },
  { praefix: "S20", gruppe: "WS", diagnose: "Oberflächliche Verletzung Thorax", lhb: false },
  { praefix: "S30", gruppe: "WS", diagnose: "Oberflächliche Verletzung Bauch/Becken", lhb: false }
];

// Freitext-Startwörterbuch für gängige Diagnosebezeichnungen, die nicht 1:1 in den
// obigen Diagnose-Labels vorkommen. Der automatische Textabgleich gegen die Labels
// (siehe matchFreitext) deckt bereits viele Fälle ab (z.B. "Schlaganfall", "Rückenschmerzen").
const FREITEXT_SYNONYME = {
  "bandscheibenvorfall": "M51",
  "hexenschuss": "M54",
  "ischias": "M54",
  "depression": "F32",
  "ms": "G35",
  "morbus parkinson": "G20",
  "alzheimer": "F00",
  "querschnittlähmung": "T09",
  "querschnittslähmung": "T09",
  "schlaganfall": "I64",
  "apoplex": "I64",
  "hirninfarkt": "I63",
  "arthrose knie": "M17",
  "kniearthrose": "M17",
  "hüftarthrose": "M16",
  "arthrose hüfte": "M16",
  "fibromyalgie": "M79",
  "lymphoedem": "I89",
  "lipoedem": "E88",
  "copd": "J44",
  "asthma": "J45",
  "diabetes": "E11",
  "polyneuropathie": "G61",
  "schwindel": "R42",
  "sturzgefahr": "R29",
  "sturzneigung": "R29",
  "inkontinenz": "R32"
};

function stripDiacritics(value) {
  return String(value || "").normalize("NFD").replace(/[̀-ͯ]/g, "");
}

const FREITEXT_STOPWORDS = new Set([
  "der", "die", "das", "des", "dem", "den", "und", "mit", "bei", "von", "vom", "zum", "zur",
  "auf", "nach", "seit", "wegen", "durch", "ohne", "im", "am",
  "verdacht", "va", "zn", "stn", "st", "re", "li",
  "chronisch", "chronische", "chronischer", "chronisches",
  "akut", "akute", "akuter", "akutes",
  "links", "rechts", "beidseits", "beidseitig", "syndrom"
]);

// Signifikante Wörter (>= 3 Zeichen, ohne Füllwörter) für den tolerantenen
// Wort-für-Wort-Abgleich einer Freitext-Diagnose gegen Wörterbuch/Labels.
function significantWords(text) {
  return stripDiacritics(String(text || "").toLowerCase())
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !FREITEXT_STOPWORDS.has(w));
}

export function normalisiereICD(code) {
  return String(code || "").trim().toUpperCase().replace(/\s/g, "");
}

// ICD-10 AUTO-FORMAT: A00.00
export function formatICD(val) {
  const bereinigt = String(val || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 6);
  if (bereinigt.length <= 1) return bereinigt;
  if (!/^[A-Z]/.test(bereinigt)) return bereinigt.slice(0, 1);
  const buchstabe = bereinigt[0];
  const zahlen = bereinigt.slice(1).replace(/[^0-9]/g, "");
  if (zahlen.length <= 2) return buchstabe + zahlen;
  return buchstabe + zahlen.slice(0, 2) + "." + zahlen.slice(2);
}

function isIcdLike(value) {
  return /^[A-Za-z]\d{2}/.test(String(value || "").trim());
}

export function findeRegelFuerICD(code) {
  const norm = normalisiereICD(code);
  if (!norm) return null;
  const sorted = [...PRAEFIX_REGELN].sort((a, b) => b.praefix.length - a.praefix.length);
  return sorted.find((r) => norm.startsWith(r.praefix)) || null;
}

// Textabgleich einer Freitext-Diagnose gegen die hinterlegten Diagnose-Labels
// und das Synonym-Wörterbuch. Wort-für-Wort statt nur Gesamt-String-Vergleich,
// damit z.B. "chronische Rückenschmerzen" oder "Knie Arthrose" (andere
// Wortreihenfolge / zusätzliche Wörter) ebenfalls erkannt werden.
export function matchFreitext(text) {
  const raw = stripDiacritics(String(text || "").trim().toLowerCase());
  if (!raw) return null;
  const rawNoSpace = raw.replace(/\s+/g, "");
  const eingabeWoerter = significantWords(text);

  // 1) Synonym-Wörterbuch: Ganzwort-Substring (bisheriges Verhalten) oder
  // Übereinstimmung ohne Leerzeichen (z.B. "Knie Arthrose" -> "kniearthrose").
  for (const [keyword, praefix] of Object.entries(FREITEXT_SYNONYME)) {
    const keywordNorm = stripDiacritics(keyword);
    if (raw.includes(keywordNorm) || rawNoSpace.includes(keywordNorm.replace(/\s+/g, ""))) {
      const regel = PRAEFIX_REGELN.find((r) => r.praefix === praefix);
      if (regel) return regel;
    }
  }

  if (eingabeWoerter.length === 0) return null;

  // Zwei Wörter gelten als gleich, wenn sie identisch sind, oder wenn das
  // kürzere (ab 6 Zeichen, um generische Wortstämme wie "schmerz" als
  // Fehltreffer auszuschließen) ein Präfix des längeren ist, z.B.
  // "schulter" -> "schulterlaesion".
  function woerterGleich(w1, w2) {
    if (w1 === w2) return true;
    const kurz = w1.length <= w2.length ? w1 : w2;
    const lang = w1.length <= w2.length ? w2 : w1;
    return kurz.length >= 6 && lang.startsWith(kurz);
  }

  // 2) Diagnose-Labels: alle signifikanten Wörter der kürzeren Seite (Eingabe
  // oder Label) müssen in der jeweils anderen Seite vorkommen.
  let bester = null;
  let besterScore = 0;
  for (const regel of PRAEFIX_REGELN) {
    const labelWoerter = significantWords(regel.diagnose);
    if (labelWoerter.length === 0) continue;

    const kuerzer = eingabeWoerter.length <= labelWoerter.length ? eingabeWoerter : labelWoerter;
    const laenger = eingabeWoerter.length <= labelWoerter.length ? labelWoerter : eingabeWoerter;
    const vollstaendigEnthalten = kuerzer.every((w) => laenger.some((lw) => woerterGleich(w, lw)));

    if (vollstaendigEnthalten && kuerzer.length > besterScore) {
      bester = regel;
      besterScore = kuerzer.length;
    }
  }
  if (bester) return bester;

  // 3) Fallback: gesamte Eingabe als Substring des Labels oder umgekehrt.
  const treffer = PRAEFIX_REGELN.find((r) => {
    const diagnoseLower = stripDiacritics(r.diagnose.toLowerCase());
    return diagnoseLower.includes(raw) || raw.includes(diagnoseLower);
  });

  return treffer || null;
}

// Löst eine Diagnose-Eingabe (ICD-10 oder Freitext) in einen ICD-10-Code auf.
export function resolveDiagnoseInput(input) {
  const raw = String(input || "").trim();
  if (!raw) return null;

  if (isIcdLike(raw)) {
    return { icd10: normalisiereICD(raw), eingabe: raw, quelle: "icd10" };
  }

  const regel = matchFreitext(raw);
  if (regel) {
    return { icd10: regel.praefix, eingabe: raw, quelle: "freitext" };
  }

  return { icd10: normalisiereICD(raw), eingabe: raw, quelle: "freitext-unbekannt" };
}

// Kernlogik: aus einer Liste ICD-10-Codes (oder {icd10, eingabe, quelle}-Objekten,
// siehe optimiereVerordnung) + Zertifikatsprofil die optimale Verordnung ermitteln.
// eingabe/quelle werden direkt an jedes Ergebnis gehängt, BEVOR sortiert wird -
// so bleibt die Zuordnung zum Originaltext auch nach dem Sortieren nach 'rang'
// korrekt (vorher wurden eingabe/quelle erst danach rein positionsbasiert
// zugeordnet, was bei einer Umsortierung zu vertauschten Diagnosetexten führte).
export function berechneOptimum(icdCodes, zertifikate) {
  const profil = zertifikate || {};
  const ergebnisse = [];

  for (const rawEntry of icdCodes || []) {
    const entry = typeof rawEntry === "string" ? { icd10: rawEntry } : (rawEntry || {});
    const code = normalisiereICD(entry.icd10);
    const eingabe = entry.eingabe || code;
    const quelle = entry.quelle || "icd10";
    const regel = findeRegelFuerICD(code);

    if (!regel) {
      ergebnisse.push({ icd: code, eingabe, quelle, unbekannt: true });
      continue;
    }

    const gruppe = regel.gruppe;
    const katalog = HEILMITTEL_KATALOG[gruppe];
    if (!katalog) continue;

    let empfehlung = "KG";
    let rang = 4;

    if (gruppe === "ZN" && profil.kgzns) { empfehlung = "KgZNS"; rang = 1; }
    else if ((gruppe === "WS" || gruppe === "EX") && profil.mt) { empfehlung = "MT"; rang = 2; }
    else if (gruppe === "LY" && profil.mld) { empfehlung = "MLD"; rang = 3; }

    ergebnisse.push({
      icd: code,
      eingabe,
      quelle,
      diagnose: regel.diagnose,
      gruppe,
      gruppeLabel: katalog.label,
      empfehlung,
      rang,
      maxProVO: katalog.maxProVO,
      orientierendeMenge: katalog.orientierendeMenge,
      lhb: regel.lhb || false,
      bvb: regel.bvb || null,
      unbekannt: false
    });
  }

  ergebnisse.sort((a, b) => {
    if (a.unbekannt) return 1;
    if (b.unbekannt) return -1;
    return a.rang - b.rang;
  });

  return ergebnisse;
}

// High-Level-Einstieg für die UI: nimmt rohe Diagnose-Eingaben (Freitext ODER ICD-10),
// löst sie auf und berechnet die Empfehlung je Eingabe.
export function optimiereVerordnung(diagnoseInputs, zertifikate) {
  const resolved = (diagnoseInputs || []).map(resolveDiagnoseInput).filter(Boolean);
  return berechneOptimum(resolved, zertifikate);
}

export function getDefaultLeitsymptomatik(gruppe) {
  return gruppe === "ZN"
    ? "a) Schädigung der Bewegungs- und Sinnesfunktion"
    : "a) Schädigung der Gelenkfunktion / Muskelkraft";
}
