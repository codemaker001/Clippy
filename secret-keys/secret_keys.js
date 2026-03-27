/**
 * Secret Keys UI Logic
 * Module pattern with deferred init() for SPA router compatibility.
 */

const SecretKeys = (function () {

    // --- DOM Element handles (populated in init) ---
    let viewLocked, viewUnlocked;
    let listEntries, btnAddEntry, panelDetail, panelTitle, btnSaveEntry, btnClosePanel;
    let panelContentArea, searchBoxSK;
    let categoryListSK, folderListSK, currentCategoryTitle;
    let inputSKPassword, btnSKUnlock, msgSKLoginError;
    let skSetupFooter, skLoginTitle, skLoginSubtitle;

    let currentEditId = null;
    let activeSkCategoryId = 'sk_all';
    let isSKNewVault = false;


    async function checkSKVaultStatus() {
        if (!window.vaultService) return;

        const secured = await window.vaultService.isSecured();

        if (!secured) {
            // PLAINTEXT MODE — skip lock screen
            await window.vaultService.loadPlaintext();
            showSKUnlockedView();
            return;
        }

        if (window.vaultService.isUnlocked) {
            showSKUnlockedView();
            return;
        }

        // Try auto-unlock
        const autoUnlocked = await window.vaultService.tryAutoUnlock();
        if (autoUnlocked) {
            showSKUnlockedView();
            return;
        }

        // Show lock screen (unlock only)
        isSKNewVault = false;
        skLoginTitle.textContent = "Unlock Vault";
        skLoginSubtitle.textContent = "Enter your master password";
        btnSKUnlock.textContent = "Unlock";
        if (skSetupFooter) skSetupFooter.classList.add('hidden');

        showSKLockedView();
    }

    async function handleSKAuthSubmit() {
        if (!inputSKPassword) return;
        const password = inputSKPassword.value.trim();
        msgSKLoginError.classList.add('hidden');

        if (!password) {
            showSKError("Password cannot be empty.");
            return;
        }

        btnSKUnlock.disabled = true;
        btnSKUnlock.textContent = "Unlocking...";

        try {
            await window.vaultService.unlock(password);
            inputSKPassword.value = '';
            showSKUnlockedView();
        } catch (error) {
            showSKError(error.message);
        } finally {
            btnSKUnlock.disabled = false;
            btnSKUnlock.textContent = "Unlock";
        }
    }

    function showSKError(msg) {
        msgSKLoginError.textContent = msg;
        msgSKLoginError.classList.remove('hidden');
        viewLocked.querySelector('.pm-login-card').classList.add('animate-out');
        setTimeout(() => {
            viewLocked.querySelector('.pm-login-card').classList.remove('animate-out');
            viewLocked.querySelector('.pm-login-card').classList.add('animate-in');
        }, 300);
    }

    // Event bindings moved to bindAllSKEvents()

    function showSKLockedView() {
        if (viewLocked) viewLocked.classList.remove('hidden');
        if (viewUnlocked) viewUnlocked.classList.add('hidden');
    }

    function showSKUnlockedView() {
        if (viewLocked) viewLocked.classList.add('hidden');
        if (viewUnlocked) viewUnlocked.classList.remove('hidden');

        // Show/hide Secure Vault banner
        const secureBanner = document.getElementById('sk-secure-vault-banner');
        if (secureBanner) {
            secureBanner.classList.toggle('hidden', !!window.vaultService._isSecured);
        }

        // Setup SK specific sidebar categories if they don't exist
        setupSKCategories();

        activeSkCategoryId = 'sk_all';
        if (currentCategoryTitle) currentCategoryTitle.textContent = 'All Secrets';
        if (searchBoxSK) searchBoxSK.value = '';

        renderSidebar();
        renderVaultItems();
    }

    window.secretKeysUI = {
        showUnlockedView: showSKUnlockedView,
        showLockedView: showSKLockedView,
        render: renderVaultItems
    };

    // --- Data Management & Categories ---

    async function setupSKCategories() {
        if (!window.vaultService) return;
        const types = [
            { id: 'sk_env', name: 'Environment Variables', icon: 'env' },
            { id: 'sk_api', name: 'API Keys', icon: 'api' },
            { id: 'sk_ssh', name: 'SSH / Certificates', icon: 'ssh' }
        ];

        let needsSave = false;
        if (!window.vaultService.vaultCache.skCategories) {
            window.vaultService.vaultCache.skCategories = [
                { id: 'sk_env', name: 'Environment Variables', type: 'system' },
                { id: 'sk_api', name: 'API Keys', type: 'system' },
                { id: 'sk_ssh', name: 'SSH / Certificates', type: 'system' }
            ];
            needsSave = true;
        }

        if (!window.vaultService.vaultCache.skFolders) {
            window.vaultService.vaultCache.skFolders = [];
            needsSave = true;
        }

        if (needsSave) {
            try { await window.vaultService._saveToStorage(); } catch (e) { }
        }
    }

    function renderSidebar() {
        if (!window.vaultService || (!window.vaultService.isUnlocked && !window.vaultService._plaintextLoaded)) return;

        // --- System categories in sk-category-list ---
        const sysCats = (window.vaultService.vaultCache.skCategories || []).filter(c => c.type !== 'custom');
        let catHtml = `<li data-id="sk_all" class="${activeSkCategoryId === 'sk_all' ? 'active' : ''}">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>
            All Secrets
        </li>`;

        sysCats.forEach(c => {
            const iconHtml = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>`;

            catHtml += `<li data-id="${c.id}" class="${activeSkCategoryId === c.id ? 'active' : ''}">
                ${iconHtml}
                <span class="sk-category-name-text">${AppUtils.escapeHTML(c.name)}</span>
            </li>`;
        });
        categoryListSK.innerHTML = catHtml;

        // --- Custom folders in sk-folder-list ---
        const customCats = (window.vaultService.vaultCache.skCategories || []).filter(c => c.type === 'custom');
        let folderHtml = '';

        customCats.forEach(c => {
            const folderIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>`;

            const actionBtns = `
                <div class="sk-category-actions-row">
                    <button class="icon-btn sk-edit-category-btn sk-edit-category-btn-icon" title="Edit Folder Name" data-id="${c.id}" data-name="${AppUtils.escapeHTML(c.name)}">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                    </button>
                    <button class="icon-btn sk-del-category-btn sk-del-category-btn-icon" title="Delete Folder" data-id="${c.id}">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                    </button>
                </div>`;

            folderHtml += `<li data-id="${c.id}" class="${activeSkCategoryId === c.id ? 'active' : ''}">
                ${folderIcon}
                <span class="sk-category-name-text">${AppUtils.escapeHTML(c.name)}</span>
                ${actionBtns}
            </li>`;
        });
        folderListSK.innerHTML = folderHtml;

        // Delete listeners for custom folders
        document.querySelectorAll('.sk-del-category-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const confirmed = await AppUtils.showConfirmDialog({ title: 'Delete Folder?', body: 'Delete this folder? Keys inside will remain in <strong>All Secrets</strong>.', confirmLabel: 'Delete' });
                if (confirmed) {
                    try {
                        const cid = btn.dataset.id;
                        window.vaultService.vaultCache.skCategories = window.vaultService.vaultCache.skCategories.filter(c => c.id !== cid);

                        // Keep keys orphaned or reset them to a default type if needed, but since we are just filtering them out they will show in All Secrets
                        const entries = window.vaultService.getEntries().filter(en => en.type === 'secret_key' && en.skType === cid);
                        for (let en of entries) {
                            en.skType = 'sk_other';
                        }

                        await window.vaultService._saveToStorage();
                        if (activeSkCategoryId === cid) activeSkCategoryId = 'sk_all';
                        renderSidebar();
                        renderVaultItems();
                    } catch (err) {
                        alert(err.message);
                    }
                }
            });
        });

        // Edit listeners for custom folders
        document.querySelectorAll('.sk-edit-category-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const newName = await AppUtils.showPromptDialog({ title: 'Rename Folder', placeholder: 'Folder name', defaultValue: btn.dataset.name });
                if (newName && newName !== btn.dataset.name) {
                    try {
                        const cid = btn.dataset.id;
                        const cat = window.vaultService.vaultCache.skCategories.find(c => c.id === cid);
                        if (cat) {
                            cat.name = newName.trim();
                            await window.vaultService._saveToStorage();
                            if (activeSkCategoryId === cid) {
                                currentCategoryTitle.textContent = cat.name;
                            }
                            renderSidebar();
                        }
                    } catch (err) {
                        alert(err.message);
                    }
                }
            });
        });
    }

    const handleSidebarClick = (e) => {
        const li = e.target.closest('li[data-id]');
        if (!li) return;
        if (e.target.closest('.sk-del-category-btn') || e.target.closest('.sk-edit-category-btn')) return;

        activeSkCategoryId = li.dataset.id;

        if (activeSkCategoryId === 'sk_all') {
            currentCategoryTitle.textContent = 'All Secrets';
        } else {
            const cat = (window.vaultService.vaultCache.skCategories || []).find(c => c.id === activeSkCategoryId);
            if (cat) currentCategoryTitle.textContent = cat.name;
        }

        renderSidebar();
        renderVaultItems();
    };
    // Sidebar, Add Category, and Search event bindings moved to bindAllSKEvents()


    // --- Core Rendering Loop (Cards & Standalone) ---

    function renderVaultItems() {
        if (!window.vaultService || (!window.vaultService.isUnlocked && !window.vaultService._plaintextLoaded)) return;

        listEntries.innerHTML = '';

        // Filter to only Secret Keys
        let rawEntries = window.vaultService.getEntries().filter(e => e.type === 'secret_key');
        const searchTerm = (searchBoxSK.value || '').trim().toLowerCase();

        // Filter by Search
        if (searchTerm) {
            rawEntries = rawEntries.filter(e =>
                (e.keyName && e.keyName.toLowerCase().includes(searchTerm)) ||
                (e.value && e.value.toLowerCase().includes(searchTerm)) ||
                (e.notes && e.notes.toLowerCase().includes(searchTerm))
            );
        }

        // Apply Sidebar Filters
        if (activeSkCategoryId !== 'sk_all') {
            if (activeSkCategoryId.startsWith('sk_fol_')) {
                // It's a folder/collection filter
                rawEntries = rawEntries.filter(e => e.skFolderId === activeSkCategoryId);
            } else {
                // It's a type/category filter (sk_env, sk_api, etc)
                rawEntries = rawEntries.filter(e => e.skType === activeSkCategoryId);
            }
        }

        if (rawEntries.length === 0) {
            listEntries.innerHTML = '<div class="empty-state">No secrets found. Click + to add one.</div>';
            return;
        }

        // Render Standalone Items (Pills)
        rawEntries.forEach(entry => {
            listEntries.appendChild(createPillElement(entry, true));
        });
    }

    // --- Pill DOM Builder ---

    function getBadgeClass(skType) {
        if (skType === 'sk_env') return 'sk-badge-env';
        if (skType === 'sk_api') return 'sk-badge-api';
        if (skType === 'sk_ssh') return 'sk-badge-ssh';
        return 'sk-badge-other';
    }

    function getBadgeLabel(skType) {
        if (skType === 'sk_env') return 'ENV';
        if (skType === 'sk_api') return 'API';
        if (skType === 'sk_ssh') return 'SSH';
        return 'KEY';
    }

    function createPillElement(entry, isStandalone) {
        const el = document.createElement('div');
        el.className = 'sk-pill-container';

        // Left side
        let leftHtml = `
            <div class="sk-pill-key sk-monospace">${AppUtils.escapeHTML(entry.keyName)}</div>
            <div class="sk-pill-divider">|</div>
        `;

        // Right side (Masked value)
        let rightHtml = `
            <div class="sk-pill-value sk-monospace" data-val="${AppUtils.escapeHTML(entry.value)}">********</div>
            <span class="sk-badge ${getBadgeClass(entry.skType)}">${getBadgeLabel(entry.skType)}</span>
        `;

        // Actions
        let actionsHtml = `
            <div class="sk-pill-actions">
                <button class="icon-btn sk-action-btn" title="Edit" data-action="edit">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                </button>
                <button class="icon-btn sk-action-btn sk-delete-btn-icon" title="Delete" data-action="delete">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                </button>
                <button class="icon-btn sk-action-btn sk-copy-btn" title="Copy" data-action="copy">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                </button>
            </div>
        `;

        const headerEl = document.createElement('div');
        headerEl.className = 'sk-pill-header';
        headerEl.innerHTML = leftHtml + rightHtml + actionsHtml;
        el.appendChild(headerEl);

        // Notes injection (if present) appended below the main flex box
        if (entry.notes) {
            const notesEl = document.createElement('div');
            notesEl.className = 'sk-notes-container hidden';
            notesEl.innerHTML = `<div class="sk-notes-toggle-box"><strong>Notes</strong> <button class="icon-btn sk-copy-notes-btn">Copy</button></div><div>${AppUtils.escapeHTML(entry.notes)}</div>`;
            
            // Ensure the container can wrap the notes to the next line
            el.style.flexWrap = 'wrap';

            notesEl.style.width = '100%';

            // Add a tiny notes toggle button to actions
            const notesToggleHtml = document.createElement('div');
            notesToggleHtml.innerHTML = `<button class="icon-btn sk-action-btn" title="Toggle Notes" data-action="notes"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg></button>`;

            el.querySelector('.sk-pill-actions').insertBefore(notesToggleHtml.firstChild, el.querySelector('.sk-pill-actions').firstChild);
            el.appendChild(notesEl);
        }

        // --- Pill Interactivity ---

        // Hover/Click to reveal value
        const valContainer = el.querySelector('.sk-pill-value');
        el.addEventListener('mouseenter', () => {
            valContainer.textContent = valContainer.dataset.val;
            valContainer.classList.add('revealed');
        });
        el.addEventListener('mouseleave', () => {
            valContainer.textContent = '********';
            valContainer.classList.remove('revealed');
            // Hide notes automatically on leave to keep it tidy
            const notes = el.querySelector('.sk-notes-container');
            if (notes) notes.classList.add('hidden');
        });

        // Action Buttons
        el.querySelectorAll('.sk-action-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const action = btn.dataset.action;

                if (action === 'copy') {
                    // Quick flash effect
                    const origHtml = btn.innerHTML;
                    btn.textContent = 'Copied!';
                    setTimeout(() => btn.innerHTML = origHtml, 1500);

                    try {
                        await navigator.clipboard.writeText(entry.value);
                    } catch (err) { }
                }
                else if (action === 'edit') {
                    openDetailPanel(entry);
                }
                else if (action === 'delete') {
                    AppUtils.showDeleteConfirm(entry.keyName, async () => {
                        await window.vaultService.deleteEntry(entry.id);
                        renderVaultItems();
                    });
                }
                else if (action === 'notes') {
                    const notesContainer = el.querySelector('.sk-notes-container');
                    if (notesContainer) {
                        notesContainer.classList.toggle('hidden');
                    }
                }
            });
        });

        const copyNotesBtn = el.querySelector('.sk-copy-notes-btn');
        if (copyNotesBtn) {
            copyNotesBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                try { await navigator.clipboard.writeText(entry.notes); } catch (err) { }
                copyNotesBtn.textContent = 'Copied';
                setTimeout(() => copyNotesBtn.textContent = 'Copy', 1000);
            });
        }

        return el;
    }

    // showDeleteConfirm — uses shared AppUtils.showDeleteConfirm from core/utils.js

    // escapeHtml removed — uses AppUtils.escapeHTML from core/utils.js

    // --- ADD / EDIT PANEL LOGIC ---

    function buildPanelForm() {
        const sysCats = window.vaultService.vaultCache.skCategories || [];
        let typeOptions = '';
        sysCats.forEach(c => {
            typeOptions += `<option value="${c.id}">${AppUtils.escapeHTML(c.name)}</option>`;
        });

        panelContentArea.innerHTML = `
            <div class="pm-field-group">
                <label>Key Name</label>
                <input type="text" id="sk-entry-key" placeholder="e.g. OPENAI_API_KEY" class="sk-monospace sk-key-input">
            </div>

            <div class="pm-field-group">
                <label>Value / Secret</label>
                <div class="sk-value-container">
                    <input type="password" id="sk-entry-value" placeholder="Enter secret..." class="sk-monospace sk-value-input">
                    <button type="button" class="icon-btn visibility-btn sk-visibility-toggle" id="sk-value-visibility-btn" title="Toggle Visibility">
                        <svg class="eye-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                    </button>
                </div>
            </div>
            
            <div class="sk-form-row">
                <div class="pm-field-group sk-form-col">
                    <label>Collection</label>
                    <select id="sk-entry-type" class="pm-select">
                        ${typeOptions}
                    </select>
                </div>
            </div>

            <div class="pm-field-group">
                <label>Notes (Optional)</label>
                <textarea id="sk-entry-notes" placeholder="Notes, endpoints, usages..."></textarea>
            </div>
        `;
    }

    function openDetailPanel(entry = null) {
        currentEditId = entry ? entry.id : null;
        panelTitle.textContent = entry ? 'Edit Secret' : 'Add Secret';

        buildPanelForm();

        const inputKey = document.getElementById('sk-entry-key');
        const inputValue = document.getElementById('sk-entry-value');
        const selectType = document.getElementById('sk-entry-type');
        const inputNotes = document.getElementById('sk-entry-notes');

        // Populate fields
        inputKey.value = entry ? entry.keyName : '';
        inputValue.value = entry ? (entry.value || '') : '';
        inputNotes.value = entry ? (entry.notes || '') : '';

        // Default type selection
        if (entry && entry.skType) {
            selectType.value = entry.skType;
        } else if (!entry && activeSkCategoryId.startsWith('sk_') && !activeSkCategoryId.startsWith('sk_fol_') && activeSkCategoryId !== 'sk_all') {
            selectType.value = activeSkCategoryId;
        }

        // Default folder selection removed

        // Assign toggle listener
        const btnVisibility = document.getElementById('sk-value-visibility-btn');
        if (btnVisibility) {
            btnVisibility.addEventListener('click', (e) => {
                e.preventDefault();
                if (inputValue.type === 'password') {
                    inputValue.type = 'text';
                    btnVisibility.innerHTML = '<svg class="eye-off-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>';
                } else {
                    inputValue.type = 'password';
                    btnVisibility.innerHTML = '<svg class="eye-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>';
                }
            });
        }

        panelDetail.classList.remove('hidden');
    }

    function closeSKPanel() {
        panelDetail.classList.add('hidden');
        currentEditId = null;
    }

    function openSKPanel(entry) { openDetailPanel(entry); }

    async function saveSKEntry() {
        const inputKey = document.getElementById('sk-entry-key');
        const inputValue = document.getElementById('sk-entry-value');
        const selectType = document.getElementById('sk-entry-type');
        const inputNotes = document.getElementById('sk-entry-notes');
        const keyName = inputKey.value.trim();
        const value = inputValue.value;
        if (!keyName) { alert("Key Name is required"); return; }
        if (!value) { alert("Value is required"); return; }
        const entryData = {
            type: 'secret_key', keyName, value,
            skType: selectType.value, skFolderId: null,
            notes: inputNotes.value.trim()
        };
        btnSaveEntry.disabled = true;
        try {
            if (currentEditId) await window.vaultService.updateEntry(currentEditId, entryData);
            else await window.vaultService.addEntry(entryData);
            closeSKPanel();
            renderVaultItems();
        } catch (e) {
            console.error("Save failed", e); alert("Failed to save secret key");
        } finally { btnSaveEntry.disabled = false; }
    }
    // FAB/Panel/Save event bindings handled in bindAllSKEvents()


    // --- SK Import / Export Utility Functions ---
    // (event bindings handled in bindAllSKEvents)

    async function exportSKData() {
        if (!window.vaultService || !window.vaultService.isUnlocked) {
            alert("Vault must be unlocked to export.");
            return;
        }
        const allEntries = window.vaultService.getEntries();
        const skEntries = allEntries.filter(e => e.type === 'secret_key');
        const blob = new Blob([JSON.stringify(skEntries, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `secret_keys_backup_${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
    }

    function importSKData(e) {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (event) => {
            try {
                const entries = JSON.parse(event.target.result);
                if (!Array.isArray(entries)) throw new Error("Invalid format: expected array");
                let successCount = 0, failCount = 0;
                for (const entry of entries) {
                    if (entry.type === 'secret_key' && entry.keyName && entry.value) {
                        try {
                            await window.vaultService.addEntry({
                                type: 'secret_key',
                                keyName: entry.keyName,
                                value: entry.value,
                                skType: entry.skType || 'sk_other',
                                skFolderId: entry.skFolderId || null,
                                notes: entry.notes || ''
                            });
                            successCount++;
                        } catch (err) { console.error("Failed to import entry", err); failCount++; }
                    } else { failCount++; }
                }
                alert(`Import complete!\nSuccessfully imported: ${successCount}\nFailed: ${failCount}`);
                renderVaultItems();
            } catch (error) {
                alert("Secret Keys Import failed. Please check the JSON file format.");
                console.error("SK Import Error:", error);
            }
        };
        reader.readAsText(file);
        e.target.value = '';
    }


    // --- Public init() — called by router when Secret Keys tab becomes active ---
    function init() {
        // Grab DOM elements
        viewLocked = document.getElementById('sk-locked-view');
        viewUnlocked = document.getElementById('sk-unlocked-view');
        listEntries = document.getElementById('sk-entries-list');
        btnAddEntry = document.getElementById('sk-add-entry-fab');
        panelDetail = document.getElementById('sk-detail-panel');
        panelTitle = document.getElementById('sk-panel-title');
        btnSaveEntry = document.getElementById('sk-save-entry-btn');
        btnClosePanel = document.getElementById('sk-close-panel-btn');
        panelContentArea = document.getElementById('sk-panel-content-area');
        searchBoxSK = document.getElementById('sk-search-box');
        categoryListSK = document.getElementById('sk-category-list');
        folderListSK = document.getElementById('sk-folder-list');
        currentCategoryTitle = document.getElementById('sk-current-category-title');
        inputSKPassword = document.getElementById('sk-master-password');
        btnSKUnlock = document.getElementById('sk-unlock-btn');
        msgSKLoginError = document.getElementById('sk-login-error');
        skSetupFooter = document.getElementById('sk-setup-footer');
        skLoginTitle = document.getElementById('sk-login-title');
        skLoginSubtitle = document.getElementById('sk-login-subtitle');

        // Bind events
        bindAllSKEvents();

        // Check vault status
        checkSKVaultStatus();
    }

    function bindAllSKEvents() {
        // Vault login
        if (btnSKUnlock) btnSKUnlock.addEventListener('click', handleSKAuthSubmit);
        if (inputSKPassword) {
            inputSKPassword.addEventListener('keydown', e => {
                if (e.key === 'Enter') { e.preventDefault(); handleSKAuthSubmit(); }
            });
        }

        // --- Secure Vault button ---
        const btnSKSecureVault = document.getElementById('sk-secure-vault-btn');
        if (btnSKSecureVault) {
            btnSKSecureVault.addEventListener('click', () => {
                if (globalThis.SyncService) {
                    SyncService.signIn();
                } else if (globalThis.AppRouter) {
                    globalThis.AppRouter.switchTo('settings');
                }
            });
        }

        // Sidebar
        const sidebarClickHandler = (e) => {
            const li = e.target.closest('li[data-id]');
            if (!li) return;
            if (e.target.closest('.sk-del-category-btn') || e.target.closest('.sk-edit-category-btn')) return;
            activeSkCategoryId = li.dataset.id;
            if (activeSkCategoryId === 'sk_all') {
                currentCategoryTitle.textContent = 'All Secrets';
            } else {
                const cat = (window.vaultService.vaultCache.skCategories || []).find(c => c.id === activeSkCategoryId);
                if (cat) currentCategoryTitle.textContent = cat.name;
            }
            renderSidebar();
            renderVaultItems();
        };
        if (categoryListSK) {
            categoryListSK.addEventListener('click', sidebarClickHandler);
        }
        if (folderListSK) {
            folderListSK.addEventListener('click', sidebarClickHandler);
        }

        // Add folder
        const addCatBtn = document.getElementById('sk-add-category-btn');
        if (addCatBtn) {
            addCatBtn.addEventListener('click', async () => {
                const name = await AppUtils.showPromptDialog({ title: 'New Folder', placeholder: 'Folder name' });
                if (name) {
                    try {
                        if (!window.vaultService.vaultCache.skCategories) {
                            window.vaultService.vaultCache.skCategories = [];
                        }
                        const newFolder = { id: `sk_custom_${Date.now()}`, name: name, type: 'custom' };
                        window.vaultService.vaultCache.skCategories.push(newFolder);
                        await window.vaultService._saveToStorage();
                        renderSidebar();
                    } catch (err) { alert(err.message); }
                }
            });
        }

        // Search
        if (searchBoxSK) {
            searchBoxSK.addEventListener('input', () => {
                const searchClearSK = document.getElementById('sk-search-clear');
                if (searchClearSK) searchClearSK.classList.toggle('visible', searchBoxSK.value.length > 0);
                renderVaultItems();
            });
        }
        const searchClearSK = document.getElementById('sk-search-clear');
        if (searchClearSK) {
            searchClearSK.addEventListener('click', () => {
                searchBoxSK.value = '';
                searchClearSK.classList.remove('visible');
                searchBoxSK.focus();
                renderVaultItems();
            });
        }

        // FAB & Panel
        if (btnAddEntry) btnAddEntry.addEventListener('click', () => openSKPanel());
        if (btnClosePanel) btnClosePanel.addEventListener('click', closeSKPanel);
        if (btnSaveEntry) btnSaveEntry.addEventListener('click', saveSKEntry);

        // IO Dropdowns
        AppUtils.setupIODropdowns({
            importBtn: document.getElementById('sk-import-btn'),
            exportBtn: document.getElementById('sk-export-btn'),
            importDropdown: document.getElementById('sk-import-dropdown'),
            exportDropdown: document.getElementById('sk-export-dropdown')
        });

        // SK IO action buttons
        const skImportFile = document.getElementById('sk-import-file');
        document.querySelectorAll('#sk-import-dropdown .io-dropdown-item, #sk-export-dropdown .io-dropdown-item').forEach(item => {
            item.addEventListener('click', async (e) => {
                e.stopPropagation();
                const action = item.dataset.action;
                if (action === 'sk-export-json') exportSKData();
                else if (action === 'sk-import-json' && skImportFile) skImportFile.click();
            });
        });

        if (skImportFile) {
            skImportFile.addEventListener('change', importSKData);
        }
    }

    return {
        init
    };

})();

window.SecretKeys = SecretKeys;
