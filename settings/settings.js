/**
 * Global Settings Logic
 * Handles loading, saving, and binding the settings UI.
 */

const SettingsApp = (function() {
    const DEFAULT_SETTINGS = {
        vaultTimeout: 5,           // minutes (-1 = never, 0 = immediately)
        lockOnClose: true,         // boolean
        askToSave: true,           // boolean
        savePromptTimeout: 10,     // seconds (-1 = never close)
        theme: 'dark',             // string
        showFavicons: true,        // boolean
        clipboardClear: 30,        // seconds (-1 = never clear)
        genLength: 16,             // number
        genUpper: true,            // boolean
        genLower: true,            // boolean
        genNums: true,             // boolean
        genSyms: true,             // boolean
        defaultTab: 'passwords'    // string ('passwords', 'notes', 'secret-keys')
    };

    let currentSettings = { ...DEFAULT_SETTINGS };

    // DOM Elements mapping
    const elements = {
        vaultTimeout: 'setting-vault-timeout',
        lockOnClose: 'setting-lock-on-close',
        askToSave: 'setting-ask-to-save',
        savePromptTimeout: 'setting-save-timeout',
        theme: 'setting-theme',
        showFavicons: 'setting-show-favicons',
        clipboardClear: 'setting-clipboard-clear',
        genLength: 'setting-generator-length',
        genUpper: 'setting-gen-upper',
        genLower: 'setting-gen-lower',
        genNums: 'setting-gen-nums',
        genSyms: 'setting-gen-syms',
        defaultTab: 'setting-default-tab'
    };

    /**
     * Load settings from storage and apply to UI.
     */
    async function loadSettings() {
        return new Promise((resolve) => {
            chrome.storage.local.get(['pm_settings'], (result) => {
                if (result.pm_settings) {
                    currentSettings = { ...DEFAULT_SETTINGS, ...result.pm_settings };
                } else {
                    currentSettings = { ...DEFAULT_SETTINGS };
                }
                applySettingsToUI();
                resolve(currentSettings);
            });
        });
    }

    /**
     * Save current settings to storage.
     */
    function saveSettings() {
        chrome.storage.local.set({
            pm_settings: currentSettings,
            // Stamp update time so sync can detect local settings changes (Fix #3 / Bug G)
            settings_updatedAt: new Date().toISOString(),
            unpushedLocalChanges: true // Flag that local data has changed and needs pushing
        }, () => {
            // Notify background script or other content scripts about the update
            chrome.runtime.sendMessage({ 
                action: 'pm_settings_updated', 
                settings: currentSettings 
            });
            // Trigger auto-sync so settings propagate immediately
            globalThis.SyncService?.triggerAutoSync();
        });
    }

    /**
     * Update the UI controls to match the current settings state.
     */
    function applySettingsToUI() {
        Object.keys(elements).forEach(key => {
            const el = document.getElementById(elements[key]);
            if (!el) return;

            const val = currentSettings[key];
            if (el.type === 'checkbox') {
                el.checked = val;
            } else {
                el.value = val;
            }
        });
    }

    /**
     * Read the UI state and update the current settings object.
     */
    function readSettingsFromUI() {
        Object.keys(elements).forEach(key => {
            const el = document.getElementById(elements[key]);
            if (!el) return;

            if (el.type === 'checkbox') {
                currentSettings[key] = el.checked;
            } else if (el.type === 'number' || key === 'vaultTimeout' || key === 'savePromptTimeout' || key === 'clipboardClear') {
                currentSettings[key] = parseInt(el.value, 10);
            } else {
                currentSettings[key] = el.value;
            }
        });
    }

    /**
     * Initialize listeners for all settings controls.
     */
    function bindUIEvents() {
        Object.values(elements).forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;

            el.addEventListener('change', () => {
                readSettingsFromUI();
                saveSettings();
            });
        });

        // Initialize Settings Navigation
        const navItems = document.querySelectorAll('.settings-nav-item');
        const backBtns = document.querySelectorAll('.settings-back-btn');
        const allPanes = document.querySelectorAll('.settings-pane');
        const mainMenu = document.getElementById('settings-main-menu');

        // Forward Navigation
        if (mainMenu) {
            navItems.forEach(item => {
                item.addEventListener('click', () => {
                    const targetId = item.getAttribute('data-target');
                    const targetPane = document.getElementById(targetId);
                    
                    if (targetPane) {
                        // Hide main menu
                        mainMenu.classList.remove('active');
                        mainMenu.classList.add('hidden');
                        
                        // Show target pane
                        targetPane.classList.remove('hidden');
                        // Small delay to allow display to trigger before opacity transition
                        setTimeout(() => targetPane.classList.add('active'), 10);
                    }
                });
            });

            // Backward Navigation
            backBtns.forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const currentPane = e.target.closest('.settings-pane');
                    if (currentPane) {
                        // Hide current sub-pane
                        currentPane.classList.remove('active');
                        setTimeout(() => {
                            currentPane.classList.add('hidden');
                            
                            // Show main menu
                            mainMenu.classList.remove('hidden');
                            setTimeout(() => mainMenu.classList.add('active'), 10);
                        }, 200); // Wait for fade out
                    }
                });
            });
        }
    }

    /**
     * Bind Sync & Account events and render initial state.
     */
    function bindSyncEvents() {
        const signInBtn = document.getElementById('sync-sign-in-btn');
        const signOutBtn = document.getElementById('sync-sign-out-btn');
        const syncNowBtn = document.getElementById('sync-now-btn');
        const autoSyncToggle = document.getElementById('sync-auto-toggle');
        const upgradeBtn = document.getElementById('sync-upgrade-btn');
        const adminBtn = document.getElementById('sync-admin-btn');

        if (signInBtn) {
            signInBtn.addEventListener('click', () => {
                // Opens the hosted login page in a new tab
                SyncService.signIn();
            });
        }

        // Listen for auth state changes (when login page sends token back)
        chrome.storage.onChanged.addListener((changes) => {
            if (changes.sync_state) {
                updateSyncUI();
            }
        });

        if (signOutBtn) {
            signOutBtn.addEventListener('click', async () => {
                const confirmed = confirm('Sign out? Your local data will be kept.');
                if (!confirmed) return;
                await SyncService.signOut();
                await updateSyncUI();
            });
        }

        if (syncNowBtn) {
            syncNowBtn.addEventListener('click', async () => {
                syncNowBtn.disabled = true;
                syncNowBtn.innerHTML = '<span class="sync-spinner"></span> Syncing...';
                try {
                    await SyncService.syncAll();
                    syncNowBtn.innerHTML = '✓ Synced!';
                    setTimeout(() => {
                        syncNowBtn.innerHTML = `<svg class="sync-now-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg> Sync Now`;
                    }, 2000);
                } catch (err) {
                    syncNowBtn.textContent = '⚠ Failed';
                    setTimeout(() => {
                        syncNowBtn.innerHTML = `<svg class="sync-now-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg> Sync Now`;
                    }, 2000);
                } finally {
                    syncNowBtn.disabled = false;
                    await updateSyncUI();
                }
            });
        }

        if (autoSyncToggle) {
            autoSyncToggle.addEventListener('change', async () => {
                const state = await SyncService._getSyncState();
                state.autoSync = autoSyncToggle.checked;
                chrome.storage.local.set({ sync_state: state });
            });
        }

        if (upgradeBtn) {
            upgradeBtn.addEventListener('click', async () => {
                const confirmed = confirm('Activate Premium membership?');
                if (!confirmed) return;
                upgradeBtn.disabled = true;
                try {
                    await SyncService.setPremiumStatus(true);
                    await updateSyncUI();
                } catch (err) {
                    alert('Failed to upgrade: ' + err.message);
                } finally {
                    upgradeBtn.disabled = false;
                }
            });
        }

        if (adminBtn) {
            adminBtn.addEventListener('click', () => {
                // Open admin dashboard in new tab
                const adminUrl = chrome.runtime.getURL('admin/admin.html');
                chrome.tabs.create({ url: adminUrl });
            });
        }
    }

    /**
     * Update the Sync & Account UI based on current state.
     */
    async function updateSyncUI() {
        const signedOut = document.getElementById('sync-signed-out');
        const signedIn = document.getElementById('sync-signed-in');
        if (!signedOut || !signedIn) return;

        const isLoggedIn = await SyncService.isSignedIn();

        if (!isLoggedIn) {
            signedOut.classList.remove('hidden');
            signedIn.classList.add('hidden');
            return;
        }

        signedOut.classList.add('hidden');
        signedIn.classList.remove('hidden');

        const profile = await SyncService.getProfile();
        const state = await SyncService._getSyncState();

        // Profile
        const avatarEl = document.getElementById('sync-avatar');
        const nameEl = document.getElementById('sync-user-name');
        const emailEl = document.getElementById('sync-user-email');
        if (avatarEl && profile.avatarUrl) avatarEl.src = profile.avatarUrl;
        if (nameEl) nameEl.textContent = profile.name || 'User';
        if (emailEl) emailEl.textContent = profile.email || '';

        // Last synced
        const lastSyncedEl = document.getElementById('sync-last-synced');
        if (lastSyncedEl) {
            lastSyncedEl.textContent = state.lastSyncedAt
                ? `Last synced: ${SyncService.getRelativeTime(state.lastSyncedAt)}`
                : 'Never synced';
        }

        // Auto-sync
        const autoToggle = document.getElementById('sync-auto-toggle');
        if (autoToggle) autoToggle.checked = state.autoSync !== false;

        // Premium
        const premiumBadge = document.getElementById('sync-premium-badge');
        const premiumFree = document.getElementById('sync-premium-free');
        const premiumActive = document.getElementById('sync-premium-active');
        const premiumSince = document.getElementById('sync-premium-since');

        if (state.isPremium) {
            if (premiumBadge) premiumBadge.classList.remove('hidden');
            if (premiumFree) premiumFree.classList.add('hidden');
            if (premiumActive) premiumActive.classList.remove('hidden');
            if (premiumSince) {
                // We don't have premiumSince in local state, just show generic
                premiumSince.textContent = 'Thank you for being a premium member!';
            }
        } else {
            if (premiumBadge) premiumBadge.classList.add('hidden');
            if (premiumFree) premiumFree.classList.remove('hidden');
            if (premiumActive) premiumActive.classList.add('hidden');
        }

        // Admin section
        const adminSection = document.getElementById('sync-admin-section');
        if (adminSection) {
            const isAdminUser = await SyncService.isAdmin();
            adminSection.classList.toggle('hidden', !isAdminUser);
        }
    }

    /**
     * Public init — called by AppRouter after HTML is loaded.
     */
    async function init() {
        if (window.vaultService && !window.vaultService.isUnlocked) {
            // Force user to unlock vault first
            if (globalThis.AppRouter) {
                // Set a flag so the password manager knows where to return us
                sessionStorage.setItem('pm_post_unlock_redirect', 'settings');
                globalThis.AppRouter.switchTo('passwords');
                return;
            }
        }
        await loadSettings();
        bindUIEvents();
        bindSyncEvents();
        await updateSyncUI();
    }

    // Expose API
    return {
        init,
        loadSettings,
        getSettings: () => ({ ...currentSettings })
    };
})();

// Assign to globalThis for global access
globalThis.SettingsApp = SettingsApp;
