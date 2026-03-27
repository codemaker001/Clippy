/**
 * Password Manager UI Controller
 * 
 * Module pattern with deferred init() for SPA router compatibility.
 * Uses AppUtils from core/ for shared helpers.
 */

const PasswordManager = (function () {

    // --- DOM Element handles (populated in init) ---
    let viewLocked, viewUnlocked;
    let inputMasterPassword, btnUnlock, btnToggleVis, msgLoginError;
    let iconEyeOpen, iconEyeClosed, setupFooter, loginTitle, loginSubtitle;
    let btnLockVault;

    // --- State ---
    let isNewVault = false;



    // ==========================================
    // VAULT LIFECYCLE LOGIC
    // ==========================================

    function handlePostUnlockRedirect() {
        const redirectPath = sessionStorage.getItem('pm_post_unlock_redirect');
        if (redirectPath && globalThis.AppRouter) {
            sessionStorage.removeItem('pm_post_unlock_redirect');
            globalThis.AppRouter.switchTo(redirectPath);
        }
    }

    /**
     * Checks vault mode and decides which view to show:
     * - NOT secured (no master password) → load plaintext, skip lock, show unlocked
     * - Secured and unlocked → show unlocked
     * - Secured and locked → show lock screen
     */
    async function checkVaultStatus() {
        if (!window.vaultService) return;

        const secured = await window.vaultService.isSecured();

        if (!secured) {
            // PLAINTEXT MODE — no master password, skip lock screen
            await window.vaultService.loadPlaintext();
            showUnlockedView();
            handlePostUnlockRedirect();
            return;
        }

        // ENCRYPTED MODE — check if already unlocked
        if (window.vaultService.isUnlocked) {
            showUnlockedView();
            handlePostUnlockRedirect();
            return;
        }

        // Try auto-unlock from session
        const autoUnlocked = await window.vaultService.tryAutoUnlock();
        if (autoUnlocked) {
            syncVaultWithBackground();
            showUnlockedView();
            handlePostUnlockRedirect();
            return;
        }

        // Show lock screen (unlock only, no 'Create Vault' — that's done via sign-in now)
        isNewVault = false;
        loginTitle.textContent = "Unlock Vault";
        loginSubtitle.textContent = "Enter your master password";
        btnUnlock.textContent = "Unlock";
        setupFooter.classList.add('hidden');

        showLockedView();
        inputMasterPassword.focus();
    }

    /**
     * Handles the Unlock button click (no more Create Vault — that's in auth flow)
     */
    async function handleAuthSubmit() {
        const password = inputMasterPassword.value.trim();
        msgLoginError.classList.add('hidden');

        if (!password) {
            showError("Password cannot be empty.");
            return;
        }

        btnUnlock.disabled = true;
        btnUnlock.textContent = "Unlocking...";

        try {
            await window.vaultService.unlock(password);
            inputMasterPassword.value = '';
            syncVaultWithBackground();
            showUnlockedView();
            handlePostUnlockRedirect();
        } catch (error) {
            showError(error.message);
        } finally {
            btnUnlock.disabled = false;
            btnUnlock.textContent = "Unlock";
        }
    }

    function showError(msg) {
        msgLoginError.textContent = msg;
        msgLoginError.classList.remove('hidden');

        // Shake animation
        viewLocked.querySelector('.pm-login-card').classList.add('animate-out');
        setTimeout(() => {
            viewLocked.querySelector('.pm-login-card').classList.remove('animate-out');
            viewLocked.querySelector('.pm-login-card').classList.add('animate-in');
        }, 300);
    }

    function showLockedView() {
        viewLocked.classList.remove('hidden');
        viewUnlocked.classList.add('hidden');
    }

    // Event bindings moved to bindAllEvents() in init()

    function lockVault() {
        if (window.vaultService) {
            window.vaultService.lock();
            chrome.runtime.sendMessage({ action: 'sync_vault_cache', entries: null });
            checkVaultStatus();
        }
    }

    function syncVaultWithBackground() {
        if (window.vaultService && window.vaultService.isUnlocked) {
            chrome.runtime.sendMessage({
                action: 'sync_vault_cache',
                entries: window.vaultService.getEntries()
            });
        }
    }

    // --- Phase 3 DOM elements (populated in bindUnlockedViewEvents) ---
    let listEntries, btnAddEntry, panelDetail, panelTitle, btnSaveEntry, btnClosePanel;
    let inputTitle, inputUsername, inputEmail, inputPassword, inputUrl;
    let selectFolder, selectCategory, inputNotes;
    let btnTogglePanVis, iconPanEyeOpen, iconPanEyeClosed, strengthFill;
    let modalGen, inGenResult, btnGenOpen, btnGenClose, btnGenUse, btnGenRefresh, btnGenCopy;

    let sliderLen, lblLenVal, chkUpper, chkLower, chkNums, chkSyms;

    // Sidebar & Filtering
    let categoryList, folderListPM, currentCategoryTitle, searchBoxPM, btnAddFolder;
    let btnSettings, viewSettings, listScrollContainer;

    let currentEditId = null;
    let activePmCategoryId = 'cat_all'; // Default view

    // --- RENDER LOGIC --- //

    function getFaviconUrl(urlStr) {
        if (!urlStr) return '';
        try {
            const domain = new URL(urlStr).hostname;
            return `https://s2.googleusercontent.com/s2/favicons?domain=${domain}&sz=64`;
        } catch (e) { return ''; }
    }

    // --- Category icon map ---
    function getCategoryIcon(id, size = 16) {
        const s = size;
        const icons = {
            cat_all: `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>`,
            cat_logins: `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>`,
            cat_favorites: `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>`,
            cat_email: `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg>`,
            cat_social: `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line></svg>`,
            cat_work: `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path></svg>`,
            cat_bank: `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"></line><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>`,
            cat_sensitive: `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`,
            cat_others: `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="1"></circle><circle cx="19" cy="12" r="1"></circle><circle cx="5" cy="12" r="1"></circle></svg>`,
            cat_notes: `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>`,
            cat_cards: `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"></rect><line x1="1" y1="10" x2="23" y2="10"></line></svg>`,
        };
        return icons[id] || icons['cat_others'];
    }

    function renderSidebar() {
        if (!window.vaultService || (!window.vaultService.isUnlocked && !window.vaultService._plaintextLoaded)) return;
        const categories = window.vaultService.vaultCache.categories || [];

        // System categories
        const systemCats = categories.filter(c => c.type === 'system');
        // Custom Folders
        const customFolders = categories.filter(c => c.type === 'custom');

        // All Items option
        let catHtml = `<li data-id="cat_all" class="${activePmCategoryId === 'cat_all' ? 'active' : ''}">
            ${getCategoryIcon('cat_all')}
            All Items
        </li>`;

        systemCats.forEach(c => {
            catHtml += `<li data-id="${c.id}" class="${activePmCategoryId === c.id ? 'active' : ''}">${getCategoryIcon(c.id)} ${AppUtils.escapeHTML(c.name)}</li>`;
        });
        categoryList.innerHTML = catHtml;

        let folderHtml = '';
        customFolders.forEach(f => {
            folderHtml += `<li data-id="${f.id}" class="${activePmCategoryId === f.id ? 'active' : ''}">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg> 
                <span class="pm-folder-name-text">${AppUtils.escapeHTML(f.name)}</span>
                <div class="pm-folder-actions-row">
                    <button class="icon-btn pm-edit-folder-btn" title="Edit Folder Name" data-id="${f.id}" data-name="${AppUtils.escapeHTML(f.name)}">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                    </button>
                    <button class="icon-btn pm-del-folder-btn" title="Delete Folder" data-id="${f.id}">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                    </button>
                </div>
            </li>`;
        });
        folderListPM.innerHTML = folderHtml;

        // Populate dropdowns in panel
        if (selectCategory && selectFolder) {
            let catOptions = '<option value="none">-- No Category --</option>';
            systemCats.forEach(c => {
                catOptions += `<option value="${c.id}">${AppUtils.escapeHTML(c.name)}</option>`;
            });
            selectCategory.innerHTML = catOptions;

            let folderOptions = '<option value="none">-- No Folder --</option>';
            customFolders.forEach(c => {
                folderOptions += `<option value="${c.id}">${AppUtils.escapeHTML(c.name)}</option>`;
            });
            selectFolder.innerHTML = folderOptions;
        }

        // Apply folder delete listeners
        document.querySelectorAll('.pm-del-folder-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const confirmed = await AppUtils.showConfirmDialog({ title: 'Delete Folder?', body: 'Delete this folder? Entries will be moved to <strong>All Items</strong>.', confirmLabel: 'Delete' });
                if (confirmed) {
                    try {
                        await window.vaultService.deleteCategory(btn.dataset.id);
                        if (activePmCategoryId === btn.dataset.id) {
                            activePmCategoryId = 'cat_all';
                        }
                        renderSidebar();
                        renderVaultItems();
                    } catch (err) {
                        alert(err.message);
                    }
                }
            });
        });

        // Apply folder edit listeners
        document.querySelectorAll('.pm-edit-folder-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const newName = await AppUtils.showPromptDialog({ title: 'Rename Folder', placeholder: 'Folder name', defaultValue: btn.dataset.name });
                if (newName && newName !== btn.dataset.name) {
                    try {
                        await window.vaultService.updateCategory(btn.dataset.id, newName.trim());
                        // Update title if it's the active category
                        if (activePmCategoryId === btn.dataset.id) {
                            currentCategoryTitle.textContent = newName.trim();
                        }
                        renderSidebar();
                    } catch (err) {
                        alert(err.message);
                    }
                }
            });
        });
    }

    // Sidebar clicking
    const handleSidebarClick = (e) => {
        const li = e.target.closest('li[data-id]');
        if (!li) return;
        if (e.target.closest('.pm-del-folder-btn') || e.target.closest('.pm-edit-folder-btn')) return; // handled separately

        activePmCategoryId = li.dataset.id;

        // Update Title
        if (activePmCategoryId === 'cat_all') {
            currentCategoryTitle.textContent = 'All Items';
        } else {
            const cat = window.vaultService.vaultCache.categories.find(c => c.id === activePmCategoryId);
            if (cat) currentCategoryTitle.textContent = cat.name;
        }

        if (viewSettings) viewSettings.classList.add('hidden');
        if (listScrollContainer) listScrollContainer.classList.remove('hidden');

        renderSidebar(); // Update active styles
        renderVaultItems();
    };
    // Settings click event moved to bindUnlockedViewEvents()

    // Add Folder event moved to bindUnlockedViewEvents()

    // Search events moved to bindUnlockedViewEvents()


    function renderVaultItems() {
        if (!window.vaultService || (!window.vaultService.isUnlocked && !window.vaultService._plaintextLoaded)) return;

        listEntries.innerHTML = '';
        // Only show passwords in the PM tab (default type is assumed password if not set)
        let entries = window.vaultService.getEntries().filter(e => !e.type || e.type === 'password');
        const searchTerm = searchBoxPM.value.trim().toLowerCase();

        // 1. Filter by Category
        if (activePmCategoryId !== 'cat_all') {
            entries = entries.filter(e => e.categoryId === activePmCategoryId);
        }

        // 2. Filter by Search
        if (searchTerm) {
            entries = entries.filter(e =>
                (e.title && e.title.toLowerCase().includes(searchTerm)) ||
                (e.username && e.username.toLowerCase().includes(searchTerm)) ||
                (e.email && e.email.toLowerCase().includes(searchTerm)) ||
                (e.url && e.url.toLowerCase().includes(searchTerm)) ||
                (e.notes && e.notes.toLowerCase().includes(searchTerm))
            );
        }

        if (entries.length === 0) {
            listEntries.innerHTML = '<div class="empty-state">No items found. Click + to add one.</div>';
            return;
        }

        entries.forEach(entry => {
            const favicon = getFaviconUrl(entry.url);
            const fallbackLetter = entry.title ? entry.title.charAt(0).toUpperCase() : '?';
            const iconHtml = favicon
                ? `<img src="${favicon}" alt="" loading="lazy" class="pm-favicon-img" data-fallback="${AppUtils.escapeHTML(fallbackLetter)}">`
                : `<span class="pm-fallback-icon">${AppUtils.escapeHTML(fallbackLetter)}</span>`;

            const el = document.createElement('div');
            el.className = 'pm-entry-card';
            el.innerHTML = `
                <div class="pm-entry-icon">${iconHtml}</div>
                <div class="pm-entry-details">
                    <div class="pm-entry-title">${AppUtils.escapeHTML(entry.title)}</div>
                    <div class="pm-entry-username">${AppUtils.escapeHTML(entry.username || entry.email || 'No username/email')}</div>
                </div>
                <div class="pm-entry-actions">
                    <button class="icon-btn" title="Copy Username" data-action="copy-user" data-val="${AppUtils.escapeHTML(entry.username)}">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
                    </button>
                    <button class="icon-btn" title="Copy Password" data-action="copy-pass" data-val="${AppUtils.escapeHTML(entry.password)}">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                    </button>
                    <button class="icon-btn" title="Auto-fill" data-action="autofill" data-user="${AppUtils.escapeHTML(entry.username)}" data-email="${AppUtils.escapeHTML(entry.email)}" data-pass="${AppUtils.escapeHTML(entry.password)}">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
                    </button>
                    <button class="icon-btn pm-delete-entry-btn pm-delete-entry-btn-icon" title="Delete Entry" data-action="delete" data-id="${entry.id}" data-title="${AppUtils.escapeHTML(entry.title)}">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                    </button>
                </div>
            `;

            // Clicking card opens edit panel
            el.addEventListener('click', (e) => {
                // Prevent opening if clicking an action button
                if (e.target.closest('.pm-entry-actions')) return;
                openDetailPanel(entry);
            });

            // Handle favicon load error (CSP compliant)
            const imgEl = el.querySelector('.pm-favicon-img');
            if (imgEl) {
                imgEl.addEventListener('error', function() {
                    const fallback = this.dataset.fallback || '?';
                    this.outerHTML = `<span class="pm-fallback-icon">${fallback}</span>`;
                });
            }

            // Action buttons
            const actions = el.querySelectorAll('[data-action]');
            actions.forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    const action = btn.dataset.action;
                    const val = btn.dataset.val;
                    const actionUser = btn.dataset.user;
                    const actionEmail = btn.dataset.email;
                    const actionPass = btn.dataset.pass;

                    if (action === 'copy-user' || action === 'copy-pass') {
                        copyToClipboard(val, action === 'copy-pass');
                    } else if (action === 'launch') {
                        window.open(val, '_blank');
                    } else if (action === 'autofill') {
                        executeAutofill(actionUser, actionEmail, actionPass, btn);
                    } else if (action === 'delete') {
                        const entryId = btn.dataset.id;
                        const entryTitle = btn.dataset.title || 'this item';
                        AppUtils.showDeleteConfirm(entryTitle, async () => {
                            try {
                                await window.vaultService.deleteEntry(entryId);
                                renderVaultItems();
                            } catch (err) {
                                console.error('Delete failed', err);
                            }
                        });
                    }
                });
            });

            listEntries.appendChild(el);
        });
    }


    // escapeHtml removed — now uses AppUtils.escapeHTML from core/utils.js


    // showDeleteConfirm — uses shared AppUtils.showDeleteConfirm from core/utils.js

    showUnlockedView = function () {
        viewLocked.classList.add('hidden');
        viewUnlocked.classList.remove('hidden');
        activePmCategoryId = 'cat_all';
        if (viewSettings) viewSettings.classList.add('hidden');
        if (listScrollContainer) listScrollContainer.classList.remove('hidden');
        if (currentCategoryTitle) currentCategoryTitle.textContent = 'All Items';
        if (searchBoxPM) searchBoxPM.value = '';

        // Show/hide Secure Vault banner and Lock button based on vault state
        const secureBanner = document.getElementById('pm-secure-vault-banner');
        if (secureBanner) {
            secureBanner.classList.toggle('hidden', !!window.vaultService._isSecured);
        }
        if (btnLockVault) {
            btnLockVault.style.display = window.vaultService._isSecured ? '' : 'none';
        }

        renderSidebar();
        renderVaultItems();
    }

    // --- PANEL LOGIC --- //

    function openDetailPanel(entry = null) {
        currentEditId = entry ? entry.id : null;
        panelTitle.textContent = entry ? 'Edit Item' : 'Add Item';

        // Populate fields
        inputTitle.value = entry ? entry.title : '';
        inputUsername.value = entry ? (entry.username || '') : '';
        inputEmail.value = entry ? (entry.email || '') : '';
        inputPassword.value = entry ? (entry.password || '') : '';
        inputUrl.value = entry ? (entry.url || '') : '';
        inputNotes.value = entry ? (entry.notes || '') : '';

        if (selectCategory && selectFolder) {
            selectCategory.value = 'none';
            selectFolder.value = 'none';

            let targetId = null;
            if (entry && entry.categoryId) {
                targetId = entry.categoryId;
            } else if (!entry && activePmCategoryId !== 'cat_all') {
                targetId = activePmCategoryId;
            } else if (!entry) {
                targetId = 'cat_logins';
            }

            if (targetId) {
                const catInfo = window.vaultService.vaultCache.categories.find(c => c.id === targetId);
                if (catInfo && catInfo.type === 'custom') {
                    selectFolder.value = targetId;
                } else if (catInfo && catInfo.type === 'system') {
                    selectCategory.value = targetId;
                }
            }
        }

        // Reset password visibility & strength
        inputPassword.type = 'password';
        iconPanEyeOpen.classList.remove('hidden');
        iconPanEyeClosed.classList.add('hidden');
        evaluatePasswordStrength();

        // Slide in
        panelDetail.classList.remove('hidden');
    }

    function closeDetailPanel() {
        panelDetail.classList.add('hidden');
        currentEditId = null;
    }

    // Panel event bindings moved to bindUnlockedViewEvents()


    // Save entry event moved to bindUnlockedViewEvents()


    // --- PASSWORD GENERATOR & STRENGTH --- //

    function evaluatePasswordStrength() {
        const pass = inputPassword.value;
        strengthFill.className = '';
        if (!pass) {
            strengthFill.style.width = '0%';
            return;
        }

        let score = 0;
        if (pass.length > 8) score++;
        if (pass.length > 12) score++;
        if (/[A-Z]/.test(pass) && /[a-z]/.test(pass)) score++;
        if (/[0-9]/.test(pass)) score++;
        if (/[^A-Za-z0-9]/.test(pass)) score++;

        if (score <= 2) strengthFill.className = 'strength-weak';
        else if (score <= 4) strengthFill.className = 'strength-fair';
        else strengthFill.className = 'strength-strong';
    }

    // Password input event moved to bindUnlockedViewEvents()

    function doGeneratePassword() {
        if (!window.cryptoService) return;
        const len = parseInt(sliderLen.value);
        const u = chkUpper.checked;
        const l = chkLower.checked;
        const n = chkNums.checked;
        const s = chkSyms.checked;

        if (!u && !l && !n && !s) {
            chkLower.checked = true; // force at least one
        }

        const pass = window.cryptoService.generatePassword(len, u, l, n, s);
        inGenResult.value = pass;
    }

    // Generator, copy, and launch event bindings moved to bindUnlockedViewEvents()



    // --- SECURE CLIPBOARD --- //

    async function copyToClipboard(text, isPassword = false) {
        if (!text) return;
        try {
            await navigator.clipboard.writeText(text);

            if (isPassword) {
                // Secure clipboard clearing after 20 seconds
                // Note: Only works if tab stays alive or via background worker.
                // In extension popup, this clears if popup stays open. 
                // Background worker handles robust clear (Phase 4).
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
                            } catch (e) { }
                        }, clearTime * 1000);
                    }
                });
            }
        } catch (err) {
            console.error('Failed to copy: ', err);
        }
    }

    // --- AUTO-FILL EXECUTION --- //

    async function executeAutofill(username, email, password, btnElement) {
        if (!username && !email && !password) return;

        try {
            // Get active tab
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tab) throw new Error("No active tab found");

            // Visually indicate action
            const oldHtml = btnElement.innerHTML;
            btnElement.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>`;

            // Send payload to content script
            chrome.tabs.sendMessage(tab.id, {
                action: 'pm_autofill',
                username: username,
                email: email,
                password: password
            }, (response) => {
                if (chrome.runtime.lastError) {
                    console.warn("Could not communicate with page. Ensure it's fully loaded.");
                    // Restore icon after short delay
                    setTimeout(() => btnElement.innerHTML = oldHtml, 1500);
                } else if (response && response.success) {
                    // Close popup on success
                    setTimeout(() => window.close(), 500);
                } else {
                    setTimeout(() => btnElement.innerHTML = oldHtml, 1500);
                }
            });

        } catch (e) {
            console.error('Autofill failed', e);
        }
    }

    // --- Public init() — called by router when Passwords tab becomes active ---
    function init() {
        // Grab DOM elements now that HTML fragment is loaded
        viewLocked = document.getElementById('pm-locked-view');
        viewUnlocked = document.getElementById('pm-unlocked-view');
        inputMasterPassword = document.getElementById('pm-master-password');
        btnUnlock = document.getElementById('pm-unlock-btn');
        btnToggleVis = document.getElementById('pm-toggle-visibility');
        msgLoginError = document.getElementById('pm-login-error');
        if (btnToggleVis) {
            iconEyeOpen = btnToggleVis.querySelector('.eye-open');
            iconEyeClosed = btnToggleVis.querySelector('.eye-closed');
        }
        setupFooter = document.getElementById('pm-setup-footer');
        loginTitle = document.getElementById('pm-login-title');
        loginSubtitle = document.getElementById('pm-login-subtitle');
        btnLockVault = document.getElementById('pm-lock-vault-btn');

        // Re-bind all event listeners for the newly loaded DOM
        bindAllEvents();

        // Check vault status to show correct view
        checkVaultStatus();
    }

    // Collect all event binding into one function
    function bindAllEvents() {
        // Vault login events
        if (btnToggleVis) {
            btnToggleVis.addEventListener('click', () => {
                const input = inputMasterPassword;
                if (input.type === 'password') {
                    input.type = 'text';
                    if (iconEyeOpen) iconEyeOpen.classList.add('hidden');
                    if (iconEyeClosed) iconEyeClosed.classList.remove('hidden');
                } else {
                    input.type = 'password';
                    if (iconEyeOpen) iconEyeOpen.classList.remove('hidden');
                    if (iconEyeClosed) iconEyeClosed.classList.add('hidden');
                }
            });
        }

        if (btnUnlock) {
            btnUnlock.addEventListener('click', handleAuthSubmit);
        }
        if (inputMasterPassword) {
            inputMasterPassword.addEventListener('keydown', e => {
                if (e.key === 'Enter') { e.preventDefault(); handleAuthSubmit(); }
            });
        }

        if (btnLockVault) btnLockVault.addEventListener('click', lockVault);

        // --- Secure Vault button (shown when vault is NOT secured) ---
        const btnSecureVault = document.getElementById('pm-secure-vault-btn');
        if (btnSecureVault) {
            btnSecureVault.addEventListener('click', () => {
                // Open the sign-in page to create a master password
                if (globalThis.SyncService) {
                    SyncService.signIn();
                } else {
                    // Fallback: switch to settings tab to sign in
                    if (globalThis.AppRouter) globalThis.AppRouter.switchTo('settings');
                }
            });
        }

        // --- Reset Extension button (on the locked/login screen) ---
        const btnResetExt = document.getElementById('pm-reset-ext-btn');
        const resetModalOverlay = document.getElementById('pm-reset-modal-overlay');
        const resetConfirmInput = document.getElementById('pm-reset-confirm-input');
        const btnResetConfirm = document.getElementById('pm-reset-confirm-btn');
        const btnResetCancel = document.getElementById('pm-reset-cancel-btn');

        function openResetModal() {
            if (!resetModalOverlay) return;
            if (resetConfirmInput) resetConfirmInput.value = '';
            if (btnResetConfirm) btnResetConfirm.disabled = true;
            resetModalOverlay.classList.remove('hidden');
            setTimeout(() => { if (resetConfirmInput) resetConfirmInput.focus(); }, 80);
        }

        function closeResetModal() {
            if (resetModalOverlay) resetModalOverlay.classList.add('hidden');
            if (resetConfirmInput) resetConfirmInput.value = '';
            if (btnResetConfirm) btnResetConfirm.disabled = true;
        }

        if (btnResetExt) btnResetExt.addEventListener('click', openResetModal);
        if (btnResetCancel) btnResetCancel.addEventListener('click', closeResetModal);

        // Close on backdrop click
        if (resetModalOverlay) {
            resetModalOverlay.addEventListener('click', (e) => {
                if (e.target === resetModalOverlay) closeResetModal();
            });
        }

        // Enable confirm button only when user types exactly "RESET"
        if (resetConfirmInput) {
            resetConfirmInput.addEventListener('input', () => {
                if (btnResetConfirm) {
                    btnResetConfirm.disabled = resetConfirmInput.value !== 'RESET';
                }
            });
        }

        // Perform the wipe
        if (btnResetConfirm) {
            btnResetConfirm.addEventListener('click', async () => {
                if (resetConfirmInput && resetConfirmInput.value !== 'RESET') return;

                btnResetConfirm.disabled = true;
                btnResetConfirm.textContent = 'Resetting…';

                try {
                    // Wipe all local extension storage (vault, settings, sync state, etc.)
                    await new Promise(resolve => chrome.storage.local.clear(resolve));
                    // Wipe session storage (auto-unlock session)
                    await new Promise(resolve => chrome.storage.session.clear(resolve));
                    // Wipe IndexedDB — notes (folders + items) are stored here, not in chrome.storage
                    await new Promise((resolve, reject) => {
                        // Close any open connection first to avoid blocked state
                        if (globalThis.AppDB && globalThis.AppDB.getDB()) {
                            try { globalThis.AppDB.getDB().close(); } catch (_) {}
                        }
                        const req = indexedDB.deleteDatabase(AppDB.DB_NAME || 'PersonalDashboardDB');
                        req.onsuccess = resolve;
                        req.onerror = () => reject(req.error);
                        req.onblocked = resolve; // proceed even if blocked
                    });
                } catch (err) {
                    console.error('[Reset Extension] Storage clear failed:', err);
                }

                // Reload the popup to start fresh
                window.location.reload();
            });
        }

        // Populate Phase 3 DOM elements and bind their events
        bindUnlockedViewEvents();
    }

    function bindUnlockedViewEvents() {
        // Phase 3 DOM elements
        listEntries = document.getElementById('pm-entries-list');
        btnAddEntry = document.getElementById('pm-add-entry-fab');
        panelDetail = document.getElementById('pm-detail-panel');
        panelTitle = document.getElementById('pm-panel-title');
        btnSaveEntry = document.getElementById('pm-save-entry-btn');
        btnClosePanel = document.getElementById('pm-close-panel-btn');
        inputTitle = document.getElementById('pm-entry-title');
        inputUsername = document.getElementById('pm-entry-username');
        inputEmail = document.getElementById('pm-entry-email');
        inputPassword = document.getElementById('pm-entry-password');
        inputUrl = document.getElementById('pm-entry-url');
        selectFolder = document.getElementById('pm-entry-folder');
        selectCategory = document.getElementById('pm-entry-category');
        inputNotes = document.getElementById('pm-entry-notes');
        btnTogglePanVis = document.getElementById('pm-panel-toggle-vis');
        if (btnTogglePanVis) {
            iconPanEyeOpen = btnTogglePanVis.querySelector('.eye-open');
            iconPanEyeClosed = btnTogglePanVis.querySelector('.eye-closed');
        }
        strengthFill = document.getElementById('pm-strength-fill');
        modalGen = document.getElementById('pm-generator-modal');
        inGenResult = document.getElementById('pm-gen-result');
        btnGenOpen = document.getElementById('pm-panel-generate-btn');
        btnGenClose = document.getElementById('pm-gen-cancel');
        btnGenUse = document.getElementById('pm-gen-use-btn');
        btnGenRefresh = document.getElementById('pm-gen-refresh-btn');
        btnGenCopy = document.getElementById('pm-gen-copy-btn');
        sliderLen = document.getElementById('pm-gen-length');
        lblLenVal = document.getElementById('pm-gen-len-val');
        chkUpper = document.getElementById('pm-gen-upper');
        chkLower = document.getElementById('pm-gen-lower');
        chkNums = document.getElementById('pm-gen-nums');
        chkSyms = document.getElementById('pm-gen-syms');
        categoryList = document.getElementById('pm-category-list');
        folderListPM = document.getElementById('pm-folder-list');
        currentCategoryTitle = document.getElementById('pm-current-category-title');
        searchBoxPM = document.getElementById('pm-search-box');
        btnAddFolder = document.getElementById('pm-add-folder-btn');
        btnSettings = document.getElementById('pm-settings-btn');
        viewSettings = document.getElementById('pm-settings-view');
        listScrollContainer = document.getElementById('pm-list-scroll-container');
        searchClearBtn = document.getElementById('pm-search-clear');

        // Category/Folder select interaction
        if (selectCategory && selectFolder) {
            selectCategory.addEventListener('change', () => {
                if (selectCategory.value !== 'none') selectFolder.value = 'none';
            });
            selectFolder.addEventListener('change', () => {
                if (selectFolder.value !== 'none') selectCategory.value = 'none';
            });
        }

        // Sidebar clicks
        if (categoryList) categoryList.addEventListener('click', handleSidebarClick);
        if (folderListPM) folderListPM.addEventListener('click', handleSidebarClick);



        // Add folder
        if (btnAddFolder) {
            btnAddFolder.addEventListener('click', async () => {
                const name = await AppUtils.showPromptDialog({ title: 'New Folder', placeholder: 'Folder name' });
                if (name) {
                    try { await window.vaultService.addCategory(name.trim()); renderSidebar(); }
                    catch (err) { alert(err.message); }
                }
            });
        }

        // Search
        if (searchBoxPM) {
            searchBoxPM.addEventListener('input', () => {
                if (searchClearBtn) searchClearBtn.classList.toggle('visible', searchBoxPM.value.length > 0);
                renderVaultItems();
            });
        }
        if (searchClearBtn) {
            searchClearBtn.addEventListener('click', () => {
                searchBoxPM.value = ''; searchClearBtn.classList.remove('visible');
                searchBoxPM.focus(); renderVaultItems();
            });
        }

        // FAB, panel, visibility toggle
        if (btnAddEntry) btnAddEntry.addEventListener('click', () => openDetailPanel());
        if (btnClosePanel) btnClosePanel.addEventListener('click', closeDetailPanel);
        if (btnTogglePanVis) {
            btnTogglePanVis.addEventListener('click', () => {
                if (inputPassword.type === 'password') {
                    inputPassword.type = 'text';
                    if (iconPanEyeOpen) iconPanEyeOpen.classList.add('hidden');
                    if (iconPanEyeClosed) iconPanEyeClosed.classList.remove('hidden');
                } else {
                    inputPassword.type = 'password';
                    if (iconPanEyeOpen) iconPanEyeOpen.classList.remove('hidden');
                    if (iconPanEyeClosed) iconPanEyeClosed.classList.add('hidden');
                }
            });
        }

        // Save entry
        if (btnSaveEntry) {
            btnSaveEntry.addEventListener('click', async () => {
                const title = inputTitle.value.trim();
                if (!title) { alert("Title is required"); return; }
                const entryData = {
                    type: 'password', title,
                    username: inputUsername.value.trim(), email: inputEmail.value.trim(),
                    password: inputPassword.value, url: inputUrl.value.trim(),
                    categoryId: (selectFolder && selectFolder.value !== 'none') ? selectFolder.value : (selectCategory && selectCategory.value !== 'none' ? selectCategory.value : null),
                    notes: inputNotes.value.trim()
                };
                btnSaveEntry.disabled = true;
                try {
                    if (currentEditId) await window.vaultService.updateEntry(currentEditId, entryData);
                    else await window.vaultService.addEntry(entryData);
                    syncVaultWithBackground(); closeDetailPanel(); renderVaultItems();
                } catch (e) { console.error("Save failed", e); alert("Failed to save entry"); }
                finally { btnSaveEntry.disabled = false; }
            });
        }

        // Password strength
        if (inputPassword) inputPassword.addEventListener('input', evaluatePasswordStrength);

        // Generator
        if (sliderLen) sliderLen.addEventListener('input', () => { if (lblLenVal) lblLenVal.textContent = sliderLen.value; doGeneratePassword(); });
        [chkUpper, chkLower, chkNums, chkSyms].forEach(cb => { if (cb) cb.addEventListener('change', doGeneratePassword); });
        if (btnGenOpen) btnGenOpen.addEventListener('click', () => { if (modalGen) modalGen.classList.remove('hidden'); document.getElementById('modal-backdrop')?.classList.remove('hidden'); doGeneratePassword(); });
        if (btnGenClose) btnGenClose.addEventListener('click', () => { if (modalGen) modalGen.classList.add('hidden'); document.getElementById('modal-backdrop')?.classList.add('hidden'); });
        if (btnGenRefresh) btnGenRefresh.addEventListener('click', doGeneratePassword);
        if (btnGenCopy) {
            btnGenCopy.addEventListener('click', () => {
                if (inGenResult) navigator.clipboard.writeText(inGenResult.value).then(() => copyToClipboard(inGenResult.value, true));
            });
        }
        if (btnGenUse) {
            btnGenUse.addEventListener('click', () => {
                if (inGenResult && inputPassword) { inputPassword.value = inGenResult.value; evaluatePasswordStrength(); }
                if (modalGen) modalGen.classList.add('hidden');
                document.getElementById('modal-backdrop')?.classList.add('hidden');
            });
        }

        // Copy buttons in panel
        document.querySelectorAll('.pm-copy-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const target = document.getElementById(btn.dataset.target);
                if (target) copyToClipboard(target.value, btn.dataset.target === 'pm-entry-password');
            });
        });

        // URL launch
        document.querySelectorAll('.pm-launch-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (inputUrl && inputUrl.value.trim()) window.open(inputUrl.value.trim(), '_blank');
            });
        });

        // IO Dropdowns for PM
        AppUtils.setupIODropdowns({
            importBtn: document.getElementById('pm-import-btn'),
            exportBtn: document.getElementById('pm-export-btn'),
            importDropdown: document.getElementById('pm-import-dropdown'),
            exportDropdown: document.getElementById('pm-export-dropdown')
        });

        // PM IO action buttons
        const pmImportFile = document.getElementById('pm-import-file');
        document.querySelectorAll('#pm-import-dropdown .io-dropdown-item, #pm-export-dropdown .io-dropdown-item').forEach(item => {
            item.addEventListener('click', async (e) => {
                e.stopPropagation();
                const action = item.dataset.action;
                if (action === 'pm-export-json') exportPasswordVault();
                else if (action === 'pm-import-json' && pmImportFile) pmImportFile.click();
            });
        });

        if (pmImportFile) {
            pmImportFile.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = async (event) => {
                    try {
                        const entries = JSON.parse(event.target.result);
                        if (!Array.isArray(entries)) throw new Error("Invalid format: expected array");
                        let successCount = 0, failCount = 0;
                        for (const entry of entries) {
                            if (entry.password && (!entry.type || entry.type === 'password')) {
                                entry.type = 'password';
                                const response = await new Promise(resolve => chrome.runtime.sendMessage({ action: 'add_credential', entry }, resolve));
                                if (response && response.success) successCount++; else failCount++;
                            } else failCount++;
                        }
                        alert(`Import complete!\nSuccessfully imported: ${successCount}\nFailed: ${failCount}`);
                        document.dispatchEvent(new Event('vault_updated'));
                    } catch (error) { alert("Password Import failed. Please check the JSON file format."); console.error("PM Import Error:", error); }
                };
                reader.readAsText(file);
                e.target.value = '';
            });
        }
    }

    return {
        init
    };

})();

window.PasswordManager = PasswordManager;
