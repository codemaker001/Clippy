/**
 * core/sync.js — Supabase Cloud Sync + User Registry + Premium
 * 
 * Web-Based Auth Flow:
 * - Opens a hosted login page for authentication
 * - Receives auth tokens via chrome.runtime.onMessageExternal
 * - Uses Supabase client for all database + storage operations
 * - Supports Google, GitHub, and Email/Password login
 * 
 * Schema (4 tables):
 *   profiles   → user profile + vault keys + encrypted vault + settings
 *   folders    → per-row folder storage (UUID PK)
 *   notes      → per-row note storage (UUID PK)
 *   tombstones → deleted entity tracking with entity_type
 *   Storage: user-files/{uid}/  → uploaded blobs (images, PDFs, videos)
 */

const SyncService = (function () {

    // ========================================================================
    // CONFIGURATION
    // ========================================================================

    const ENV = globalThis.ENV || {};
    const SUPABASE_URL = ENV.SUPABASE_URL || '';
    const SUPABASE_ANON_KEY = ENV.SUPABASE_ANON_KEY || '';
    const ADMIN_EMAILS = ENV.ADMIN_EMAILS || [];
    const AUTH_PAGE_URL = ENV.AUTH_PAGE_URL || '';
    const SYNC_STATE_KEY = 'sync_state';
    const VAULT_PUSH_DEBOUNCE_MS = 500;
    const SETTINGS_PUSH_DEBOUNCE_MS = 500;

    // ========================================================================
    // STATE
    // ========================================================================

    let _syncInProgress = false;
    let _supabase = null;
    let _realtimeChannel = null;
    let _vaultPushTimer = null;
    let _settingsPushTimer = null;
    let _retryQueue = [];

    // Track recently pushed IDs to prevent self-echo from Realtime
    const _recentPushIDs = new Set();
    function _markPushed(id) {
        if (!id) return;
        _recentPushIDs.add(id);
        setTimeout(() => _recentPushIDs.delete(id), 5000);
    }

    // ========================================================================
    // SUPABASE CLIENT
    // ========================================================================

    function _getSupabaseClient() {
        if (_supabase) return _supabase;
        if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
            console.error('[Sync] Supabase URL or Anon Key not configured.');
            return null;
        }
        const createClient = globalThis.supabase?.createClient;
        if (!createClient) {
            console.error('[Sync] Supabase JS client not loaded. Check vendor/supabase.min.js');
            return null;
        }
        _supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
            auth: { persistSession: false, autoRefreshToken: false }
        });
        return _supabase;
    }

    // ========================================================================
    // SHARED HELPERS
    // ========================================================================

    const DEFAULT_SYNC_STATE = {
        lastSyncedAt: null, googleProfile: null, accessToken: null,
        refreshToken: null, isPremium: false, autoSync: true,
        syncStatus: 'idle', tokenExpiresAt: null
    };

    function _getSyncState() {
        return new Promise(resolve => {
            chrome.storage.local.get([SYNC_STATE_KEY], (result) => {
                resolve(result[SYNC_STATE_KEY] || { ...DEFAULT_SYNC_STATE });
            });
        });
    }

    function _setSyncState(state) {
        return new Promise(resolve => {
            chrome.storage.local.set({ [SYNC_STATE_KEY]: state }, resolve);
        });
    }

    /** Get authenticated client + uid in one call. */
    async function _getAuthContext() {
        const sb = await _getAuthenticatedClient();
        const state = await _getSyncState();
        const uid = state.googleProfile?.uid;
        if (!uid) throw new Error('Not signed in');
        return { sb, uid, state };
    }

    // --- Row mappers: cloud (snake_case) ↔ local (camelCase) ---
    // Note: `id` is the UUID — no separate `uuid` field.

    function _cloudNoteToLocal(r) {
        return {
            id: r.id, folderId: r.folder_id,
            type: r.type, title: r.title, content: r.content,
            fileUrl: r.file_url, fileMimeType: r.file_mime_type,
            tags: r.tags, color: r.color, version: r.version,
            createdAt: r.created_at, updatedAt: r.updated_at
        };
    }

    function _cloudFolderToLocal(r) {
        return {
            id: r.id, name: r.name, pin: r.pin,
            parentId: r.parent_id, order: r.sort_order, version: r.version,
            createdAt: r.created_at, updatedAt: r.updated_at
        };
    }

    function _localFolderToCloud(f, uid) {
        const now = new Date().toISOString();
        return {
            id: f.id, user_id: uid, name: f.name, pin: f.pin || null,
            parent_id: f.parentId || null, sort_order: f.order || 0,
            version: f.version || 1,
            created_at: f.createdAt || now, updated_at: f.updatedAt || now
        };
    }

    function _localNoteToCloud(item, uid, fileUrl) {
        const now = new Date().toISOString();
        return {
            id: item.id, user_id: uid, folder_id: item.folderId || null,
            type: item.type || 'text', title: item.title || null,
            content: item.content || null, file_url: fileUrl,
            file_mime_type: item.fileMimeType || item.fileBlob?.type || null,
            tags: item.tags || [], color: item.color || null,
            version: item.version || 1,
            created_at: item.createdAt || now, updated_at: item.updatedAt || now
        };
    }

    // --- Tombstone helpers ---

    function _buildTombstoneMap(tombstones) {
        const map = new Map();
        if (tombstones?.length) {
            for (const t of tombstones) {
                const cur = map.get(t.entity_id) || 0;
                const ver = t.version || 999999;
                if (ver > cur) map.set(t.entity_id, ver);
            }
        }
        return map;
    }

    function _isTombstoned(tombstoneMap, item) {
        const ver = tombstoneMap.get(item.id);
        return ver !== undefined && ver > (item.version || 1);
    }

    // --- Time helper ---

    function getRelativeTime(isoString) {
        if (!isoString) return 'Never';
        const diff = Date.now() - new Date(isoString).getTime();
        const seconds = Math.floor(diff / 1000);
        if (seconds < 60) return 'Just now';
        const minutes = Math.floor(seconds / 60);
        if (minutes < 60) return `${minutes} min ago`;
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return `${hours}h ago`;
        return `${Math.floor(hours / 24)}d ago`;
    }

    // ========================================================================
    // AUTH
    // ========================================================================

    async function signIn() {
        chrome.tabs.create({ url: `${AUTH_PAGE_URL}/index.html` });
    }

    async function handleAuthResult(authData) {
        try {
            const { accessToken, refreshToken, profile, vaultKeys } = authData;

            const sb = _getSupabaseClient();
            if (sb) {
                await sb.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
            }

            const state = await _getSyncState();
            state.googleProfile = profile;
            state.accessToken = accessToken;
            state.refreshToken = refreshToken;
            state.syncStatus = 'idle';
            state.tokenExpiresAt = Date.now() + (55 * 60 * 1000);
            await _setSyncState(state);

            if (vaultKeys) {
                await new Promise(r => chrome.storage.local.set({ pm_vault_keys: vaultKeys }, r));
                if (globalThis.vaultService && typeof globalThis.vaultService.secureVault === 'function') {
                    console.log('[Sync] Vault keys stored. Vault will be secured on next access.');
                }
            }

            await _registerUser(profile);
            const syncStatus = await _firstSync();
            return { profile, syncStatus };
        } catch (err) {
            console.error('SyncService.handleAuthResult failed:', err);
            throw err;
        }
    }

    async function signOut() {
        const sb = _getSupabaseClient();
        if (sb) await sb.auth.signOut().catch(() => {});
        _unsubscribeRealtime();

        await new Promise(resolve => chrome.storage.local.clear(resolve));
        try {
            const db = await AppDB.initDB();
            const tx = db.transaction([AppDB.ITEMS_STORE, AppDB.FOLDERS_STORE], 'readwrite');
            tx.objectStore(AppDB.ITEMS_STORE).clear();
            tx.objectStore(AppDB.FOLDERS_STORE).clear();
            await new Promise(r => { tx.oncomplete = r; tx.onerror = r; });
        } catch (e) {
            console.error('[Sync] Error wiping IndexedDB on logout:', e);
        }

        await _setSyncState({ ...DEFAULT_SYNC_STATE });
        chrome.runtime.reload();
    }

    async function isSignedIn() {
        const state = await _getSyncState();
        return !!(state.googleProfile?.email && state.accessToken);
    }

    async function isPremium() {
        return !!(await _getSyncState()).isPremium;
    }

    async function getProfile() {
        return (await _getSyncState()).googleProfile || null;
    }

    async function isAdmin() {
        const profile = await getProfile();
        return profile && ADMIN_EMAILS.includes(profile.email);
    }

    async function _getAuthenticatedClient() {
        const sb = _getSupabaseClient();
        if (!sb) throw new Error('Supabase client not initialized');

        const state = await _getSyncState();
        if (!state.accessToken || !state.refreshToken) throw new Error('Not signed in');

        // Token still valid (5 min buffer)
        if (state.tokenExpiresAt && Date.now() < (state.tokenExpiresAt - 5 * 60 * 1000)) {
            await sb.auth.setSession({ access_token: state.accessToken, refresh_token: state.refreshToken });
            return sb;
        }

        // Refresh session
        const { data, error } = await sb.auth.setSession({
            access_token: state.accessToken, refresh_token: state.refreshToken
        });
        if (error || !data.session) {
            await signOut();
            throw new Error('Session expired. Please sign in again.');
        }

        state.accessToken = data.session.access_token;
        state.refreshToken = data.session.refresh_token;
        state.tokenExpiresAt = Date.now() + (55 * 60 * 1000);
        await _setSyncState(state);
        return sb;
    }

    // ========================================================================
    // PREMIUM
    // ========================================================================

    async function setPremiumStatus(isPremiumFlag) {
        const { sb, uid, state } = await _getAuthContext();
        const { error } = await sb.from('profiles').update({
            is_premium: isPremiumFlag,
            premium_since: isPremiumFlag ? new Date().toISOString() : null
        }).eq('id', uid);
        if (error) throw error;
        state.isPremium = isPremiumFlag;
        await _setSyncState(state);
    }

    // ========================================================================
    // INSTANT PER-ITEM PUSH
    // ========================================================================

    async function pushNote(item) {
        try {
            const { sb, uid } = await _getAuthContext();
            if (!item?.id) return;

            let fileUrl = item.fileUrl || null;
            if (item.fileBlob && item.fileBlob instanceof Blob) {
                fileUrl = await _uploadBlobToStorage(sb, uid, item.fileBlob, item.id);
            }

            const row = _localNoteToCloud(item, uid, fileUrl);
            const { error } = await sb.from('notes').upsert(row, { onConflict: 'user_id,id' });
            if (error) {
                console.error('[Sync] pushNote error:', error);
                _enqueueRetry({ type: 'pushNote', payload: { item } });
            } else {
                _markPushed(item.id);
            }
        } catch (e) {
            console.warn('[Sync] pushNote failed:', e.message);
            _enqueueRetry({ type: 'pushNote', payload: { item } });
        }
    }

    async function pushFolder(folder) {
        try {
            const { sb, uid } = await _getAuthContext();
            if (!folder?.id) return;

            const row = _localFolderToCloud(folder, uid);
            const { error } = await sb.from('folders').upsert(row, { onConflict: 'user_id,id' });
            if (error) {
                console.error('[Sync] pushFolder error:', error);
                _enqueueRetry({ type: 'pushFolder', payload: { folder } });
            } else {
                _markPushed(folder.id);
            }
        } catch (e) {
            console.warn('[Sync] pushFolder failed:', e.message);
            _enqueueRetry({ type: 'pushFolder', payload: { folder } });
        }
    }

    async function pushFolders(folders) {
        for (const f of folders) await pushFolder(f);
    }

    /** Unified cloud delete for notes or folders. */
    async function _deleteFromCloud(table, entityType, entityId, version) {
        try {
            await _recordTombstone(entityId, entityType, version);
            const { sb, uid } = await _getAuthContext();
            await sb.from(table).delete().eq('user_id', uid).eq('id', entityId);
            _markPushed(entityId);
        } catch (e) {
            console.warn(`[Sync] delete from ${table} failed:`, e.message);
            _enqueueRetry({ type: table === 'notes' ? 'deleteNote' : 'deleteFolder', payload: { entityId, entityType, version } });
        }
    }

    function deleteNoteFromCloud(entityId, version) { return _deleteFromCloud('notes', 'note', entityId, version); }
    function deleteFolderFromCloud(entityId, version) { return _deleteFromCloud('folders', 'folder', entityId, version); }

    function pushVault() {
        if (_vaultPushTimer) clearTimeout(_vaultPushTimer);
        _vaultPushTimer = setTimeout(() => _doPushVault(), VAULT_PUSH_DEBOUNCE_MS);
    }

    async function _doPushVault() {
        try {
            const { sb, uid } = await _getAuthContext();
            const vaultData = await new Promise(r => chrome.storage.local.get(['pm_vault_data', 'pm_vault_keys'], r));
            const now = new Date().toISOString();

            const updatePayload = {};

            if (vaultData.pm_vault_data) {
                const payload = { ...vaultData.pm_vault_data };
                updatePayload.encrypted_vault = payload;
                updatePayload.vault_version = payload.version || 1;
            }

            if (vaultData.pm_vault_keys) {
                const k = vaultData.pm_vault_keys;
                updatePayload.vault_salt = k.salt;
                updatePayload.vault_edek = k.edek;
                updatePayload.vault_edek_iv = k.edek_iv;
                updatePayload.vault_validator = k.validator;
                updatePayload.vault_validator_iv = k.validator_iv;
            }

            if (Object.keys(updatePayload).length > 0) {
                await sb.from('profiles').update(updatePayload).eq('id', uid);
                _markPushed('vault_' + uid);
            }

            await new Promise(r => chrome.storage.local.set({ unpushedVaultChanges: false }, r));
        } catch (e) {
            console.warn('[Sync] pushVault failed:', e.message);
        }
    }

    function pushSettings() {
        if (_settingsPushTimer) clearTimeout(_settingsPushTimer);
        _settingsPushTimer = setTimeout(() => _doPushSettings(), SETTINGS_PUSH_DEBOUNCE_MS);
    }

    async function _doPushSettings() {
        try {
            const { sb, uid } = await _getAuthContext();
            const settingsData = await new Promise(r => chrome.storage.local.get(['pm_settings'], r));

            if (settingsData.pm_settings && Object.keys(settingsData.pm_settings).length > 0) {
                const now = new Date().toISOString();
                await sb.from('profiles').update({
                    settings: settingsData.pm_settings,
                    settings_updated_at: now
                }).eq('id', uid);
                _markPushed('settings_' + uid);
                await new Promise(r => chrome.storage.local.set({ settings_updatedAt: now }, r));
            }
        } catch (e) {
            console.warn('[Sync] pushSettings failed:', e.message);
        }
    }

    // ========================================================================
    // RETRY QUEUE
    // ========================================================================

    function _enqueueRetry(op) {
        op.retries = (op.retries || 0);
        if (op.retries >= 3) { console.warn('[Sync] Dropping after 3 retries:', op.type); return; }
        op.retries++;
        _retryQueue.push(op);
    }

    async function _drainRetryQueue() {
        if (_retryQueue.length === 0) return;
        const queue = [..._retryQueue];
        _retryQueue = [];
        const handlers = {
            pushNote: op => pushNote(op.payload.item),
            pushFolder: op => pushFolder(op.payload.folder),
            deleteNote: op => deleteNoteFromCloud(op.payload.entityId, op.payload.version),
            deleteFolder: op => deleteFolderFromCloud(op.payload.entityId, op.payload.version)
        };
        for (const op of queue) {
            try { await (handlers[op.type]?.(op)); }
            catch (e) { console.warn('[Sync] Retry failed for', op.type, e.message); _enqueueRetry(op); }
        }
    }

    // ========================================================================
    // TOMBSTONE
    // ========================================================================

    async function _recordTombstone(entityId, entityType, version = null) {
        try {
            const { sb, uid } = await _getAuthContext();
            await sb.from('tombstones').upsert({
                user_id: uid, entity_id: entityId, entity_type: entityType,
                version: version || 999999,
                deleted_at: new Date().toISOString()
            }, { onConflict: 'user_id,entity_id' });
        } catch (e) {
            console.warn('[Sync] Could not record tombstone:', e);
        }
    }

    // ========================================================================
    // REALTIME
    // ========================================================================

    function _subscribeRealtime(uid) {
        if (_realtimeChannel) return;
        const sb = _getSupabaseClient();
        if (!sb) return;

        const tables = ['notes', 'folders', 'tombstones', 'profiles'];
        let channel = sb.channel('sync-changes');
        for (const table of tables) {
            const filter = table === 'profiles'
                ? `id=eq.${uid}`
                : `user_id=eq.${uid}`;
            channel = channel.on('postgres_changes', {
                event: '*', schema: 'public', table, filter
            }, (payload) => _handleRealtimeChange(table, payload));
        }
        _realtimeChannel = channel.subscribe();
    }

    function _unsubscribeRealtime() {
        if (_realtimeChannel) {
            const sb = _getSupabaseClient();
            if (sb) sb.removeChannel(_realtimeChannel);
            _realtimeChannel = null;
        }
    }

    async function _handleRealtimeChange(table, payload) {
        const row = payload.new || payload.old || {};
        let rowId = row.id
            || (table === 'profiles' ? 'profile_' + row.id : null);
        if (rowId && _recentPushIDs.has(rowId)) return;

        // Also check vault/settings push markers
        if (table === 'profiles') {
            if (_recentPushIDs.has('vault_' + row.id) || _recentPushIDs.has('settings_' + row.id)) return;
        }

        console.log(`[Sync Realtime] ${table} ${payload.eventType}`, payload);

        try {
            let changeType = 'sync_completed';

            if (table === 'notes') {
                changeType = 'notes_changed';
                if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
                    await importNotesData({ folders: [], items: [_cloudNoteToLocal(payload.new)] });
                } else if (payload.eventType === 'DELETE' && payload.old?.id) {
                    await _deleteLocalById(AppDB.ITEMS_STORE, payload.old.id);
                }
            } else if (table === 'folders') {
                changeType = 'notes_changed';
                if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
                    await importNotesData({ folders: [_cloudFolderToLocal(payload.new)], items: [] });
                } else if (payload.eventType === 'DELETE' && payload.old?.id) {
                    await _deleteLocalById(AppDB.FOLDERS_STORE, payload.old.id);
                }
            } else if (table === 'profiles') {
                // Detect vault or settings changes from the profiles row
                if (payload.eventType === 'UPDATE' && payload.new) {
                    const newRow = payload.new;
                    if (newRow.encrypted_vault && Object.keys(newRow.encrypted_vault).length > 0) {
                        changeType = 'vault_changed';
                        await _importVaultData(newRow.encrypted_vault, newRow.vault_version);
                    }
                    if (newRow.settings && Object.keys(newRow.settings).length > 0) {
                        if (changeType === 'vault_changed') {
                            // Also settings changed — send separate message
                            await _importSettingsData(newRow.settings, newRow.settings_updated_at);
                            _notifyUI('settings_changed');
                        } else {
                            changeType = 'settings_changed';
                            await _importSettingsData(newRow.settings, newRow.settings_updated_at);
                        }
                    }
                }
            } else if (table === 'tombstones') {
                changeType = 'notes_changed';
                if (payload.eventType === 'INSERT') {
                    const entityType = payload.new.entity_type;
                    const entityId = payload.new.entity_id;
                    if (entityType === 'note') {
                        await _deleteLocalById(AppDB.ITEMS_STORE, entityId);
                    } else if (entityType === 'folder') {
                        await _deleteLocalById(AppDB.FOLDERS_STORE, entityId);
                    }
                }
            }

            _notifyUI(changeType);
            if (changeType !== 'sync_completed') {
                _notifyUI('sync_completed');
            }
        } catch (e) {
            console.warn('[Sync Realtime] Error handling change:', e);
        }
    }

    function _notifyUI(action) {
        if (typeof chrome !== 'undefined' && chrome.runtime) {
            chrome.runtime.sendMessage({ action }).catch(() => {});
        }
    }

    // ========================================================================
    // SYNC ENGINE
    // ========================================================================

    async function _firstSync() {
        const { sb, uid } = await _getAuthContext();

        const { data: cloudNotes } = await sb.from('notes').select('*').eq('user_id', uid);
        const { data: cloudFolders } = await sb.from('folders').select('*').eq('user_id', uid);
        const { data: cloudProfile } = await sb.from('profiles').select('encrypted_vault, vault_version, settings, settings_updated_at').eq('id', uid).maybeSingle();

        const hasCloudData = (cloudNotes?.length > 0) || (cloudFolders?.length > 0)
            || !!(cloudProfile?.encrypted_vault && Object.keys(cloudProfile.encrypted_vault).length > 0)
            || !!(cloudProfile?.settings && Object.keys(cloudProfile.settings).length > 0);

        const localData = await exportLocalData();
        const hasLocalData = (localData.items?.length > 0) || (localData.folders?.length > 0)
            || !!(localData.vault?.encrypted_vault || localData.vault?.data);

        if (!hasCloudData && hasLocalData) {
            console.log('[Sync] First sync: uploading local data to cloud');
            await _uploadAllToCloud(uid, localData);
        } else if (hasCloudData && !hasLocalData) {
            console.log('[Sync] First sync: downloading cloud data to local');
            await _downloadAllFromCloud(uid);
        } else if (hasCloudData && hasLocalData) {
            console.log('[Sync] First sync: both local and cloud data exist — prompting user');
            return { status: 'NEEDS_MERGE', cloudCount: cloudNotes?.length || 0, localCount: localData.items?.length || 0 };
        } else {
            console.log('[Sync] First sync: no data anywhere, nothing to sync');
            const state = await _getSyncState();
            state.lastSyncedAt = new Date().toISOString();
            await _setSyncState(state);
        }

        _subscribeRealtime(uid);
        return { status: 'DONE' };
    }

    async function handleMergeResponse(choice) {
        const { sb, uid, state } = await _getAuthContext();

        if (choice === 'merge') {
            const localData = await exportLocalData();
            const { data: cloudNotes } = await sb.from('notes').select('*').eq('user_id', uid);
            const { data: cloudFolders } = await sb.from('folders').select('*').eq('user_id', uid);
            const { data: tombstones } = await sb.from('tombstones').select('*').eq('user_id', uid);

            const merged = _mergeNotesData(localData, { items: cloudNotes || [], folders: cloudFolders || [] }, tombstones || []);
            await importNotesData(merged.data);
            await _uploadAllToCloud(uid, await exportLocalData());
        } else {
            await _downloadAllFromCloud(uid);
        }

        await new Promise(r => chrome.storage.local.set({ unpushedLocalChanges: false }, r));
        state.lastSyncedAt = new Date().toISOString();
        state.syncStatus = 'idle';
        await _setSyncState(state);
        _subscribeRealtime(uid);
    }

    async function syncAll(retryCount = 0) {
        if (retryCount > 3) throw new Error('Sync failed after 3 retries');

        if (retryCount === 0) {
            if (_syncInProgress) return;
            _syncInProgress = true;
            await _drainRetryQueue();
        }

        const state = await _getSyncState();
        state.syncStatus = 'syncing';
        await _setSyncState(state);

        try {
            const sb = await _getAuthenticatedClient();
            const uid = state.googleProfile.uid;

            const flagData = await new Promise(r => chrome.storage.local.get(['unpushedLocalChanges', 'unpushedVaultChanges'], r));
            let needsPush = !!flagData.unpushedLocalChanges || !!flagData.unpushedVaultChanges;
            let localData = await exportLocalData();

            // Pull cloud data
            const { data: cloudNotes } = await sb.from('notes').select('*').eq('user_id', uid);
            const { data: cloudFolders } = await sb.from('folders').select('*').eq('user_id', uid);
            const { data: cloudProfile } = await sb.from('profiles').select('*').eq('id', uid).maybeSingle();
            const { data: tombstones } = await sb.from('tombstones').select('*').eq('user_id', uid);

            // Merge Notes & Folders
            const cloudData = { items: cloudNotes || [], folders: cloudFolders || [] };
            if (cloudData.items.length > 0 || cloudData.folders.length > 0) {
                const mergeResult = _mergeNotesData(localData, cloudData, tombstones || []);
                await importNotesData(mergeResult.data);
                await _applyTombstonesLocally(tombstones || [], localData);
                if (mergeResult.localWon) needsPush = true;
            } else if (localData.items.length > 0 || localData.folders.length > 0) {
                needsPush = true;
            }

            // Merge Vault Keys (from profiles table)
            const cloudVaultKeys = cloudProfile ? {
                salt: cloudProfile.vault_salt,
                edek: cloudProfile.vault_edek,
                edek_iv: cloudProfile.vault_edek_iv,
                validator: cloudProfile.vault_validator,
                validator_iv: cloudProfile.vault_validator_iv
            } : null;
            const hasCloudVaultKeys = cloudVaultKeys?.salt;

            if (hasCloudVaultKeys && (!localData.vaultKeys || cloudVaultKeys.salt !== localData.vaultKeys.salt)) {
                await new Promise(r => chrome.storage.local.set({ pm_vault_keys: cloudVaultKeys }, r));
                needsPush = false;
                if (typeof window !== 'undefined' && window.vaultService) window.vaultService.lock();
            } else if (localData.vaultKeys && !hasCloudVaultKeys) {
                needsPush = true;
            }

            // Merge Vault Data (from profiles table)
            const cloudVault = cloudProfile?.encrypted_vault;
            const cloudVaultVersion = cloudProfile?.vault_version || 0;
            if (cloudVault && Object.keys(cloudVault).length > 0) {
                if (typeof window !== 'undefined' && window.vaultService?.isUnlocked) {
                    const mergeResult = await window.vaultService.mergeCloudVault(cloudVault, { items: tombstones || [] });
                    if (mergeResult.localWon) needsPush = true;
                } else {
                    const localVer = localData.vault?.version || 1;
                    if (cloudVaultVersion > localVer) await _importVaultData(cloudVault, cloudVaultVersion);
                    else if (localVer > cloudVaultVersion) needsPush = true;
                }
            } else if (localData.vault) {
                needsPush = true;
            }

            // Merge Settings (from profiles table)
            const localSettingsTime = new Date(localData._settingsUpdatedAt || 0).getTime();
            const cloudSettingsTime = new Date(cloudProfile?.settings_updated_at || 0).getTime();
            if (cloudProfile?.settings && cloudSettingsTime > localSettingsTime) {
                await _importSettingsData(cloudProfile.settings, cloudProfile.settings_updated_at);
            } else if (Object.keys(localData.settings).length > 0 && localSettingsTime > cloudSettingsTime) {
                needsPush = true;
            }

            // Push phase
            if (needsPush) {
                await _uploadAllToCloud(uid, await exportLocalData());
                await new Promise(r => chrome.storage.local.set({ unpushedLocalChanges: false, unpushedVaultChanges: false }, r));
            }

            const now = new Date().toISOString();
            state.lastSyncedAt = now;
            state.syncStatus = 'idle';
            await _setSyncState(state);
            _subscribeRealtime(uid);

        } catch (err) {
            console.error('SyncService.syncAll failed:', err);
            state.syncStatus = 'error';
            await _setSyncState(state);
        } finally {
            if (retryCount === 0) _syncInProgress = false;
        }
    }

    // ========================================================================
    // MERGE LOGIC
    // ========================================================================

    /** Merge a single collection (folders or items), returning { merged, localWon }. */
    function _mergeCollection(localItems, cloudItems, tombstoneMap) {
        let localWon = false;
        const map = new Map();

        // Cloud first
        if (cloudItems) {
            for (const item of cloudItems) {
                if (!_isTombstoned(tombstoneMap, item)) map.set(item.id, item);
            }
        }
        // Local overwrites if higher version
        if (localItems) {
            for (const item of localItems) {
                if (_isTombstoned(tombstoneMap, item)) continue;

                if (!map.has(item.id)) {
                    map.set(item.id, item);
                    localWon = true;
                } else {
                    const existing = map.get(item.id);
                    const localVer = item.version || 1;
                    const cloudVer = existing.version || 1;

                    if (localVer > cloudVer) {
                        map.set(item.id, item);
                        localWon = true;
                    } else if (localVer === cloudVer) {
                        const existingTime = new Date(existing.updatedAt || existing.updated_at || existing.createdAt || existing.created_at || 0).getTime();
                        const localTime = new Date(item.updatedAt || item.createdAt || 0).getTime();
                        if (localTime > existingTime) {
                            map.set(item.id, item);
                            localWon = true;
                        }
                    }
                }
            }
        }
        return { merged: Array.from(map.values()), localWon };
    }

    function _mergeNotesData(localData, cloudData, tombstones) {
        const tombstoneMap = _buildTombstoneMap(tombstones);
        const folders = _mergeCollection(localData?.folders, cloudData?.folders, tombstoneMap);
        const items = _mergeCollection(localData?.items, cloudData?.items, tombstoneMap);
        return {
            data: { folders: folders.merged, items: items.merged },
            localWon: folders.localWon || items.localWon
        };
    }

    async function _applyTombstonesLocally(tombstones, localData) {
        if (!tombstones?.length || !localData) return;
        const tombstoneMap = _buildTombstoneMap(tombstones);

        const itemIds = (localData.items || []).filter(i => _isTombstoned(tombstoneMap, i)).map(i => i.id);
        const folderIds = (localData.folders || []).filter(f => _isTombstoned(tombstoneMap, f)).map(f => f.id);
        if (itemIds.length === 0 && folderIds.length === 0) return;

        const db = await AppDB.initDB();
        for (const [storeName, ids] of [[AppDB.ITEMS_STORE, itemIds], [AppDB.FOLDERS_STORE, folderIds]]) {
            if (ids.length > 0) {
                await new Promise(r => {
                    const tx = db.transaction([storeName], 'readwrite');
                    const store = tx.objectStore(storeName);
                    ids.forEach(id => store.delete(id));
                    tx.oncomplete = r; tx.onerror = r;
                });
            }
        }
    }

    // ========================================================================
    // DATA IMPORT / EXPORT
    // ========================================================================

    async function exportLocalData() {
        await AppDB.initDB();
        const folders = await AppDB.getAllFolders();
        const items = await AppDB.getAllItems();
        const vaultData = await new Promise(r => chrome.storage.local.get(['pm_vault_data', 'pm_vault_keys', 'vault_tombstones', 'vault_updatedAt'], r));
        const settingsData = await new Promise(r => chrome.storage.local.get(['pm_settings', 'settings_updatedAt'], r));

        return {
            folders, items,
            vault: vaultData.pm_vault_data, vaultKeys: vaultData.pm_vault_keys,
            vaultTombstones: vaultData.vault_tombstones,
            settings: settingsData.pm_settings || {},
            _settingsUpdatedAt: settingsData.settings_updatedAt || null
        };
    }

    /** Upsert records into an IDB store by id (UUID). */
    async function _upsertById(storeName, records, preProcess) {
        if (!records || records.length === 0) return;
        const db = await AppDB.initDB();
        await new Promise((resolve, reject) => {
            const tx = db.transaction([storeName], 'readwrite');
            const store = tx.objectStore(storeName);

            for (let record of records) {
                if (preProcess) record = preProcess(record);
                if (record.id) {
                    // Upsert: try to get existing, then merge
                    const req = store.get(record.id);
                    req.onsuccess = () => {
                        if (req.result) store.put({ ...req.result, ...record });
                        else store.add(record);
                    };
                }
            }

            tx.oncomplete = resolve;
            tx.onerror = reject;
        });
    }

    async function importNotesData(data) {
        if (!data?.folders || !data?.items) return;
        await _upsertById(AppDB.FOLDERS_STORE, data.folders);
        await _upsertById(AppDB.ITEMS_STORE, data.items, (item) => {
            const copy = { ...item };
            if (copy._hasBlobData && typeof copy.fileBlob === 'string') {
                delete copy.fileBlob;
                delete copy._hasBlobData;
            }
            return copy;
        });
    }

    async function _importVaultData(vaultPayload, version) {
        if (!vaultPayload) return;
        const payload = { ...vaultPayload };
        if (version) payload.version = version;
        await new Promise(r => chrome.storage.local.set({ pm_vault_data: payload, vault_updatedAt: new Date().toISOString() }, r));
    }

    async function _importSettingsData(settingsPayload, updatedAt) {
        if (!settingsPayload) return;
        await new Promise(r => chrome.storage.local.set({
            pm_settings: settingsPayload, settings_updatedAt: updatedAt || new Date().toISOString()
        }, r));
    }

    // ========================================================================
    // CLOUD UPLOAD / DOWNLOAD
    // ========================================================================

    /** Delete a local IDB record by id. */
    async function _deleteLocalById(storeName, id) {
        try {
            const db = await AppDB.initDB();
            const tx = db.transaction([storeName], 'readwrite');
            tx.objectStore(storeName).delete(id);
            await new Promise(r => { tx.oncomplete = r; tx.onerror = r; });
        } catch (e) {
            console.warn('[Sync] _deleteLocalById failed:', e);
        }
    }

    /** Upload all local data to Supabase. */
    async function _uploadAllToCloud(uid, localData) {
        const sb = await _getAuthenticatedClient();
        const now = new Date().toISOString();

        if (localData.folders?.length > 0) {
            const rows = localData.folders.map(f => _localFolderToCloud(f, uid));
            const { error } = await sb.from('folders').upsert(rows, { onConflict: 'user_id,id' });
            if (error) console.error('[Sync] Folder upsert error:', error);
        }

        if (localData.items?.length > 0) {
            const noteRows = [];
            for (const item of localData.items) {
                let fileUrl = item.fileUrl || null;
                if (item.fileBlob && item.fileBlob instanceof Blob) {
                    fileUrl = await _uploadBlobToStorage(sb, uid, item.fileBlob, item.id);
                }
                noteRows.push(_localNoteToCloud(item, uid, fileUrl));
            }
            const { error } = await sb.from('notes').upsert(noteRows, { onConflict: 'user_id,id' });
            if (error) console.error('[Sync] Notes upsert error:', error);
        }

        // Push vault + keys + settings to profiles row
        const profileUpdate = {};

        if (localData.vault) {
            const vaultPayload = { ...localData.vault };
            delete vaultPayload._updatedAt;
            profileUpdate.encrypted_vault = vaultPayload;
            profileUpdate.vault_version = vaultPayload.version || 1;
        }

        if (localData.vaultKeys) {
            const k = localData.vaultKeys;
            profileUpdate.vault_salt = k.salt;
            profileUpdate.vault_edek = k.edek;
            profileUpdate.vault_edek_iv = k.edek_iv;
            profileUpdate.vault_validator = k.validator;
            profileUpdate.vault_validator_iv = k.validator_iv;
        }

        if (localData.settings && Object.keys(localData.settings).length > 0) {
            profileUpdate.settings = localData.settings;
            profileUpdate.settings_updated_at = now;
        }

        if (Object.keys(profileUpdate).length > 0) {
            await sb.from('profiles').update(profileUpdate).eq('id', uid);
        }
    }

    async function _downloadAllFromCloud(uid) {
        const sb = await _getAuthenticatedClient();
        const { data: cloudNotes } = await sb.from('notes').select('*').eq('user_id', uid);
        const { data: cloudFolders } = await sb.from('folders').select('*').eq('user_id', uid);
        const { data: cloudProfile } = await sb.from('profiles').select('*').eq('id', uid).maybeSingle();

        if (cloudFolders || cloudNotes) {
            await importNotesData({
                folders: (cloudFolders || []).map(_cloudFolderToLocal),
                items: (cloudNotes || []).map(_cloudNoteToLocal)
            });
        }

        if (cloudProfile?.encrypted_vault && Object.keys(cloudProfile.encrypted_vault).length > 0) {
            await _importVaultData(cloudProfile.encrypted_vault, cloudProfile.vault_version);
        }

        if (cloudProfile?.vault_salt) {
            const k = cloudProfile;
            await new Promise(r => chrome.storage.local.set({
                pm_vault_keys: {
                    salt: k.vault_salt, edek: k.vault_edek, edek_iv: k.vault_edek_iv,
                    validator: k.vault_validator, validator_iv: k.vault_validator_iv
                }
            }, r));
        }

        if (cloudProfile?.settings) await _importSettingsData(cloudProfile.settings, cloudProfile.settings_updated_at);

        const state = await _getSyncState();
        state.lastSyncedAt = new Date().toISOString();
        state.syncStatus = 'idle';
        await _setSyncState(state);
    }

    async function _uploadBlobToStorage(sb, uid, blob, itemId) {
        try {
            const storagePath = `${uid}/${itemId || crypto.randomUUID()}`;
            const { error } = await sb.storage.from('user-files').upload(storagePath, blob, {
                contentType: blob.type || 'application/octet-stream', upsert: true
            });
            if (error) { console.warn('[Sync] Blob upload failed:', error); return null; }
            const { data: urlData } = sb.storage.from('user-files').getPublicUrl(storagePath);
            return urlData?.publicUrl || null;
        } catch (err) {
            console.warn('[Sync] _uploadBlobToStorage error:', err);
            return null;
        }
    }

    // ========================================================================
    // USER REGISTRY
    // ========================================================================

    async function _registerUser(profile) {
        const sb = await _getAuthenticatedClient();
        const uid = profile.uid;
        const { data: existing } = await sb.from('profiles').select('*').eq('id', uid).maybeSingle();
        const now = new Date().toISOString();

        if (existing) {
            await sb.from('profiles').update({
                name: profile.name, avatar_url: profile.avatarUrl
            }).eq('id', uid);
            const state = await _getSyncState();
            state.isPremium = existing.is_premium || false;
            await _setSyncState(state);
        } else {
            await sb.from('profiles').insert({
                id: uid, email: profile.email, name: profile.name,
                avatar_url: profile.avatarUrl, provider: profile.provider || 'unknown',
                is_premium: false, premium_since: null, created_at: now
            });
        }
    }

    async function fetchAllUsers() {
        const sb = await _getAuthenticatedClient();
        const { data, error } = await sb.from('profiles').select('*').order('created_at', { ascending: false }).limit(1000);
        if (error) throw error;
        return (data || []).map(u => ({
            uid: u.id, email: u.email, name: u.name, avatarUrl: u.avatar_url,
            isPremium: u.is_premium, premiumSince: u.premium_since,
            registeredAt: u.created_at, lastSyncedAt: u.updated_at
        }));
    }

    async function updateUserProfile(uid, updates) {
        const sb = await _getAuthenticatedClient();
        const { error } = await sb.from('profiles').update(updates).eq('id', uid);
        if (error) throw error;
    }

    // ========================================================================
    // PUBLIC API
    // ========================================================================

    return {
        signIn, signOut, isSignedIn, getProfile, isAdmin, handleAuthResult,
        isPremium, setPremiumStatus,
        syncAll, exportLocalData, importNotesData, handleMergeResponse,
        pushNote, pushFolder, pushFolders, pushVault, pushSettings,
        deleteNoteFromCloud, deleteFolderFromCloud,
        fetchAllUsers, updateUserProfile, ADMIN_EMAILS,
        getRelativeTime,
        _getAuthenticatedClient, _getSyncState, _recordTombstone,
        _subscribeRealtime, _drainRetryQueue
    };

})();

globalThis.SyncService = SyncService;
