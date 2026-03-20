import { APP_MODULE, APP_SCHEMA_VERSION, APP_VERSION } from "../data/schema.js";
import { finalizeAppStructure } from "../data/normalization.js";
import { fromBase64 } from "../crypto/crypto-engine.js";
import {
  loadEncryptedAppData,
  loadCryptoMeta,
  loadSecurityState,
  saveEncryptedAppData,
  saveCryptoMeta,
  saveSecurityState
} from "../storage/secure-store.js";
import { createDefaultSecurityState } from "../security/lock.js";

function requireZip() {
  if (!globalThis.zip) {
    throw new Error("ZIP Bibliothek ist nicht geladen");
  }
  return globalThis.zip;
}

function safeJsonParse(text, filename) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${filename} ist kein gültiges JSON`);
  }
}

function ensureNonEmptyObject(value, filename) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${filename} ist ungültig`);
  }
}

function sanitizeFilenamePart(str) {
  return String(str || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9\-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function ensureBase64String(value, fieldLabel) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${fieldLabel} fehlt`);
  }

  try {
    const bytes = fromBase64(value);
    if (!bytes || bytes.length === 0) {
      throw new Error("EMPTY");
    }
  } catch {
    throw new Error(`${fieldLabel} ist ungültig`);
  }
}

export function migrateBackupData(data, fromVersion) {
  void fromVersion;
  return data;
}

function countRuntimeEntities(normalized) {
  let patientCount = 0;
  let rezeptCount = 0;
  let entryCount = 0;

  (normalized.homes || []).forEach((home) => {
    patientCount += (home.patients || []).length;
    (home.patients || []).forEach((patient) => {
      rezeptCount += (patient.rezepte || []).length;
      (patient.rezepte || []).forEach((rezept) => {
        entryCount += (rezept.entries || []).length;
      });
    });
  });

  return {
    homeCount: (normalized.homes || []).length,
    patientCount,
    rezeptCount,
    entryCount
  };
}

export function buildBackupMeta(runtimeData) {
  const normalized = finalizeAppStructure(runtimeData);
  const counts = countRuntimeEntities(normalized);

  return {
    type: "fast-doku-backup",
    module: APP_MODULE,
    schemaVersion: APP_SCHEMA_VERSION,
    appVersion: APP_VERSION,
    viewerCompatible: true,
    exportTimestamp: new Date().toISOString(),
    therapistName: normalized.settings?.therapistName || "",
    therapistFax: normalized.settings?.therapistFax || "",
    practicePhone: normalized.settings?.practicePhone || "",
    counts
  };
}

export async function exportBackup(runtimeData) {
  const encryptedAppData = await loadEncryptedAppData();
  const cryptoMeta = await loadCryptoMeta();
  const securityState = await loadSecurityState();

  if (!encryptedAppData || !cryptoMeta) {
    throw new Error("Kein vollständiger Sicherungsstand vorhanden");
  }

  const meta = buildBackupMeta(runtimeData);
  const zipLib = requireZip();
  const writer = new zipLib.ZipWriter(new zipLib.BlobWriter("application/zip"));

  await writer.add("appData.enc", new zipLib.TextReader(JSON.stringify(encryptedAppData)));
  await writer.add("cryptoMeta.json", new zipLib.TextReader(JSON.stringify(cryptoMeta, null, 2)));
  await writer.add("meta.json", new zipLib.TextReader(JSON.stringify(meta, null, 2)));
  await writer.add("securityState.json", new zipLib.TextReader(JSON.stringify(securityState, null, 2)));

  const blob = await writer.close();
  const stamp = meta.exportTimestamp.replace(/[:T]/g, "-").slice(0, 16);
  const therapistSlug = sanitizeFilenamePart(meta.therapistName) || "therapeut";
  const filename = `FaSt-Doku-Backup-${therapistSlug}-${stamp}.zip`;
  return { blob, filename, meta };
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function validateBackupMeta(meta) {
  ensureNonEmptyObject(meta, "meta.json");

  if (meta.type !== "fast-doku-backup") {
    throw new Error("Backup-Typ nicht unterstützt");
  }

  if (meta.module !== APP_MODULE) {
    throw new Error("Backup stammt nicht aus FaSt-Doku");
  }

  if (meta.viewerCompatible !== true && meta.viewerCompatible !== false) {
    throw new Error("meta.json enthält kein gültiges viewerCompatible Feld");
  }

  if (!meta.schemaVersion && meta.schemaVersion !== 0) {
    throw new Error("meta.json enthält keine schemaVersion");
  }

  if (!meta.appVersion) {
    throw new Error("meta.json enthält keine appVersion");
  }

  if (!meta.exportTimestamp) {
    throw new Error("meta.json enthält keinen exportTimestamp");
  }

  if (typeof meta.therapistName !== "string") {
    throw new Error("meta.json enthält keinen gültigen Therapeutennamen");
  }

  return meta;
}

function validateWrappedKeyPayload(value, filename, fieldName) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${filename} ist unvollständig: ${fieldName} fehlt`);
  }

  ensureBase64String(value.ivBase64, `${filename}.${fieldName}.ivBase64`);
  ensureBase64String(value.wrappedKeyBase64, `${filename}.${fieldName}.wrappedKeyBase64`);
}

export function validateCryptoMeta(cryptoMeta) {
  ensureNonEmptyObject(cryptoMeta, "cryptoMeta.json");

  if (typeof cryptoMeta.schemaVersion !== "number") {
    throw new Error("cryptoMeta.json ist unvollständig: schemaVersion fehlt");
  }

  ensureBase64String(cryptoMeta.passwordSaltBase64, "cryptoMeta.json.passwordSaltBase64");
  ensureBase64String(cryptoMeta.pinSaltBase64, "cryptoMeta.json.pinSaltBase64");

  validateWrappedKeyPayload(
    cryptoMeta.wrappedDataKeyByPassword,
    "cryptoMeta.json",
    "wrappedDataKeyByPassword"
  );

  validateWrappedKeyPayload(
    cryptoMeta.wrappedDataKeyByPIN,
    "cryptoMeta.json",
    "wrappedDataKeyByPIN"
  );

  return cryptoMeta;
}

export function validateEncryptedAppData(encryptedAppData) {
  ensureNonEmptyObject(encryptedAppData, "appData.enc");

  ensureBase64String(encryptedAppData.cipherBase64, "appData.enc.cipherBase64");
  ensureBase64String(encryptedAppData.ivBase64, "appData.enc.ivBase64");

  return encryptedAppData;
}

export function resetImportedSecurityState() {
  return createDefaultSecurityState();
}

export function validateBackupPayload({ encryptedAppData, cryptoMeta, meta }) {
  validateEncryptedAppData(encryptedAppData);
  validateCryptoMeta(cryptoMeta);
  validateBackupMeta(meta);

  return true;
}

function validateBackupCompatibility({ encryptedAppData, cryptoMeta, meta }) {
  try {
    validateBackupPayload({ encryptedAppData, cryptoMeta, meta });

    const normalizedMeta = finalizeAppStructure({
      settings: {
        therapistName: meta.therapistName || "",
        practicePhone: meta.practicePhone || "",
        therapistFax: meta.therapistFax || ""
      },
      homes: []
    });

    if (!normalizedMeta?.settings || typeof normalizedMeta.settings !== "object") {
      throw new Error("META_INVALID");
    }

    return true;
  } catch (err) {
    if (String(err?.message || err).includes("ungültig") || String(err?.message || err).includes("fehlt")) {
      throw err;
    }
    throw new Error("Backup beschädigt oder nicht kompatibel");
  }
}

export async function validateBackupZip(file) {
  if (!file) {
    throw new Error("Keine Backup-Datei ausgewählt");
  }

  const zipLib = requireZip();
  const reader = new zipLib.ZipReader(new zipLib.BlobReader(file));

  try {
    const entries = await reader.getEntries();
    const entryMap = new Map(entries.map((entry) => [entry.filename, entry]));

    const appEntry = entryMap.get("appData.enc");
    const cryptoEntry = entryMap.get("cryptoMeta.json");
    const metaEntry = entryMap.get("meta.json");
    const securityEntry = entryMap.get("securityState.json");

    if (!appEntry) throw new Error("Backup enthält keine appData.enc");
    if (!cryptoEntry) throw new Error("Backup enthält keine cryptoMeta.json");
    if (!metaEntry) throw new Error("Backup enthält keine meta.json");

    const encryptedAppData = safeJsonParse(await appEntry.getData(new zipLib.TextWriter()), "appData.enc");
    const cryptoMeta = safeJsonParse(await cryptoEntry.getData(new zipLib.TextWriter()), "cryptoMeta.json");
    const meta = safeJsonParse(await metaEntry.getData(new zipLib.TextWriter()), "meta.json");
    const securityState = securityEntry
      ? safeJsonParse(await securityEntry.getData(new zipLib.TextWriter()), "securityState.json")
      : resetImportedSecurityState();

    validateBackupCompatibility({ encryptedAppData, cryptoMeta, meta });

    return {
      encryptedAppData,
      cryptoMeta,
      meta,
      securityState,
      entries: Array.from(entryMap.keys())
    };
  } finally {
    await reader.close();
  }
}

export async function importBackup(file) {
  const payload = await validateBackupZip(file);
  const backupSchemaVersion = Number(payload.meta?.schemaVersion ?? 0);
  const migratedEncryptedAppData = migrateBackupData(payload.encryptedAppData, backupSchemaVersion);
  const migratedCryptoMeta = migrateBackupData(payload.cryptoMeta, backupSchemaVersion);
  const securityState = resetImportedSecurityState();

  await saveEncryptedAppData(migratedEncryptedAppData);
  await saveCryptoMeta(migratedCryptoMeta);
  await saveSecurityState(securityState);

  return {
    meta: payload.meta,
    importedEntries: payload.entries,
    securityState
  };
}
