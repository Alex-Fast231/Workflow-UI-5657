// ─────────────────────────────────────────────────────────────────────────
// HILFE-INHALT – Text der Support-Seite (Dashboard → „🆘 Support")
// ─────────────────────────────────────────────────────────────────────────
//
// Diese Datei enthält den kompletten Leitfaden-Text, wortgleich aus dem
// PDF "FaSt-App-Leitfaden" übernommen. Die Support-Seite (ui/views.js,
// showSupportView) baut daraus automatisch Inhaltsverzeichnis, aufklappbare
// Kapitel und die Suche. An der Darstellung/Logik muss dafür nichts
// angepasst werden – nur diese Datei hier.
//
// AUFBAU
// ------
// HILFE_KAPITEL ist eine Liste von Kapiteln. Jedes Kapitel hat:
//   nummer        Kapitelnummer als Text, z. B. "1", "10"
//   titel         Kapitelüberschrift
//   abschnitte    Liste von Abschnitten in diesem Kapitel
//
// Jeder Abschnitt hat:
//   anker         Sprungziel-ID. Muss zu den Ankern aus der Datei
//                 "support-suchbegriffe-physio.json" passen (siehe unten).
//   titel         Abschnittsüberschrift
//   stichwoerter  Liste zusätzlicher Suchbegriffe für diesen Abschnitt
//                 (auch Umgangssprache, Abkürzungen, Schreibweisen ohne
//                 Umlaute). Diese Wörter müssen NICHT im Text vorkommen –
//                 wer sie in die Suche eintippt, findet den Abschnitt
//                 trotzdem.
//   bloecke       Der eigentliche Text, als Liste von Bausteinen (siehe
//                 unten). So bleiben Tabellen echte Tabellen und
//                 nummerierte Schritte echte nummerierte Listen, ohne dass
//                 im Text selbst HTML geschrieben werden muss.
//
// BAUSTEIN-TYPEN (für "bloecke")
// -------------------------------
//   { typ: "text", text: `...` }
//       Ein normaler Absatz. Zwei Sternchen **so** machen ein Wort fett
//       (genau wie in der Leitfaden-Vorlage).
//
//   { typ: "ueberschrift", text: `...` }
//       Eine kleine Zwischenüberschrift innerhalb eines Abschnitts.
//
//   { typ: "liste", items: [ `...`, `...` ] }
//       Eine Aufzählung mit Punkten (keine Reihenfolge).
//
//   { typ: "schritte", items: [ `...`, `...` ] }
//       Eine nummerierte Schritt-für-Schritt-Anleitung.
//
//   { typ: "tabelle", kopf: [ `Spalte 1`, `Spalte 2` ],
//     zeilen: [ [ `...`, `...` ], [ `...`, `...` ] ] }
//       Eine Tabelle. "kopf" sind die Spaltenüberschriften, "zeilen" die
//       Datenzeilen (jede Zeile ein Array mit genauso vielen Einträgen wie
//       "kopf").
//
// EINEN ABSCHNITT ÄNDERN
// -----------------------
// Einfach den Text im passenden Baustein anpassen. Anker und Reihenfolge
// bitte nicht verändern, sonst funktionieren Inhaltsverzeichnis-Sprünge und
// die erwarteten Suchtreffer nicht mehr.
//
// EINEN NEUEN ABSCHNITT HINZUFÜGEN
// ----------------------------------
// 1. In "abschnitte" des passenden Kapitels ein neues Objekt mit anker,
//    titel, stichwoerter und bloecke ergänzen.
// 2. Fertig – die Seite übernimmt den neuen Abschnitt automatisch in
//    Inhaltsverzeichnis, Anzeige und Suche.
//
// WICHTIG: Kapitel 20 ("Support") beschreibt noch die frühere externe
// Webseite. Dieser Text wurde absichtlich NICHT verändert, siehe
// Abschlussbericht.
// ─────────────────────────────────────────────────────────────────────────

export const HILFE_KAPITEL = [
  {
    nummer: "1",
    titel: "Dashboard-Überblick",
    abschnitte: [
      {
        anker: "1",
        titel: "Dashboard-Überblick",
        stichwoerter: ["dashboard", "startseite", "startbildschirm", "hauptmenü", "hauptmenue", "übersicht", "uebersicht", "buttons", "kacheln", "bereiche", "stunden heute", "patienten heute", "warnkarte"],
        bloecke: [
          { typ: "text", text: `Nach dem Einloggen öffnet sich das **Dashboard** mit folgendem Aufbau von oben nach unten:` },
          { typ: "liste", items: [
            `**Kopfkarte**: Überschrift „Dashboard", darunter das aktuelle Datum und „Willkommen, [Therapeutenname]." Rechts oben befindet sich das Zahnrad-Symbol ⚙️ zum Öffnen der Einstellungen.`,
            `**Warnkarte „Zuzahlungsstatus ungeklärt"** (nur sichtbar, wenn fällig): Für jeden betroffenen Patienten erscheint die Zeile „Zuzahlungsstatus ungeklärt – Patient [Name]" mit einem Button **„Jetzt klären"**, der direkt zur Zuzahlungsabfrage führt.`,
            `**Warnkarte „Assessment fällig"** (nur sichtbar, wenn fällig): Für jeden betroffenen Patienten erscheint „Assessment fällig – Patient [Name]" mit zwei Buttons: **„Jetzt durchführen"** und **„Verschieben"**.`,
            `**Aufklappbarer Bereich „Überblick"**: zeigt die Kachel „Stunden heute" mit der heute erfassten Zeit, darunter den Button **„📊 Stundenkonto"**. Ebenfalls aufklappbar: **„Patienten heute"** mit der Liste aller Patienten, bei denen heute schon Zeit erfasst wurde.`,
            `**Karte „Bereiche"** mit allen Haupt-Buttons (Tabelle unten).`,
            `**Aufklappbarer Bereich „Backup"** (Beschriftung: „Export / Import") mit den Buttons „Backup exportieren" und „Backup importieren" – siehe Abschnitt 19.`,
            `**Aufklappbarer Bereich „App zurücksetzen"** mit dem Button „Alles löschen und neu starten" (nur im Notfall verwenden).`
          ]},
          { typ: "ueberschrift", text: `Die Dashboard-Buttons im Bereich „Bereiche"` },
          { typ: "tabelle", kopf: [`Button`, `Führt zu`], zeilen: [
            [`📝 Doku`, `SchnellDoku-Patientenliste (siehe Abschnitt 5)`],
            [`⏱ Zeiterfassung`, `Zeit buchen: Heim → Patient → Rezept (siehe Abschnitt 7)`],
            [`Einrichtungen`, `Liste aller Einrichtungen/Heime (siehe Abschnitt 2)`],
            [`👤 Patienten`, `Einrichtungsübergreifende, alphabetische Patientenliste mit Suche`],
            [`Abgabeliste`, `Rezepte zur Abgabe/Abrechnung markieren (siehe Abschnitt 12)`],
            [`Nachbestellung`, `Nachbestellzettel an Ärzte (siehe Abschnitt 11)`],
            [`Kilometer`, `Kilometererfassung für Hausbesuchsfahrten (siehe Abschnitt 14)`],
            [`👨‍⚕️ Ärzte`, `Ärzteübersicht (siehe Abschnitt 13)`],
            [`Unterschriften`, `Öffnet direkt das Unterschriftenblatt-PDF (siehe Abschnitt 17)`],
            [`🤒 Krank / Urlaub`, `Abwesenheit melden (siehe Abschnitt 15)`],
            [`✉️ Freikuvert`, `Freikuvert bestellen (siehe Abschnitt 16)`],
            [`📋 Assessment`, `Assessment starten (siehe Abschnitt 9)`],
            [`❓ FAQ`, `Enthält den **Fristenrechner** sowie Nachschlagetabellen (siehe Abschnitt 4)`],
            [`🆘 Support`, `Öffnet die externe Support-Webseite in einem neuen Tab`],
            [`⚙️ (oben rechts)`, `Einstellungen (siehe Abschnitt 18)`],
            [`📊 Stundenkonto (im Bereich „Überblick")`, `Stundenkonto-Ansicht (siehe Abschnitt 8)`]
          ]}
        ]
      },
      {
        anker: "1-app-zuruecksetzen",
        titel: "App zurücksetzen",
        stichwoerter: ["zurücksetzen", "zuruecksetzen", "alles löschen", "alles loeschen", "neu starten", "reset", "app leeren"],
        bloecke: [
          { typ: "text", text: `Aufklappbarer Bereich „App zurücksetzen" mit dem Button „Alles löschen und neu starten" (nur im Notfall verwenden).` }
        ]
      }
    ]
  },

  {
    nummer: "2",
    titel: "Einrichtungen & Patienten verwalten",
    abschnitte: [
      {
        anker: "2.1",
        titel: "Neue Einrichtung anlegen",
        stichwoerter: ["einrichtung anlegen", "heim anlegen", "neues heim", "neue einrichtung", "altenheim anlegen", "pflegeheim anlegen", "hb-pauschale", "hbhp", "verwaltungs-e-mail", "einrichtung bearbeiten", "heim löschen", "einrichtung löschen"],
        bloecke: [
          { typ: "schritte", items: [
            `Im Dashboard auf **„Einrichtungen"** klicken.`,
            `In der Karte „Heimübersicht" den Bereich **„Neues Heim anlegen"** aufklappen.`,
            `Felder ausfüllen: **„Name"**, **„Adresse"**, **„Verwaltungs-E-Mail"**.`,
            `Unter **„HB-Pauschale"** zwischen **„HB"** und **„HBHP"** wählen (Standard: HB).`,
            `Auf **„Heim speichern"** klicken.`
          ]},
          { typ: "text", text: `Über das Stift-Symbol ✎ an jeder Einrichtung lassen sich dieselben Felder nachträglich ändern (Button „Speichern") oder die Einrichtung über „Heim löschen" entfernen (mit Sicherheitsabfrage – löscht auch alle zugehörigen Patienten, Rezepte und Dokumentationen).` }
        ]
      },
      {
        anker: "2.2",
        titel: "Neuen Patienten + Erstrezept anlegen",
        stichwoerter: ["patient anlegen", "neuer patient", "neuen patienten", "patient hinzufügen", "patient hinzufuegen", "erstrezept", "anrede", "neuaufnahme"],
        bloecke: [
          { typ: "schritte", items: [
            `Dashboard → **„Einrichtungen"** → gewünschte Einrichtung anklicken.`,
            `Dort auf **„Neuen Patienten + Rezept anlegen"** klicken.`,
            `Im Bereich **„Patient"**: Nachname, Vorname, **„Anrede"** (Keine Angabe / Frau / Herr – wird für die automatische Anrede im Arztbericht genutzt), Geburtsdatum (TT.MM.JJJJ).`,
            `Im Bereich **„Rezept"** alle Rezeptfelder ausfüllen (siehe Abschnitt 3).`,
            `Auf **„Patient + Rezept speichern"** klicken.`,
            `Die App fragt danach automatisch, ob der Patient zuzahlungsbefreit ist, und führt direkt zum Assessment-Einstieg weiter.`
          ]},
          { typ: "text", text: `Fehlt Vor- **und** Nachname, erscheint „Bitte mindestens einen Namen für den Patienten eingeben." Fehlt eine Leistung, erscheint „Bitte mindestens eine Leistung angeben."` }
        ]
      },
      {
        anker: "2.3",
        titel: "Bestehenden Patienten finden/öffnen",
        stichwoerter: ["patient finden", "patient suchen", "patientensuche", "patientenliste", "alle patienten", "ausgeschieden verstorben liste"],
        bloecke: [
          { typ: "text", text: `Zwei Wege:` },
          { typ: "liste", items: [
            `**Über die Einrichtung**: Dashboard → „Einrichtungen" → Einrichtung anklicken → in der Patientenübersicht suchen (Suchfeld „Suche nach Name oder Geburtsdatum") oder den Patienten direkt aufklappen.`,
            `**Über die Gesamt-Patientenliste**: Dashboard → **„👤 Patienten"** → Suchfeld „Suche nach Name, Geburtsdatum oder Einrichtung" nutzen. Jeder Patient zeigt drei Buttons: **„Rezept"**, **„Rezeptoptimierer"**, **„Arztbericht"**.`
          ]},
          { typ: "text", text: `In der Gesamt-Patientenliste gibt es außerdem **oben** einen eigenen, eingeklappten Bereich **„Ausgeschieden / Verstorben"**, der ausschließlich diese Patienten getrennt von der aktiven Liste auflistet.` }
        ]
      },
      {
        anker: "2.4",
        titel: "Markierungen in der Patientenübersicht",
        stichwoerter: ["markierung", "befreit markierung", "kennzeichnung", "label"],
        bloecke: [
          { typ: "text", text: `Beim Aufklappen eines Patienten in der Einrichtungs-Ansicht erscheinen ggf. folgende Markierungen: **„Befreit"** (zuzahlungsbefreit), **„Verstorben"**, **„Ausgeschieden"**. Darunter drei Bereichs-Buttons: **„Rezept"**, **„Stammdaten"**, **„SchnellDoku"**.` }
        ]
      },
      {
        anker: "2.5",
        titel: "Stammdaten eines Patienten bearbeiten",
        stichwoerter: ["stammdaten", "patient bearbeiten", "geburtsdatum ändern", "name ändern", "verstorben", "ausgeschieden", "entlassen", "patient löschen", "patient loeschen", "zuzahlungsstatus ändern"],
        bloecke: [
          { typ: "schritte", items: [
            `Patient aufklappen → Button **„Stammdaten"**.`,
            `Felder: Nachname, Vorname, Geburtsdatum.`,
            `Checkboxen **„Verstorben"** und **„Ausgeschieden"** (Hinweis dazu im Formular: *„'Ausgeschieden' löscht den Patienten nicht, gilt aber nicht mehr als aktiv – keine Nachbestellungs-, Zuzahlungs- oder Assessment-Erinnerungen mehr."*).`,
            `Feld **„Zuzahlungsstatus"**: Nicht angegeben / Ja, zuzahlungsbefreit / Nein / Noch nicht geklärt.`,
            `Auf **„Stammdaten speichern"** klicken.`
          ]},
          { typ: "text", text: `Ganz unten: Button **„Patient löschen"** (mit Sicherheitsabfrage – löscht auch alle Rezepte und Dokumentationen).` }
        ]
      }
    ]
  },

  {
    nummer: "3",
    titel: "Rezepte anlegen, bearbeiten, einsehen",
    abschnitte: [
      {
        anker: "3.1",
        titel: "Neues Rezept anlegen – Schritt für Schritt",
        stichwoerter: ["rezept anlegen", "neues rezept", "verordnung anlegen", "vo anlegen", "rezept eingeben", "rezept eintragen", "icd", "icd-10", "leitsymptomatik", "leistung hinzufügen", "heilmittel", "privatrezept", "privat", "bg", "doppeltermin", "dringender bedarf", "hausbesuch", "arztstempel", "unterschrift arzt"],
        bloecke: [
          { typ: "text", text: `Erreichbar über Einrichtung → Patient → Bereich „Rezept" → **„Neues Rezept anlegen"**.` },
          { typ: "schritte", items: [
            `**Arzt** (Freitext mit Vorschlagsliste bereits bekannter Ärzte).`,
            `**Arztadresse, PLZ, Ort, E-Mail (für Nachbestellung per Mail)** – werden automatisch befüllt, wenn der Arztname exakt übereinstimmt.`,
            `**Ausstellungsdatum** (TT.MM.JJJJ).`,
            `**ICD-10 Code** und optional **„2. ICD-10 Code (optional)"**.`,
            `**Leitsymptomatik**: Kästchen A, B, C sowie „Patient individuell" mit Freitextfeld.`,
            `Bereich **„Leistungen"**: Dropdown „Leistung" (KG, MT, KG-ZNS, KG-Atemtherapie, MLD30, MLD45, MLD60, Blanko) und Feld „Anzahl". Über **„Leistung hinzufügen"** weitere Zeilen ergänzen.`,
            `Checkboxen: **„🔒 Privat (keine Prüfung nötig)"**, **„BG"**, **„Doppeltermin"**, **„Dringender Bedarf"**.`,
            `**Hausbesuch** (Ja/Nein), **Arzt-Stempel vorhanden** (Ja/Nein), **Arzt-Unterschrift vorhanden** (Ja/Nein).`,
            `Direkt darunter erscheint automatisch die Fristen-/Pflichtfeldprüfung (siehe Abschnitt 4).`,
            `Auf **„Rezept speichern"** klicken.`
          ]}
        ]
      },
      {
        anker: "3.2",
        titel: "Rezept bearbeiten",
        stichwoerter: ["rezept bearbeiten", "rezept ändern", "rezept aendern", "rezept korrigieren", "rezept löschen", "rezept loeschen", "verordnung ändern"],
        bloecke: [
          { typ: "text", text: `Einrichtung → Patient → Rezept aufklappen → **„Bearbeiten"**. Gleiche Felder wie beim Neuanlegen, bereits ausgefüllt. Unten: **„Änderungen speichern"** und **„Rezept löschen"** (mit Sicherheitsabfrage).` }
        ]
      },
      {
        anker: "3.3",
        titel: `Rezept-Detailansicht („Dokumentieren")`,
        stichwoerter: ["rezeptdetails", "rezeptdaten", "rezeptstatus", "als abgegeben markieren", "einträge ansehen", "eintrag bearbeiten", "eintrag löschen", "doku löschen"],
        bloecke: [
          { typ: "text", text: `Einrichtung → Patient → Rezept aufklappen → **„Dokumentieren"** öffnet: Karte „Rezeptprüfung", aufklappbar „Rezeptdaten" (alle Felder im Klartext), aufklappbar „Fristenhinweis" (Status, Hinweis, Spätester Beginn, Gültig bis), Karte „Rezeptstatus" mit **„Rezept als abgegeben markieren"**, und aufklappbar „Vorhandene Einträge" (je mit „Eintrag bearbeiten" / „Eintrag löschen").` }
        ]
      },
      {
        anker: "3.4",
        titel: "Rezept ohne vollständige Angaben anlegen",
        stichwoerter: ["rezept unvollständig", "rezept unvollstaendig", "ohne rezept", "kein rezept", "rezept fehlt", "leeres rezept", "rezept nachtragen", "rezept später"],
        bloecke: [
          { typ: "text", text: `Wenn ein Rezept noch nicht fertig eingetippt werden kann (z. B. aus Zeitgründen), reicht es, dass **überhaupt ein Rezept existiert**, damit Zeit gebucht oder dokumentiert werden kann. Dafür legen die Buttons **„Zeit ohne Rezept-Angaben buchen"** (Zeiterfassung, Abschnitt 7) bzw. **„Ohne Rezept-Angaben dokumentieren"** (SchnellDoku, Abschnitt 5) automatisch ein leeres Rezept an. Die eigentlichen Angaben (Arzt, ICD-10, Leitsymptomatik, Heilmittel usw.) lassen sich jederzeit später über Einrichtung → Patient → Rezept → „Bearbeiten" nachtragen – die App erinnert über die Meldung „Rezept unvollständig" automatisch daran.` }
        ]
      }
    ]
  },

  {
    nummer: "4",
    titel: "Fristenprüfung",
    abschnitte: [
      {
        anker: "4.1",
        titel: "Die automatische Anzeige beim Ausfüllen eines Rezepts",
        stichwoerter: ["rezeptprüfung", "rezeptpruefung", "pflichtfelder", "pflichtfeld", "punkte offen", "fehlende angaben", "warnung hausbesuch", "icd passt nicht", "rezept prüfen", "rezeptcheck", "automatische fristen- und pflichtfeldprüfung"],
        bloecke: [
          { typ: "text", text: `Sobald ein Rezept **neu angelegt** oder **bearbeitet** wird, erscheint unterhalb der Felder automatisch ein Prüfbereich. Er aktualisiert sich bei jeder Eingabe – also auch sofort, sobald Ausstellungsdatum **und** mindestens eine Leistung eingetragen sind. Angezeigt wird:` },
          { typ: "liste", items: [
            `Bei vollständigem Privatrezept: **„🔒 Privatrezept — keine Kassenregeln, keine Pflichtfeld-Prüfung nötig."**`,
            `Bei vollständigem Kassenrezept ohne Fristproblem: **„✓ Alle Pflichtfelder vollständig · Fristen ok"**`,
            `Bei fehlenden Angaben: **„✗ Rezeptprüfung: [Anzahl] Punkt(e) offen"** mit Liste der fehlenden Punkte (z. B. „ICD-10 Code fehlt.", oder bei abgelaufener Frist: „Frist für den Behandlungsbeginn ist bereits überschritten").`,
            `Steht „Hausbesuch" auf „Nein": zusätzliche Warnung **„⚠️ Hausbesuch: Nein"**.`,
            `Passt ICD-10 nicht zum gewählten Heilmittel: aufklappbares Warnschild **„⚠️ ICD-10/Heilmittel"** mit Empfehlung, den Rezeptoptimierer zu nutzen.`
          ]},
          { typ: "text", text: `Dieses Panel zeigt die Frist also immer **im Zusammenhang mit einem konkreten Patienten-Rezept**.` }
        ]
      },
      {
        anker: "4-fristenrechner",
        titel: "Fristen berechnen, ohne einen Patienten oder ein Rezept anzulegen",
        stichwoerter: ["frist", "fristen", "fristenrechner", "fristenchecker", "fristencheck", "fristenprüfung", "frist berechnen", "frist ausrechnen", "behandlungsbeginn", "spätester beginn", "spaetester beginn", "spätestes anfangsdatum", "wann anfangen", "wann muss ich anfangen", "ablauf", "abgelaufen", "rezept gültig", "28 tage", "14 tage"],
        bloecke: [
          { typ: "text", text: `Es gibt einen **eigenständigen Fristenrechner**, der komplett unabhängig von einem Patienten oder Rezept funktioniert – ideal, um schnell zu klären „Was ist die späteste Behandlungsfrist bei diesem Ausstellungsdatum?", ohne vorher irgendetwas in der App anzulegen. Er ist allerdings **nicht unter „Rezept" zu finden, sondern versteckt unter dem FAQ-Button:**` },
          { typ: "text", text: `**So geht's:**` },
          { typ: "schritte", items: [
            `Im Dashboard auf **„❓ FAQ"** klicken.`,
            `In der FAQ-Ansicht den Bereich **„Spätestes Anfangsdatum berechnen"** aufklappen.`,
            `Feld **„Ausstellungsdatum"** ausfüllen (TT.MM.JJJJ).`,
            `Feld **„Rezepttyp"** auswählen: GKV normal / GKV dringender Bedarf / BG-Rezept.`,
            `Auf **„Berechnen"** klicken.`,
            `Ergebnis erscheint direkt darunter: **„Spätester Behandlungsbeginn: [Datum]"** mit erläuterndem Hinweistext.`
          ]},
          { typ: "text", text: `Ohne gültiges Ausstellungsdatum erscheint die Meldung „Bitte ein gültiges Ausstellungsdatum eingeben." Dieser Rechner braucht **nichts weiter** als Ausstellungsdatum und Rezepttyp.` }
        ]
      },
      {
        anker: "4.2",
        titel: `Die beiden Nachschlage-Tabellen direkt daneben (ebenfalls unter „❓ FAQ")`,
        stichwoerter: ["gültigkeit", "gueltigkeit", "rezeptgültigkeit", "wie lange gültig", "unterbrechung", "unterbrechungsfrist", "pause", "blanko", "blanko-vo", "16 wochen", "3 monate", "6 monate", "rezept-checkliste", "checkliste"],
        bloecke: [
          { typ: "text", text: `**„Rezeptgültigkeit"** (Fristen je Rezepttyp):` },
          { typ: "tabelle", kopf: [`Rezepttyp`, `Gültigkeit`], zeilen: [
            [`GKV normal`, `28 Kalendertage ab Ausstellungsdatum`],
            [`GKV dringender Bedarf`, `14 Kalendertage ab Ausstellungsdatum`],
            [`BG-Rezept`, `14 Kalendertage ab Ausstellungsdatum`],
            [`Blanko-VO`, `16 Wochen ab Ausstellungsdatum`]
          ]},
          { typ: "text", text: `**„Unterbrechungsfristen"** (nach Anzahl Behandlungen):` },
          { typ: "tabelle", kopf: [`Anzahl Behandlungen`, `Unterbrechungsfrist`], zeilen: [
            [`Bis 6 Behandlungen`, `3 Monate ab erster Behandlung`],
            [`Mehr als 6 Behandlungen`, `6 Monate ab erster Behandlung`],
            [`BG-Rezept`, `28 Kalendertage ab Ausstellungsdatum`],
            [`Blanko-VO`, `Keine Regelung`]
          ]},
          { typ: "text", text: `Ebenfalls in der FAQ-Ansicht: aufklappbarer Bereich **„Rezept-Checkliste"** mit der Liste der Pflichtangaben.` }
        ]
      }
    ]
  },

  {
    nummer: "5",
    titel: "SchnellDoku (Dokumentation)",
    abschnitte: [
      {
        anker: "5",
        titel: "SchnellDoku (Dokumentation)",
        stichwoerter: ["doku", "dokumentation", "dokumentieren", "schnelldoku", "schnell doku", "verlauf", "behandlung eintragen", "behandlungsdatum", "zielrezept", "doku schreiben"],
        bloecke: [
          { typ: "text", text: `Es gibt zwei gleichwertige Wege zur SchnellDoku.` },
          { typ: "text", text: `**Weg 1 – über den Dashboard-Button „📝 Doku":**` },
          { typ: "schritte", items: [
            `Dashboard → **„📝 Doku"**.`,
            `Alphabetische Liste aller Patienten (mit Suche).`,
            `Gewünschten Patienten anklicken – öffnet direkt das SchnellDoku-Schreibfeld.`
          ]},
          { typ: "text", text: `**Weg 2 – über Einrichtung → Patient → „SchnellDoku":**` },
          { typ: "schritte", items: [
            `Dashboard → „Einrichtungen" → Einrichtung → Patient aufklappen.`,
            `Button **„SchnellDoku"** anklicken.`
          ]},
          { typ: "ueberschrift", text: `Einen Doku-Eintrag eintragen (beide Wege identisch)` },
          { typ: "schritte", items: [
            `Feld **„Behandlungsdatum"** prüfen/anpassen (standardmäßig heutiges Datum).`,
            `Bei **mehreren** aktiven Rezepten: unter **„Zielrezept auswählen"** das passende Rezept markieren. Bei genau einem aktiven Rezept wird dieses automatisch verwendet.`,
            `Feld **„Dokumentation"** ausfüllen.`,
            `Auf **„SchnellDoku speichern"** klicken.`
          ]}
        ]
      },
      {
        anker: "5-vom-letzten-mal",
        titel: `„Vom letzten Mal übernehmen"`,
        stichwoerter: ["vom letzten mal", "übernehmen", "uebernehmen", "kopieren", "letzte doku", "text wiederholen", "gleicher text"],
        bloecke: [
          { typ: "text", text: `Sobald bereits ein Doku-Text vorliegt, blendet die App oberhalb des Textfelds eine Box **„📋 Vom letzten Mal ([Datum])"** mit dem zuletzt geschriebenen Text und dem Button **„Vom letzten Mal übernehmen"** ein. Ein Klick übernimmt den Text nur ins Textfeld – gespeichert wird weiterhin erst über „SchnellDoku speichern".` }
        ]
      },
      {
        anker: "5-ohne-rezept",
        titel: "Wenn der Patient noch kein Rezept hat",
        stichwoerter: ["doku ohne rezept", "keine rezepte für schnelldoku", "ohne rezept-angaben dokumentieren"],
        bloecke: [
          { typ: "text", text: `Statt der Zielrezept-Auswahl erscheint der Hinweis „Keine Rezepte für SchnellDoku vorhanden." sowie der Button **„Ohne Rezept-Angaben dokumentieren"** (siehe Abschnitt 3.4).` }
        ]
      }
    ]
  },

  {
    nummer: "6",
    titel: "Rezeptoptimierer",
    abschnitte: [
      {
        anker: "6",
        titel: "Rezeptoptimierer",
        stichwoerter: ["rezeptoptimierer", "optimierer", "optimieren", "optimale verordnung", "beste verordnung", "welches heilmittel", "diagnose eingeben", "diagnosegruppe", "heilmittelkatalog", "lhb", "langfristiger heilmittelbedarf", "arzt-fax", "arztfax", "orientierende menge"],
        bloecke: [
          { typ: "ueberschrift", text: `Zweck` },
          { typ: "text", text: `Schlägt anhand einer eingegebenen Diagnose (ICD-10-Code oder Freitext wie „Rückenschmerzen") automatisch das laut Heilmittelkatalog passende Heilmittel sowie Mengen-/Diagnosegruppen-Angaben vor. Berücksichtigt die in den Einstellungen hinterlegten Zusatz-Zertifikate der Praxis (KG-ZNS, MT, MLD) – ohne diese basieren die Vorschläge nur auf „KG".` },
          { typ: "ueberschrift", text: `Aufruf` },
          { typ: "text", text: `Dashboard → **„👤 Patienten"** → bei einem Patienten auf **„Rezeptoptimierer"** klicken.` },
          { typ: "ueberschrift", text: `Bedienung` },
          { typ: "schritte", items: [
            `Oben: Karte „Zertifikate" zeigt die aktiven Zusatz-Zertifikate der Praxis.`,
            `Ggf. Karte „Zuletzt verwendete Diagnosen" mit Button „Erneut verwenden".`,
            `Diagnose eintippen (Freitext oder ICD-10-Code) und auf **„Hinzufügen"** klicken. Mehrere Diagnosen möglich (Chips, über „×" entfernbar).`,
            `Auf **„Optimale Verordnung finden"** klicken.`
          ]},
          { typ: "ueberschrift", text: `Ergebnis` },
          { typ: "text", text: `Abschnitt **„✓ Beste Verordnung"** zeigt: empfohlenes Heilmittel, erkannte Diagnose, ICD-10-Code, Diagnosegruppe, „Max. je VO", „Orient. Menge", ggf. „LHB möglich" (langfristiger Heilmittelbedarf). Zwei Buttons:` },
          { typ: "liste", items: [
            `**„Übernehmen"** – überträgt ICD-10, Leitsymptomatik und Heilmittel direkt in ein neues Rezept-Formular.`,
            `**„PDF für Arzt-Fax"** – erzeugt ein druckbares Anschreiben an den Arzt mit allen Angaben.`
          ]},
          { typ: "text", text: `Weitere passende Optionen erscheinen unter „Weitere Optionen". Konnte eine Diagnose nicht zugeordnet werden: „Nicht erkannt: […] – bitte ICD-10-Code direkt eingeben oder manuell prüfen."` }
        ]
      }
    ]
  },

  {
    nummer: "7",
    titel: "Zeiterfassung",
    abschnitte: [
      {
        anker: "7",
        titel: "Zeiterfassung",
        stichwoerter: ["zeit", "zeiterfassung", "zeit buchen", "zeit eintragen", "minuten", "stunden eintragen", "20 min", "40 min", "60 min", "dauer", "arbeitszeit erfassen"],
        bloecke: [
          { typ: "ueberschrift", text: `Aufruf und Auswahl` },
          { typ: "schritte", items: [
            `Dashboard → **„⏱ Zeiterfassung"**.`,
            `**Einrichtung auswählen** (oben die Checkbox „Nur Patienten mit aktivem Rezept" ein-/ausschalten).`,
            `**Patient auswählen**.`,
            `Hat der Patient **mehrere** aktive Rezepte: **Rezept auswählen** (zeigt je Rezept die Leistung und automatisch erkannte Minutenzahl). Bei genau einem aktiven Rezept entfällt dieser Schritt.`
          ]},
          { typ: "ueberschrift", text: `Zeit buchen` },
          { typ: "text", text: `Im Bildschirm **„Zeit buchen"**:` },
          { typ: "schritte", items: [
            `Feld **„Datum"** (vorausgefüllt mit heute, Format TT.MM.JJJJ).`,
            `**„Dauer"**: Auswahl 20 Min / 40 Min / 60 Min (bei Doppeltermin-Rezepten erscheint der Hinweis „Doppelbehandlung berücksichtigt").`,
            `Optional **„Notiz"** (z. B. „Hausbesuch").`,
            `Auf **„Zeit buchen"** klicken.`
          ]}
        ]
      },
      {
        anker: "7-ohne-rezept",
        titel: "Patient hat noch kein Rezept",
        stichwoerter: ["zeit ohne rezept", "keine aktiven rezepte", "zeit ohne rezept-angaben"],
        bloecke: [
          { typ: "text", text: `Statt der Rezeptauswahl erscheint „Keine aktiven Rezepte vorhanden." mit dem Hinweis, dass die Zeit trotzdem schon erfasst werden kann, und dem Button **„Zeit ohne Rezept-Angaben buchen"** (siehe Abschnitt 3.4) – ein Klick legt automatisch ein leeres Rezept an und führt direkt zur Zeitbuchung.` }
        ]
      }
    ]
  },

  {
    nummer: "8",
    titel: "Stundenkonto",
    abschnitte: [
      {
        anker: "8.1",
        titel: "Öffnen und Zeitraum wählen",
        stichwoerter: ["stundenkonto", "stunden", "zeitraum", "auswertung", "diese woche", "letzter monat", "kalender stundenkonto"],
        bloecke: [
          { typ: "text", text: `Dashboard → Bereich „Überblick" → **„📊 Stundenkonto"**. Drei Wege für den Zeitraum:` },
          { typ: "schritte", items: [
            `**Schnellauswahl**: „Diese Woche", „Letzte Woche", „Dieser Monat", „Letzter Monat".`,
            `**Kalender**: Mit ‹ / › zum Monat blättern, Starttag antippen, dann Endtag antippen. Mit **„Auswahl zurücksetzen"** löschen.`,
            `**Manuell**: Felder **„Von"** / **„Bis"** ausfüllen, dann **„Auswertung anzeigen"**.`
          ]}
        ]
      },
      {
        anker: "8.2",
        titel: "Saldo ansehen",
        stichwoerter: ["saldo", "überstunden", "ueberstunden", "minusstunden", "plusstunden", "soll", "geleistet", "zeitsaldo"],
        bloecke: [
          { typ: "text", text: `Nach „Auswertung anzeigen" erscheint die Karte **„Zeitsaldo"** mit **„Geleistet"**, **„Soll"** und **„Saldo"** (farblich hervorgehoben: positiv/negativ).` }
        ]
      },
      {
        anker: "8.3",
        titel: "Urlaub / Krank eintragen (rein intern, ohne E-Mail)",
        stichwoerter: ["urlaub intern", "krank intern", "urlaub stundenkonto", "krankheitstag eintragen"],
        bloecke: [
          { typ: "text", text: `Bereich **„Urlaub / Krank"** → **„Eintragen"** → Felder „Von"/„Bis" ausfüllen → direkt auf **„Urlaub"** oder **„Krank"** klicken (kein separater Speichern-Button nötig). Zum reinen internen Buchen, **ohne** Benachrichtigung der Einrichtungen – dafür siehe Abschnitt 15.` }
        ]
      },
      {
        anker: "8.4",
        titel: "Feiertag eintragen",
        stichwoerter: ["feiertag", "feiertage"],
        bloecke: [
          { typ: "text", text: `Bereich „Feiertage" → „Eintragen" → Datum ausfüllen → „Speichern".` }
        ]
      },
      {
        anker: "8.5",
        titel: "Stunden-Abgleich eintragen",
        stichwoerter: ["stundenabgleich", "abgleich", "auszahlung", "überstunden auszahlen", "überstundenfrei", "ueberstundenfrei", "freizeitausgleich"],
        bloecke: [
          { typ: "text", text: `Bereich „Stundenabgleich" → „Eintragen" → Art wählen (Auszahlung / Überstundenfrei), Datum, Stunden, optional Notiz → „Speichern".` }
        ]
      }
    ]
  },

  {
    nummer: "9",
    titel: "Assessment (Berg-Balance-Test)",
    abschnitte: [
      {
        anker: "9.1",
        titel: "Welcher Test wird durchgeführt?",
        stichwoerter: ["assessment", "test", "berg", "berg-balance", "bbs", "balance", "gleichgewicht", "sturzrisiko", "14 items", "56 punkte"],
        bloecke: [
          { typ: "text", text: `In der App ist ausschließlich der **Berg-Balance-Test (BBS)** in der vollständigen **14-Item-Version** hinterlegt. Jedes Item wird mit **0 bis 4 Punkten** bewertet (4 = bestes Ergebnis), maximal **56 Punkte**. Die 14 Items: Vom Sitzen zum Stehen, Freies Stehen, Freies Sitzen, Vom Stehen zum Sitzen, Transfer, Stehen mit geschlossenen Augen, Stehen mit geschlossenen Füßen, Reichweite nach vorne im Stehen, Gegenstand vom Boden aufheben, Über die Schulter nach hinten schauen, 360°-Drehung, Abwechselnd Fuß auf Stufe/Hocker stellen, Tandemstand, Einbeinstand. Jedes Item kann statt bewertet auch als **„Nicht durchführbar"** markiert werden.` }
        ]
      },
      {
        anker: "9.2",
        titel: "Ein neues Assessment starten",
        stichwoerter: ["assessment starten", "assessment durchführen", "test starten", "unvollständige erfassung", "fortsetzen"],
        bloecke: [
          { typ: "schritte", items: [
            `Dashboard → **„📋 Assessment"**.`,
            `Einrichtung auswählen.`,
            `Patient auswählen (Suche möglich).`,
            `Frage **„Assessment jetzt durchführen?"** mit: **„Jetzt durchführen"**, **„Später"**, **„Letztes Assessment ansehen"** (falls vorhanden), **„Abbrechen"**.`
          ]},
          { typ: "text", text: `Wurde ein Assessment schon begonnen, aber nicht gespeichert, erscheint stattdessen „Unvollständige Erfassung gefunden" mit „Fortsetzen" oder „Verwerfen & neu beginnen".` }
        ]
      },
      {
        anker: "9.3",
        titel: "Punktzahlen eintragen",
        stichwoerter: ["punkte eintragen", "punktzahl", "nicht durchführbar", "item bewerten"],
        bloecke: [
          { typ: "text", text: `Für jedes der 14 Items wird die Aufgabenstellung angezeigt, darunter die Punktzahl (0–4) auswählen oder „Nicht durchführbar" ankreuzen. Unten auf **„Weiter"** klicken. Fehlt eine Bewertung: „Bitte '[Item]' bewerten oder als nicht durchführbar markieren." Mit **„Abbrechen"** lässt sich der Vorgang jederzeit verlassen (Zwischenstand wird automatisch gespeichert).` }
        ]
      },
      {
        anker: "9.4",
        titel: "Zusammenfassung",
        stichwoerter: ["assessment speichern", "ergebnis assessment", "einstufung"],
        bloecke: [
          { typ: "text", text: `Zeigt „Berg-Balance-Test: X/Y Punkte – [Einstufung]" (Geringes / Mittleres / Hohes Sturzrisiko). Mit **„Zurück"** korrigieren, mit **„Assessment speichern"** endgültig ablegen (berechnet automatisch das nächste Fälligkeitsdatum, siehe Einstellungen „Assessment-Intervall").` }
        ]
      },
      {
        anker: "9.5",
        titel: "Vergangene Assessments ansehen",
        stichwoerter: ["letztes assessment", "alte assessments", "assessment verlauf", "verlaufsdiagramm", "historie assessment"],
        bloecke: [
          { typ: "liste", items: [
            `Direkt nach dem Start: **„Letztes Assessment ansehen"**.`,
            `Vollständige Historie: Einrichtung → Patient → aufklappbarer Bereich **„Assessments"** (inkl. Verlaufs-Liniendiagramm ab zwei Assessments).`
          ]}
        ]
      },
      {
        anker: "9.6",
        titel: `„Assessment fällig" verschieben`,
        stichwoerter: ["assessment verschieben", "assessment fällig", "assessment faellig", "später assessment"],
        bloecke: [
          { typ: "text", text: `Dashboard-Karte „Assessment fällig" → Button **„Verschieben"** → Feld **„Neues Datum"** → **„Speichern"**.` }
        ]
      }
    ]
  },

  {
    nummer: "10",
    titel: "FaSti – der Chat-Assistent",
    abschnitte: [
      {
        anker: "10",
        titel: "FaSti – der Chat-Assistent",
        stichwoerter: ["fasti", "assistent", "chat", "büroklammer", "bueroklammer", "befehle", "was kann fasti", "meldungen", "hinweise ignorieren", "alle meldungen aus"],
        bloecke: [
          { typ: "text", text: `FaSti ist kein eigener Dashboard-Button, sondern ein frei verschiebbares, schwebendes Icon (meist unten rechts), das nach dem Einloggen automatisch erscheint, sofern aktiviert.` },
          { typ: "ueberschrift", text: `10.1 Was FaSti automatisch prüft` },
          { typ: "text", text: `Direkt nach dem Entsperren prüft FaSti im Hintergrund fünf Bereiche: **Rezepte & Behandlungszählung**, **Zeiterfassung/Stundensaldo** (inkl. montäglichem Wochenrückblick), **Assessments**, **Fristen & Nachbestellung**, **Zuzahlungsbefreiung**. Jede Meldung erscheint als farbige Karte im FaSti-Panel; das Chat-Fenster bleibt dabei geschlossen, nur ein Zähler-Badge zeigt die Anzahl neuer Hinweise.` },
          { typ: "ueberschrift", text: `10.2 Bedienung` },
          { typ: "liste", items: [
            `**Öffnen/Schließen**: auf das Icon tippen bzw. im Panel-Kopf auf ✕.`,
            `**„Alle Meldungen aus"** verwirft alle aktuellen Hinweise auf einmal.`,
            `Jeder Hinweis hat „Ignorieren" sowie ggf. einen Aktions-Button (z. B. „Nachbestellzettel vorbereiten", „Rezept bearbeiten", „Dokumentieren").`,
            `Eingabefeld **„Frag FaSti…"** unten mit Button **„Senden"**.`
          ]},
          { typ: "ueberschrift", text: `10.3 Wichtige Chat-Befehle (Beispiele)` },
          { typ: "liste", items: [
            `**Doku schreiben**: „Schreibe Doku für [Patient]: [Text]"`,
            `**Zeit eintragen**: „Trage 40 Minuten für [Patient] ein"`,
            `**Rezept anlegen**: „Neues Rezept für [Patient] anlegen"`,
            `**Rezept optimieren**: „Optimiere Rezept für [Patient]"`,
            `**Assessment starten**: „Starte Assessment"`,
            `**Arztbericht**: „Arztbericht für [Patient]"`,
            `**Urlaub/Krank**: „Ich bin vom 1.10. bis 5.10. im Urlaub"`,
            `**Zuzahlungsstatus**: „Ist [Patient] befreit?" / „[Patient] ist befreit" / „wer ist nicht befreit"`,
            `**Kilometer-Übersicht**: „Wie viele Kilometer diesen Monat?" (nur Übersicht, kein Eintragen per Chat)`,
            `**Nachbestellzettel**: „Nachbestellung für Dr. [Name]"`,
            `**Freikuvert**: „Freikuvert bestellen"`,
            `**Fristen**: Stichwort „Frist"/„Ablauf"`,
            `**Stunden/Saldo**: „Wie viele Stunden habe ich diesen Monat gearbeitet?"`,
            `**Navigation**: „Zeig Abgabeliste", „Zeig Nachbestellung", „Zeig alle Patienten", „Zeig Doku" usw.`
          ]},
          { typ: "text", text: `Jeder datenverändernde Befehl wird von FaSti erst zur Bestätigung vorgelegt und erst danach ausgeführt. Versteht FaSti eine Eingabe nicht, zeigt es eine Hilfe-Übersicht der unterstützten Themen.` }
        ]
      },
      {
        anker: "10.4",
        titel: "FaSti komplett ausschalten",
        stichwoerter: ["fasti ausschalten", "fasti deaktivieren", "fasti aus", "assistent aus"],
        bloecke: [
          { typ: "text", text: `Einstellungen (⚙️) → Bereich „FaSti" → Checkbox **„FaSti aktiviert"** deaktivieren → **„Änderungen speichern"**.` }
        ]
      }
    ]
  },

  {
    nummer: "11",
    titel: "Nachbestellung",
    abschnitte: [
      {
        anker: "11",
        titel: "Nachbestellung",
        stichwoerter: ["nachbestellung", "nachbestellen", "folgerezept", "folgeverordnung", "neues rezept beim arzt", "nachbestellzettel", "rezept anfordern", "zustellart", "abholen", "per fax", "per post", "per e-mail an arzt", "nachbestell-historie"],
        bloecke: [
          { typ: "ueberschrift", text: `11.1 Öffnen und Rezepte auswählen` },
          { typ: "schritte", items: [
            `Dashboard → **„Nachbestellung"**.`,
            `Optional im Bereich „Filter" nach Arzt und/oder Patient/Heim/Text suchen.`,
            `Im Bereich **„Nachbestell-Auswahl"** (gruppiert nach Arzt → Patient → Rezept) die gewünschten Rezepte ankreuzen.`
          ]},
          { typ: "ueberschrift", text: `11.2 Zustellart wählen` },
          { typ: "text", text: `Im Bereich „Zustellung" stehen vier Optionen zur Verfügung:` },
          { typ: "liste", items: [
            `**„Per Fax an mich / Original zur Einrichtung"** (voreingestellt)`,
            `**„Ich hole die Rezepte selbst ab"** (zusätzliches Feld „Abholdatum")`,
            `**„Original per Post an die Praxis"**`,
            `**„Per E-Mail an den Arzt senden"**`
          ]},
          { typ: "ueberschrift", text: `11.3 Zettel erzeugen und versenden` },
          { typ: "schritte", items: [
            `Auf **„Nachbestellzettel erzeugen"** klicken – öffnet die Druckvorschau und speichert in der Historie.`,
            `Bei **„Per E-Mail an den Arzt senden"**: ist keine E-Mail-Adresse für den Arzt hinterlegt, erscheint ein entsprechender Hinweis (Adresse in der Arztübersicht ergänzen, Abschnitt 13). Mit Adresse erscheint der Button **„E-Mail an [Arzt] öffnen"** – vorher den Zettel als PDF speichern, dann die E-Mail öffnen und die PDF-Datei von Hand anhängen (ein E-Mail-Link kann technisch keine Anhänge automatisch setzen).`,
            `Alternativ: **„Aktuelle Auswahl drucken"** druckt sofort, ohne automatisch einen Historieneintrag anzulegen.`
          ]},
          { typ: "ueberschrift", text: `11.4 Nachbestell-Historie` },
          { typ: "text", text: `Zeigt die letzten Zettel (bis 20) mit **„Öffnen"**, **„Drucken"**, **„Löschen"**.` }
        ]
      }
    ]
  },

  {
    nummer: "12",
    titel: "Abgabeliste",
    abschnitte: [
      {
        anker: "12",
        titel: "Abgabeliste",
        stichwoerter: ["abgabeliste", "abgabe", "abgeben", "abrechnung", "rezepte abgeben", "abgegeben", "abgabezettel", "abgabe-historie", "orange rahmen", "orangener rahmen"],
        bloecke: [
          { typ: "ueberschrift", text: `12.1 Öffnen und auswählen` },
          { typ: "schritte", items: [
            `Dashboard → **„Abgabeliste"**.`,
            `Checkbox **„Nur Patienten mit aktivem Rezept"** steuert, ob nur Patienten mit aktuell aktivem Rezept angezeigt werden.`,
            `In der Liste (gruppiert nach Heim → Patient) die gewünschten Rezeptzeilen ankreuzen.`
          ]},
          { typ: "ueberschrift", text: `12.2 Speichern vs. Drucken` },
          { typ: "liste", items: [
            `**„Auswahl speichern"**: legt einen Eintrag in der Abgabe-Historie an und setzt die ausgewählten Rezepte sofort auf „abgegeben".`,
            `**„Auswahl drucken"**: öffnet den Druckdialog und setzt die Rezepte beim tatsächlichen Drucken ebenfalls auf „abgegeben" – **ohne** dabei einen Historieneintrag anzulegen.`
          ]},
          { typ: "ueberschrift", text: `12.3 Farbliche Hervorhebung` },
          { typ: "text", text: `Nur im gedruckten/als PDF erzeugten Abgabezettel werden Zeilen von **zuzahlungsbefreiten** Patienten mit einem **orangefarbenen Rahmen** umrandet. Jede andere farbliche Hervorhebung gibt es im aktuellen Programmstand nicht.` },
          { typ: "ueberschrift", text: `12.4 Alte Abgabeliste erneut öffnen/drucken` },
          { typ: "text", text: `Bereich „Abgabe-Historie" (bis 20 Einträge): **„Öffnen"** (Vorschau), **„Drucken"** (direkt), **„Löschen"**.` }
        ]
      }
    ]
  },

  {
    nummer: "13",
    titel: "Ärzte / Arztübersicht",
    abschnitte: [
      {
        anker: "13",
        titel: "Ärzte / Arztübersicht",
        stichwoerter: ["arzt", "ärzte", "aerzte", "arztübersicht", "arztliste", "arztadresse", "arzt e-mail", "arzt bearbeiten", "hausarzt"],
        bloecke: [
          { typ: "ueberschrift", text: `13.1 Öffnen und suchen` },
          { typ: "schritte", items: [
            `Dashboard → **„👨‍⚕️ Ärzte"**.`,
            `Über das Suchfeld „Suche nach Arztname" filtern.`,
            `Arzt antippen → Detailseite mit allen zugehörigen Patienten (Name, Einrichtung, Geburtsdatum).`
          ]},
          { typ: "ueberschrift", text: `13.2 Arztdaten bearbeiten` },
          { typ: "text", text: `Auf der Arzt-Detailseite im Bereich „Arztdaten": **„Name"**, **„Arztadresse"**, **„PLZ"**, **„Ort"**, **„E-Mail (für Nachbestellung per Mail)"** → **„Speichern"**.` }
        ]
      }
    ]
  },

  {
    nummer: "14",
    titel: "Kilometer-Erfassung",
    abschnitte: [
      {
        anker: "14",
        titel: "Kilometer-Erfassung",
        stichwoerter: ["kilometer", "km", "fahrt", "fahrten", "fahrtkosten", "kilometergeld", "kilometerzettel", "strecke", "fahrtenprotokoll", "kilometerkonto"],
        bloecke: [
          { typ: "ueberschrift", text: `14.1 Fahrt eintragen` },
          { typ: "text", text: `Dashboard → **„Kilometer"** → Bereich „Fahrt eintragen": Datum, **„Von"**, **„Nach"** (Strecken-Kilometer werden bei bekannten Strecken automatisch ausgefüllt, bei neuen Strecken gemerkt), optional **„Notiz"** → **„Fahrt speichern"**. Bereits erfasste Fahrten lassen sich im „Fahrtenprotokoll" über **„Fahrt bearbeiten"** / **„Fahrt löschen"** verwalten.` },
          { typ: "ueberschrift", text: `14.2 Zeitraum-Auswertung` },
          { typ: "text", text: `Bereich „Zeitraum-Auswertung": „Von"/„Bis" ausfüllen → **„Auswertung anzeigen"** → Kasten „Kilometerkonto" mit Gesamtkilometern und Vergütung. Über **„Kilometerzettel drucken"** wird ein Zettel erzeugt; die enthaltenen Fahrten gelten danach als abgerechnet und erscheinen in der **„Kilometerzettel-Historie"** (dort erneut über „Öffnen"/„Drucken" abrufbar).` }
        ]
      }
    ]
  },

  {
    nummer: "15",
    titel: "Krank / Urlaub melden",
    abschnitte: [
      {
        anker: "15",
        titel: "Krank / Urlaub melden",
        stichwoerter: ["krank", "krankmeldung", "krank melden", "urlaub", "urlaub melden", "abwesenheit", "abwesend", "einrichtungen informieren", "heime benachrichtigen"],
        bloecke: [
          { typ: "text", text: `Dieser Weg erfasst eine Abwesenheit **und** benachrichtigt ausgewählte Einrichtungen per E-Mail.` },
          { typ: "schritte", items: [
            `Dashboard → **„🤒 Krank / Urlaub"**.`,
            `Art wählen: **„Krank"** oder **„Urlaub"**.`,
            `Felder **„Von"** / **„Bis"** ausfüllen.`,
            `Unter **„Einrichtungen informieren"** die zu benachrichtigenden Einrichtungen ankreuzen (fehlt eine E-Mail-Adresse, steht das dabei).`,
            `Auf **„Weiter"** → Angaben prüfen → **„Ja, bestätigen"**.`,
            `Danach erscheint pro ausgewählter Einrichtung ein Button **„E-Mail öffnen"** – jede E-Mail muss einzeln geöffnet und von Hand abgeschickt werden.`
          ]}
        ]
      }
    ]
  },

  {
    nummer: "16",
    titel: "Freikuvert bestellen",
    abschnitte: [
      {
        anker: "16",
        titel: "Freikuvert bestellen",
        stichwoerter: ["freikuvert", "kuvert", "umschlag", "briefumschlag", "freiumschlag"],
        bloecke: [
          { typ: "schritte", items: [
            `Dashboard → **„✉️ Freikuvert"** (benötigt eine hinterlegte Büro-E-Mail-Adresse in den Einstellungen).`,
            `Arzt auswählen (Adresse wird angezeigt).`,
            `Auf **„Freikuvert bestellen"** klicken → Angaben prüfen (feste Menge „10 Stück") → **„Ja, bestellen"**.`,
            `Danach Button **„E-Mail ans Büro öffnen"** antippen und die vorausgefüllte E-Mail abschicken.`
          ]}
        ]
      }
    ]
  },

  {
    nummer: "17",
    titel: "Unterschriftenblatt",
    abschnitte: [
      {
        anker: "17",
        titel: "Unterschriftenblatt",
        stichwoerter: ["unterschrift", "unterschriften", "unterschriftenblatt", "unterschriftenliste", "patientenunterschrift"],
        bloecke: [
          { typ: "text", text: `Der Dashboard-Button **„Unterschriften"** öffnet direkt eine PDF-Datei in einem neuen Tab – es gibt dafür keinen eigenen App-Bildschirm. Zum Drucken die Druckfunktion des geöffneten PDF-Anzeigeprogramms bzw. Browsers verwenden.` }
        ]
      }
    ]
  },

  {
    nummer: "18",
    titel: "Einstellungen",
    abschnitte: [
      {
        anker: "18",
        titel: "Einstellungen",
        stichwoerter: ["einstellungen", "zahnrad", "therapeutenname", "faxnummer", "arbeitstage", "wochenstunden", "startsaldo", "jahresurlaub", "urlaubstage", "zertifikate", "büro-e-mail", "assessment-intervall", "doku-prüfung", "dokueintrag fehlt", "app-version", "aktualisieren", "update"],
        bloecke: [
          { typ: "text", text: `Erreichbar über das Zahnrad-Symbol ⚙️ oben rechts auf dem Dashboard.` },
          { typ: "tabelle", kopf: [`Feld`, `Bedeutung`], zeilen: [
            [`Therapeutenname`, `Name, erscheint auf Begrüßung und Ausdrucken`],
            [`Praxisadresse / Telefon`, `Nur Anzeige, feste Praxisangaben`],
            [`Faxnummer`, `Fax der Praxis (z. B. für Nachbestellzettel)`],
            [`Arbeitstage pro Woche`, `Grundlage für die Soll-Zeit-Berechnung`],
            [`Arbeitsstunden pro Woche`, `Vertragliche Wochenstundenzahl`],
            [`Startdatum bei FaSt`, `Ab wann Zeiten ins Stundenkonto einfließen`],
            [`Startsaldo Stundenkonto`, `Plus-/Minusstunden von vor der App-Einführung`],
            [`Jahresurlaub (Tage)`, `Jährlicher Urlaubsanspruch`],
            [`FaSti aktiviert`, `Schaltet den Chat-Assistenten ein/aus`],
            [`Doku-Prüfung deaktivieren`, `Schaltet die Meldung „Dokueintrag fehlt" ab – zum Einschalten ist eine PIN nötig, zum Ausschalten nicht`],
            [`Zertifikate (MT / MLD / KG-ZNS)`, `Zusatzqualifikationen, fließen in die Heilmittel-Vorschläge ein`],
            [`Büro-E-Mail-Adresse`, `Ziel für Backup-Erinnerung und Freikuvert-Bestellung`],
            [`Assessment-Intervall`, `Alle 3 oder alle 6 Monate bis zum nächsten fälligen Assessment`],
            [`PIN ändern`, `Eigener Bereich: aktuelle PIN, neue PIN, neue PIN wiederholen → „PIN ändern"`],
            [`App-Version`, `Zeigt die installierte Version, Button „Aktualisieren"`]
          ]},
          { typ: "text", text: `Alle Felder außer dem PIN-Wechsel werden über **„Änderungen speichern"** gesichert.` }
        ]
      },
      {
        anker: "18-pin",
        titel: "PIN ändern",
        stichwoerter: ["pin", "pin ändern", "pin aendern", "passwort", "code ändern"],
        bloecke: [
          { typ: "text", text: `Eigener Bereich in den Einstellungen: aktuelle PIN, neue PIN, neue PIN wiederholen → **„PIN ändern"**.` }
        ]
      }
    ]
  },

  {
    nummer: "19",
    titel: "Backup & Wiederherstellen",
    abschnitte: [
      {
        anker: "19.1",
        titel: "Manuell sichern / zurückspielen",
        stichwoerter: ["backup", "sicherung", "sichern", "exportieren", "importieren", "export", "import", "wiederherstellen", "daten zurück", "daten weg", "daten verloren", "neues handy", "handywechsel"],
        bloecke: [
          { typ: "text", text: `Backup-Export und -Import liegen **direkt auf dem Dashboard**, im Bereich **„Backup"**.` },
          { typ: "liste", items: [
            `**„Backup exportieren"**: erstellt eine Sicherungsdatei, die automatisch im Download-Bereich des Geräts landet.`,
            `**„Backup importieren"**: Datei auswählen – ersetzt die aktuell gespeicherten Daten durch den Inhalt des Backups, die App startet danach neu.`
          ]}
        ]
      },
      {
        anker: "19.2",
        titel: "Automatische Sicherung im Hintergrund",
        stichwoerter: ["automatisches backup", "automatische sicherung", "downloads", "download-ordner"],
        bloecke: [
          { typ: "text", text: `Beim Öffnen/Entsperren lädt die App automatisch (ohne Klick) ein vollständiges Backup herunter, sobald neue Daten vorliegen, spätestens alle 5 Tage. Landet im normalen Downloads-Ordner des Geräts.` }
        ]
      },
      {
        anker: "19.3",
        titel: "Backup-Erinnerung",
        stichwoerter: ["backup-erinnerung", "backup erinnerung", "erinnerung backup", "backup per mail"],
        bloecke: [
          { typ: "text", text: `Alle 14 Tage erscheint ein Erinnerungsfenster **„🔔 Backup-Erinnerung"** mit drei Buttons: **„Als Datei herunterladen"**, **„Per E-Mail senden (mailto)"** (öffnet das E-Mail-Programm, die Datei muss von Hand angehängt werden) und **„Später erinnern"**.` }
        ]
      },
      {
        anker: "19.4",
        titel: "Hinweis: Offline-Viewer",
        stichwoerter: ["viewer", "offline-viewer", "praxis-pc", "am pc ansehen"],
        bloecke: [
          { typ: "text", text: `Für den Praxis-PC gibt es zusätzlich einen separaten **„FaSt-Doku Viewer"**, der die Backup-Dateien einliest, um die Praxisdaten am PC anzusehen. Das ist ein eigenständiges Programm außerhalb dieser App und wird hier nur der Vollständigkeit halber erwähnt.` }
        ]
      }
    ]
  },

  {
    nummer: "20",
    titel: "Support",
    abschnitte: [
      {
        anker: "20",
        titel: "Support",
        stichwoerter: ["support", "faq", "hilfe", "anleitung", "leitfaden", "handbuch"],
        bloecke: [
          // ACHTUNG: Dieser Text beschreibt noch die frühere externe
          // Wix-Support-Webseite und wurde bewusst NICHT angepasst
          // (siehe Abschlussbericht der Support-Seiten-Umstellung).
          { typ: "text", text: `Der Button **„🆘 Support"** öffnet die externe Support-Webseite in einem neuen Browser-Tab (unabhängig von der App). Der Button **„❓ FAQ"** daneben ist dagegen ein eigener, interner Bildschirm der App mit Fristenrechner und Nachschlagetabellen (siehe Abschnitt 4).` }
        ]
      }
    ]
  }
];
