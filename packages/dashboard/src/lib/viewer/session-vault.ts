/**
 * Tab-scoped storage, encrypted at rest, for the viewing key and what it decrypts.
 *
 * DEMO ONLY — not hot-wallet grade. Entries sit in sessionStorage, so they survive a refresh
 * and die with the tab. Each is sealed with an AES-GCM key that WebCrypto marks
 * non-extractable, kept in IndexedDB under this tab's session id. That keeps the raw key
 * out of storage dumps, devtools panels and screenshots, but any script running on this
 * origin can still ask WebCrypto to unseal an entry: an XSS on the dashboard leaks the
 * viewing key. A viewing key only opens disclosures; it never controls the wallet.
 */

const DB_NAME = "smartclaws-session-vault";
const STORE = "keys";
const SESSION_ID_KEY = "smartclaws:vault:session";
const ENTRY_PREFIX = "smartclaws:vault:entry:";

// IndexedDB is not tab-scoped, so a closed tab leaves its wrapping key behind. Keys no tab
// has touched for a day are swept; a live tab refreshes its timestamp on every load.
const ABANDONED_AFTER_MS = 24 * 60 * 60 * 1000;

interface KeyRecord {
    id: string;
    key: CryptoKey;
    touchedAt: number;
}

function settle<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

function generateKey(): Promise<CryptoKey> {
    return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
        "encrypt",
        "decrypt",
    ]);
}

function entryNames(): string[] {
    const names: string[] = [];
    for (let i = 0; i < sessionStorage.length; i += 1) {
        const name = sessionStorage.key(i);
        if (name?.startsWith(ENTRY_PREFIX)) names.push(name);
    }
    return names;
}

function clearEntries() {
    for (const name of entryNames()) sessionStorage.removeItem(name);
}

async function loadWrappingKey(): Promise<CryptoKey> {
    let sessionId = sessionStorage.getItem(SESSION_ID_KEY);
    if (!sessionId) {
        sessionId = crypto.randomUUID();
        sessionStorage.setItem(SESSION_ID_KEY, sessionId);
    }

    try {
        const open = indexedDB.open(DB_NAME, 1);
        open.onupgradeneeded = () => open.result.createObjectStore(STORE, { keyPath: "id" });
        const db = await settle(open);
        const store = () => db.transaction(STORE, "readwrite").objectStore(STORE);

        const existing = (await settle(store().get(sessionId))) as KeyRecord | undefined;
        const now = Date.now();
        let key = existing?.key;
        if (!key) {
            key = await generateKey();
            // Anything sealed under a key this tab no longer has is unreadable noise.
            clearEntries();
        }
        await settle(store().put({ id: sessionId, key, touchedAt: now } satisfies KeyRecord));

        const records = (await settle(store().getAll())) as KeyRecord[];
        for (const record of records) {
            if (record.id !== sessionId && now - record.touchedAt > ABANDONED_AFTER_MS) {
                store().delete(record.id);
            }
        }
        db.close();
        return key;
    } catch {
        // No IndexedDB (some private modes): the key lives in memory only, so entries do not
        // survive a refresh. That fails safe — the user signs again.
        clearEntries();
        return generateKey();
    }
}

let wrappingKey: Promise<CryptoKey> | undefined;
function getWrappingKey() {
    wrappingKey ??= loadWrappingKey();
    return wrappingKey;
}

function toBase64(bytes: Uint8Array): string {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

// Writes are serialised so a slow seal can never land after, and overwrite, a newer one.
let writes: Promise<void> = Promise.resolve();

export function vaultWrite(name: string, value: unknown): Promise<void> {
    writes = writes
        .catch(() => undefined)
        .then(async () => {
            const key = await getWrappingKey();
            const iv = crypto.getRandomValues(new Uint8Array(12));
            const data = new TextEncoder().encode(JSON.stringify(value));
            const sealed = new Uint8Array(
                await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data),
            );
            sessionStorage.setItem(ENTRY_PREFIX + name, `${toBase64(iv)}.${toBase64(sealed)}`);
        });
    return writes;
}

export async function vaultRead<T>(name: string): Promise<T | undefined> {
    const key = await getWrappingKey();
    const stored = sessionStorage.getItem(ENTRY_PREFIX + name);
    if (!stored) return undefined;
    const [iv, sealed] = stored.split(".");
    try {
        const data = await crypto.subtle.decrypt(
            { name: "AES-GCM", iv: fromBase64(iv) },
            key,
            fromBase64(sealed),
        );
        return JSON.parse(new TextDecoder().decode(data)) as T;
    } catch {
        sessionStorage.removeItem(ENTRY_PREFIX + name);
        return undefined;
    }
}

export function vaultRemove(name: string) {
    sessionStorage.removeItem(ENTRY_PREFIX + name);
}
