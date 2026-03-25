/**
 * save_prompt.js
 * Injected into all web pages to display the "Save Password" and "Update Password" prompt.
 * Uses Shadow DOM to ensure host website CSS does not interfere with the popup styling.
 */

let activeSavePopupRoot = null;

function showSaveCredentialPopup(username, email, password, isUpdate, existingId) {
    if (activeSavePopupRoot) {
        document.body.removeChild(activeSavePopupRoot.host);
        activeSavePopupRoot = null;
    }

    // Create the host element for the Shadow DOM
    const host = document.createElement('div');
    host.id = 'pm-save-prompt-host';
    host.style.position = 'fixed';
    host.style.top = '20px';
    host.style.right = '20px';
    host.style.zIndex = '2147483647';
    
    // Attach closed shadow root to completely isolate styles from the host page
    const shadow = host.attachShadow({ mode: 'closed' });
    activeSavePopupRoot = shadow;
    activeSavePopupRoot.host = host;

    const popup = document.createElement('div');
    popup.className = 'pm-save-popup';

    const style = document.createElement('style');
    style.textContent = `
        :host {
            all: initial; /* Resets inherited styles on the host */
        }
        
        .pm-save-popup {
            all: revert; /* Base reset */
            width: 300px;
            background-color: #1a1b1e;
            border: 1px solid #33363d;
            border-radius: 8px;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.6);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            display: flex;
            flex-direction: column;
            color: #eceff4;
            animation: slideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1);
            box-sizing: border-box;
        }

        @keyframes slideIn {
            from { transform: translateX(100%) scale(0.95); opacity: 0; }
            to { transform: translateX(0) scale(1); opacity: 1; }
        }

        .pm-header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            padding: 16px 16px 12px 16px;
        }

        .pm-header-left {
            display: flex;
            align-items: center;
            gap: 12px;
        }

        .pm-icon-wrap {
            background: rgba(59, 130, 246, 0.1);
            border: 1px solid rgba(59, 130, 246, 0.2);
            padding: 8px;
            border-radius: 8px;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .pm-title-stack {
            display: flex;
            flex-direction: column;
            gap: 2px;
        }

        .pm-title {
            font-weight: 600;
            font-size: 15px;
            color: #f8fafc;
            line-height: 1.2;
            margin: 0;
            padding: 0;
        }

        .pm-subtitle {
            font-size: 12px;
            color: #94a3b8;
            line-height: 1.2;
            margin: 0;
            padding: 0;
        }

        .pm-close-btn {
            background: none;
            border: none;
            color: #64748b;
            cursor: pointer;
            padding: 4px;
            line-height: 1;
            transition: color 0.15s;
        }

        .pm-close-btn:hover {
            color: #e2e8f0;
        }

        .pm-content {
            padding: 0 16px 16px 16px;
            display: flex;
            flex-direction: column;
            gap: 12px;
        }

        .pm-account-card {
            background: #25262b;
            padding: 10px 12px;
            border-radius: 6px;
            border: 1px solid #33363d;
        }

        .pm-account-label {
            font-size: 10.5px;
            color: #8b95a5;
            text-transform: uppercase;
            font-weight: 700;
            letter-spacing: 0.5px;
            margin-bottom: 4px;
        }

        .pm-account-value {
            font-size: 13.5px;
            color: #e5e7eb;
            font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, Courier, monospace;
            word-break: break-all;
        }

        .pm-locked-warning {
            display: none;
        }

        .pm-save-input {
            background: #2b2c31;
            border: 1px solid #40444f;
            color: #fff;
            padding: 8px 12px;
            border-radius: 6px;
            font-size: 13px;
            width: 100%;
            box-sizing: border-box;
            outline: none;
            transition: border-color 0.2s;
            font-family: inherit;
        }
        
        .pm-save-input:focus {
            border-color: #3b82f6;
        }

        .pm-actions {
            display: flex;
            gap: 8px;
            margin-top: 4px;
        }

        .pm-btn {
            padding: 8px 16px;
            border-radius: 6px;
            font-size: 13px;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.15s ease;
            flex: 1;
            border: none;
            font-family: inherit;
            box-sizing: border-box;
            text-align: center;
        }

        .pm-btn-primary { 
            background: #3b82f6; 
            color: white; 
        }
        
        .pm-btn-primary:hover:not(:disabled) { 
            background: #2563eb; 
        }

        .pm-btn-primary:disabled {
            opacity: 0.6;
            cursor: not-allowed;
        }

        .pm-btn-secondary { 
            background: transparent; 
            color: #9ca3af; 
            border: 1px solid #4b5563; 
        }
        
        .pm-btn-secondary:hover { 
            background: #2b2c31; 
            color: #f3f4f6; 
            border-color: #6b7280;
        }
    `;
    shadow.appendChild(style);

    const titleText = isUpdate ? 'Update Password?' : 'Save Password?';
    const displayUser = username || email || 'No Username';
    
    popup.innerHTML = `
        <div class="pm-header">
            <div class="pm-header-left">
                <div class="pm-icon-wrap">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="none" stroke="#60a5fa" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"></path></svg>
                </div>
                <div class="pm-title-stack">
                    <div class="pm-title">${titleText}</div>
                    <div class="pm-subtitle">${window.location.hostname}</div>
                </div>
            </div>
            <button class="pm-close-btn" id="pm-close-btn" title="Close">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
        </div>
        
        <div class="pm-content">
            <div class="pm-account-card">
                <div class="pm-account-label">Account</div>
                <div class="pm-account-value">${displayUser}</div>
            </div>

            <div class="pm-locked-warning" id="pm-locked-warning">
                <input type="password" id="pm-inline-unlock" class="pm-save-input" placeholder="Master Password to Save">
            </div>

            <div class="pm-actions">
                <button id="pm-cancel-btn" class="pm-btn pm-btn-secondary">Never on this site</button>
                <button id="pm-confirm-btn" class="pm-btn pm-btn-primary">${isUpdate ? 'Update' : 'Save'}</button>
            </div>
        </div>
    `;

    shadow.appendChild(popup);
    document.body.appendChild(host);

    let dismissTimeout = null;

    const clearDismissTimeout = () => {
        if (dismissTimeout) {
            clearTimeout(dismissTimeout);
            dismissTimeout = null;
        }
    };

    const closePopup = () => {
        clearDismissTimeout();
        if (activeSavePopupRoot && activeSavePopupRoot.host === host) {
            if (document.body.contains(host)) {
                document.body.removeChild(host);
            }
            if (activeSavePopupRoot === shadow) {
                activeSavePopupRoot = null;
            }
        }
        // Clear pending save from background session
        chrome.runtime.sendMessage({ action: 'clear_pending_save' });
    };

    // Auto-dismiss timeout
    chrome.storage.local.get(['pm_settings'], (result) => {
        const settings = result.pm_settings || {};
        const timeoutSeconds = settings.savePromptTimeout !== undefined ? settings.savePromptTimeout : 10;
        
        if (timeoutSeconds !== -1) {
            dismissTimeout = setTimeout(() => {
                closePopup();
            }, timeoutSeconds * 1000);
        }
    });

    // Interaction detection to prevent auto-dismiss
    popup.onclick = () => clearDismissTimeout();
    popup.onmouseenter = () => clearDismissTimeout();
    popup.oninput = () => clearDismissTimeout();

    // Events
    const closeBtn = shadow.getElementById('pm-close-btn');
    const cancelBtn = shadow.getElementById('pm-cancel-btn');
    const confirmBtn = shadow.getElementById('pm-confirm-btn');
    
    closeBtn.onclick = () => {
        closePopup();
    };
    
    // Never on this site
    cancelBtn.onclick = () => {
        chrome.runtime.sendMessage({ action: 'ignore_domain', hostname: window.location.hostname });
        closePopup();
    };
    
    // Save / Update
    confirmBtn.onclick = () => {
        confirmBtn.textContent = '...';
        confirmBtn.disabled = true;
        
        const payload = isUpdate ? {
            action: 'update_credential',
            id: existingId,
            updates: {
                username: username || '',
                email: email || '',
                password: password || ''
            }
        } : {
            action: 'add_credential',
            entry: {
                title: window.location.hostname,
                url: window.location.href,
                username: username || '',
                email: email || '',
                password: password || '',
                type: 'password'
            }
        };

        const trySave = () => {
            chrome.runtime.sendMessage(payload, (res) => {
                if (res && res.success) {
                    confirmBtn.style.background = '#10b981';
                    confirmBtn.textContent = 'Saved!';
                    setTimeout(() => {
                        closePopup();
                    }, 1000);
                } else if (res && res.error === 'Vault is locked') {
                    // Show inline unlock
                    confirmBtn.textContent = 'Unlock & Save';
                    confirmBtn.disabled = false;
                    shadow.getElementById('pm-locked-warning').style.display = 'block';
                    
                    const unlockInput = shadow.getElementById('pm-inline-unlock');
                    unlockInput.focus();
                    
                    // Hook up confirm button to unlock first
                    confirmBtn.onclick = () => {
                        if (!unlockInput.value) return;
                        confirmBtn.textContent = '...';
                        confirmBtn.disabled = true;
                        
                        chrome.runtime.sendMessage({
                            action: 'unlock_and_save',
                            masterPassword: unlockInput.value,
                            entry: payload.entry
                        }, (unlockRes) => {
                            if (unlockRes && unlockRes.success) {
                                confirmBtn.style.background = '#10b981';
                                confirmBtn.textContent = 'Saved!';
                                setTimeout(() => {
                                    closePopup();
                                }, 1000);
                            } else {
                                confirmBtn.textContent = 'Unlock & Save';
                                confirmBtn.disabled = false;
                                unlockInput.style.borderColor = '#ef4444';
                            }
                        });
                    };
                } else {
                    confirmBtn.textContent = 'Failed';
                    confirmBtn.style.background = '#ef4444';
                }
            });
        };

        trySave();
    };
}
