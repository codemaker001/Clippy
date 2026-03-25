/**
 * core/components.js — Reusable HTML component generators
 * Eliminates copy-pasted markup across modules.
 */

const AppComponents = (function () {

    /**
     * Generate a vault lock/unlock screen.
     * Used by both Password Manager and Secret Keys.
     * @param {Object} config
     * @param {string} config.prefix - ID prefix (e.g., 'pm' or 'sk')
     * @param {string} config.iconSVG - SVG markup for the lock icon
     * @param {boolean} config.showVisibilityToggle - Whether to show eye toggle (PM has it, SK doesn't)
     */
    function renderLockScreen(config) {
        const { prefix, iconSVG, showVisibilityToggle = false } = config;

        const visToggle = showVisibilityToggle ? `
            <button id="${prefix}-toggle-visibility" class="icon-btn visibility-btn" type="button" tabindex="-1">
                <svg class="eye-open" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                    <circle cx="12" cy="12" r="3"></circle>
                </svg>
                <svg class="eye-closed hidden" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                    <line x1="1" y1="1" x2="23" y2="23"></line>
                </svg>
            </button>` : '';

        return `
        <div id="${prefix}-locked-view" class="pm-state-view active">
            <div class="pm-login-card">
                ${iconSVG}
                <h2 id="${prefix}-login-title">Unlock Vault</h2>
                <p id="${prefix}-login-subtitle">Enter your master password</p>

                <div class="pm-input-group">
                    <input type="password" id="${prefix}-master-password" placeholder="Master Password"
                        autocomplete="new-password" data-lpignore="true" data-1p-ignore="true">
                    ${visToggle}
                </div>

                <p id="${prefix}-login-error" class="error-msg hidden"></p>
                <button id="${prefix}-unlock-btn" class="pm-primary-btn">Unlock</button>

                <div id="${prefix}-setup-footer" class="hidden">
                    <p class="pm-warning-text">Make sure you remember this password. If lost, your data cannot be recovered.</p>
                </div>
            </div>
        </div>`;
    }

    /**
     * Generate Import/Export button group with dropdowns.
     * @param {Object} config
     * @param {string} config.prefix - ID prefix (e.g., 'pm', 'sk', 'notes')
     * @param {Array<Object>} config.importFormats - [{action: 'pm-import-json', label: 'JSON'}, ...]
     * @param {Array<Object>} config.exportFormats - [{action: 'pm-export-json', label: 'JSON'}, ...]
     * @param {string} config.fileAccept - File accept attribute (e.g., '.json' or '.json,.zip')
     */
    function renderIOButtons(config) {
        const { prefix, importFormats, exportFormats, fileAccept = '.json' } = config;

        function formatItems(formats) {
            return formats.map(f => `
                <button class="io-dropdown-item" data-action="${f.action}">
                    <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                    ${f.label}
                </button>
            `).join('');
        }

        return `
        <input type="file" id="${prefix}-import-file" accept="${fileAccept}" class="hidden">
        <div class="io-btn-group">
            <div class="io-dropdown-wrapper">
                <button id="${prefix}-import-btn" class="io-btn">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                    Import
                </button>
                <div class="io-dropdown" id="${prefix}-import-dropdown">
                    ${formatItems(importFormats)}
                </div>
            </div>
            <div class="io-dropdown-wrapper">
                <button id="${prefix}-export-btn" class="io-btn">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                    Export
                </button>
                <div class="io-dropdown" id="${prefix}-export-dropdown">
                    ${formatItems(exportFormats)}
                </div>
            </div>
        </div>`;
    }

    /**
     * Generate a search bar with optional clear button.
     * @param {Object} config
     * @param {string} config.id - Input element ID
     * @param {string} config.placeholder - Placeholder text
     * @param {boolean} config.showClear - Whether to show a clear button
     */
    function renderSearchBar(config) {
        const { id, placeholder, showClear = false } = config;

        const clearBtn = showClear ? `
            <button id="${id}-clear" class="search-clear-btn" title="Clear search">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
            </button>` : '';

        return `
        <div id="${id}-container" class="search-container">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
            <input type="text" id="${id}" class="search-input" placeholder="${placeholder}">
            ${clearBtn}
        </div>`;
    }

    /**
     * Generate the floating action button (FAB) +.
     * @param {string} id - Button ID
     * @param {string} title - tooltip
     */
    function renderFAB(id, title) {
        return `
        <button id="${id}" title="${title}">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 5v14" /><path d="M5 12h14" />
            </svg>
        </button>`;
    }

    return {
        renderLockScreen,
        renderIOButtons,
        renderSearchBar,
        renderFAB
    };

})();

window.AppComponents = AppComponents;
