#!/usr/bin/env node
// Erhöht die Patch-Version in data/schema.js automatisch um 1. Wird vom
// pre-commit-Hook (.githooks/pre-commit) bei jedem Commit aufgerufen, damit
// die App-Version sich nicht mehr manuell gepflegt werden muss.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.join(__dirname, "..", "data", "schema.js");

const source = fs.readFileSync(schemaPath, "utf8");
const match = source.match(/export const APP_VERSION = "(\d+)\.(\d+)\.(\d+)";/);

if (!match) {
  console.error("bump-version: APP_VERSION nicht im erwarteten Format gefunden, breche ab.");
  process.exit(1);
}

const [, major, minor, patch] = match;
const nextVersion = `${major}.${minor}.${Number(patch) + 1}`;
const updated = source.replace(
  /export const APP_VERSION = "\d+\.\d+\.\d+";/,
  `export const APP_VERSION = "${nextVersion}";`
);

fs.writeFileSync(schemaPath, updated);
console.log(`bump-version: APP_VERSION -> ${nextVersion}`);
