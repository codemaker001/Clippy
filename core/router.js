/**
 * core/router.js — SPA Router for the Personal Dashboard
 * 
 * Handles tab switching by dynamically loading HTML fragments into
 * #app-container and calling each module's init() function.
 */

const AppRouter = (function () {

    const appContainer = document.getElementById('app-container');
    const switcherBtns = document.querySelectorAll('.switcher-btn[data-app]');
    const themeBtn = document.getElementById('theme-toggle');

    // Tab configuration: maps app name to HTML path and init function name
    const TAB_CONFIG = {
        'notes': {
            html: 'notes/notes.html',
            initFn: () => window.NotesApp && window.NotesApp.init()
        },
        'passwords': {
            html: 'password-manager/password_manager.html',
            initFn: () => window.PasswordManager && window.PasswordManager.init()
        },
        'secret-keys': {
            html: 'secret-keys/secret_keys.html',
            initFn: () => window.SecretKeys && window.SecretKeys.init()
        },
        'settings': {
            html: 'settings/settings.html',
            initFn: () => globalThis.SettingsApp && globalThis.SettingsApp.init()
        }
    };

    let currentTab = null;
    const htmlCache = {}; // Cache loaded HTML to avoid re-fetching

    /**
     * Switch to a tab by name (e.g., 'notes', 'passwords', 'secret-keys').
     */
    async function switchTo(appName) {
        if (currentTab === appName) return;

        const config = TAB_CONFIG[appName];
        if (!config) {
            console.error(`Unknown tab: ${appName}`);
            return;
        }

        // Update switcher button active states
        switcherBtns.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.app === appName);
        });

        // Load HTML fragment (from cache or fetch)
        try {
            if (!htmlCache[appName]) {
                const response = await fetch(config.html);
                if (!response.ok) throw new Error(`Failed to load ${config.html}`);
                htmlCache[appName] = await response.text();
            }

            appContainer.innerHTML = htmlCache[appName];
            currentTab = appName;

            // Initialize the module
            config.initFn();

            // Trigger sync down to the cloud
            globalThis.SyncService?.triggerAutoSync();

        } catch (err) {
            console.error(`Router: Failed to load tab "${appName}"`, err);
            appContainer.innerHTML = `<div class="empty-state">Failed to load this view. Please reload the extension.</div>`;
        }
    }

    /**
     * Theme management
     */
    function applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('theme', theme);
    }

    /**
     * Initialize the router: bind switcher buttons and load the default tab.
     */
    async function init() {
        // Init theme
        applyTheme(localStorage.getItem('theme') || 'dark');
        if (themeBtn) {
            themeBtn.addEventListener('click', () => {
                const current = document.documentElement.getAttribute('data-theme');
                applyTheme(current === 'dark' ? 'light' : 'dark');
            });
        }

        // Bind switcher button clicks
        switcherBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                switchTo(btn.dataset.app);
            });
        });

        // Open in new window handler (moved from notes.js)
        const openWindowBtn = document.getElementById('open-window-btn');
        if (openWindowBtn) {
            openWindowBtn.addEventListener('click', () => {
                chrome.windows.create({ url: chrome.runtime.getURL('popup.html'), type: 'popup', width: 600, height: 520 });
                window.close();
            });
        }

        // Determine default tab from settings
        let defaultTab = 'passwords'; // fallback default

        try {
            const result = await new Promise(resolve => {
                chrome.storage.local.get(['pm_settings'], resolve);
            });
            const settings = result.pm_settings || {};
            if (settings.defaultTab) {
                defaultTab = settings.defaultTab;
            }
        } catch (e) {
            // If chrome.storage fails (e.g., running standalone), use fallback
        }

        // Handle URL params (e.g., ?noteId=123 for "open in new window")
        const urlParams = new URLSearchParams(window.location.search);
        const noteIdToOpen = urlParams.get('noteId');
        if (noteIdToOpen) {
            document.body.classList.add('isolated-mode');
            defaultTab = 'notes';
        }

        await switchTo(defaultTab);

        // If we need to open a specific note, do it after the module loads
        if (noteIdToOpen && window.NotesApp) {
            setTimeout(() => window.NotesApp.openNote(parseInt(noteIdToOpen)), 100);
        }
    }

    /**
     * Get the currently active tab name.
     */
    function getCurrentTab() {
        return currentTab;
    }

    return {
        init,
        switchTo,
        getCurrentTab
    };

})();

window.AppRouter = AppRouter;

// Bootstrap the SPA when DOM is ready
document.addEventListener('DOMContentLoaded', () => AppRouter.init());
