/**
 * Vault State Manager
 * 
 * Supports TWO modes:
 * 1. PLAINTEXT mode — entries stored unencrypted (when user is not signed in)
 * 2. ENCRYPTED mode — AES-GCM encrypted with master password (after sign-in)
 * 
 * The mode is determined by whether pm_vault_keys exists in storage.
 */

class VaultService {
    constructor(cryptoService) {
        this.crypto = cryptoService;
        this.STORAGE_KEY = 'pm_vault_data';
        this.KEYS_KEY = 'pm_vault_keys';
        this.PLAINTEXT_KEY = 'pm_vault_plaintext';
        this.masterKey = null; // Contains the DEK (Data Encryption Key) in memory
        this.isUnlocked = false;
        this._isSecured = false; // true when vault keys exist (encrypted mode)
        this._plaintextLoaded = false; // true when plaintext data has been loaded into cache

        // Caches the unencrypted vault data while unlocked (or in plaintext mode)
        this.vaultCache = {
            entries: [],
            categories: [], // Folders, tags, etc.
            settings: {}
        };
    }

    /**
     * Checks if the vault is secured with a master password (encrypted mode).
     * @returns {Promise<boolean>}
     */
    async isSecured() {
        return new Promise((resolve) => {
            chrome.storage.local.get([this.KEYS_KEY], (result) => {
                this._isSecured = !!result[this.KEYS_KEY];
                resolve(this._isSecured);
            });
        });
    }

    /**
     * Checks if any vault data exists (plaintext OR encrypted).
     * @returns {Promise<boolean>}
     */
    async hasVault() {
        return new Promise((resolve) => {
            chrome.storage.local.get([this.STORAGE_KEY, this.PLAINTEXT_KEY, this.KEYS_KEY], (result) => {
                this._isSecured = !!result[this.KEYS_KEY];
                const hasEncrypted = !!result[this.STORAGE_KEY];
                const hasPlaintext = !!result[this.PLAINTEXT_KEY];
                resolve(hasEncrypted || hasPlaintext);
            });
        });
    }

    /**
     * Loads plaintext vault data into cache. Called instead of unlock() when not secured.
     * @returns {Promise<boolean>}
     */
    async loadPlaintext() {
        return new Promise((resolve) => {
            chrome.storage.local.get([this.PLAINTEXT_KEY], (result) => {
                const data = result[this.PLAINTEXT_KEY];
                if (data) {
                    this.vaultCache = data;
                } else {
                    // Initialize empty plaintext vault
                    this.vaultCache = {
                        entries: [],
                        categories: [
                            { id: 'cat_logins', name: 'Logins', type: 'system' },
                            { id: 'cat_favorites', name: 'Favorites', type: 'system' },
                            { id: 'cat_email', name: 'Email', type: 'system' },
                            { id: 'cat_social', name: 'Social', type: 'system' },
                            { id: 'cat_work', name: 'Work', type: 'system' },
                            { id: 'cat_bank', name: 'Finance', type: 'system' },
                            { id: 'cat_sensitive', name: 'Sensitive', type: 'system' },
                            { id: 'cat_others', name: 'Others', type: 'system' }
                        ],
                        settings: { autoLockMinutes: 15 }
                    };
                }
                this.isUnlocked = true;
                this._plaintextLoaded = true;
                resolve(true);
            });
        });
    }

    /**
     * Saves plaintext vault data directly (no encryption).
     */
    async _savePlaintext() {
        return new Promise((resolve, reject) => {
            chrome.storage.local.set({
                [this.PLAINTEXT_KEY]: this.vaultCache,
                unpushedVaultChanges: true
            }, () => {
                if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
                else {
                    globalThis.SyncService?.pushVault();
                    resolve();
                }
            });
        });
    }

    /**
     * Secures the vault by encrypting all plaintext data with a master password.
     * Called after user signs in and creates a master password.
     * @param {string} masterPassword
     * @returns {Promise<boolean>}
     */
    async secureVault(masterPassword) {
        // Load plaintext data if not already loaded
        if (!this._plaintextLoaded) {
            await this.loadPlaintext();
        }

        // Save current cache contents before creating vault
        const savedCache = JSON.parse(JSON.stringify(this.vaultCache));

        // 1. Generate DEK
        const dekBase64 = this.crypto.generateDataKeyBase64();
        const dekKey = await this.crypto.importDataKey(dekBase64);

        // 2. Encrypt the vault cache with the DEK
        const jsonString = JSON.stringify(savedCache);
        const vaultEnc = await this.crypto.encrypt(jsonString, dekKey);

        const vaultPayload = {
            v: 2,
            iv: vaultEnc.iv,
            data: vaultEnc.ciphertext,
            version: 1
        };

        // 3. Derive KEK from password
        const salt = this.crypto.generateRandomBytes(16);
        const saltBase64 = this.crypto.bufferToBase64(salt.buffer);
        const kek = await this.crypto.deriveMasterKey(masterPassword, salt);

        // 4. Encrypt DEK and Validator
        const edekEnc = await this.crypto.encrypt(dekBase64, kek);
        const validatorEnc = await this.crypto.encrypt('VAULT_OK', dekKey);

        const keysPayload = {
            salt: saltBase64,
            edek: edekEnc.ciphertext,
            edek_iv: edekEnc.iv,
            validator: validatorEnc.ciphertext,
            validator_iv: validatorEnc.iv
        };

        // 5. Save encrypted vault + keys, and remove plaintext
        return new Promise((resolve, reject) => {
            chrome.storage.local.set({
                [this.STORAGE_KEY]: vaultPayload,
                [this.KEYS_KEY]: keysPayload,
                unpushedVaultChanges: true
            }, () => {
                if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);

                // Remove plaintext data
                chrome.storage.local.remove([this.PLAINTEXT_KEY], () => {
                    this._isSecured = true;
                    this._plaintextLoaded = false;
                    this.masterKey = dekKey;
                    this.isUnlocked = true;
                    this.vaultCache = savedCache;

                    this._storeSession(masterPassword);
                    globalThis.SyncService?.pushVault();
                    this._dispatchEvent('vaultUnlocked');
                    resolve(true);
                });
            });
        });
    }

    /**
     * Creates a new vault replacing any existing one
     * @param {string} masterPassword 
     */
    async createVault(masterPassword) {
        // 1. Generate DEK (Data Encryption Key)
        const dekBase64 = this.crypto.generateDataKeyBase64();
        const dekKey = await this.crypto.importDataKey(dekBase64);

        // 2. Create empty vault structure
        const emptyVault = {
            entries: [],
            categories: [
                { id: 'cat_logins', name: 'Logins', type: 'system' },
                { id: 'cat_favorites', name: 'Favorites', type: 'system' },
                { id: 'cat_email', name: 'Email', type: 'system' },
                { id: 'cat_social', name: 'Social', type: 'system' },
                { id: 'cat_work', name: 'Work', type: 'system' },
                { id: 'cat_bank', name: 'Finance', type: 'system' },
                { id: 'cat_sensitive', name: 'Sensitive', type: 'system' },
                { id: 'cat_others', name: 'Others', type: 'system' }
            ],
            settings: {
                autoLockMinutes: 15
            }
        };

        // 3. Encrypt the empty vault with the DEK
        const jsonString = JSON.stringify(emptyVault);
        const vaultEnc = await this.crypto.encrypt(jsonString, dekKey);
        
        const vaultPayload = {
            v: 2, // Version 2 denotes decoupled keys
            iv: vaultEnc.iv,
            data: vaultEnc.ciphertext,
            version: 1 // Logical clock for OCC sync
        };

        // 4. Derive KEK (Key Encryption Key) from password
        const salt = this.crypto.generateRandomBytes(16);
        const saltBase64 = this.crypto.bufferToBase64(salt.buffer);
        const kek = await this.crypto.deriveMasterKey(masterPassword, salt);

        // 5. Encrypt DEK and Validator using KEK & DEK
        const edekEnc = await this.crypto.encrypt(dekBase64, kek);
        const validatorEnc = await this.crypto.encrypt('VAULT_OK', dekKey); // Proves the DEK decrypted successfully

        const keysPayload = {
            salt: saltBase64,
            edek: edekEnc.ciphertext,
            edek_iv: edekEnc.iv,
            validator: validatorEnc.ciphertext,
            validator_iv: validatorEnc.iv
        };

        // 6. Save payloads to disk
        return new Promise((resolve, reject) => {
            chrome.storage.local.set({ 
                [this.STORAGE_KEY]: vaultPayload,
                [this.KEYS_KEY]: keysPayload,
                unpushedVaultChanges: true // Flag for OCC sync
            }, () => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                } else {
                    // Start sync timer
                    globalThis.SyncService?.pushVault();
                    // Lock the vault immediately after creation, forcing user to re-enter
                    this._lock();
                    resolve(true);
                }
            });
        });
    }

    /**
     * Unlocks the vault given a master password
     * Handles legacy v1 migration to v2 (decoupled keys) automatically.
     * @param {string} masterPassword 
     * @returns {Promise<boolean>}
     */
    async unlock(masterPassword) {
        return new Promise((resolve, reject) => {
            chrome.storage.local.get([this.STORAGE_KEY, this.KEYS_KEY, this.PLAINTEXT_KEY], async (result) => {
                const vaultPayload = result[this.STORAGE_KEY];
                const keysPayload = result[this.KEYS_KEY];
                const plaintextData = result[this.PLAINTEXT_KEY];

                // If no keysPayload but we have vaultPayload v1, it's a legacy vault
                if (vaultPayload && vaultPayload.v === 1 && !keysPayload) {
                    try {
                        const saltBuffer = new Uint8Array(this.crypto.base64ToBuffer(vaultPayload.salt));
                        const legacyKey = await this.crypto.deriveMasterKey(masterPassword, saltBuffer);
                        const plaintext = await this.crypto.decrypt(vaultPayload.data, vaultPayload.iv, legacyKey);
                        
                        // Successfully unlocked v1! Instantly migrate to v2.
                        this.vaultCache = JSON.parse(plaintext);
                        
                        // Generate DEK
                        const dekBase64 = this.crypto.generateDataKeyBase64();
                        const dekKey = await this.crypto.importDataKey(dekBase64);
                        
                        // Generate new KEK salt
                        const newSalt = this.crypto.generateRandomBytes(16);
                        const newSaltBase64 = this.crypto.bufferToBase64(newSalt.buffer);
                        const newKek = await this.crypto.deriveMasterKey(masterPassword, newSalt);

                        // Encrypt DEK and Validator
                        const edekEnc = await this.crypto.encrypt(dekBase64, newKek);
                        const validatorEnc = await this.crypto.encrypt('VAULT_OK', dekKey);
                        
                        const newKeysPayload = {
                            salt: newSaltBase64,
                            edek: edekEnc.ciphertext,
                            edek_iv: edekEnc.iv,
                            validator: validatorEnc.ciphertext,
                            validator_iv: validatorEnc.iv
                        };

                        // Save V2 structure using _saveToStorage which will write both payloads and set version
                        this.masterKey = dekKey; // Store DEK in memory
                        this.isUnlocked = true;
                        
                        // Emulate a _saveToStorage payload build to migrate the data block
                        const newVaultEnc = await this.crypto.encrypt(JSON.stringify(this.vaultCache), dekKey);
                        const newVaultPayload = {
                            v: 2,
                            iv: newVaultEnc.iv,
                            data: newVaultEnc.ciphertext,
                            version: 1 // Start OCC tracking
                        };

                        await new Promise(res => {
                            chrome.storage.local.set({ 
                                [this.STORAGE_KEY]: newVaultPayload,
                                [this.KEYS_KEY]: newKeysPayload,
                                unpushedVaultChanges: true 
                            }, res);
                        });
                        
                        this._storeSession(masterPassword);
                        globalThis.SyncService?.pushVault();
                        this._dispatchEvent('vaultUnlocked');
                        return resolve(true);
                    } catch (e) {
                        return reject(new Error("Invalid Master Password"));
                    }
                }

                // Normal V2 Unlock Flow
                if (!keysPayload) return reject(new Error("No vault found."));

                try {
                    // 1. Derive KEK from salt
                    const saltBuffer = new Uint8Array(this.crypto.base64ToBuffer(keysPayload.salt));
                    const kek = await this.crypto.deriveMasterKey(masterPassword, saltBuffer);

                    // 2. Decrypt EDEK to get DEK Base64
                    const dekBase64 = await this.crypto.decrypt(keysPayload.edek, keysPayload.edek_iv, kek);
                    const dekKey = await this.crypto.importDataKey(dekBase64);

                    // 3. Verify DEK correctness (optional explicit check, but good for UX)
                    const validator = await this.crypto.decrypt(keysPayload.validator, keysPayload.validator_iv, dekKey);
                    if (validator !== 'VAULT_OK') throw new Error('Validator mismatch');

                    // 4. Decrypt Vault Payload
                    if (vaultPayload && vaultPayload.data) {
                        const plaintext = await this.crypto.decrypt(vaultPayload.data, vaultPayload.iv, dekKey);
                        this.vaultCache = JSON.parse(plaintext);
                    } else if (plaintextData) {
                        // Migrate plaintext into encrypted vault automatically
                        this.vaultCache = plaintextData;
                        chrome.storage.local.remove([this.PLAINTEXT_KEY]);
                        setTimeout(() => this._saveToStorage(), 0);
                    } else {
                        // Empty vault (e.g. fresh account without synced data yet)
                        this.vaultCache = { entries: [], categories: [], settings: {} };
                        setTimeout(() => this._saveToStorage(), 0);
                    }

                    this.masterKey = dekKey;
                    this.isUnlocked = true;
                    this._storeSession(masterPassword);
                    this._dispatchEvent('vaultUnlocked');
                    resolve(true);
                } catch (err) {
                    this.masterKey = null;
                    this.isUnlocked = false;
                    reject(new Error("Invalid Master Password"));
                }
            });
        });
    }

    /**
     * Tries to auto-unlock the vault using a stored session (if within timeout).
     * Call this on popup open before showing the lock screen.
     * @returns {Promise<boolean>} True if auto-unlock succeeded.
     */
    async tryAutoUnlock() {
        return new Promise((resolve) => {
            chrome.storage.session.get(['vault_session'], async (result) => {
                const session = result.vault_session;
                if (!session || !session.password) return resolve(false);

                // Check expiry (expiry of -1 means never)
                if (session.expiry !== -1 && Date.now() > session.expiry) {
                    chrome.storage.session.remove(['vault_session']);
                    return resolve(false);
                }

                try {
                    await this.unlock(session.password);
                    resolve(true);
                } catch (err) {
                    // Session password no longer valid (vault recreated?)
                    chrome.storage.session.remove(['vault_session']);
                    resolve(false);
                }
            });
        });
    }

    /**
     * Stores the master password in chrome.storage.session with an expiry
     * based on the pm_settings vaultTimeout value.
     */
    _storeSession(masterPassword) {
        chrome.storage.local.get(['pm_settings'], (result) => {
            const settings = result.pm_settings || {};
            const timeoutMinutes = settings.vaultTimeout !== undefined ? settings.vaultTimeout : 5;

            if (timeoutMinutes === 0) {
                // Immediately lock — don't store session
                chrome.storage.session.remove(['vault_session']);
                return;
            }

            const expiry = timeoutMinutes === -1
                ? -1  // Never expire
                : Date.now() + timeoutMinutes * 60 * 1000;

            chrome.storage.session.set({ vault_session: { password: masterPassword, expiry } });
        });
    }

    /**
     * Nullifies the in-memory key and clears the cache
     */
    lock() {
        // Only lock if vault is secured (encrypted mode)
        if (!this._isSecured) return;
        chrome.storage.session.remove(['vault_session']); // Clear auto-unlock session
        this._lock();
        this._dispatchEvent('vaultLocked');
    }

    _lock() {
        this.masterKey = null;
        this.isUnlocked = false;
        this._plaintextLoaded = false;
        this.vaultCache = { entries: [], categories: [], settings: {} };
    }

    /**
     * Gets all entries from the vault cache.
     */
    getEntries() {
        if (!this.isUnlocked && !this._plaintextLoaded) throw new Error("Vault is locked");
        return this.vaultCache.entries;
    }

    /**
     * Saves changes to the vault cache to chrome storage by re-encrypting.
     */
    async _saveToStorage() {
        // Plaintext mode — save without encryption
        if (!this._isSecured) {
            return this._savePlaintext();
        }

        if (!this.isUnlocked || !this.masterKey) {
            throw new Error("Cannot save: Vault is locked.");
        }

        return new Promise((resolve, reject) => {
            chrome.storage.local.get([this.STORAGE_KEY], async (result) => {
                let payload = result[this.STORAGE_KEY];

                try {
                    const jsonString = JSON.stringify(this.vaultCache);
                    // Generate new IV for every save operation
                    const { ciphertext, iv } = await this.crypto.encrypt(jsonString, this.masterKey);

                    if (!payload) {
                        payload = { v: 2, version: 0 };
                    }

                    payload.iv = iv;
                    payload.data = ciphertext;
                    payload.version = (payload.version || 1) + 1; // Increment OCC Clock

                    chrome.storage.local.set({ 
                        [this.STORAGE_KEY]: payload,
                        unpushedVaultChanges: true
                    }, () => {
                        globalThis.SyncService?.pushVault();
                        if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
                        else resolve();
                    });
                } catch (e) {
                    reject(e);
                }
            });
        });
    }

    /**
     * Adds a new entry and persists to storage
     */
    async addEntry(entry) {
        if (!this.isUnlocked && !this._plaintextLoaded) throw new Error("Vault is locked");

        entry.id = 'entry_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        entry.createdAt = new Date().toISOString();
        entry.updatedAt = entry.createdAt;

        this.vaultCache.entries.push(entry);
        await this._saveToStorage();
        return entry;
    }

    /**
     * Updates an existing entry
     */
    async updateEntry(id, updatedFields) {
        if (!this.isUnlocked && !this._plaintextLoaded) throw new Error("Vault is locked");

        const index = this.vaultCache.entries.findIndex(e => e.id === id);
        if (index === -1) throw new Error("Entry not found");

        this.vaultCache.entries[index] = {
            ...this.vaultCache.entries[index],
            ...updatedFields,
            updatedAt: new Date().toISOString()
        };

        await this._saveToStorage();
        return this.vaultCache.entries[index];
    }

    /**
     * Deletes an entry
     */
    async deleteEntry(id) {
        if (!this.isUnlocked && !this._plaintextLoaded) throw new Error("Vault is locked");

        const initialLength = this.vaultCache.entries.length;
        this.vaultCache.entries = this.vaultCache.entries.filter(e => e.id !== id);

        if (this.vaultCache.entries.length !== initialLength) {
            await this._recordVaultTombstone(id);
            await this._saveToStorage();
            return true;
        }
        return false;
    }

    /**
     * Adds a new custom category (folder)
     */
    async addCategory(name) {
        if (!this.isUnlocked && !this._plaintextLoaded) throw new Error("Vault is locked");

        const newCategory = {
            id: 'cat_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
            name: name,
            type: 'custom'
        };

        this.vaultCache.categories.push(newCategory);
        await this._saveToStorage();
        return newCategory;
    }

    /**
     * Updates an existing custom category
     */
    async updateCategory(id, newName) {
        if (!this.isUnlocked && !this._plaintextLoaded) throw new Error("Vault is locked");

        const category = this.vaultCache.categories.find(c => c.id === id);
        if (!category) throw new Error("Category not found");
        if (category.type === 'system') throw new Error("Cannot rename system categories");

        category.name = newName;
        await this._saveToStorage();
        return category;
    }

    /**
     * Deletes a custom category
     */
    async deleteCategory(id) {
        if (!this.isUnlocked && !this._plaintextLoaded) throw new Error("Vault is locked");

        const category = this.vaultCache.categories.find(c => c.id === id);
        if (category && category.type === 'system') {
            throw new Error("Cannot delete system categories");
        }

        const initialLength = this.vaultCache.categories.length;
        this.vaultCache.categories = this.vaultCache.categories.filter(c => c.id !== id);

        if (this.vaultCache.categories.length !== initialLength) {
            // Move any entries in this category back to default (null)
            this.vaultCache.entries.forEach(e => {
                if (e.categoryId === id) {
                    e.categoryId = null;
                }
            });
            await this._recordVaultTombstone(id);
            await this._saveToStorage();
            return true;
        }
        return false;
    }

    /**
     * Called by SyncService when the vault is unlocked to perform a true OCC merge.
     */
    async mergeCloudVault(cloudPayload, tombstones) {
        if (!this.isUnlocked || !this.masterKey) throw new Error('Vault must be unlocked to merge');
        if (!cloudPayload || !cloudPayload.data) return { localWon: false };

        // 1. Decrypt cloud payload
        let cloudCache;
        try {
            const plaintext = await this.crypto.decrypt(cloudPayload.data, cloudPayload.iv, this.masterKey);
            cloudCache = JSON.parse(plaintext);
        } catch (e) {
            console.warn('[Vault] Failed to decrypt cloud vault for merge. Keys mismatched?');
            return { localWon: false };
        }

        let localWon = false;

        // 2. Map tombstones
        const tombMap = new Map();
        if (tombstones && tombstones.items) {
            for (const t of tombstones.items) {
                const maxV = tombMap.get(t.id) || 0;
                if (t.vaultVersion > maxV) tombMap.set(t.id, t.vaultVersion);
            }
        }
        function isTombstoned(id, version) {
            const tVer = tombMap.get(id);
            if (tVer === undefined) return false;
            return tVer > version; // Strict greater than
        }

        // 3. Merge Categories
        const catMap = new Map();
        (cloudCache.categories || []).forEach(c => {
            if (!isTombstoned(c.id, cloudPayload.version || 1)) catMap.set(c.id, c);
        });
        (this.vaultCache.categories || []).forEach(c => {
            if (isTombstoned(c.id, this.vaultVersion || 1)) return; // skip dead local
            if (!catMap.has(c.id)) {
                catMap.set(c.id, c);
                localWon = true;
            } else {
                // no timestamps on categories right now, just let local win if conflict?
                // we'll adopt local.
                catMap.set(c.id, c);
                localWon = true; 
            }
        });
        this.vaultCache.categories = Array.from(catMap.values());

        // 4. Merge Entries
        const entryMap = new Map();
        (cloudCache.entries || []).forEach(e => {
            if (!isTombstoned(e.id, cloudPayload.version || 1)) entryMap.set(e.id, e);
        });
        (this.vaultCache.entries || []).forEach(e => {
            if (isTombstoned(e.id, this.vaultVersion || 1)) return;
            if (!entryMap.has(e.id)) {
                entryMap.set(e.id, e);
                localWon = true;
            } else {
                const cloudE = entryMap.get(e.id);
                const localTime = new Date(e.updatedAt || 0).getTime();
                const cloudTime = new Date(cloudE.updatedAt || 0).getTime();
                if (localTime > cloudTime) {
                    entryMap.set(e.id, e);
                    localWon = true;
                }
            }
        });
        this.vaultCache.entries = Array.from(entryMap.values());

        // 5. Check structural differences even if not technically "local won" timestamp wise
        // For instance, if cloud had items we didn't have, we adopted them into `this.vaultCache`.
        // So we MUST save them to disk!
        await this._saveToStorage();

        return { localWon };
    }

    /**
     * Records a deleted Vault ID so that it is never resurrected by sync.
     */
    async _recordVaultTombstone(id) {
        return new Promise(resolve => {
            chrome.storage.local.get(['vault_tombstones', this.STORAGE_KEY], (result) => {
                const tombstones = result.vault_tombstones || { items: [] };
                const vaultPayload = result[this.STORAGE_KEY] || { version: 1 };
                
                // Record the vault version at the time of deletion
                tombstones.items.push({
                    id: id,
                    deletedAt: new Date().toISOString(),
                    vaultVersion: vaultPayload.version
                });

                chrome.storage.local.set({ vault_tombstones: tombstones }, resolve);
            });
        });
    }

    // Simple event dispatcher for UI updates
    _listeners = {};
    on(event, callback) {
        if (!this._listeners[event]) this._listeners[event] = [];
        this._listeners[event].push(callback);
    }
    _dispatchEvent(event, data) {
        if (this._listeners[event]) {
            this._listeners[event].forEach(cb => cb(data));
        }
    }
}

// Attach globally if loaded in browser or service worker
const _globalVault = typeof window !== 'undefined' ? window : self;
if (_globalVault.cryptoService) {
    _globalVault.vaultService = new VaultService(_globalVault.cryptoService);
}
