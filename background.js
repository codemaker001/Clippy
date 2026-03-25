try {
    importScripts('password-manager/crypto.js', 'password-manager/vault.js');
    importScripts('core/utils.js', 'core/db.js');
    importScripts('core/env.js');
    importScripts('vendor/supabase.min.js');
    importScripts('core/sync.js');
} catch (e) {
    console.error('Failed to import scripts in background:', e);
}


// --- Context Menu Setup ---
chrome.runtime.onInstalled.addListener(() => {
    // Context menu for adding the page link
    chrome.contextMenus.create({
        id: "addPageLink",
        title: "Add page to Dashboard",
        contexts: ["page"]
    });

    // Context menu for adding selected text
    chrome.contextMenus.create({
        id: "addSelectedText",
        title: "Add selection to Dashboard",
        contexts: ["selection"]
    });

    // Password Manager Context Menus
    chrome.contextMenus.create({
        id: "pmAutoFill",
        title: "🔑 Open Vault to Auto-fill login",
        contexts: ["page", "editable"]
    });

    chrome.contextMenus.create({
        id: "pmGenerate",
        title: "🎲 Generate Secure Password",
        contexts: ["editable"]
    });
});

// --- Communication with Content Script ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'get_vault_entries') {
        // Vault is handled by popup usually, but if background kept it alive we could return it.
        // For the Personal Dashboard, the VaultService is instantiated in the popup.
        // A better approach for Auto-fill: send a message to the active popup if it's open,
        // or background script needs its own VaultService instance.

        // Since background.js in MV3 cannot reliably hold in-memory state for long,
        // we'll check if the popup (or an offscreen document) can provide it.
        // For now, let's assume the user has to unlock from popup first, which
        // can optionally send the decrypted cache to background.js temporarily.

        // We will store a temporary cache in background memory when popup unlocks
        if (self._tempVaultCache !== undefined && self._tempVaultCache !== null) {
            sendResponse({ success: true, entries: self._tempVaultCache });
        } else {
            sendResponse({ success: false, error: "Vault is locked or not initialized." });
        }
    } else if (request.action === 'sync_vault_cache') {
        // Called by password_manager.js when unlocked
        self._tempVaultCache = request.entries;

        // Auto-clear cache based on user settings
        if (self._cacheTimeout) clearTimeout(self._cacheTimeout);
        
        chrome.storage.local.get(['pm_settings'], (result) => {
            const settings = result.pm_settings || {};
            const timeoutMinutes = settings.vaultTimeout !== undefined ? settings.vaultTimeout : 5;
            
            if (timeoutMinutes === 0) {
                self._tempVaultCache = null; // Immediate lock
            } else if (timeoutMinutes !== -1) {
                self._cacheTimeout = setTimeout(() => {
                    self._tempVaultCache = null;
                }, timeoutMinutes * 60 * 1000);
            }
        });

        sendResponse({ success: true });
    } else if (request.action === 'unlock_vault') {
        if (self.vaultService) {
            self.vaultService.unlock(request.password).then(() => {
                self._tempVaultCache = self.vaultService.getEntries();

                if (self._cacheTimeout) clearTimeout(self._cacheTimeout);
                
                chrome.storage.local.get(['pm_settings'], (result) => {
                    const settings = result.pm_settings || {};
                    const timeoutMinutes = settings.vaultTimeout !== undefined ? settings.vaultTimeout : 5;
                    
                    if (timeoutMinutes === 0) {
                        self._tempVaultCache = null;
                    } else if (timeoutMinutes !== -1) {
                        self._cacheTimeout = setTimeout(() => {
                            self._tempVaultCache = null;
                        }, timeoutMinutes * 60 * 1000);
                    }
                });

                sendResponse({ success: true, entries: self._tempVaultCache });
            }).catch(err => {
                sendResponse({ success: false, error: err.message });
            });
            return true; // Keep message channel open for async
        } else {
            sendResponse({ success: false, error: "Vault missing." });
        }
    } else if (request.action === 'ignore_domain') {
        chrome.storage.local.get(['ignored_domains'], (result) => {
            const ignored = result.ignored_domains || [];
            if (!ignored.includes(request.hostname)) {
                ignored.push(request.hostname);
                chrome.storage.local.set({ ignored_domains: ignored });
            }
            sendResponse({ success: true });
        });
        return true;
    } else if (request.action === 'process_login') {
        const { username, email, password, hostname, title } = request;
        const searchUser = username || email;

        chrome.storage.local.get(['ignored_domains', 'pm_settings'], (result) => {
            const ignored = result.ignored_domains || [];
            const settings = result.pm_settings || {};
            
            if (settings.askToSave === false) {
                sendResponse({ action: 'ignore' });
                return;
            }
            
            if (ignored.includes(hostname)) {
                sendResponse({ action: 'ignore' });
                return;
            }

            if (self._tempVaultCache && self.vaultService && self.vaultService.isUnlocked) {
                // Unlocked - we can check
                const entries = self._tempVaultCache;
                
                // Find entries for this hostname
                const domainEntries = entries.filter(e => {
                    if (e.type && e.type !== 'password') return false;
                    if (!e.url) return false;
                    try {
                        let urlStr = e.url.trim();
                        if (!/^https?:\/\//i.test(urlStr)) urlStr = 'https://' + urlStr;
                        const entryHost = new URL(urlStr).hostname;
                        return hostname === entryHost || hostname.endsWith('.' + entryHost) || entryHost.endsWith('.' + hostname);
                    } catch(err) { return false; }
                });

                const exactMatch = domainEntries.find(e => (e.username === searchUser || e.email === searchUser) && e.password === password);
                if (exactMatch) {
                    sendResponse({ action: 'ignore' });
                } else {
                    const userMatch = domainEntries.find(e => e.username === searchUser || e.email === searchUser);
                    const action = userMatch ? 'prompt_update' : 'prompt_save';
                    const existingId = userMatch ? userMatch.id : null;
                    
                    // Store pending save in session storage for persistence across reloads
                    const pendingSave = {
                        username, email, password, hostname, title, isUpdate: !!userMatch, existingId,
                        timestamp: Date.now()
                    };
                    chrome.storage.session.set({ pending_save: pendingSave });
                    
                    sendResponse({ action, existingId });
                }
            } else {
                // Locked - just prompt save
                const pendingSave = {
                    username, email, password, hostname, title, isUpdate: false, existingId: null,
                    timestamp: Date.now()
                };
                chrome.storage.session.set({ pending_save: pendingSave });
                sendResponse({ action: 'prompt_locked_save' });
            }
        });
        return true;
    } else if (request.action === 'add_credential') {
        if (self.vaultService && self.vaultService.isUnlocked) {
            self.vaultService.addEntry(request.entry).then(newEntry => {
                self._tempVaultCache = self.vaultService.getEntries();
                sendResponse({ success: true, entry: newEntry });
            }).catch(e => sendResponse({ success: false, error: e.message }));
            return true;
        } else {
            sendResponse({ success: false, error: 'Vault is locked' });
        }
    } else if (request.action === 'update_credential') {
        if (self.vaultService && self.vaultService.isUnlocked) {
            self.vaultService.updateEntry(request.id, request.updates).then(updatedEntry => {
                self._tempVaultCache = self.vaultService.getEntries();
                sendResponse({ success: true, entry: updatedEntry });
            }).catch(e => sendResponse({ success: false, error: e.message }));
            return true;
        } else {
            sendResponse({ success: false, error: 'Vault is locked' });
        }
    } else if (request.action === 'unlock_and_save') {
        if (self.vaultService) {
            self.vaultService.unlock(request.masterPassword).then(() => {
                return self.vaultService.addEntry(request.entry);
            }).then(newEntry => {
                self._tempVaultCache = self.vaultService.getEntries();

                if (self._cacheTimeout) clearTimeout(self._cacheTimeout);
                
                chrome.storage.local.get(['pm_settings'], (result) => {
                    const settings = result.pm_settings || {};
                    const timeoutMinutes = settings.vaultTimeout !== undefined ? settings.vaultTimeout : 5;
                    
                    if (timeoutMinutes === 0) {
                        self._tempVaultCache = null;
                    } else if (timeoutMinutes !== -1) {
                        self._cacheTimeout = setTimeout(() => {
                            self._tempVaultCache = null;
                        }, timeoutMinutes * 60 * 1000);
                    }
                });

                sendResponse({ success: true, entry: newEntry });
            }).catch(e => sendResponse({ success: false, error: e.message }));
            return true;
        } else {
            sendResponse({ success: false, error: 'Vault missing' });
        }
    } else if (request.action === 'open_extension_popup') {
        if (chrome.action && chrome.action.openPopup) {
            chrome.action.openPopup().catch(() => {
                // Fallback: open in new tab
                chrome.tabs.create({ url: 'popup.html' });
            });
        } else {
            chrome.tabs.create({ url: 'popup.html' });
        }
        sendResponse({ success: true });
    } else if (request.action === 'check_pending_save') {
        chrome.storage.session.get(['pending_save'], (result) => {
            const pending = result.pending_save;
            if (pending && pending.hostname === request.hostname) {
                // Auto-expiry (5 minutes)
                if (Date.now() - pending.timestamp > 5 * 60 * 1000) {
                    chrome.storage.session.remove('pending_save');
                    sendResponse({ hasPending: false });
                } else {
                    sendResponse({ hasPending: true, data: pending });
                }
            } else {
                sendResponse({ hasPending: false });
            }
        });
        return true;
    } else if (request.action === 'clear_pending_save') {
        chrome.storage.session.remove('pending_save');
        sendResponse({ success: true });
    } else if (request.action === 'sync_trigger') {
        // Trigger sync from popup or other contexts
        if (globalThis.SyncService) {
            globalThis.SyncService.syncAll().then(() => {
                sendResponse({ success: true });
            }).catch(err => {
                sendResponse({ success: false, error: err.message });
            });
            return true; // Keep channel open for async
        } else {
            sendResponse({ success: false, error: 'SyncService not available' });
        }
    } else if (request.action === 'merge_prompt_response') {
        // User responded to the merge prompt (merge or replace)
        if (globalThis.SyncService) {
            globalThis.SyncService.handleMergeResponse(request.choice).then(() => {
                sendResponse({ success: true });
                chrome.runtime.sendMessage({ action: 'sync_completed' });
            }).catch(err => {
                sendResponse({ success: false, error: err.message });
            });
            return true;
        } else {
            sendResponse({ success: false, error: 'SyncService not available' });
        }
    }
});

// --- Receive auth tokens from the hosted login page ---
chrome.runtime.onMessageExternal.addListener(async (message, sender, sendResponse) => {
    if (message && message.type === 'AUTH_SUCCESS') {
        try {
            if (globalThis.SyncService) {
                const authResult = await globalThis.SyncService.handleAuthResult(message);
                
                // Return the syncStatus (DONE or NEEDS_MERGE) to the login page
                sendResponse({ success: true, syncStatus: authResult.syncStatus });

                // Notify all extension pages to refresh
                chrome.runtime.sendMessage({ action: 'sync_completed' });
            } else {
                sendResponse({ success: false, error: 'SyncService not available' });
            }
        } catch (err) {
            console.error('Auth result handling failed:', err);
            sendResponse({ success: false, error: err.message });
        }
    } else if (message && message.type === 'MERGE_DECISION') {
        try {
            if (globalThis.SyncService) {
                await globalThis.SyncService.handleMergeResponse(message.choice);
                sendResponse({ success: true });
                chrome.runtime.sendMessage({ action: 'sync_completed' });
            } else {
                sendResponse({ success: false, error: 'SyncService not available' });
            }
        } catch (err) {
            console.error('Merge decision handling failed:', err);
            sendResponse({ success: false, error: err.message });
        }
    }
    return true; // Keep channel open for async
});

// --- Auto-sync on browser startup ---
chrome.runtime.onStartup.addListener(async () => {
    try {
        if (globalThis.SyncService) {
            const signedIn = await globalThis.SyncService.isSignedIn();
            if (signedIn) {
                const state = await globalThis.SyncService._getSyncState();
                if (state.autoSync !== false) {
                    globalThis.SyncService.syncAll().catch(err => {
                        console.warn('Auto-sync on startup failed:', err);
                    });
                }
            }
        }
    } catch (e) {
        console.warn('Startup sync check failed:', e);
    }
});
// --- Context Menu Click Handler ---
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId === 'addPageLink') {
        await globalThis.AppDB.initDB();
        const newItem = {
            folderId: null, // Add to "All Items" by default
            type: 'link',
            content: globalThis.AppUtils.normalizeUrl(info.pageUrl),
            title: tab.title,
            createdAt: new Date().toISOString()
        };
        const transaction = globalThis.AppDB.addItem(newItem);
        await new Promise((resolve, reject) => {
            transaction.oncomplete = resolve;
            transaction.onerror = reject;
        });

    } else if (info.menuItemId === 'addSelectedText') {
        await globalThis.AppDB.initDB();
        const newItem = {
            folderId: null, // Add to "All Items" by default
            type: 'text',
            content: info.selectionText.trim(),
            createdAt: new Date().toISOString()
        };
        const transaction = globalThis.AppDB.addItem(newItem);
        await new Promise((resolve, reject) => {
            transaction.oncomplete = resolve;
            transaction.onerror = reject;
        });
    } else if (info.menuItemId === 'pmAutoFill' || info.menuItemId === 'pmGenerate') {
        // Open the extension popup. The user will need to unlock it,
        // switch to passwords, and execute the desired action from the panel.
        if (chrome.action && chrome.action.openPopup) {
            chrome.action.openPopup().catch(err => console.warn('Could not auto-open popup', err));
        } else {
            console.warn("openPopup() not supported. Please click the extension icon manually.");
        }
    }
});