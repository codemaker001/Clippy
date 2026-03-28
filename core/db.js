/**
 * core/db.js — IndexedDB shared configuration and initialization.
 * Single source of truth for database constants and setup.
 * Used by both popup context and the background service worker.
 *
 * v4: UUID-only primary keys (no more autoIncrement).
 *     The `id` field IS the UUID — no separate `uuid` index.
 */

const AppDB = (function () {

    const DB_NAME = 'PersonalDashboardDB';
    const DB_VERSION = 4; // v4: UUID-only primary keys
    const FOLDERS_STORE = 'folders';
    const ITEMS_STORE = 'items';

    let db = null;

    /**
     * Initialize / open the IndexedDB connection.
     * Returns a Promise that resolves with the db instance.
     * Safe to call multiple times — reuses the existing connection.
     */
    function initDB() {
        return new Promise((resolve, reject) => {
            if (db) return resolve(db);

            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onerror = () => reject('Database error');

            request.onupgradeneeded = (event) => {
                const dbInstance = event.target.result;
                const tx = event.target.transaction;

                // --- Folders store ---
                if (!dbInstance.objectStoreNames.contains(FOLDERS_STORE)) {
                    const fStore = dbInstance.createObjectStore(FOLDERS_STORE, { keyPath: 'id' });
                    fStore.createIndex('parentId', 'parentId', { unique: false });
                } else {
                    const fStore = tx.objectStore(FOLDERS_STORE);
                    // Migration: convert old autoIncrement records to UUID-keyed records
                    if (event.oldVersion < 4) {
                        _migrateStoreToUUID(fStore);
                    }
                    // Clean up legacy indexes
                    if (fStore.indexNames.contains('uuid')) fStore.deleteIndex('uuid');
                    if (!fStore.indexNames.contains('parentId')) {
                        fStore.createIndex('parentId', 'parentId', { unique: false });
                    }
                }

                // --- Items store ---
                if (!dbInstance.objectStoreNames.contains(ITEMS_STORE)) {
                    const iStore = dbInstance.createObjectStore(ITEMS_STORE, { keyPath: 'id' });
                    iStore.createIndex('folderId', 'folderId', { unique: false });
                    iStore.createIndex('tags', 'tags', { unique: false, multiEntry: true });
                } else {
                    const iStore = tx.objectStore(ITEMS_STORE);
                    // Migration: convert old autoIncrement records to UUID-keyed records
                    if (event.oldVersion < 4) {
                        _migrateStoreToUUID(iStore);
                    }
                    // Clean up legacy indexes
                    if (iStore.indexNames.contains('uuid')) iStore.deleteIndex('uuid');
                    if (!iStore.indexNames.contains('folderId')) {
                        iStore.createIndex('folderId', 'folderId', { unique: false });
                    }
                    if (!iStore.indexNames.contains('tags')) {
                        iStore.createIndex('tags', 'tags', { unique: false, multiEntry: true });
                    }
                }
            };

            request.onsuccess = (event) => {
                db = event.target.result;
                resolve(db);
            };
        });
    }

    /**
     * Migrate legacy autoIncrement records to UUID-keyed records.
     * For each record: if `uuid` exists, replace `id` with `uuid`;
     * otherwise generate a new UUID as `id`.
     */
    function _migrateStoreToUUID(store) {
        const getAllReq = store.getAll();
        getAllReq.onsuccess = () => {
            const records = getAllReq.result || [];
            for (const record of records) {
                // Delete the old numeric-keyed record
                store.delete(record.id);
                // Assign UUID as the new id
                const newId = record.uuid || crypto.randomUUID();
                const { uuid: _dropped, ...rest } = record;
                rest.id = newId;
                // Fix folder references: if parentId was numeric, clear it
                // (will be re-linked on next sync)
                if (rest.parentId && typeof rest.parentId === 'number') {
                    rest.parentId = null;
                }
                if (rest.folderId && typeof rest.folderId === 'number') {
                    rest.folderId = null;
                }
                store.add(rest);
            }
        };
    }

    /**
     * Get the current db instance (may be null if not yet initialized).
     */
    function getDB() {
        return db;
    }

    // --- CRUD Helpers ---

    function getItem(id) {
        return new Promise((resolve, reject) => {
            const request = db.transaction([ITEMS_STORE]).objectStore(ITEMS_STORE).get(id);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    function getFolder(id) {
        return new Promise(resolve => {
            db.transaction(FOLDERS_STORE).objectStore(FOLDERS_STORE).get(id).onsuccess = e => resolve(e.target.result);
        });
    }

    function addItem(item, onComplete) {
        // Use UUID as the primary key
        if (!item.id) item.id = crypto.randomUUID();
        if (!item.createdAt) item.createdAt = new Date().toISOString();
        item.updatedAt = new Date().toISOString();
        item.version = 1;

        const transaction = db.transaction([ITEMS_STORE], 'readwrite');
        const store = transaction.objectStore(ITEMS_STORE);
        store.add(item);
        transaction.oncomplete = () => {
            chrome.storage.local.set({ unpushedLocalChanges: true });
            if (onComplete) onComplete();
            globalThis.SyncService?.pushNote(item);
        };
        return transaction;
    }

    function updateItem(id, dataToUpdate, onComplete) {
        let updatedItem = null;
        const transaction = db.transaction([ITEMS_STORE], 'readwrite');
        const store = transaction.objectStore(ITEMS_STORE);
        const request = store.get(id);
        request.onsuccess = () => {
            const item = request.result;
            if (item) {
                updatedItem = {
                    ...item,
                    ...dataToUpdate,
                    updatedAt: new Date().toISOString(),
                    version: (item.version || 1) + 1
                };
                store.put(updatedItem);
            }
        };
        transaction.oncomplete = () => {
            chrome.storage.local.set({ unpushedLocalChanges: true });
            if (onComplete) onComplete();
            if (updatedItem) {
                globalThis.SyncService?.pushNote(updatedItem);
            }
        };
        return transaction;
    }

    function deleteItem(id, onComplete) {
        // Record tombstone before deleting so the deletion propagates on sync
        getItem(id).then(item => {
            if (item) {
                const deletedVersion = (item.version || 1) + 1;
                globalThis.SyncService?.deleteNoteFromCloud(item.id, deletedVersion);
            }
        });
        const transaction = db.transaction([ITEMS_STORE], 'readwrite');
        transaction.objectStore(ITEMS_STORE).delete(id);
        transaction.oncomplete = () => {
            chrome.storage.local.set({ unpushedLocalChanges: true });
            if (onComplete) onComplete();
        };
        return transaction;
    }

    async function addFolder(name, parentId = null, onComplete) {
        const allFolders = await getAllFolders();
        const sameLevelFolders = allFolders.filter(f => f.parentId === parentId);
        const maxOrder = sameLevelFolders.reduce((max, f) => Math.max(max, f.order || 0), -1);

        const folderData = {
            id: crypto.randomUUID(),
            name,
            pin: null,
            parentId,
            order: maxOrder + 1,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            version: 1
        };

        const transaction = db.transaction([FOLDERS_STORE], 'readwrite');
        const store = transaction.objectStore(FOLDERS_STORE);
        store.add(folderData);
        transaction.oncomplete = () => {
            chrome.storage.local.set({ unpushedLocalChanges: true });
            if (onComplete) onComplete();
            globalThis.SyncService?.pushFolder(folderData);
        };
        return transaction;
    }

    function updateFolderOrders(orderMap) {
        return new Promise((resolve, reject) => {
            const changedFolders = [];
            const transaction = db.transaction([FOLDERS_STORE], 'readwrite');
            const store = transaction.objectStore(FOLDERS_STORE);
            
            Object.keys(orderMap).forEach(id => {
                const order = orderMap[id];
                const request = store.get(id);
                request.onsuccess = () => {
                    const folder = request.result;
                    if (folder) {
                        folder.order = order;
                        folder.version = (folder.version || 1) + 1;
                        store.put(folder);
                        changedFolders.push({ ...folder });
                    }
                };
            });
            
            transaction.oncomplete = () => {
                chrome.storage.local.set({ unpushedLocalChanges: true });
                resolve();
                if (changedFolders.length > 0) {
                    globalThis.SyncService?.pushFolders(changedFolders);
                }
            };
            transaction.onerror = () => reject(transaction.error);
        });
    }

    function updateFolder(id, dataToUpdate, onComplete) {
        let updatedFolder = null;
        const transaction = db.transaction([FOLDERS_STORE], 'readwrite');
        const store = transaction.objectStore(FOLDERS_STORE);
        const request = store.get(id);
        request.onsuccess = () => {
            updatedFolder = {
                ...request.result,
                ...dataToUpdate,
                updatedAt: new Date().toISOString(),
                version: (request.result.version || 1) + 1
            };
            store.put(updatedFolder);
        };
        transaction.oncomplete = () => {
            chrome.storage.local.set({ unpushedLocalChanges: true });
            if (onComplete) onComplete();
            if (updatedFolder) {
                globalThis.SyncService?.pushFolder(updatedFolder);
            }
        };
        return transaction;
    }

    function deleteFolder(id, onComplete) {
        getAllFolders().then(allFolders => {
            const foldersToDelete = new Set([id]);
            let added = true;
            while (added) {
                added = false;
                for (const f of allFolders) {
                    if (f.parentId && foldersToDelete.has(f.parentId) && !foldersToDelete.has(f.id)) {
                        foldersToDelete.add(f.id);
                        added = true;
                    }
                }
            }

            const itemTransaction = db.transaction([ITEMS_STORE], 'readwrite');
            const itemStore = itemTransaction.objectStore(ITEMS_STORE);
            const itemRequest = itemStore.getAll();
            itemRequest.onsuccess = () => {
                itemRequest.result.forEach(item => {
                    if (foldersToDelete.has(item.folderId)) {
                        const deletedVersion = (item.version || 1) + 1;
                        globalThis.SyncService?.deleteNoteFromCloud(item.id, deletedVersion);
                        itemStore.delete(item.id);
                    }
                });
                // Delete folders and push tombstones
                allFolders.forEach(f => {
                    if (foldersToDelete.has(f.id)) {
                        const deletedVersion = (f.version || 1) + 1;
                        globalThis.SyncService?.deleteFolderFromCloud(f.id, deletedVersion);
                    }
                });
            };

            itemTransaction.oncomplete = () => {
                const folderTransaction = db.transaction([FOLDERS_STORE], 'readwrite');
                const folderStore = folderTransaction.objectStore(FOLDERS_STORE);
                foldersToDelete.forEach(folderId => folderStore.delete(folderId));
                folderTransaction.oncomplete = () => {
                    chrome.storage.local.set({ unpushedLocalChanges: true });
                    if (onComplete) onComplete();
                };
            };
        });
    }

    function getAllFolders() {
        return new Promise(resolve => {
            const request = db.transaction(FOLDERS_STORE).objectStore(FOLDERS_STORE).getAll();
            request.onsuccess = e => {
                const folders = e.target.result || [];
                // Sort by order, then by creation time as fallback
                folders.sort((a, b) => (a.order || 0) - (b.order || 0));
                resolve(folders);
            };
        });
    }

    function getAllItems() {
        return new Promise(resolve => {
            db.transaction(ITEMS_STORE).objectStore(ITEMS_STORE).getAll().onsuccess = e => resolve(e.target.result);
        });
    }

    function getItemsByFolder(folderId) {
        return new Promise(resolve => {
            db.transaction(ITEMS_STORE).objectStore(ITEMS_STORE).index('folderId').getAll(folderId).onsuccess = e => resolve(e.target.result);
        });
    }

    return {
        DB_NAME,
        DB_VERSION,
        FOLDERS_STORE,
        ITEMS_STORE,
        initDB,
        getDB,
        getItem,
        getFolder,
        addItem,
        updateItem,
        deleteItem,
        addFolder,
        updateFolder,
        updateFolderOrders,
        deleteFolder,
        getAllFolders,
        getAllItems,
        getItemsByFolder
    };

})();

// Expose to global scope (works in both window and service worker)
globalThis.AppDB = AppDB;
