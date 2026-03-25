/**
 * core/db.js — IndexedDB shared configuration and initialization.
 * Single source of truth for database constants and setup.
 * Used by both popup context and the background service worker.
 */

const AppDB = (function () {

    const DB_NAME = 'PersonalDashboardDB';
    const DB_VERSION = 3; // v3: added 'uuid' unique index on folders + items
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

                // --- Folders store ---
                if (!dbInstance.objectStoreNames.contains(FOLDERS_STORE)) {
                    const fStore = dbInstance.createObjectStore(FOLDERS_STORE, { keyPath: 'id', autoIncrement: true });
                    fStore.createIndex('uuid', 'uuid', { unique: true });
                } else {
                    const fStore = event.target.transaction.objectStore(FOLDERS_STORE);
                    if (!fStore.indexNames.contains('uuid')) {
                        fStore.createIndex('uuid', 'uuid', { unique: false }); // non-unique during migration (existing rows have no uuid)
                    }
                }

                // --- Items store ---
                let itemsStore;
                if (!dbInstance.objectStoreNames.contains(ITEMS_STORE)) {
                    itemsStore = dbInstance.createObjectStore(ITEMS_STORE, { keyPath: 'id', autoIncrement: true });
                } else {
                    itemsStore = event.target.transaction.objectStore(ITEMS_STORE);
                }

                if (!itemsStore.indexNames.contains('folderId')) {
                    itemsStore.createIndex('folderId', 'folderId', { unique: false });
                }
                if (!itemsStore.indexNames.contains('tags')) {
                    itemsStore.createIndex('tags', 'tags', { unique: false, multiEntry: true });
                }
                if (!itemsStore.indexNames.contains('uuid')) {
                    itemsStore.createIndex('uuid', 'uuid', { unique: false }); // non-unique during migration
                }
            };

            request.onsuccess = (event) => {
                db = event.target.result;
                resolve(db);
            };
        });
    }

    /**
     * Get the current db instance (may be null if not yet initialized).
     */
    function getDB() {
        return db;
    }

    // --- CRUD Helpers (for Notes module, which uses IndexedDB directly) ---

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
        // Inject stable cross-device UUID if missing
        if (!item.uuid) item.uuid = crypto.randomUUID();
        // Stamp createdAt and updatedAt for timestamp-based merge
        if (!item.createdAt) item.createdAt = new Date().toISOString();
        item.updatedAt = new Date().toISOString();
        item.version = 1; // Logical clock initialization

        const transaction = db.transaction([ITEMS_STORE], 'readwrite');
        transaction.objectStore(ITEMS_STORE).add(item);
        transaction.oncomplete = () => {
            chrome.storage.local.set({ unpushedLocalChanges: true });
            if (onComplete) onComplete();
            globalThis.SyncService?.triggerAutoSync();
        };
        return transaction;
    }

    function updateItem(id, dataToUpdate, onComplete) {
        const transaction = db.transaction([ITEMS_STORE], 'readwrite');
        const store = transaction.objectStore(ITEMS_STORE);
        const request = store.get(id);
        request.onsuccess = () => {
            const item = request.result;
            if (item) {
                store.put({
                    ...item,
                    ...dataToUpdate,
                    updatedAt: new Date().toISOString(),
                    version: (item.version || 1) + 1 // Increment logical clock
                });
            }
        };
        transaction.oncomplete = () => {
            chrome.storage.local.set({ unpushedLocalChanges: true });
            if (onComplete) onComplete();
            globalThis.SyncService?.triggerAutoSync();
        };
        return transaction;
    }

    function deleteItem(id, onComplete) {
        // Record tombstone before deleting so the deletion propagates on sync
        getItem(id).then(item => {
            if (item?.uuid) {
                const deletedVersion = (item.version || 1) + 1; // Tombstone strictly beats item
                globalThis.SyncService?._recordTombstone(item.uuid, deletedVersion);
            }
        });
        const transaction = db.transaction([ITEMS_STORE], 'readwrite');
        transaction.objectStore(ITEMS_STORE).delete(id);
        transaction.oncomplete = () => {
            chrome.storage.local.set({ unpushedLocalChanges: true });
            if (onComplete) onComplete();
            globalThis.SyncService?.triggerAutoSync();
        };
        return transaction;
    }

    async function addFolder(name, parentId = null, onComplete) {
        const allFolders = await getAllFolders();
        const sameLevelFolders = allFolders.filter(f => f.parentId === parentId);
        const maxOrder = sameLevelFolders.reduce((max, f) => Math.max(max, f.order || 0), -1);

        const folderData = {
            name,
            pin: null,
            parentId,
            order: maxOrder + 1,
            uuid: crypto.randomUUID(),          // stable cross-device UUID
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            version: 1 // Logical clock initialization
        };

        const transaction = db.transaction([FOLDERS_STORE], 'readwrite');
        transaction.objectStore(FOLDERS_STORE).add(folderData);
        transaction.oncomplete = () => {
            chrome.storage.local.set({ unpushedLocalChanges: true });
            if (onComplete) onComplete();
            globalThis.SyncService?.triggerAutoSync();
        };
        return transaction;
    }

    function updateFolderOrders(orderMap) {
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([FOLDERS_STORE], 'readwrite');
            const store = transaction.objectStore(FOLDERS_STORE);
            
            Object.keys(orderMap).forEach(id => {
                const folderId = parseInt(id);
                const order = orderMap[id];
                const request = store.get(folderId);
                request.onsuccess = () => {
                    const folder = request.result;
                    if (folder) {
                        folder.order = order;
                        folder.version = (folder.version || 1) + 1; // Increment logical clock on order change
                        store.put(folder);
                    }
                };
            });
            
            transaction.oncomplete = () => {
                chrome.storage.local.set({ unpushedLocalChanges: true });
                resolve();
                globalThis.SyncService?.triggerAutoSync();
            };
            transaction.onerror = () => reject(transaction.error);
        });
    }

    function updateFolder(id, dataToUpdate, onComplete) {
        const transaction = db.transaction([FOLDERS_STORE], 'readwrite');
        const store = transaction.objectStore(FOLDERS_STORE);
        const request = store.get(id);
        request.onsuccess = () => {
            store.put({
                ...request.result,
                ...dataToUpdate,
                updatedAt: new Date().toISOString(),
                version: (request.result.version || 1) + 1 // Increment logical clock
            });
        };
        transaction.oncomplete = () => {
            chrome.storage.local.set({ unpushedLocalChanges: true });
            if (onComplete) onComplete();
            globalThis.SyncService?.triggerAutoSync();
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
                        // Record tombstone so deletion propagates on sync
                        if (item.uuid) {
                            const deletedVersion = (item.version || 1) + 1;
                            globalThis.SyncService?._recordTombstone(item.uuid, deletedVersion);
                        }
                        itemStore.delete(item.id);
                    }
                });
                // Tombstone the folders themselves too
                allFolders.forEach(f => {
                    if (foldersToDelete.has(f.id) && f.uuid) {
                        const deletedVersion = (f.version || 1) + 1;
                        globalThis.SyncService?._recordTombstone(f.uuid, deletedVersion);
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
                    globalThis.SyncService?.triggerAutoSync();
                };
            };
        });
    }

    function getAllFolders() {
        return new Promise(resolve => {
            const request = db.transaction(FOLDERS_STORE).objectStore(FOLDERS_STORE).getAll();
            request.onsuccess = e => {
                const folders = e.target.result || [];
                // Sort by order, then by ID as fallback
                folders.sort((a, b) => (a.order || 0) - (b.order || 0) || (a.id - b.id));
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
