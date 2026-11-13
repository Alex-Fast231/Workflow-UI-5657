import { generateSalt, toBase64, fromBase64, encryptJSON, decryptJSON, encryptText, decryptText } from "../crypto/crypto-engine.js";
import { generateDataKey, wrapDataKeyWithPassword, wrapDataKeyWithPIN, unwrapDataKeyWithPassword, unwrapDataKeyWithPIN, unwrapDataKeyWithPINExtractable } from "../crypto/key-management.js";
import { normalizeAppData } from "../data/normalization.js";
import { createDefaultSecurityState, isLockedOut, registerFailedLogin, registerSuccessfulUnlock } from "./lock.js";
import { saveCryptoMeta, saveEncryptedAppData, saveSecurityState } from "../storage/secure-store.js";

export async function createCryptoMeta({ password, pin, dataKey }) {
  const passwordSaltBytes = generateSalt(16);
  const pinSaltBytes = generateSalt(16);
  const backupSaltBytes = generateSalt(16);

  const wrappedByPassword = await wrapDataKeyWithPassword(dataKey, password, passwordSaltBytes);
  const wrappedByPIN = await wrapDataKeyWithPIN(dataKey, pin, pinSaltBytes);
  const encryptedPracticePasswordByDataKey = await encryptText(password, dataKey);

  return {
    schemaVersion: 1,
    passwordSaltBase64: toBase64(passwordSaltBytes),
    pinSaltBase64: toBase64(pinSaltBytes),
    backupSaltBase64: toBase64(backupSaltBytes),
    wrappedDataKeyByPassword: wrappedByPassword,
    wrappedDataKeyByPIN: wrappedByPIN,
    encryptedPracticePasswordByDataKey
  };
}

export async function setupSecurity({ password, pin, initialAppData }) {
  const normalized = normalizeAppData(initialAppData);
  const dataKey = await generateDataKey();
  const cryptoMeta = await createCryptoMeta({ password, pin, dataKey });
  const encryptedAppData = await encryptJSON(normalized, dataKey);
  const securityState = createDefaultSecurityState();

  await saveCryptoMeta(cryptoMeta);
  await saveEncryptedAppData(encryptedAppData);
  await saveSecurityState(securityState);

  return {
    runtimeKey: dataKey,
    runtimeData: normalized,
    cryptoMeta,
    securityState
  };
}

export async function unlockWithPIN({ pin, cryptoMeta, encryptedAppData, securityState }) {
  if (isLockedOut(securityState)) {
    const err = new Error("LOCKED_OUT");
    err.code = "LOCKED_OUT";
    err.securityState = securityState;
    throw err;
  }

  // Technische Voraussetzungen prüfen, BEVOR der PIN-Versuch gezählt wird.
  // Fehlt cryptoMeta oder encryptedAppData (z.B. durch einen Storage-Fehler),
  // ist das kein falscher PIN-Versuch und darf den Nutzer nicht aussperren.
  if (!cryptoMeta || !cryptoMeta.wrappedDataKeyByPIN || !cryptoMeta.pinSaltBase64) {
    const err = new Error("STORAGE_ERROR");
    err.code = "STORAGE_ERROR";
    err.message = "Sicherheitsdaten (cryptoMeta) fehlen oder sind unvollständig.";
    throw err;
  }

  if (!encryptedAppData || !encryptedAppData.cipherBase64 || !encryptedAppData.ivBase64) {
    const err = new Error("STORAGE_ERROR");
    err.code = "STORAGE_ERROR";
    err.message = "Verschlüsselte App-Daten fehlen oder sind unvollständig.";
    throw err;
  }

  let dataKey;
  try {
    dataKey = await unwrapDataKeyWithPIN(
      cryptoMeta.wrappedDataKeyByPIN,
      pin,
      fromBase64(cryptoMeta.pinSaltBase64)
    );
  } catch {
    // Hier ist es tatsächlich (mit sehr hoher Wahrscheinlichkeit) ein
    // falscher PIN: Schlüssel-Unwrap mit AES-GCM scheitert authentifiziert,
    // wenn der abgeleitete Schlüssel nicht passt.
    const nextSecurityState = registerFailedLogin(securityState);
    await saveSecurityState(nextSecurityState);

    const err = new Error("INVALID_PIN");
    err.code = "INVALID_PIN";
    err.securityState = nextSecurityState;
    throw err;
  }

  try {
    const data = await decryptJSON(encryptedAppData, dataKey);
    const runtimeData = normalizeAppData(data);
    const nextSecurityState = registerSuccessfulUnlock(securityState, "pin");

    await saveSecurityState(nextSecurityState);

    return {
      runtimeKey: dataKey,
      runtimeData,
      securityState: nextSecurityState
    };
  } catch (decryptErr) {
    // PIN war korrekt (der Schlüssel ließ sich entschlüsseln), aber die
    // eigentlichen App-Daten lassen sich nicht entschlüsseln/parsen. Das
    // ist ein Daten- bzw. Storage-Problem, kein falscher PIN-Versuch -
    // der Fehlversuchszähler bleibt daher unverändert.
    console.error("Entschlüsselung der App-Daten fehlgeschlagen:", decryptErr);
    const err = new Error("DATA_CORRUPTED");
    err.code = "DATA_CORRUPTED";
    err.securityState = securityState;
    throw err;
  }
}


// Ändert ausschließlich die PIN (für den Geräte-/Personenwechsel, z.B. bei
// der Übergabe an eine andere Therapeutin): der bestehende dataKey bleibt
// unverändert, es wird nur ein neues PIN-Salt erzeugt und der dataKey damit
// neu umschlossen. Praxispasswort-Wrapping, verschlüsselte App-Daten und
// alle fachlichen Daten (Patienten, Rezepte, ...) bleiben komplett
// unberührt. Der Aufruf setzt voraus, dass die App bereits entsperrt ist
// (runtimeKey liegt vor) - es gibt bewusst keine zusätzliche
// "alte PIN eingeben"-Hürde, da das Erreichen der Einstellungen selbst schon
// voraussetzt, dass zuvor erfolgreich entsperrt wurde.
export async function changePIN({ currentPin, newPin, cryptoMeta }) {
  // Der laufende Session-Schlüssel (runtimeKey) ist bewusst NICHT
  // extrahierbar (siehe importKeyRaw() in crypto-engine.js) - ihn hier zu
  // verwenden würde mit "key is not extractable" fehlschlagen. Stattdessen
  // wird der dataKey hier eigens noch einmal mit der aktuellen PIN
  // entschlüsselt, diesmal extrahierbar, nur für diesen einen Vorgang.
  // Das bestätigt nebenbei auch gleich, dass die aktuelle PIN stimmt.
  let dataKey;
  try {
    dataKey = await unwrapDataKeyWithPINExtractable(
      cryptoMeta.wrappedDataKeyByPIN,
      currentPin,
      fromBase64(cryptoMeta.pinSaltBase64)
    );
  } catch {
    const err = new Error("Aktuelle PIN ist falsch.");
    err.code = "INVALID_PIN";
    throw err;
  }

  const pinSaltBytes = generateSalt(16);
  const wrappedByPIN = await wrapDataKeyWithPIN(dataKey, newPin, pinSaltBytes);

  const updatedMeta = {
    ...cryptoMeta,
    pinSaltBase64: toBase64(pinSaltBytes),
    wrappedDataKeyByPIN: wrappedByPIN
  };

  await saveCryptoMeta(updatedMeta);
  return updatedMeta;
}

export async function getPracticePasswordFromRuntime({ runtimeKey, cryptoMeta }) {
  if (!runtimeKey) {
    throw new Error("Runtime-Key fehlt");
  }

  const payload = cryptoMeta?.encryptedPracticePasswordByDataKey;
  if (!payload?.ivBase64 || !payload?.cipherBase64) {
    throw new Error("Praxispasswort ist nicht verfügbar");
  }

  const password = await decryptText(payload, runtimeKey);
  if (!password || password.length < 8) {
    throw new Error("Praxispasswort ist ungültig");
  }
  return password;
}

export async function verifyPracticePassword({ password, cryptoMeta }) {
  try {
    await unwrapDataKeyWithPassword(
      cryptoMeta.wrappedDataKeyByPassword,
      password,
      fromBase64(cryptoMeta.passwordSaltBase64)
    );
    return true;
  } catch {
    return false;
  }
}