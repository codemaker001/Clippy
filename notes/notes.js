/**
 * notes/notes.js — Notes/Ideas Module
 * Extracted and wrapped in a module pattern.
 * Uses AppDB and AppUtils from core/ for shared functionality.
 */

const NotesApp = (function () {

    // --- Module State ---
    let db;
    let activeFolderId = 'all';
    let currentItemType = 'text';
    let sessionUnlockedFolders = new Set();
    let pendingFolderAction = { id: null, type: null };
    let addQuill = null;
    let editQuill = null;
    let initialized = false;
    let selectedNoteColor = 'default';
    
    // Tag and Filter State
    let currentItemTags = [];
    let allExistingTags = new Set();
    let activeFilters = {
        tags: new Set(),
        dateRange: { start: null, end: null },
        types: new Set(['text', 'link', 'image', 'file'])
    };

    // DOM element handles (populated in init)
    let el = {};

    const escapeHTML = AppUtils.escapeHTML;
    const normalizeUrl = AppUtils.normalizeUrl;

    // --- File Upload ---
    function handleFileUpload(file, folderId) {
        const newItem = {
            folderId,
            fileName: file.name,
            fileType: file.type || 'N/A',
            fileSize: (file.size / 1024).toFixed(2),
            createdAt: new Date(),
        };

        if (file.type.startsWith('image/')) {
            newItem.type = 'image';
            newItem.fileBlob = file;
            addItem(newItem);
        } else if (file.type.startsWith('text/')) {
            const reader = new FileReader();
            reader.onload = ev => {
                newItem.type = 'text';
                newItem.content = ev.target.result;
                addItem(newItem);
            };
            reader.readAsText(file);
        } else {
            newItem.type = 'file';
            newItem.fileBlob = file;
            addItem(newItem);
        }
    }

    // --- Folder CRUD ---
    function addFolder(name, parentId = null) {
        AppDB.addFolder(name, parentId, () => {
            renderFolders();
            if (activeFolderId !== 'all') renderSubfolders(activeFolderId);
        });
    }

    function updateFolder(id, dataToUpdate) {
        AppDB.updateFolder(id, dataToUpdate, () => renderFolders());
    }

    // --- Item CRUD ---
    // All CRUD goes through AppDB so that UUIDs, timestamps, tombstones
    // and triggerAutoSync() are handled consistently.
    function addItem(item) {
        if (!item.tags) item.tags = [];
        // Normalise createdAt to ISO string (callers sometimes pass Date objects)
        if (item.createdAt instanceof Date) item.createdAt = item.createdAt.toISOString();
        AppDB.addItem(item, () => {
            refreshExistingTags();
            renderItems(activeFolderId);
        });
    }

    function updateItem(id, dataToUpdate) {
        AppDB.updateItem(id, dataToUpdate, () => {
            refreshExistingTags();
            renderItems(activeFolderId, el.searchBox ? el.searchBox.value : '');
        });
    }

    function deleteItem(id) {
        // Animate the card out immediately (optimistic UI), then delete via AppDB.
        // AppDB.deleteItem records the tombstone and triggers auto-sync.
        const itemCard = document.querySelector(`.item-card[data-id="${id}"]`);
        if (itemCard) {
            itemCard.classList.add('animate-out');
            itemCard.addEventListener('animationend', () => {
                itemCard.remove();
                if (el.notesGrid.children.length === 0 && el.linksContainer.children.length === 0) {
                    renderItems(activeFolderId, el.searchBox ? el.searchBox.value : '');
                }
            }, { once: true });
        } else {
            // Card not in DOM — just re-render after delete
            AppDB.deleteItem(id, () => renderItems(activeFolderId, el.searchBox ? el.searchBox.value : ''));
            return;
        }
        AppDB.deleteItem(id);
    }

    function getItem(id) {
        return new Promise((resolve, reject) => {
            const request = db.transaction(['items']).objectStore('items').get(id);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    function getFolder(id) {
        return new Promise(resolve => {
            db.transaction('folders').objectStore('folders').get(id).onsuccess = e => resolve(e.target.result);
        });
    }

    // --- Rendering ---
    async function renderFolders() {
        const allFolders = await AppDB.getAllFolders();

        el.folderList.innerHTML = `
            <li class="folder-item ${activeFolderId === 'all' ? 'active' : ''}" data-id="all">
                <span class="folder-name">All Items</span>
            </li>
        `;

        // Only show top-level folders in sidebar
        const topLevelFolders = allFolders.filter(f => !f.parentId);

        topLevelFolders.forEach(folder => {
            const li = document.createElement('li');
            li.className = `folder-item ${activeFolderId === folder.id ? 'active' : ''}`;
            li.dataset.id = folder.id;
            li.draggable = true;

            const lockIcon = folder.pin
                ? `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>`
                : `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 9.9-1"></path></svg>`;

            li.innerHTML = `
                <span class="folder-name">${escapeHTML(folder.name)}</span>
                <div class="folder-actions">
                    <button class="icon-btn edit-folder" title="Rename folder">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg>
                    </button>
                    <button class="icon-btn delete-folder" title="Delete folder">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                    </button>
                    <button class="icon-btn manage-pin-btn" title="${folder.pin ? 'Manage PIN' : 'Set PIN'}">${lockIcon}</button>
                </div>
            `;
            el.folderList.appendChild(li);
        });
    }

    async function renderSubfolders(parentId) {
        if (parentId === 'all') {
            el.subfoldersSection.classList.add('hidden');
            el.addSubfolderBtn.classList.add('hidden');
            return;
        }

        const allFolders = await AppDB.getAllFolders();

        const subfolders = allFolders.filter(f => f.parentId === parentId);

        el.addSubfolderBtn.classList.remove('hidden');

        if (subfolders.length > 0) {
            el.subfoldersSection.classList.remove('hidden');
            el.subfoldersGrid.innerHTML = '';
            subfolders.forEach(folder => {
                const card = document.createElement('div');
                card.className = 'folder-card';
                card.dataset.id = folder.id;

                const lockIcon = folder.pin
                    ? `<div class="folder-card-lock"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg></div>`
                    : '';

                const pinIcon = folder.pin
                    ? `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>`
                    : `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 9.9-1"></path></svg>`;

                card.innerHTML = `
                    <div class="folder-card-icon">
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
                    </div>
                    <span class="folder-card-name">${escapeHTML(folder.name)}</span>
                    ${lockIcon}
                    <div class="folder-card-actions">
                        <button class="icon-btn edit-folder-card" title="Rename folder">
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                        </button>
                        <button class="icon-btn delete-folder-card" title="Delete folder">
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                        </button>
                        <button class="icon-btn manage-pin-card" title="${folder.pin ? 'Manage PIN' : 'Set PIN'}">
                            ${pinIcon}
                        </button>
                    </div>
                `;
                el.subfoldersGrid.appendChild(card);
            });
        } else {
            el.subfoldersSection.classList.add('hidden');
        }
    }

    async function renderItems(folderId, searchTerm = '') {
        const store = db.transaction(['items']).objectStore('items');
        let allItems;

        if (folderId === 'all') {
            const allItemsPromise = new Promise(resolve => store.getAll().onsuccess = e => resolve(e.target.result));
            const allFoldersPromise = AppDB.getAllFolders();
            const [itemsFromDB, allFolders] = await Promise.all([allItemsPromise, allFoldersPromise]);
            const lockedFolderIds = new Set();
            allFolders.forEach(folder => {
                if (folder.pin && !sessionUnlockedFolders.has(folder.id)) lockedFolderIds.add(folder.id);
            });
            allItems = itemsFromDB.filter(item => !lockedFolderIds.has(item.folderId));
        } else {
            allItems = await new Promise(resolve =>
                store.index('folderId').getAll(folderId).onsuccess = e => resolve(e.target.result)
            );
        }

        // Apply Search Term
        if (searchTerm) {
            searchTerm = searchTerm.toLowerCase();
            allItems = allItems.filter(item => {
                const content = (item.content || '').toLowerCase();
                const title = (item.title || '').toLowerCase();
                const fileName = (item.fileName || '').toLowerCase();
                const tagsMatch = (item.tags || []).some(t => t.toLowerCase().includes(searchTerm));
                return content.includes(searchTerm) || title.includes(searchTerm) || fileName.includes(searchTerm) || tagsMatch;
            });
        }

        // Apply Advanced Filters
        // 1. Tag Filter
        if (activeFilters.tags.size > 0) {
            allItems = allItems.filter(item => {
                if (!item.tags || item.tags.length === 0) return false;
                return [...activeFilters.tags].every(tag => item.tags.includes(tag));
            });
        }

        // 2. Date Range Filter
        if (activeFilters.dateRange.start || activeFilters.dateRange.end) {
            const start = activeFilters.dateRange.start ? new Date(activeFilters.dateRange.start) : null;
            const end = activeFilters.dateRange.end ? new Date(activeFilters.dateRange.end) : null;
            if (start) start.setHours(0, 0, 0, 0);
            if (end) end.setHours(23, 59, 59, 999);

            allItems = allItems.filter(item => {
                const itemDate = new Date(item.createdAt);
                if (start && itemDate < start) return false;
                if (end && itemDate > end) return false;
                return true;
            });
        }

        // 3. Type Filter
        if (activeFilters.types.size < 4) {
            allItems = allItems.filter(item => activeFilters.types.has(item.type));
        }

        const gridItems = allItems.filter(item => item.type === 'text' || item.type === 'image' || item.type === 'file');
        const links = allItems.filter(item => item.type === 'link');

        el.notesGrid.innerHTML = '';
        el.linksContainer.innerHTML = '';
        el.notesGrid.classList.add('hidden');
        if (el.linksSectionTitle) el.linksSectionTitle.classList.add('hidden');

        if (gridItems.length > 0) {
            el.notesGrid.classList.remove('hidden');
            gridItems.reverse().forEach(item => {
                const card = document.createElement('div');
                card.className = `item-card item-card-${item.type} animate-in`;
                card.dataset.id = item.id;
                if (item.color && item.color !== 'default') {
                    card.style.backgroundColor = item.color;
                }
                
                let contentHTML = '';
                switch (item.type) {
                    case 'text':
                        const tempDiv = document.createElement('div');
                        tempDiv.innerHTML = item.content;
                        const rawText = tempDiv.textContent || tempDiv.innerText || '';
                        contentHTML = `<div class="item-content">${escapeHTML(rawText)}</div>`;
                        break;
                    case 'image':
                        let imageUrl = '';
                        if (item.fileUrl) imageUrl = item.fileUrl; // From Supabase Storage
                        else if (item.fileBlob) imageUrl = URL.createObjectURL(item.fileBlob); // Local before sync
                        else if (item.content) imageUrl = item.content; // Legacy/external
                        contentHTML = `<div class="item-content-image"><img src="${imageUrl}" alt="Saved image content"></div>`;
                        break;
                    case 'file':
                        contentHTML = `
                            <div class="item-content" style="text-align: center; display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 8px;">
                                <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><polyline points="13 2 13 9 20 9"></polyline></svg>
                                <span style="display: block; word-break: break-all; font-weight: 500; line-height: 1.2;">${escapeHTML(item.fileName)}</span>
                            </div>`;
                        break;
                }

                const tagsHTML = (item.tags && item.tags.length > 0) 
                    ? `<div class="card-tags">${item.tags.map(t => `<span class="card-tag">#${escapeHTML(t)}</span>`).join('')}</div>`
                    : '';

                card.innerHTML = `
                    ${contentHTML}
                    ${tagsHTML}
                    <div class="item-actions">
                        <button class="icon-btn copy-item-btn" title="Copy content">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                        </button>
                        <button class="icon-btn delete-item-btn" title="Delete item">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                        </button>
                    </div>
                `;
                el.notesGrid.appendChild(card);
            });
        }

        if (links.length > 0) {
            el.linksSectionTitle.classList.remove('hidden');
            links.reverse().forEach(item => {
                const card = document.createElement('div');
                card.className = `item-card item-card-link animate-in`;
                card.dataset.id = item.id;
                if (item.color && item.color !== 'default') {
                    card.style.backgroundColor = item.color;
                }

                const tagsHTML = (item.tags && item.tags.length > 0) 
                    ? `<div class="card-tags">${item.tags.map(t => `<span class="card-tag">#${escapeHTML(t)}</span>`).join('')}</div>`
                    : '';

                card.innerHTML = `
                    <div class="item-content">
                        <span class="link-title">${escapeHTML(item.title) || 'Link'}</span>
                        <span class="link-url">${escapeHTML(item.content)}</span>
                        ${tagsHTML}
                    </div>
                    <div class="item-actions">
                        <button class="icon-btn open-link-btn" title="Open link">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
                        </button>
                        <button class="icon-btn delete-item-btn" title="Delete item">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                        </button>
                    </div>
                `;
                el.linksContainer.appendChild(card);
            });
        } else {
            el.linksSectionTitle.classList.add('hidden');
        }

        if (allItems.length === 0) {
            el.notesGrid.classList.remove('hidden');
            el.notesGrid.innerHTML = `<p class="empty-state">${searchTerm || activeFilters.tags.size > 0 || activeFilters.date ? 'No items match your search/filters.' : 'This folder is empty. Click the \'+\' button to add an item!'}</p>`;
        }
    }

    async function setActiveFolder(folderId) {
        // Clear filters when switching folder
        if (typeof clearAllFilters === 'function') clearAllFilters(true);
        
        activeFolderId = folderId;
        document.querySelectorAll('.folder-item').forEach(f => f.classList.remove('active'));
        
        if (folderId === 'all') {
            const allBtn = document.querySelector('.folder-item[data-id="all"]');
            if (allBtn) allBtn.classList.add('active');
            el.currentFolderTitle.textContent = 'All Items';
            el.folderBackBtn.classList.add('hidden');
        } else {
            const folder = await getFolder(folderId);
            if (folder) {
                el.currentFolderTitle.textContent = folder.name;
                const activeSidebarEl = document.querySelector(`.folder-item[data-id="${folderId}"]`);
                if (activeSidebarEl) activeSidebarEl.classList.add('active');
                
                // Show back button if it has a parent
                if (folder.parentId) {
                    el.folderBackBtn.classList.remove('hidden');
                } else {
                    el.folderBackBtn.classList.add('hidden');
                }
            }
        }
        
        renderSubfolders(folderId);
        renderItems(folderId, el.searchBox ? el.searchBox.value : '');
    }

    // --- Modal Helpers ---
    function openModal(modal) {
        const backdrop = document.getElementById('modal-backdrop');
        if (backdrop) backdrop.classList.remove('hidden');
        if (modal) modal.classList.remove('hidden');
    }

    function closeModal() {
        const backdrop = document.getElementById('modal-backdrop');
        if (backdrop) backdrop.classList.add('hidden');
        document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
        if (el.noteColorPicker) el.noteColorPicker.classList.add('hidden');
    }

    async function openViewModal(itemId) {
        const item = await getItem(itemId);
        if (!item) return;

        el.viewItemContent.classList.remove('hidden');
        el.editItemTextarea.classList.add('hidden');
        el.saveEditBtn.classList.add('hidden');
        el.editItemBtn.classList.remove('hidden');

        el.viewItemModal.dataset.itemId = item.id;
        el.viewItemModal.dataset.itemType = item.type;
        el.viewItemModal.dataset.currentItemFolderId = item.folderId === null || item.folderId === undefined ? 'null' : item.folderId;
        el.viewItemContent.innerHTML = '';

        let contentToCopy = '';

        switch (item.type) {
            case 'text':
                el.viewModalTitle.textContent = 'View Note';
                el.viewItemContent.innerHTML = item.content;
                if (editQuill) editQuill.root.innerHTML = item.content;
                el.editItemTextarea.classList.add('hidden');
                document.getElementById('edit-editor-wrapper').classList.add('hidden');
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = item.content;
                contentToCopy = tempDiv.textContent || tempDiv.innerText || '';
                break;
            case 'link':
                el.viewModalTitle.textContent = 'View Link';
                const title = item.title || item.content;
                const fullUrl = normalizeUrl(item.content);
                el.viewItemContent.innerHTML = `
                    <p class="notes-view-title-text">${escapeHTML(title)}</p>
                    <a href="${escapeHTML(fullUrl)}" data-url="${escapeHTML(fullUrl)}">${escapeHTML(item.content)}</a>
                `;
                el.editItemTextarea.value = item.content;
                document.getElementById('edit-editor-wrapper').classList.add('hidden');
                contentToCopy = item.content;
                break;
            case 'image':
                el.viewModalTitle.textContent = 'View Image';
                let viewImageUrl = '';
                if (item.fileBlob) viewImageUrl = URL.createObjectURL(item.fileBlob);
                else if (item.content) viewImageUrl = item.content;
                el.viewItemContent.innerHTML = `<img src="${viewImageUrl}" class="notes-view-image">`;
                el.editItemBtn.classList.add('hidden');
                contentToCopy = viewImageUrl;
                break;
        }

        el.viewItemModal.dataset.contentToCopy = contentToCopy;

        if (item.type === 'image') {
            el.copyItemBtn.classList.add('hidden');
        } else {
            el.copyItemBtn.classList.remove('hidden');
        }

        // Apply current color to modal
        el.viewItemModal.style.backgroundColor = (item.color && item.color !== 'default') ? item.color : '';
        document.querySelectorAll('.color-option').forEach(opt => {
            opt.classList.toggle('selected', (item.color || 'default') === opt.dataset.color);
        });
        if (el.customNoteColor && item.color && item.color !== 'default') {
            el.customNoteColor.value = item.color;
        }
        selectedNoteColor = item.color || 'default';

        // Render Tags
        currentItemTags = item.tags ? [...item.tags] : [];
        renderTagChips(currentItemTags, el.viewItemTagsContainer, false);
        el.editTagsInputWrapper.classList.add('hidden');

        // Hide tags section if empty in view mode
        if (currentItemTags.length === 0) {
            el.viewItemTagsSection.classList.add('hidden');
        } else {
            el.viewItemTagsSection.classList.remove('hidden');
        }


        openModal(el.viewItemModal);
    }

    function resetAddModal() {
        if (addQuill) addQuill.setContents([]);
        const linkUrl = document.getElementById('item-link-url-input');
        const linkTitle = document.getElementById('item-link-title-input');
        if (linkUrl) linkUrl.value = '';
        if (linkTitle) linkTitle.value = '';
        currentItemTags = [];
        renderTagChips(currentItemTags, el.selectedTagsContainer, true);
        switchTab('text');
    }

    // --- Tag Helpers ---
    async function refreshExistingTags() {
        const items = await AppDB.getAllItems();
        const tags = new Set();
        items.forEach(item => {
            if (item.tags && Array.isArray(item.tags)) {
                item.tags.forEach(t => tags.add(t));
            }
        });
        allExistingTags = tags;
        updateFilterTagsList();
    }

    function renderTagChips(tags, container, isEditable = false) {
        if (!container) return;
        container.innerHTML = '';
        tags.forEach(tag => {
            const chip = document.createElement('div');
            chip.className = 'tag-chip';
            chip.innerHTML = `
                <span>#${escapeHTML(tag)}</span>
                ${isEditable ? `<span class="remove-tag" data-tag="${escapeHTML(tag)}">&times;</span>` : ''}
            `;
            container.appendChild(chip);
        });
    }

    function handleTagInput(inputEl, containerEl, suggestionsEl, tagsArray) {
        const val = inputEl.value.trim().toLowerCase();
        
        // Show suggestions
        if (val.length > 0) {
            const suggestions = [...allExistingTags].filter(t => t.toLowerCase().includes(val) && !tagsArray.includes(t));
            if (suggestions.length > 0) {
                suggestionsEl.innerHTML = suggestions.map(t => `<div class="tag-suggestion-item">${escapeHTML(t)}</div>`).join('');
                suggestionsEl.classList.remove('hidden');
            } else {
                suggestionsEl.innerHTML = '';
                suggestionsEl.classList.add('hidden');
            }
        } else {
            suggestionsEl.innerHTML = '';
            suggestionsEl.classList.add('hidden');
        }
    }

    function addTag(tag, inputEl, containerEl, suggestionsEl, tagsArray) {
        if (tag && !tagsArray.includes(tag)) {
            tagsArray.push(tag);
            inputEl.value = '';
            suggestionsEl.classList.add('hidden');
            suggestionsEl.innerHTML = '';
            renderTagChips(tagsArray, containerEl, true);
        }
    }

    function updateFilterTagsList() {
        if (!el.filterTagsList) return;
        el.filterTagsList.innerHTML = '';
        [...allExistingTags].sort().forEach(tag => {
            const item = document.createElement('div');
            item.className = `filter-tag-item ${activeFilters.tags.has(tag) ? 'active' : ''}`;
            item.textContent = tag;
            item.onclick = () => {
                if (activeFilters.tags.has(tag)) activeFilters.tags.delete(tag);
                else activeFilters.tags.add(tag);
                item.classList.toggle('active');
                renderItems(activeFolderId, el.searchBox.value);
            };
            el.filterTagsList.appendChild(item);
        });
    }

    function switchTab(type) {
        currentItemType = type;
        document.querySelectorAll('#add-item-modal .tab-content').forEach(el => el.classList.add('hidden'));
        document.querySelectorAll('#add-item-modal .tab-btn').forEach(el => el.classList.remove('active'));
        document.getElementById(`${type}-input-container`).classList.remove('hidden');
        document.querySelector(`.tab-btn[data-type="${type}"]`).classList.add('active');

        if (type === 'upload') {
            el.saveItemBtn.classList.add('hidden');
        } else {
            el.saveItemBtn.classList.remove('hidden');
        }
    }

    function clearAllFilters(silent = false) {
        activeFilters.tags.clear();
        activeFilters.dateRange = { start: null, end: null };
        activeFilters.types = new Set(['text', 'link', 'image', 'file']);
        
        if (el.filterDateStart) el.filterDateStart.value = '';
        if (el.filterDateEnd) el.filterDateEnd.value = '';
        if (el.searchBox) {
            el.searchBox.value = '';
            if (el.searchClearBtn) el.searchClearBtn.classList.remove('visible');
        }
        document.querySelectorAll('.filter-tag-item').forEach(i => i.classList.remove('active'));
        document.querySelectorAll('.filter-type-options input').forEach(i => i.checked = true);
        
        if (!silent) renderItems(activeFolderId, el.searchBox ? el.searchBox.value : '');
    }




    // --- Export/Import ---
    async function exportData(exportFormat) {
        const folders = await new Promise(resolve => db.transaction('folders').objectStore('folders').getAll().onsuccess = e => resolve(e.target.result));
        const items = await new Promise(resolve => db.transaction('items').objectStore('items').getAll().onsuccess = e => resolve(e.target.result));

        if (exportFormat === 'json') {
            const blob = new Blob([JSON.stringify({ folders, items }, null, 2)], { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `dashboard_backup_${new Date().toISOString().slice(0, 10)}.json`;
            a.click();
            URL.revokeObjectURL(a.href);
        } else if (exportFormat === 'zip') {
            const zip = new JSZip();
            const manifestItems = [];
            const filesFolder = zip.folder("files");

            items.forEach(item => {
                const manifestItem = { ...item };
                if ((item.type === 'file' || item.type === 'image') && item.fileBlob) {
                    const ext = item.fileName ? item.fileName.split('.').pop() : (item.type === 'image' ? 'png' : 'bin');
                    const fileNameInZip = `file_${item.id}_${Date.now()}.${ext}`;
                    filesFolder.file(fileNameInZip, item.fileBlob);
                    delete manifestItem.fileBlob;
                    manifestItem._fileReference = fileNameInZip;
                }
                manifestItems.push(manifestItem);
            });

            zip.file("manifest.json", JSON.stringify({ folders, items: manifestItems }, null, 2));
            const blob = await zip.generateAsync({ type: "blob" });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `dashboard_backup_${new Date().toISOString().slice(0, 10)}.zip`;
            a.click();
            URL.revokeObjectURL(a.href);
        }
    }

    async function importData(event) {
        const file = event.target.files[0];
        if (!file) return;

        if (file.name.endsWith('.zip')) {
            try {
                const zip = await JSZip.loadAsync(file);
                const manifestFile = zip.file("manifest.json");
                if (!manifestFile) { alert("Invalid ZIP file: Missing manifest.json."); return; }

                const data = JSON.parse(await manifestFile.async("string"));
                if (!data.folders || !data.items) throw new Error("Invalid format in manifest.json");

                const itemsWithBlobs = await Promise.all(data.items.map(async (item) => {
                    if (item._fileReference) {
                        const zippedFile = zip.file(`files/${item._fileReference}`);
                        if (zippedFile) item.fileBlob = await zippedFile.async("blob");
                        delete item._fileReference;
                    }
                    return item;
                }));

                // Safe upsert import — no store.clear(), so interruption can't cause data loss
                await SyncService.importNotesData({ folders: data.folders, items: itemsWithBlobs });
                alert("ZIP Import successful!");
                sessionUnlockedFolders.clear();
                setActiveFolder('all');
                renderFolders();
            } catch (error) {
                console.error("ZIP Import error:", error);
                alert("ZIP Import failed. Please check the file.");
            }
        } else if (file.name.endsWith('.json')) {
            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    const data = JSON.parse(e.target.result);
                    if (!data.folders || !data.items) throw new Error("Invalid format");
                    // Safe upsert import — no store.clear(), so interruption can't cause data loss
                    await SyncService.importNotesData({ folders: data.folders, items: data.items });
                    alert("JSON Import successful!");
                    sessionUnlockedFolders.clear();
                    setActiveFolder('all');
                    renderFolders();
                } catch (error) { alert("JSON Import failed. Please check the file."); }
            };
            reader.readAsText(file);
        } else {
            alert("Unsupported file format.");
        }
    }

    // --- Bind All Event Listeners (called on each init) ---
    function bindEvents() {
        // Add folder
        el.addFolderBtn.addEventListener('click', async () => {
            const folderName = await AppUtils.showPromptDialog({ title: 'New Folder', placeholder: 'Folder name' });
            if (folderName) {
                // If in a folder, create as subfolder? Actually, sidebar button usually creates top-level.
                // But let's check if the user is in a folder and maybe ask?
                // For now, sidebar button creates top-level to keep it standard.
                addFolder(folderName, null);
            }
        });

        // Copy all tabs
        if (el.copyTabsBtn) {
            el.copyTabsBtn.addEventListener('click', () => {
                chrome.tabs.query({ currentWindow: true }, async (tabs) => {
                    if (!tabs || tabs.length === 0) return;

                    const now = new Date();
                    const folderName = `Saved Tabs - ${now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })}`;

                    // Create folder with UUID, timestamps and retrieve its new auto-incremented id
                    let savedCount = 0;
                    const newFolderId = await new Promise((resolve, reject) => {
                        const tx = db.transaction(['folders'], 'readwrite');
                        const fStore = tx.objectStore('folders');
                        const nowIso = new Date().toISOString();
                        const req = fStore.add({
                            name: folderName,
                            pin: null,
                            parentId: null,
                            order: 0,
                            uuid: crypto.randomUUID(),
                            createdAt: nowIso,
                            updatedAt: nowIso
                        });
                        req.onsuccess = () => resolve(req.result);
                        req.onerror = () => reject(req.error);
                    });

                    const validTabs = tabs.filter(tab => tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('edge://'));

                    for (const tab of validTabs) {
                        await new Promise((resolve, reject) => {
                            AppDB.addItem({
                                folderId: newFolderId,
                                type: 'link',
                                content: tab.url,
                                title: tab.title || tab.url,
                                createdAt: new Date().toISOString()
                            }, resolve);
                        });
                        savedCount++;
                    }

                    globalThis.SyncService?.triggerAutoSync();
                    renderFolders().then(() => setActiveFolder(newFolderId));
                    alert(`${savedCount} tabs have been successfully saved to "${folderName}".`);
                });
            });
        }

        // Sidebar Folder Drag and Drop
        let draggedFolderId = null;

        el.folderList.addEventListener('dragstart', (e) => {
            const item = e.target.closest('.folder-item');
            if (item && item.dataset.id !== 'all') {
                draggedFolderId = parseInt(item.dataset.id);
                item.classList.add('dragging');
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', draggedFolderId);
            }
        });

        el.folderList.addEventListener('dragend', (e) => {
            const item = e.target.closest('.folder-item');
            if (item) item.classList.remove('dragging');
            document.querySelectorAll('.folder-item').forEach(f => {
                f.classList.remove('drag-over', 'drag-over-bottom');
            });
            draggedFolderId = null;
        });

        el.folderList.addEventListener('dragover', (e) => {
            e.preventDefault();
            const target = e.target.closest('.folder-item');
            if (!target || target.dataset.id === 'all' || parseInt(target.dataset.id) === draggedFolderId) return;

            const rect = target.getBoundingClientRect();
            const midpoint = rect.top + rect.height / 2;
            
            document.querySelectorAll('.folder-item').forEach(f => f.classList.remove('drag-over', 'drag-over-bottom'));
            
            if (e.clientY < midpoint) {
                target.classList.add('drag-over');
            } else {
                target.classList.add('drag-over-bottom');
            }
            
            e.dataTransfer.dropEffect = 'move';
        });

        el.folderList.addEventListener('drop', async (e) => {
            e.preventDefault();
            const target = e.target.closest('.folder-item');
            if (!target || target.dataset.id === 'all') return;

            const droppedId = parseInt(e.dataTransfer.getData('text/plain'));
            if (!droppedId || droppedId === parseInt(target.dataset.id)) return;

            const targetId = parseInt(target.dataset.id);
            const rect = target.getBoundingClientRect();
            const midpoint = rect.top + rect.height / 2;
            const insertAfter = e.clientY >= midpoint;

            const allFolders = await AppDB.getAllFolders();
            const topLevelFolders = allFolders.filter(f => !f.parentId);
            
            const draggedFolder = topLevelFolders.find(f => f.id === droppedId);
            if (!draggedFolder) return;

            const otherFolders = topLevelFolders.filter(f => f.id !== droppedId);
            
            let targetIdx = otherFolders.findIndex(f => f.id === targetId);
            if (insertAfter) targetIdx++;

            otherFolders.splice(targetIdx, 0, draggedFolder);
            
            const orderMap = {};
            otherFolders.forEach((f, index) => {
                orderMap[f.id] = index;
            });

            try {
                await AppDB.updateFolderOrders(orderMap);
                await renderFolders(); // Re-render to show new order
            } catch (err) {
                console.error("Failed to reorder folders:", err);
            }
        });

        // Folder list clicks
        el.folderList.addEventListener('click', async e => {
            const folderItem = e.target.closest('.folder-item');
            if (!folderItem) return;

            const folderIdStr = folderItem.dataset.id;
            if (folderIdStr === 'all') { setActiveFolder('all'); return; }

            const folderId = parseInt(folderIdStr);
            const folder = await getFolder(folderId);

            if (e.target.closest('.edit-folder')) {
                const newName = await AppUtils.showPromptDialog({ title: 'Rename Folder', placeholder: 'Folder name', defaultValue: folder.name });
                if (newName && newName !== folder.name) updateFolder(folderId, { name: newName });
            } else if (e.target.closest('.delete-folder')) {
                const confirmed = await AppUtils.showConfirmDialog({ title: 'Delete Folder?', body: `Are you sure you want to delete <strong>${escapeHTML(folder.name)}</strong> and all its items? This cannot be undone.`, confirmLabel: 'Delete' });
                if (confirmed) {
                    await AppDB.deleteFolder(folderId, () => {
                        sessionUnlockedFolders.delete(folderId);
                        renderFolders(); // Always refresh sidebar
                        if (activeFolderId === folderId) setActiveFolder('all');
                        else renderSubfolders(activeFolderId);
                    });
                }
            } else if (e.target.closest('.manage-pin-btn')) {
                if (folder.pin) {
                    pendingFolderAction = { id: folderId, type: 'manage-pin' };
                    el.enterPinFolderName.textContent = `Enter PIN for "${escapeHTML(folder.name)}" to manage it.`;
                    el.enterPinInput.value = '';
                    el.pinErrorMsg.classList.add('hidden');
                    openModal(el.enterPinModal);
                    el.enterPinInput.focus();
                } else {
                    pendingFolderAction = { id: folderId, type: 'set-pin' };
                    el.setPinInput.value = '';
                    openModal(el.setPinModal);
                }
            } else {
                if (!folder.pin || sessionUnlockedFolders.has(folderId)) {
                    setActiveFolder(folderId);
                } else {
                    pendingFolderAction = { id: folderId, type: 'unlock' };
                    el.enterPinFolderName.textContent = `Enter PIN for "${escapeHTML(folder.name)}"`;
                    el.enterPinInput.value = '';
                    el.pinErrorMsg.classList.add('hidden');
                    openModal(el.enterPinModal);
                    el.enterPinInput.focus();
                }
            }
        });

        // Subfolder grid clicks
        el.subfoldersGrid.addEventListener('click', async e => {
            const card = e.target.closest('.folder-card');
            if (!card || card.classList.contains('create-folder-card')) return;

            const folderId = parseInt(card.dataset.id);
            const folder = await getFolder(folderId);

            if (e.target.closest('.edit-folder-card')) {
                e.stopPropagation();
                const newName = await AppUtils.showPromptDialog({ title: 'Rename Folder', placeholder: 'Folder name', defaultValue: folder.name });
                if (newName && newName !== folder.name) {
                    updateFolder(folderId, { name: newName });
                    renderSubfolders(activeFolderId);
                }
                return;
            }

            if (e.target.closest('.manage-pin-card')) {
                e.stopPropagation();
                if (folder.pin) {
                    pendingFolderAction = { id: folderId, type: 'manage-pin' };
                    el.enterPinFolderName.textContent = `Enter PIN for "${escapeHTML(folder.name)}" to manage it.`;
                    el.enterPinInput.value = '';
                    el.pinErrorMsg.classList.add('hidden');
                    openModal(el.enterPinModal);
                    el.enterPinInput.focus();
                } else {
                    pendingFolderAction = { id: folderId, type: 'set-pin' };
                    el.setPinInput.value = '';
                    openModal(el.setPinModal);
                }
                return;
            }

            if (e.target.closest('.delete-folder-card')) {
                e.stopPropagation();
                const confirmed = await AppUtils.showConfirmDialog({ title: 'Delete Folder?', body: `Are you sure you want to delete <strong>${escapeHTML(folder.name)}</strong> and all its contents?`, confirmLabel: 'Delete' });
                if (confirmed) {
                    await AppDB.deleteFolder(folderId, () => {
                        sessionUnlockedFolders.delete(folderId);
                        renderFolders(); // Always refresh sidebar
                        if (activeFolderId === folderId) setActiveFolder('all');
                        else renderSubfolders(activeFolderId);
                    });
                }
                return;
            }

            if (!folder.pin || sessionUnlockedFolders.has(folderId)) {
                setActiveFolder(folderId);
            } else {
                pendingFolderAction = { id: folderId, type: 'unlock' };
                el.enterPinFolderName.textContent = `Enter PIN for "${escapeHTML(folder.name)}"`;
                el.enterPinInput.value = '';
                el.pinErrorMsg.classList.add('hidden');
                openModal(el.enterPinModal);
                el.enterPinInput.focus();
            }
        });

        // Back button
        el.folderBackBtn.addEventListener('click', async () => {
            if (activeFolderId === 'all') return;
            const folder = await getFolder(activeFolderId);
            if (folder && folder.parentId) {
                setActiveFolder(folder.parentId);
            } else {
                setActiveFolder('all');
            }
        });

        // Add subfolder button
        el.addSubfolderBtn.addEventListener('click', async () => {
            const folderName = await AppUtils.showPromptDialog({ title: 'New Subfolder', placeholder: 'Folder name' });
            if (folderName) {
                AppDB.addFolder(folderName, activeFolderId, () => {
                    renderFolders();
                    renderSubfolders(activeFolderId);
                });
            }
        });

        // Grid click handler
        el.gridScrollContainer.addEventListener('click', async e => {
            const card = e.target.closest('.item-card');
            if (!card) return;
            const itemId = parseInt(card.dataset.id);

            if (e.target.closest('.delete-item-btn')) {
                const confirmed = await AppUtils.showConfirmDialog({ title: 'Delete Item?', body: 'Are you sure you want to delete this item? This cannot be undone.', confirmLabel: 'Delete' });
                if (confirmed) deleteItem(itemId);
                return;
            }
            if (e.target.closest('.copy-item-btn')) {
                const item = await getItem(itemId);
                if (item) {
                    let contentToCopy = '';
                    if (item.type === 'text') {
                        const tempDiv = document.createElement('div');
                        tempDiv.innerHTML = item.content;
                        contentToCopy = tempDiv.textContent || tempDiv.innerText || '';
                    } else if (item.type === 'link' || item.type === 'image') {
                        contentToCopy = item.content;
                    } else if (item.type === 'file') {
                        contentToCopy = item.fileName;
                    }

                    if (contentToCopy) {
                        navigator.clipboard.writeText(contentToCopy).then(() => {
                            const btn = e.target.closest('.copy-item-btn');
                            const originalIcon = btn.innerHTML;
                            btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
                            setTimeout(() => { btn.innerHTML = originalIcon; }, 1500);
                        });
                    }
                }
                return;
            }
            if (e.target.closest('.open-link-btn')) {
                const item = await getItem(itemId);
                if (item && item.type === 'link') chrome.tabs.create({ url: normalizeUrl(item.content) });
                return;
            }
            try {
                const item = await getItem(itemId);
                if (!item) return;
                if (item.type === 'file' && item.fileBlob) {
                    chrome.tabs.create({ url: URL.createObjectURL(item.fileBlob) });
                } else {
                    openViewModal(itemId);
                }
            } catch (error) { console.error("Failed to process item click:", error); }
        });

        // FAB
        el.addItemFab.addEventListener('click', () => { resetAddModal(); openModal(el.addItemModal); });

        // Modal backdrop
        document.getElementById('modal-backdrop').addEventListener('click', closeModal);
        el.cancelAddItemBtn.addEventListener('click', closeModal);
        el.closeViewModalBtn.addEventListener('click', closeModal);

        // View modal link clicks
        el.viewItemModal.addEventListener('click', e => {
            if (e.target.tagName === 'A' && e.target.dataset.url) {
                e.preventDefault();
                chrome.tabs.create({ url: e.target.dataset.url });
            }
        });

        // Edit button
        el.editItemBtn.addEventListener('click', () => {
            const itemType = el.viewItemModal.dataset.itemType;
            el.viewItemContent.classList.add('hidden');
            if (itemType === 'text') {
                document.getElementById('edit-editor-wrapper').classList.remove('hidden');
                if (editQuill) editQuill.focus();
            } else {
                el.editItemTextarea.classList.remove('hidden');
                el.editItemTextarea.focus();
            }
            el.editItemBtn.classList.add('hidden');
            el.saveEditBtn.classList.remove('hidden');
            el.noteColorPicker.classList.remove('hidden');
            
            // Tags edit
            if (el.editTagsInputWrapper) el.editTagsInputWrapper.classList.remove('hidden');
            if (el.viewItemTagsSection) el.viewItemTagsSection.classList.remove('hidden');
            renderTagChips(currentItemTags, el.viewItemTagsContainer, true);
        });

        // Color picker options
        document.querySelectorAll('.color-option').forEach(opt => {
            opt.addEventListener('click', () => {
                document.querySelectorAll('.color-option').forEach(o => o.classList.remove('selected'));
                opt.classList.add('selected');
                selectedNoteColor = opt.dataset.color;
                el.viewItemModal.style.backgroundColor = (selectedNoteColor !== 'default') ? selectedNoteColor : '';
                if (el.customNoteColor && selectedNoteColor !== 'default') {
                    el.customNoteColor.value = selectedNoteColor;
                }
            });
        });

        // Custom color picker (Edit Modal)
        if (el.customNoteColor) {
            el.customNoteColor.addEventListener('input', (e) => {
                const color = e.target.value;
                selectedNoteColor = color;
                el.viewItemModal.style.backgroundColor = color;
            });
        }

        // Custom color picker (Add Modal)
        if (el.addCustomNoteColor) {
            el.addCustomNoteColor.addEventListener('input', (e) => {
                const color = e.target.value;
                selectedNoteColor = color;
                el.addItemModal.style.backgroundColor = color;
            });
        }

        // Save edit
        el.saveEditBtn.addEventListener('click', () => {
            const itemId = parseInt(el.viewItemModal.dataset.itemId);
            const itemType = el.viewItemModal.dataset.itemType;
            let newContent = '';
            if (itemType === 'text') newContent = editQuill.root.innerHTML;
            else if (itemType === 'link') newContent = normalizeUrl(el.editItemTextarea.value.trim());
            else newContent = el.editItemTextarea.value.trim();
            if (itemId && newContent) { 
                updateItem(itemId, { 
                    content: newContent,
                    color: selectedNoteColor,
                    tags: currentItemTags
                }); 
                closeModal(); 
            }
        });

        // Delete from view
        el.deleteViewModalBtn.addEventListener('click', async () => {
            const itemId = parseInt(el.viewItemModal.dataset.itemId);
            if (!itemId) return;
            const confirmed = await AppUtils.showConfirmDialog({ title: 'Delete Item?', body: 'Are you sure you want to delete this item? This cannot be undone.', confirmLabel: 'Delete' });
            if (confirmed) { deleteItem(itemId); closeModal(); }
        });

        // Tab buttons
        document.querySelector('#add-item-modal .tab-buttons').addEventListener('click', e => {
            if (e.target.classList.contains('tab-btn')) switchTab(e.target.dataset.type);
        });

        // Save new item
        el.saveItemBtn.addEventListener('click', async () => {
            const folderId = activeFolderId === 'all' ? null : activeFolderId;
            let newItem;
            if (currentItemType === 'upload') return;
            if (currentItemType === 'text') {
                const content = addQuill.root.innerHTML;
                if (!addQuill.getText().trim()) return alert("Note cannot be empty.");
                newItem = { folderId, type: 'text', content, createdAt: new Date(), tags: currentItemTags, color: selectedNoteColor };
            } else if (currentItemType === 'link') {
                const url = normalizeUrl(document.getElementById('item-link-url-input').value.trim());
                const title = document.getElementById('item-link-title-input').value.trim();
                if (!url) return alert("URL cannot be empty.");
                newItem = { folderId, type: 'link', content: url, title, createdAt: new Date(), tags: currentItemTags, color: selectedNoteColor };
            }
            if (newItem) { addItem(newItem); closeModal(); }
        });

        // Search
        el.searchBox.addEventListener('input', () => {
            const hasText = el.searchBox.value.length > 0;
            if (el.searchClearBtn) el.searchClearBtn.classList.toggle('visible', hasText);
            renderItems(activeFolderId, el.searchBox.value);
        });

        if (el.searchClearBtn) {
            el.searchClearBtn.addEventListener('click', () => {
                el.searchBox.value = '';
                el.searchClearBtn.classList.remove('visible');
                el.searchBox.focus();
                renderItems(activeFolderId, '');
            });
        }



        // (openWindowBtn handler moved to core/router.js)

        // Copy
        el.copyItemBtn.addEventListener('click', () => {
            const content = el.viewItemModal.dataset.contentToCopy;
            if (content) {
                navigator.clipboard.writeText(content).then(() => {
                    const originalIcon = el.copyItemBtn.innerHTML;
                    el.copyItemBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
                    setTimeout(() => { el.copyItemBtn.innerHTML = originalIcon; }, 1500);
                }).catch(err => console.error('Failed to copy text: ', err));
            }
        });

        // IO Dropdowns
        AppUtils.setupIODropdowns({
            importBtn: document.getElementById('import-btn'),
            exportBtn: document.getElementById('export-btn'),
            importDropdown: document.getElementById('import-dropdown'),
            exportDropdown: document.getElementById('export-dropdown')
        });

        // IO action buttons
        document.querySelectorAll('#import-dropdown .io-dropdown-item, #export-dropdown .io-dropdown-item').forEach(item => {
            item.addEventListener('click', async (e) => {
                e.stopPropagation();
                const action = item.dataset.action;
                if (action === 'export-json') await exportData('json');
                else if (action === 'export-zip') await exportData('zip');
                else if (action === 'import-json') { el.importFileInput.accept = '.json'; el.importFileInput.click(); }
                else if (action === 'import-zip') { el.importFileInput.accept = '.zip'; el.importFileInput.click(); }
            });
        });

        el.importFileInput.addEventListener('change', importData);

        // File upload
        el.uploadFilesBtn.addEventListener('click', () => el.uploadFileInput.click());
        el.uploadFileInput.addEventListener('change', e => {
            const files = e.target.files;
            if (files.length > 0) {
                const folderId = activeFolderId === 'all' ? null : activeFolderId;
                for (const file of files) handleFileUpload(file, folderId);
                closeModal();
            }
            e.target.value = '';
        });

        // Drag and drop
        let dragCounter = 0;
        el.mainContent.addEventListener('dragenter', e => { e.preventDefault(); dragCounter++; el.dropOverlay.style.display = 'flex'; });
        el.mainContent.addEventListener('dragleave', e => { e.preventDefault(); dragCounter--; if (dragCounter === 0) el.dropOverlay.style.display = 'none'; });
        el.mainContent.addEventListener('dragover', e => e.preventDefault());
        el.mainContent.addEventListener('drop', e => {
            e.preventDefault(); dragCounter = 0; el.dropOverlay.style.display = 'none';
            const file = e.dataTransfer.files[0];
            if (file) handleFileUpload(file, activeFolderId === 'all' ? null : activeFolderId);
        });

        // Paste
        el.mainContent.addEventListener('paste', e => {
            e.preventDefault();
            const items = e.clipboardData.items;
            const folderId = activeFolderId === 'all' ? null : activeFolderId;
            for (let i = 0; i < items.length; i++) {
                if (items[i].kind === 'file') {
                    const file = items[i].getAsFile();
                    if (file) { handleFileUpload(file, folderId); break; }
                } else if (items[i].kind === 'string' && items[i].type.startsWith('text/plain')) {
                    items[i].getAsString(text => {
                        const content = text.trim();
                        if (!content) return;
                        addItem({ folderId, type: 'text', content: `<p>${escapeHTML(content)}</p>`, createdAt: new Date() });
                    });
                    break;
                }
            }
        });

        // Move modal
        el.moveItemBtn.addEventListener('click', async () => {
            const itemId = parseInt(el.viewItemModal.dataset.itemId);
            const currentItemFolderId = el.viewItemModal.dataset.currentItemFolderId;
            const allFolders = await new Promise(resolve =>
                db.transaction('folders').objectStore('folders').getAll().onsuccess = e => resolve(e.target.result)
            );
            el.moveFolderSelect.innerHTML = `<option value="null">All Items (no folder)</option>`;
            allFolders.forEach(folder => {
                el.moveFolderSelect.innerHTML += `<option value="${folder.id}">${escapeHTML(folder.name)}</option>`;
            });
            el.moveFolderSelect.value = currentItemFolderId;
            el.moveItemModal.dataset.itemId = itemId;
            openModal(el.moveItemModal);
        });

        el.cancelMoveItemBtn.addEventListener('click', closeModal);
        el.confirmMoveItemBtn.addEventListener('click', () => {
            const itemId = parseInt(el.moveItemModal.dataset.itemId);
            const newFolderId = el.moveFolderSelect.value === 'null' ? null : parseInt(el.moveFolderSelect.value);
            if (itemId !== undefined) { updateItem(itemId, { folderId: newFolderId }); closeModal(); }
        });

        // PIN modals
        el.cancelSetPinBtn.addEventListener('click', closeModal);
        el.cancelEnterPinBtn.addEventListener('click', closeModal);
        el.saveSetPinBtn.addEventListener('click', () => {
            const pin = el.setPinInput.value;
            if (pin && /^[0-9]+$/.test(pin)) {
                updateFolder(pendingFolderAction.id, { pin });
                sessionUnlockedFolders.add(pendingFolderAction.id);
                closeModal();
            } else { alert('Please enter a valid numeric PIN.'); }
        });

        const handleUnlock = async () => {
            const folderId = pendingFolderAction.id;
            const enteredPin = el.enterPinInput.value;
            const folder = await getFolder(folderId);
            if (folder && folder.pin === enteredPin) {
                sessionUnlockedFolders.add(folderId);
                closeModal();
                if (pendingFolderAction.type === 'unlock') setActiveFolder(folderId);
                else if (pendingFolderAction.type === 'manage-pin') {
                    const removeConfirmed = await AppUtils.showConfirmDialog({ title: 'Remove PIN?', body: `PIN verified. Do you want to remove the PIN for <strong>${escapeHTML(folder.name)}</strong>?`, confirmLabel: 'Remove', confirmClass: 'pm-confirm-btn--primary', icon: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 9.9-1"></path></svg>' });
                    if (removeConfirmed) {
                        updateFolder(folderId, { pin: null });
                        sessionUnlockedFolders.delete(folderId);
                    }
                }
            } else {
                el.pinErrorMsg.classList.remove('hidden');
                el.enterPinInput.focus();
            }
        };

        el.unlockFolderBtn.addEventListener('click', handleUnlock);
        el.enterPinInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); handleUnlock(); } });

        // Open in tab
        const openInTabBtn = document.getElementById('open-in-tab-btn');
        if (openInTabBtn) {
            openInTabBtn.addEventListener('click', () => {
                const itemId = el.viewItemModal.dataset.itemId;
                chrome.windows.create({
                    url: chrome.runtime.getURL(`popup.html?noteId=${itemId}`),
                    type: 'popup', width: 800, height: 800
                });
            });
        }

        // Open All Links in Folder
        if (el.openAllLinksBtn) {
            el.openAllLinksBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const isOpen = el.openAllLinksDropdown.classList.contains('open');
                el.openAllLinksDropdown.classList.toggle('open', !isOpen);
                el.openAllLinksBtn.classList.toggle('active', !isOpen);
            });

            document.addEventListener('click', (e) => {
                if (el.openAllLinksDropdown && !el.openAllLinksBtn.contains(e.target)) {
                    el.openAllLinksDropdown.classList.remove('open');
                    el.openAllLinksBtn.classList.remove('active');
                }
            });

            el.openAllLinksDropdown.addEventListener('click', async (e) => {
                const item = e.target.closest('.io-dropdown-item');
                if (!item) return;
                const action = item.dataset.action;

                const folderId = activeFolderId === 'all' ? null : activeFolderId;
                const itemsStore = db.transaction(['items']).objectStore('items');
                let items;
                if (folderId === null) {
                    items = await new Promise(resolve => itemsStore.getAll().onsuccess = ev => resolve(ev.target.result));
                } else {
                    items = await new Promise(resolve => itemsStore.index('folderId').getAll(folderId).onsuccess = ev => resolve(ev.target.result));
                }

                const links = items.filter(i => i.type === 'link');
                if (links.length === 0) return alert("No links found in this folder.");

                if (action === 'open-this-window') {
                    links.forEach(link => chrome.tabs.create({ url: normalizeUrl(link.content) }));
                } else if (action === 'open-new-window') {
                    chrome.windows.create({ url: normalizeUrl(links[0].content) }, (win) => {
                        for (let i = 1; i < links.length; i++) {
                            chrome.tabs.create({ windowId: win.id, url: normalizeUrl(links[i].content) });
                        }
                    });
                }
            });
        }
        // Tag Inputs
        if (el.itemTagsInput) {
            el.itemTagsInput.addEventListener('input', () => {
                handleTagInput(el.itemTagsInput, el.selectedTagsContainer, el.tagSuggestions, currentItemTags);
            });
            el.itemTagsInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ',') {
                    e.preventDefault();
                    const tag = el.itemTagsInput.value.trim().replace(/,/g, '');
                    addTag(tag, el.itemTagsInput, el.selectedTagsContainer, el.tagSuggestions, currentItemTags);
                }
            });
        }

        if (el.tagSuggestions) {
            el.tagSuggestions.addEventListener('click', (e) => {
                const item = e.target.closest('.tag-suggestion-item');
                if (item) {
                    addTag(item.textContent, el.itemTagsInput, el.selectedTagsContainer, el.tagSuggestions, currentItemTags);
                    el.itemTagsInput.focus();
                }
            });
        }

        // Dropdown icon clicks
        document.querySelectorAll('.tag-input-icon').forEach(icon => {
            icon.style.cursor = 'pointer';
            icon.style.pointerEvents = 'auto'; // Re-enable pointer events since I set it to none in CSS
            icon.addEventListener('click', (e) => {
                const wrapper = icon.closest('.tag-input-wrapper');
                const input = wrapper.querySelector('input');
                const suggestions = wrapper.querySelector('.tag-suggestions');
                const container = icon.closest('.tag-input-section, .item-tags-display-section').nextElementSibling;
                
                // Toggle with empty search or space
                if (suggestions.classList.contains('hidden')) {
                    input.focus();
                    // Just show all available tags that aren't already added
                    const availableTags = [...allExistingTags].filter(t => !currentItemTags.includes(t));
                    if (availableTags.length > 0) {
                        suggestions.innerHTML = availableTags.map(t => `<div class="tag-suggestion-item">${escapeHTML(t)}</div>`).join('');
                        suggestions.classList.remove('hidden');
                    }
                } else {
                    suggestions.classList.add('hidden');
                    suggestions.innerHTML = '';
                }
            });
        });

        if (el.editItemTagsInput) {
            el.editItemTagsInput.addEventListener('input', () => {
                handleTagInput(el.editItemTagsInput, el.viewItemTagsContainer, el.editTagSuggestions, currentItemTags);
            });
            el.editItemTagsInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ',') {
                    e.preventDefault();
                    const tag = el.editItemTagsInput.value.trim().replace(/,/g, '');
                    addTag(tag, el.editItemTagsInput, el.viewItemTagsContainer, el.editTagSuggestions, currentItemTags);
                }
            });
        }

        if (el.editTagSuggestions) {
            el.editTagSuggestions.addEventListener('click', (e) => {
                const item = e.target.closest('.tag-suggestion-item');
                if (item) {
                    addTag(item.textContent, el.editItemTagsInput, el.viewItemTagsContainer, el.editTagSuggestions, currentItemTags);
                    el.editItemTagsInput.focus();
                }
            });
        }

        // Remove tags
        document.addEventListener('click', e => {
            if (e.target.classList.contains('remove-tag')) {
                const tagToRemove = e.target.dataset.tag;
                currentItemTags = currentItemTags.filter(t => t !== tagToRemove);
                const container = e.target.closest('.selected-tags-container');
                renderTagChips(currentItemTags, container, true);
            }
        });

        // Filter Dropdown
        if (el.filterBtn) {
            el.filterBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                el.filterDropdown.classList.toggle('hidden');
                if (!el.filterDropdown.classList.contains('hidden')) {
                    updateFilterTagsList();
                }
            });
        }

        // Close filter dropdown on outside click
        document.addEventListener('click', (e) => {
            if (el.filterDropdown && !el.filterDropdown.classList.contains('hidden') && !el.filterWrapper.contains(e.target)) {
                el.filterDropdown.classList.add('hidden');
            }
            if (el.tagSuggestions && !el.tagSuggestions.classList.contains('hidden') && !e.target.closest('.tag-input-wrapper')) {
                el.tagSuggestions.classList.add('hidden');
            }
            if (el.editTagSuggestions && !el.editTagSuggestions.classList.contains('hidden') && !e.target.closest('.tag-input-wrapper')) {
                el.editTagSuggestions.classList.add('hidden');
            }
        });

        // Filter Date Range
        if (el.filterDateStart) {
            el.filterDateStart.addEventListener('change', () => {
                activeFilters.dateRange.start = el.filterDateStart.value;
                renderItems(activeFolderId, el.searchBox ? el.searchBox.value : '');
            });
        }
        if (el.filterDateEnd) {
            el.filterDateEnd.addEventListener('change', () => {
                activeFilters.dateRange.end = el.filterDateEnd.value;
                renderItems(activeFolderId, el.searchBox ? el.searchBox.value : '');
            });
        }

        // Filter Types
        document.querySelectorAll('.filter-type-options input').forEach(input => {
            input.addEventListener('change', () => {
                const type = input.dataset.type;
                if (input.checked) activeFilters.types.add(type);
                else activeFilters.types.delete(type);
                renderItems(activeFolderId, el.searchBox.value);
            });
        });

        // Clear Filters
        if (el.clearFiltersBtn) {
            el.clearFiltersBtn.addEventListener('click', clearAllFilters);
        }
    }

    // --- Public init() — called by router when Notes tab becomes active ---
    async function init() {
        // Grab all DOM elements now that HTML fragment is loaded
        el = {
            folderList: document.getElementById('folder-list'),
            addFolderBtn: document.getElementById('add-folder-btn'),
            copyTabsBtn: document.getElementById('copy-tabs-btn'),
            notesGrid: document.getElementById('notes-grid'),
            linksContainer: document.getElementById('links-container'),
            linksSectionTitle: document.getElementById('links-header'),
            gridScrollContainer: document.getElementById('grid-scroll-container'),
            currentFolderTitle: document.getElementById('current-folder-title'),
            addItemFab: document.getElementById('add-item-fab'),
            addItemModal: document.getElementById('add-item-modal'),
            cancelAddItemBtn: document.getElementById('cancel-add-item'),
            saveItemBtn: document.getElementById('save-item-btn'),
            searchBox: document.getElementById('search-box'),
            searchClearBtn: document.getElementById('search-clear'),
            openAllLinksBtn: document.getElementById('open-all-links-btn'),
            openAllLinksDropdown: document.getElementById('open-all-links-dropdown'),

            mainContent: document.getElementById('main-content'),
            importFileInput: document.getElementById('import-file-input'),
            viewItemModal: document.getElementById('view-item-modal'),
            viewModalTitle: document.getElementById('view-modal-title'),
            viewItemContent: document.getElementById('view-item-content'),
            editItemTextarea: document.getElementById('edit-item-textarea'),
            closeViewModalBtn: document.getElementById('close-view-modal'),
            deleteViewModalBtn: document.getElementById('Delete-view-modal'),
            editItemBtn: document.getElementById('edit-item-btn'),
            saveEditBtn: document.getElementById('save-edit-btn'),
            dropOverlay: document.getElementById('drop-overlay'),
            copyItemBtn: document.getElementById('copy-item-btn'),
            uploadFileInput: document.getElementById('upload-file-input'),
            uploadFilesBtn: document.getElementById('upload-files-btn'),
            setPinModal: document.getElementById('set-pin-modal'),
            enterPinModal: document.getElementById('enter-pin-modal'),
            setPinInput: document.getElementById('set-pin-input'),
            enterPinInput: document.getElementById('enter-pin-input'),
            saveSetPinBtn: document.getElementById('save-set-pin'),
            cancelSetPinBtn: document.getElementById('cancel-set-pin'),
            unlockFolderBtn: document.getElementById('unlock-folder-btn'),
            cancelEnterPinBtn: document.getElementById('cancel-enter-pin'),
            pinErrorMsg: document.getElementById('pin-error-msg'),
            enterPinFolderName: document.getElementById('enter-pin-foldername'),
            moveItemBtn: document.getElementById('move-item-btn'),
            moveItemModal: document.getElementById('move-item-modal'),
            cancelMoveItemBtn: document.getElementById('cancel-move-item'),
            confirmMoveItemBtn: document.getElementById('confirm-move-item-btn'),
            moveFolderSelect: document.getElementById('move-folder-select'),
            subfoldersSection: document.getElementById('subfolders-section'),
            subfoldersGrid: document.getElementById('subfolders-grid'),
            folderBackBtn: document.getElementById('folder-back-btn'),
            addSubfolderBtn: document.getElementById('add-subfolder-btn'),
            noteColorPicker: document.getElementById('note-color-picker'),
            customNoteColor: document.getElementById('custom-note-color'),
            addCustomNoteColor: document.getElementById('add-custom-note-color'),
            
            // Tags and Filters
            itemTagsInput: document.getElementById('item-tags-input'),
            tagSuggestions: document.getElementById('tag-suggestions'),
            selectedTagsContainer: document.getElementById('selected-tags-container'),
            viewItemTagsContainer: document.getElementById('view-item-tags-container'),
            viewItemTagsSection: document.getElementById('view-item-tags-section'),
            editItemTagsInput: document.getElementById('edit-item-tags-input'),

            editTagSuggestions: document.getElementById('edit-tag-suggestions'),
            editTagsInputWrapper: document.getElementById('edit-tags-input-wrapper'),
            filterBtn: document.getElementById('filter-btn'),
            filterDropdown: document.getElementById('filter-dropdown'),
            filterWrapper: document.querySelector('.filter-wrapper'),
            filterTagsList: document.getElementById('filter-tags-list'),
            filterDateStart: document.getElementById('filter-date-start'),
            filterDateEnd: document.getElementById('filter-date-end'),
            clearFiltersBtn: document.getElementById('clear-filters-btn'),
        };

        // Quill editors
        const toolbarOptions = [
            [{ 'header': [1, 2, 3, false] }],
            [{ 'font': [] }],
            [{ 'size': ['small', false, 'large', 'huge'] }],
            ['bold', 'italic', 'underline', 'strike'],
            [{ 'color': [] }, { 'background': [] }],
            [{ 'list': 'ordered' }, { 'list': 'bullet' }],
            [{ 'align': [] }],
            ['clean']
        ];

        addQuill = new Quill('#item-text-editor-container', {
            theme: 'snow', placeholder: 'Start typing here...',
            modules: { toolbar: toolbarOptions }
        });
        editQuill = new Quill('#edit-item-editor-container', {
            theme: 'snow',
            modules: { toolbar: toolbarOptions }
        });



        // Init DB
        db = await AppDB.initDB();

        // Ensure filters are reset when tab is re-shown
        activeFilters.tags.clear();
        activeFilters.dateRange = { start: null, end: null };
        activeFilters.types = new Set(['text', 'link', 'image', 'file']);

        // Bind events
        bindEvents();

        // Show Secure Vault banner if vault is not secured
        const notesBanner = document.getElementById('notes-secure-vault-banner');
        if (notesBanner && window.vaultService) {
            window.vaultService.isSecured().then(secured => {
                notesBanner.classList.toggle('hidden', !!secured);
            });
        }
        const notesSecureBtn = document.getElementById('notes-secure-vault-btn');
        if (notesSecureBtn) {
            notesSecureBtn.addEventListener('click', () => {
                if (globalThis.SyncService) {
                    SyncService.signIn();
                } else if (globalThis.AppRouter) {
                    globalThis.AppRouter.switchTo('settings');
                }
            });
        }

        // Load content
        await refreshExistingTags();
        await renderFolders();
        setActiveFolder('all');

        initialized = true;
    }

    /**
     * Open a specific note (used by router for ?noteId= URL param)
     */
    function openNote(noteId) {
        openViewModal(noteId);
    }

    return {
        init,
        openNote
    };

})();

window.NotesApp = NotesApp;
