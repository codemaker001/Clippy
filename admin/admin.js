/**
 * admin/admin.js — Admin Dashboard Logic
 * 
 * Functions:
 * - Verify admin access via email whitelist
 * - Fetch all users from Supabase profiles table
 * - Render table with search, filter, sort
 * - Toggle premium status per user
 * - Export CSV
 */

(function () {

    let allUsers = [];

    // ========================================================================
    // INITIALIZATION
    // ========================================================================

    document.addEventListener('DOMContentLoaded', async () => {
        try {
            // Check admin access
            const signedIn = await SyncService.isSignedIn();
            if (!signedIn) {
                showDenied();
                return;
            }

            const isAdminUser = await SyncService.isAdmin();
            if (!isAdminUser) {
                showDenied();
                return;
            }

            // Authenticated admin — load dashboard
            await loadUsers();
            showDashboard();

            // Bind events
            bindEvents();

        } catch (err) {
            console.error('Admin init error:', err);
            showDenied();
        }
    });

    function showDenied() {
        document.getElementById('admin-loading').classList.add('hidden');
        document.getElementById('admin-denied').classList.remove('hidden');
        document.getElementById('admin-dashboard').classList.add('hidden');

        const closeBtn = document.getElementById('admin-denied-close');
        if (closeBtn) closeBtn.addEventListener('click', () => window.close());
    }

    function showDashboard() {
        document.getElementById('admin-loading').classList.add('hidden');
        document.getElementById('admin-denied').classList.add('hidden');
        document.getElementById('admin-dashboard').classList.remove('hidden');
    }

    // ========================================================================
    // DATA LOADING
    // ========================================================================

    async function loadUsers() {
        try {
            allUsers = await SyncService.fetchAllUsers();
            updateStats();
            renderTable();
        } catch (err) {
            console.error('Failed to load users:', err);
            allUsers = [];
            renderTable();
        }
    }

    function updateStats() {
        const totalEl = document.getElementById('stat-total-users');
        const premiumEl = document.getElementById('stat-premium-users');
        const activeEl = document.getElementById('stat-active-today');

        if (totalEl) totalEl.textContent = allUsers.length;

        const premiumCount = allUsers.filter(u => u.isPremium).length;
        if (premiumEl) premiumEl.textContent = premiumCount;

        const now = Date.now();
        const dayMs = 24 * 60 * 60 * 1000;
        const activeCount = allUsers.filter(u => {
            if (!u.lastSyncedAt) return false;
            return (now - new Date(u.lastSyncedAt).getTime()) < dayMs;
        }).length;
        if (activeEl) activeEl.textContent = activeCount;
    }

    // ========================================================================
    // TABLE RENDERING
    // ========================================================================

    function renderTable() {
        const tbody = document.getElementById('admin-users-tbody');
        const emptyEl = document.getElementById('admin-empty');
        if (!tbody) return;

        const searchTerm = (document.getElementById('admin-search')?.value || '').toLowerCase();
        const filterVal = document.getElementById('admin-filter')?.value || 'all';

        let filtered = [...allUsers];

        // Search
        if (searchTerm) {
            filtered = filtered.filter(u =>
                (u.name && u.name.toLowerCase().includes(searchTerm)) ||
                (u.email && u.email.toLowerCase().includes(searchTerm))
            );
        }

        // Filter
        if (filterVal === 'premium') filtered = filtered.filter(u => u.isPremium);
        else if (filterVal === 'free') filtered = filtered.filter(u => !u.isPremium);

        // Sort by registration date (newest first)
        filtered.sort((a, b) => {
            const da = a.registeredAt ? new Date(a.registeredAt).getTime() : 0;
            const db = b.registeredAt ? new Date(b.registeredAt).getTime() : 0;
            return db - da;
        });

        if (filtered.length === 0) {
            tbody.innerHTML = '';
            if (emptyEl) emptyEl.classList.remove('hidden');
            return;
        }

        if (emptyEl) emptyEl.classList.add('hidden');

        tbody.innerHTML = filtered.map(user => {
            const avatarUrl = user.avatarUrl || '';
            const name = escapeHTML(user.name || 'Unknown');
            const email = escapeHTML(user.email || '—');
            const isPremium = user.isPremium;
            const registered = user.registeredAt ? formatDate(user.registeredAt) : '—';
            const lastSync = user.lastSyncedAt ? SyncService.getRelativeTime(user.lastSyncedAt) : 'Never';
            const uid = user.uid || '';

            const statusBadge = isPremium
                ? '<span class="admin-badge admin-badge-premium">⭐ Premium</span>'
                : '<span class="admin-badge admin-badge-free">Free</span>';

            const toggleLabel = isPremium ? 'Revoke' : 'Grant Premium';
            const toggleClass = isPremium ? 'admin-btn-danger' : 'admin-btn-success';

            return `
                <tr>
                    <td>
                        <div class="admin-user-cell">
                            ${avatarUrl ? `<img src="${avatarUrl}" class="admin-user-avatar" alt="">` : '<div class="admin-user-avatar-placeholder"></div>'}
                            <span class="admin-user-name">${name}</span>
                        </div>
                    </td>
                    <td class="admin-email-cell">${email}</td>
                    <td>${statusBadge}</td>
                    <td class="admin-date-cell">${registered}</td>
                    <td class="admin-date-cell">${lastSync}</td>
                    <td>
                        <button class="admin-toggle-premium ${toggleClass}" data-uid="${uid}" data-premium="${isPremium}">
                            ${toggleLabel}
                        </button>
                    </td>
                </tr>
            `;
        }).join('');

        // Bind toggle buttons
        tbody.querySelectorAll('.admin-toggle-premium').forEach(btn => {
            btn.addEventListener('click', async () => {
                const uid = btn.dataset.uid;
                const currentlyPremium = btn.dataset.premium === 'true';
                const newStatus = !currentlyPremium;

                btn.disabled = true;
                btn.textContent = 'Updating...';

                try {
                    await SyncService.updateUserProfile(uid, {
                        is_premium: newStatus,
                        premium_since: newStatus ? new Date().toISOString() : null
                    });

                    // Update local cache
                    const user = allUsers.find(u => u.uid === uid);
                    if (user) {
                        user.isPremium = newStatus;
                        user.premiumSince = newStatus ? new Date().toISOString() : null;
                    }

                    updateStats();
                    renderTable();
                } catch (err) {
                    console.error('Failed to toggle premium:', err);
                    alert('Failed to update premium status.');
                    btn.disabled = false;
                    btn.textContent = currentlyPremium ? 'Revoke' : 'Grant Premium';
                }
            });
        });
    }

    // ========================================================================
    // EVENT BINDING
    // ========================================================================

    function bindEvents() {
        // Search
        const searchInput = document.getElementById('admin-search');
        if (searchInput) {
            searchInput.addEventListener('input', () => renderTable());
        }

        // Filter
        const filterSelect = document.getElementById('admin-filter');
        if (filterSelect) {
            filterSelect.addEventListener('change', () => renderTable());
        }

        // Refresh
        const refreshBtn = document.getElementById('admin-refresh-btn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', async () => {
                refreshBtn.disabled = true;
                refreshBtn.textContent = 'Loading...';
                await loadUsers();
                refreshBtn.disabled = false;
                refreshBtn.innerHTML = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width="16" height="16" stroke-width="2"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg> Refresh`;
            });
        }

        // Export CSV
        const exportBtn = document.getElementById('admin-export-btn');
        if (exportBtn) {
            exportBtn.addEventListener('click', exportCSV);
        }
    }

    // ========================================================================
    // CSV EXPORT
    // ========================================================================

    function exportCSV() {
        if (allUsers.length === 0) {
            alert('No users to export.');
            return;
        }

        const headers = ['Name', 'Email', 'Premium', 'Registered', 'Last Synced'];
        const rows = allUsers.map(u => [
            u.name || '',
            u.email || '',
            u.isPremium ? 'Yes' : 'No',
            u.registeredAt || '',
            u.lastSyncedAt || ''
        ]);

        let csv = headers.join(',') + '\n';
        rows.forEach(row => {
            csv += row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',') + '\n';
        });

        const blob = new Blob([csv], { type: 'text/csv' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `dashboard_users_${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
    }

    // ========================================================================
    // HELPERS
    // ========================================================================

    function escapeHTML(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function formatDate(isoString) {
        try {
            const d = new Date(isoString);
            return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        } catch {
            return isoString;
        }
    }

})();
