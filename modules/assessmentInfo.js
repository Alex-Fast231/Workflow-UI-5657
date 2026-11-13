// Kurzinformationen (Durchführung + Werteinterpretation) zu den im
// Assessment-Wizard verwendeten standardisierten Testverfahren. Stichpunkte,
// keine wörtliche Wiedergabe lizenzierter Originalinstrumente (z.B. RMI) -
// dient als schnelle Erinnerungsstütze im Alltag, ersetzt keine Schulung.
// Die genannten Wertebereiche/Einstufungen entsprechen den in
// modules/assessment.js hinterlegten classify*()-Funktionen.

export const TEST_INFO = {
  barthel: {
    title: "Barthel-Index",
    durchfuehrung: [
      "Erfasst 10 Alltagsbereiche: Essen, Baden, Körperpflege, An-/Auskleiden, Stuhlkontinenz, Harnkontinenz, Toilettenbenutzung, Bett-/Stuhltransfer, Gehen, Treppensteigen",
      "Bewertet wird die tatsächlich gezeigte Leistung (Beobachtung), nicht das theoretisch Mögliche",
      "Fremdanamnese durch Pflegepersonal/Angehörige ist zulässig, wenn eigene Beobachtung nicht möglich ist",
      "Punktevergabe je Kategorie gestuft (0/5/10/15) nach Grad der benötigten Hilfe"
    ],
    interpretation: [
      "Gesamtscore 0-100 Punkte (in 5er-Schritten)",
      "100 Punkte: vollständig selbstständig",
      "65-99 Punkte: leichte Einschränkung",
      "45-64 Punkte: erhebliche Einschränkung, Unterstützungsbedarf im Alltag",
      "unter 45 Punkte: schwere Pflegebedürftigkeit"
    ]
  },

  nrs: {
    title: "NRS – Numerische Schmerzskala",
    durchfuehrung: [
      "Patient schätzt die aktuelle Schmerzstärke selbst auf einer Skala von 0 (kein Schmerz) bis 10 (stärkster vorstellbarer Schmerz) ein",
      "Nur bei ausreichend kommunikationsfähigen Patienten anwendbar (sonst BESD verwenden)",
      "Kann auf eine konkrete Situation bezogen werden, z.B. „Schmerz gerade jetzt“ oder „bei Bewegung“"
    ],
    interpretation: [
      "0: kein Schmerz",
      "1-3: leichter Schmerz",
      "4-6: mittlerer Schmerz, behandlungsrelevant",
      "7-10: starker Schmerz, dringender Handlungsbedarf"
    ]
  },

  besd: {
    title: "BESD – Beurteilung von Schmerzen bei Demenz",
    durchfuehrung: [
      "Für Patienten mit stark eingeschränkter verbaler Kommunikation (z.B. fortgeschrittene Demenz) – reines Fremdbeobachtungsinstrument",
      "Patient wird ca. 2 Minuten beobachtet, idealerweise während bzw. kurz nach Bewegung oder Lagerung (Schmerz zeigt sich oft erst bei Belastung)",
      "5 Kategorien werden je 0-2 Punkte bewertet: Atmung, Lautäußerungen, Gesichtsausdruck, Körpersprache, Reaktion auf Trost"
    ],
    interpretation: [
      "Gesamtscore 0-10 Punkte",
      "ab 4 Punkten: Hinweis auf behandlungsbedürftigen Schmerz, Schmerzbehandlung indiziert",
      "unter 4 Punkten: aktuell kein dringender Handlungsbedarf, weiter beobachten"
    ]
  },

  tug: {
    title: "TUG – Timed Up and Go",
    durchfuehrung: [
      "Patient sitzt auf einem Stuhl mit Armlehnen, steht auf Kommando auf, geht 3 Meter, dreht um, geht zurück und setzt sich wieder hin",
      "Zeit wird ab dem Startkommando bis zum vollständigen Wiederhinsetzen gestoppt",
      "Gewohntes Hilfsmittel (Rollator, Stock) darf verwendet werden und sollte notiert werden",
      "Ein Übungsdurchgang vorab ist erlaubt"
    ],
    interpretation: [
      "unter 12 Sekunden: unauffällig",
      "12-20 Sekunden: erhöhtes Sturzrisiko",
      "über 20 Sekunden: hohes Sturzrisiko"
    ]
  },

  bbs7: {
    title: "BBS-7 – Berg Balance Scale (Kurzform)",
    durchfuehrung: [
      "7-Item-Kurzform der ursprünglichen 14-Item Berg Balance Scale, prüft funktionelles Gleichgewicht",
      "Items: Aufstehen vom Sitzen, freies Stehen 2 Min., freies Sitzen 2 Min., kontrolliertes Hinsetzen, Transfer, Stehen mit geschlossenen Augen 10 Sek., Stehen mit geschlossenen Füßen 30 Sek.",
      "Jedes Item wird mit 0-4 Punkten bewertet (0 = nicht möglich, 4 = sicher/selbstständig)",
      "Aus anderen Gründen nicht durchführbare Items (z.B. Rollstuhlpflichtigkeit) können als „nicht durchführbar“ markiert werden"
    ],
    interpretation: [
      "Gesamtscore max. 28 Punkte (bei allen 7 durchführbaren Items)",
      "ab 21 Punkten: geringes Sturzrisiko",
      "11-20 Punkte: mittleres Sturzrisiko",
      "unter 11 Punkte: hohes Sturzrisiko"
    ]
  },

  bbs14: {
    title: "Berg-Balance-Test (BBS, vollständige 14-Item-Version)",
    durchfuehrung: [
      "Vollständige, standardisierte 14-Item-Version der Berg Balance Scale zur Prüfung des funktionellen Gleichgewichts",
      "Jedes Item wird mit 0-4 Punkten bewertet - die konkrete Bedeutung jeder Punktzahl steht direkt bei jedem Item in der Erfassung",
      "Items, die aus anderen Gründen nicht durchführbar sind (z.B. Rollstuhlpflichtigkeit), können als „nicht durchführbar“ markiert werden und zählen dann nicht in die erreichbare Höchstpunktzahl"
    ],
    interpretation: [
      "Gesamtscore max. 56 Punkte (bei allen 14 durchführbaren Items)",
      "41-56 Punkte: geringes Sturzrisiko, weitgehend selbstständig",
      "21-40 Punkte: mittleres Sturzrisiko, Gehen mit Unterstützung",
      "0-20 Punkte: hohes Sturzrisiko, meist rollstuhlpflichtig"
    ]
  },

  rmi: {
    title: "RMI – Rivermead Mobility Index",
    durchfuehrung: [
      "Erfasst die funktionelle Mobilität anhand von 14 Fragen zu Alltagsbewegungen (Bettmobilität, Sitzen, Stehen, Transfer, Gehen drinnen/draußen, Treppen, Bücken u.a.) plus 1 direkter Beobachtung",
      "Fragen werden dem Patienten gestellt bzw. anhand tatsächlicher Beobachtung oder Fremdanamnese beantwortet",
      "Jede erfüllte Frage zählt 1 Punkt"
    ],
    interpretation: [
      "Gesamtscore max. 15 Punkte",
      "15 Punkte: volle funktionelle Mobilität",
      "7-14 Punkte: teilweise eingeschränkte Mobilität",
      "unter 7 Punkte: stark eingeschränkte Mobilität"
    ]
  },

  mrc: {
    title: "MRC-Kraftgrad-Skala",
    durchfuehrung: [
      "Manuelle Kraftprüfung einzelner Muskelgruppen (Schulter, Ellbogen, Hüfte, Knie), jeweils links und rechts getrennt",
      "Patient bewegt/hält die Extremität aktiv gegen die Schwerkraft bzw. gegen manuellen Widerstand des Therapeuten",
      "Testposition (Sitzen oder Liegen) wird beim Erstassessment festgelegt und danach beibehalten, damit Folgeassessments vergleichbar bleiben",
      "Zusätzlich wird auf Spastik geachtet (keine / links / rechts / beidseitig)"
    ],
    interpretation: [
      "5 = normale Kraft",
      "4 = Bewegung gegen Widerstand möglich, aber abgeschwächt",
      "3 = Bewegung gegen Schwerkraft möglich, aber nicht gegen Widerstand",
      "2 = Bewegung nur bei Schwerkraftausschaltung möglich",
      "1 = sicht-/tastbare Muskelkontraktion ohne sichtbaren Bewegungseffekt",
      "0 = keine Muskelaktivität erkennbar"
    ]
  },

  sppb: {
    title: "SPPB – Short Physical Performance Battery",
    durchfuehrung: [
      "Standardisierte Testbatterie aus 3 Teilen: Balance-Test (Seit-an-Seit-Stand, Semitandem, Tandemstand, je bis 10 Sek.), Gehgeschwindigkeit über 4 Meter, Chair-Rise-Test (5x aus dem Sitzen aufstehen, Zeit stoppen)",
      "Bei Nichtdurchführbarkeit eines Teiltests wird dieser mit 0 Punkten gewertet"
    ],
    interpretation: [
      "Gesamtscore 0-12 Punkte (3 Teiltests je 0-4 Punkte)",
      "10-12 Punkte: unauffällig",
      "7-9 Punkte: leicht eingeschränkt",
      "4-6 Punkte: mittel eingeschränkt",
      "0-3 Punkte: stark eingeschränkt, hohes Sarkopenie-/Sturzrisiko"
    ]
  },

  romAktiv: {
    title: "Aktive Beweglichkeitsprüfung (ROM aktiv)",
    durchfuehrung: [
      "Patient bewegt das jeweilige Gelenk selbstständig/aktiv in der vorgegebenen Bewegungsrichtung (z.B. Arme über den Kopf heben, Kopf drehen, Rumpf beugen)",
      "Nur die ausgewählten, für die Fragestellung relevanten Gelenke werden getestet",
      "Beobachtet wird das tatsächlich erreichte Bewegungsausmaß, wenn möglich im Seitenvergleich"
    ],
    interpretation: [
      "Frei: unauffälliges, alterstypisches Bewegungsausmaß",
      "Eingeschränkt: Bewegungsausmaß spürbar reduziert, aber noch vorhanden",
      "Aufgehoben: keine aktive Bewegung im Gelenk möglich"
    ]
  },

  romPassiv: {
    title: "Passive Beweglichkeitsprüfung (ROM passiv)",
    durchfuehrung: [
      "Therapeut bewegt das Gelenk des entspannten Patienten passiv – typischerweise bei stark eingeschränkten/bettlägerigen Patienten eingesetzt",
      "Vorsichtiges, langsames Bewegen bis zum spürbaren Widerstand, keine forcierte Dehnung",
      "Zusätzlich wird erfasst, ob bei der Bewegung Schmerz auftritt und ob spastischer Widerstand spürbar ist"
    ],
    interpretation: [
      "Frei / Eingeschränkt / Aufgehoben – wie bei der aktiven Prüfung, hier jedoch fremdgeführt",
      "Schmerz bei Bewegung und Spastik/Widerstand werden zusätzlich dokumentiert und fließen in die Gesamteinschätzung ein"
    ]
  },

  kontrakturenDekubitus: {
    title: "Kontrakturen & Dekubitusrisiko",
    durchfuehrung: [
      "Kontrakturen: Prüfung, ob in bestimmten Gelenkstellungen eine dauerhafte Bewegungseinschränkung durch Verkürzung von Muskeln, Sehnen oder Gelenkkapsel vorliegt; betroffene Gelenke einzeln dokumentieren",
      "Dekubitusrisiko: klinische Einschätzung anhand von Mobilität, Hautzustand, Ernährungszustand und Feuchtigkeitsexposition (orientiert an gängigen Risikoskalen wie z.B. Braden-Skala), besonders relevant bei bettlägerigen/immobilen Patienten"
    ],
    interpretation: [
      "Kontrakturen vorhanden: betroffene Gelenke werden gelistet, erhöhter Handlungsbedarf für Mobilisation/Dehnung",
      "Dekubitusrisiko „Ja“: engmaschigere Hautkontrolle, Lagerungsmanagement und Präventionsmaßnahmen empfohlen"
    ]
  }
};
