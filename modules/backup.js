import { APP_MODULE, APP_SCHEMA_VERSION, APP_VERSION } from "../data/schema.js";
import { finalizeAppStructure } from "../data/normalization.js";
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
  const filename = `FaSt-Doku-Backup-${stamp}.zip`;
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

  if (typeof value.ivBase64 !== "string" || !value.ivBase64.trim()) {
    throw new Error(`${filename} ist unvollständig: ${fieldName}.ivBase64 fehlt`);
  }

  if (typeof value.wrappedKeyBase64 !== "string" || !value.wrappedKeyBase64.trim()) {
    throw new Error(`${filename} ist unvollständig: ${fieldName}.wrappedKeyBase64 fehlt`);
  }
}

export function validateCryptoMeta(cryptoMeta) {
  ensureNonEmptyObject(cryptoMeta, "cryptoMeta.json");

  if (typeof cryptoMeta.schemaVersion !== "number") {
    throw new Error("cryptoMeta.json ist unvollständig: schemaVersion fehlt");
  }

  if (typeof cryptoMeta.passwordSaltBase64 !== "string" || !cryptoMeta.passwordSaltBase64.trim()) {
    throw new Error("cryptoMeta.json ist unvollständig: passwordSaltBase64 fehlt");
  }

  if (typeof cryptoMeta.pinSaltBase64 !== "string" || !cryptoMeta.pinSaltBase64.trim()) {
    throw new Error("cryptoMeta.json ist unvollständig: pinSaltBase64 fehlt");
  }

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

  const hasCipher =
    typeof encryptedAppData.cipherBase64 === "string" &&
    encryptedAppData.cipherBase64.trim().length > 0;

  const hasIv =
    typeof encryptedAppData.ivBase64 === "string" &&
    encryptedAppData.ivBase64.trim().length > 0;

  if (!hasCipher) {
    throw new Error("appData.enc enthält keinen verschlüsselten Inhalt");
  }

  if (!hasIv) {
    throw new Error("appData.enc enthält keinen gültigen IV");
  }

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

export async function validateBackupZip(file) {
  if (!file) {
    throw new Error("Keine Backup-Datei ausgewählt");
  }

  if (!(file.name || "").toLowerCase().endsWith(".zip")) {
    throw new Error("Bitte eine ZIP-Datei auswählen");
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

    validateBackupPayload({ encryptedAppData, cryptoMeta, meta });

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
  const securityState = resetImportedSecurityState();

  await saveEncryptedAppData(payload.encryptedAppData);
  await saveCryptoMeta(payload.cryptoMeta);
  await saveSecurityState(securityState);

  return {
    meta: payload.meta,
    importedEntries: payload.entries,
    securityState
  };
}
