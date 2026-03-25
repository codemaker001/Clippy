/**
 * core/utils.js — Shared utility functions
 * Single source of truth for helpers used across all modules.
 */

const AppUtils = (function () {

    /**
     * Escape HTML entities to prevent XSS in dynamic content.
     */
    function escapeHTML(str) {
        if (!str) return '';
        return str
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    /**
     * Normalize a URL by ensuring it has a protocol prefix.
     */
    function normalizeUrl(url) {
        if (!url) return '';
        if (!/^(https?|ftp):\/\//i.test(url)) {
            return `https://${url}`;
        }
        return url;
    }

    /**
     * Open a modal + show the shared backdrop.
     */
    function openModal(modal) {
        const backdrop = document.getElementById('modal-backdrop');
        if (backdrop) backdrop.classList.remove('hidden');
        if (modal) modal.classList.remove('hidden');
    }

    /**
     * Close all modals and hide the shared backdrop.
     */
    function closeAllModals() {
        const backdrop = document.getElementById('modal-backdrop');
        if (backdrop) backdrop.classList.add('hidden');
        document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
    }

    /**
     * Copy text to clipboard with optional secure auto-clear for passwords.
     * @param {string} text - The text to copy.
     * @param {boolean} isPassword - If true, auto-clears clipboard based on user settings.
     */
    async function copyToClipboard(text, isPassword = false) {
        if (!text) return;
        try {
            await navigator.clipboard.writeText(text);

            if (isPassword && typeof chrome !== 'undefined' && chrome.storage) {
                chrome.storage.local.get(['pm_settings'], (result) => {
                    const settings = result.pm_settings || {};
                    const clearTime = settings.clipboardClear !== undefined ? settings.clipboardClear : 30;

                    if (clearTime !== -1) {
                        setTimeout(async () => {
                            try {
                                const currentClip = await navigator.clipboard.readText();
                                if (currentClip === text) {
                                    await navigator.clipboard.writeText('');
                                }
                            } catch (e) { /* Tab may have closed */ }
                        }, clearTime * 1000);
                    }
                });
            }
        } catch (err) {
            console.error('Failed to copy: ', err);
        }
    }

    /**
     * Show a premium styled delete confirmation dialog.
     * Reused by Password Manager and Secret Keys modules.
     * @param {string} title - Name of the item to delete.
     * @param {Function} onConfirm - Callback executed if user confirms.
     */
    function showDeleteConfirm(title, onConfirm) {
        const backdrop = document.getElementById('modal-backdrop');

        const dialog = document.createElement('div');
        dialog.className = 'pm-confirm-dialog';
        dialog.innerHTML = `
            <div class="pm-confirm-icon">
                <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            </div>
            <h3 class="pm-confirm-title">Delete Item?</h3>
            <p class="pm-confirm-body">Are you sure you want to delete <strong>${escapeHTML(title)}</strong>? This action cannot be undone.</p>
            <div class="pm-confirm-actions">
                <button class="pm-confirm-btn pm-confirm-btn--cancel" data-role="cancel">Cancel</button>
                <button class="pm-confirm-btn pm-confirm-btn--danger" data-role="delete">Delete</button>
            </div>
        `;

        // Clean up any orphaned dialogs from previous calls
        backdrop.querySelectorAll('.pm-confirm-dialog').forEach(d => d.remove());

        backdrop.appendChild(dialog);
        backdrop.classList.remove('hidden');

        // Prevent clicks inside the dialog from bubbling to backdrop
        dialog.addEventListener('click', (e) => e.stopPropagation());

        const close = () => {
            backdrop.classList.add('hidden');
            if (dialog.parentNode) backdrop.removeChild(dialog);
        };

        dialog.querySelector('[data-role="cancel"]').addEventListener('click', close);
        dialog.querySelector('[data-role="delete"]').addEventListener('click', async () => {
            close();
            await onConfirm();
        });

        backdrop.addEventListener('click', function handler(e) {
            if (e.target === backdrop) { close(); backdrop.removeEventListener('click', handler); }
        });
    }

    /**
     * Show a premium styled confirmation dialog (replaces native confirm()).
     * @param {Object} opts
     * @param {string} opts.title - Dialog heading (e.g. "Delete Folder?")
     * @param {string} opts.body - HTML body text
     * @param {string} [opts.confirmLabel='Confirm'] - Confirm button text
     * @param {string} [opts.cancelLabel='Cancel'] - Cancel button text
     * @param {string} [opts.confirmClass='pm-confirm-btn--danger'] - CSS class for confirm button
     * @param {string} [opts.icon] - SVG icon HTML (defaults to trash icon)
     * @param {string} [opts.iconBg] - Background colour for icon circle
     * @returns {Promise<boolean>} Resolves true on confirm, rejects/resolves false on cancel.
     */
    function showConfirmDialog(opts = {}) {
        return new Promise((resolve) => {
            const backdrop = document.getElementById('modal-backdrop');
            const title = opts.title || 'Are you sure?';
            const body = opts.body || '';
            const confirmLabel = opts.confirmLabel || 'Confirm';
            const cancelLabel = opts.cancelLabel || 'Cancel';
            const confirmClass = opts.confirmClass || 'pm-confirm-btn--danger';
            const iconBg = opts.iconBg || '';
            const icon = opts.icon || `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`;

            const dialog = document.createElement('div');
            dialog.className = 'pm-confirm-dialog';
            const iconStyle = iconBg ? ` style="background-color:${iconBg}"` : '';
            dialog.innerHTML = `
                <div class="pm-confirm-icon"${iconStyle}>${icon}</div>
                <h3 class="pm-confirm-title">${title}</h3>
                <p class="pm-confirm-body">${body}</p>
                <div class="pm-confirm-actions">
                    <button class="pm-confirm-btn pm-confirm-btn--cancel" data-role="cancel">${escapeHTML(cancelLabel)}</button>
                    <button class="pm-confirm-btn ${confirmClass}" data-role="confirm">${escapeHTML(confirmLabel)}</button>
                </div>
            `;

            // Clean up any orphaned dialogs from previous calls
            backdrop.querySelectorAll('.pm-confirm-dialog').forEach(d => d.remove());

            backdrop.appendChild(dialog);
            backdrop.classList.remove('hidden');

            // Prevent clicks inside the dialog from bubbling to backdrop
            // (other modules bind closeModal on #modal-backdrop click)
            dialog.addEventListener('click', (e) => e.stopPropagation());

            const close = (result) => {
                backdrop.classList.add('hidden');
                if (dialog.parentNode) backdrop.removeChild(dialog);
                backdrop.removeEventListener('click', backdropHandler);
                resolve(result);
            };

            function backdropHandler(e) {
                if (e.target === backdrop) close(false);
            }

            dialog.querySelector('[data-role="cancel"]').addEventListener('click', () => close(false));
            dialog.querySelector('[data-role="confirm"]').addEventListener('click', () => close(true));
            backdrop.addEventListener('click', backdropHandler);
        });
    }

    /**
     * Show a premium styled prompt dialog (replaces native prompt()).
     * @param {Object} opts
     * @param {string} opts.title - Dialog heading (e.g. "Rename Folder")
     * @param {string} [opts.body] - Optional description text
     * @param {string} [opts.placeholder] - Input placeholder
     * @param {string} [opts.defaultValue] - Pre-filled value
     * @param {string} [opts.confirmLabel='Save'] - Confirm button text
     * @param {string} [opts.cancelLabel='Cancel'] - Cancel button text
     * @param {string} [opts.icon] - SVG icon HTML
     * @returns {Promise<string|null>} Resolves with input value on confirm, null on cancel.
     */
    function showPromptDialog(opts = {}) {
        return new Promise((resolve) => {
            const backdrop = document.getElementById('modal-backdrop');
            const title = opts.title || 'Enter Value';
            const body = opts.body || '';
            const placeholder = opts.placeholder || '';
            const defaultValue = opts.defaultValue || '';
            const confirmLabel = opts.confirmLabel || 'Save';
            const cancelLabel = opts.cancelLabel || 'Cancel';
            const icon = opts.icon || `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>`;

            const dialog = document.createElement('div');
            dialog.className = 'pm-confirm-dialog';
            dialog.innerHTML = `
                <div class="pm-confirm-icon pm-confirm-icon--primary">${icon}</div>
                <h3 class="pm-confirm-title">${escapeHTML(title)}</h3>
                ${body ? `<p class="pm-confirm-body">${body}</p>` : ''}
                <input type="text" class="pm-confirm-input" placeholder="${escapeHTML(placeholder)}" value="${escapeHTML(defaultValue)}" autocomplete="off">
                <div class="pm-confirm-actions">
                    <button class="pm-confirm-btn pm-confirm-btn--cancel" data-role="cancel">${escapeHTML(cancelLabel)}</button>
                    <button class="pm-confirm-btn pm-confirm-btn--primary" data-role="confirm">${escapeHTML(confirmLabel)}</button>
                </div>
            `;

            // Clean up any orphaned dialogs from previous calls
            backdrop.querySelectorAll('.pm-confirm-dialog').forEach(d => d.remove());

            backdrop.appendChild(dialog);
            backdrop.classList.remove('hidden');

            // Prevent clicks inside the dialog from bubbling to backdrop
            dialog.addEventListener('click', (e) => e.stopPropagation());

            const inputEl = dialog.querySelector('.pm-confirm-input');
            inputEl.focus();
            inputEl.select();

            const close = (value) => {
                backdrop.classList.add('hidden');
                if (dialog.parentNode) backdrop.removeChild(dialog);
                backdrop.removeEventListener('click', backdropHandler);
                resolve(value);
            };

            function backdropHandler(e) {
                if (e.target === backdrop) close(null);
            }

            dialog.querySelector('[data-role="cancel"]').addEventListener('click', () => close(null));
            dialog.querySelector('[data-role="confirm"]').addEventListener('click', () => {
                const val = inputEl.value.trim();
                close(val || null);
            });
            inputEl.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    const val = inputEl.value.trim();
                    close(val || null);
                }
            });
            backdrop.addEventListener('click', backdropHandler);
        });
    }

    /**
     * Setup IO (Import/Export) dropdown toggle behavior for a pair of buttons.
     * @param {Object} config - { importBtn, exportBtn, importDropdown, exportDropdown }
     */
    function setupIODropdowns(config) {
        const { importBtn, exportBtn, importDropdown, exportDropdown } = config;

        function closeDropdowns() {
            if (importDropdown) importDropdown.classList.remove('open');
            if (exportDropdown) exportDropdown.classList.remove('open');
            if (importBtn) importBtn.classList.remove('active');
            if (exportBtn) exportBtn.classList.remove('active');
        }

        if (importBtn && importDropdown) {
            importBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const isOpen = importDropdown.classList.contains('open');
                closeDropdowns();
                if (!isOpen) {
                    importDropdown.classList.add('open');
                    importBtn.classList.add('active');
                }
            });
        }

        if (exportBtn && exportDropdown) {
            exportBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const isOpen = exportDropdown.classList.contains('open');
                closeDropdowns();
                if (!isOpen) {
                    exportDropdown.classList.add('open');
                    exportBtn.classList.add('active');
                }
            });
        }

        document.addEventListener('click', closeDropdowns);

        return { closeDropdowns };
    }

    // Public API
    return {
        escapeHTML,
        normalizeUrl,
        openModal,
        closeAllModals,
        copyToClipboard,
        showDeleteConfirm,
        showConfirmDialog,
        showPromptDialog,
        setupIODropdowns
    };

})();

// Make globally available (works in window and service worker)
globalThis.AppUtils = AppUtils;
