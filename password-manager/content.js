/**
 * Password Manager Content Script
 * Injected into active pages to map form inputs and auto-fill credentials.
 */

console.log("Personal Dashboard (PM) Content Script Loaded.");

// Listen for fill commands from the background service worker or popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'pm_autofill') {
        const success = fillLoginForm(request.username, request.email, request.password);
        sendResponse({ success });
    }
});

// Check for pending saves on page load (handles persistence across reloads)
(function checkPendingOnLoad() {
    chrome.runtime.sendMessage({ 
        action: 'check_pending_save', 
        hostname: window.location.hostname 
    }, (response) => {
        if (response && response.hasPending) {
            const data = response.data;
            showSaveCredentialPopup(
                data.username, 
                data.email, 
                data.password, 
                data.isUpdate, 
                data.existingId
            );
        }
    });
})();

/**
 * Attempts to intelligently find and fill a username and password field.
 */
function fillLoginForm(username, email, password) {
    let forms = document.forms;
    let targetPassInput = null;
    let targetUsernameInput = null;
    let targetEmailInput = null;

    // Helper to classify fields
    const classifyFields = (fields) => {
        for (let f of fields) {
            const type = f.type.toLowerCase();
            const nameStr = (f.name || '').toLowerCase();
            const idStr = (f.id || '').toLowerCase();
            const placeholder = (f.placeholder || '').toLowerCase();

            const isProbablyEmail = type === 'email' || nameStr.includes('email') || idStr.includes('email') || placeholder.includes('email');
            
            if (isProbablyEmail) {
                if (!targetEmailInput) targetEmailInput = f;
            } else {
                if (!targetUsernameInput) targetUsernameInput = f;
            }
        }
    };

    // 1. Try to find a form containing a password field
    for (let i = 0; i < forms.length; i++) {
        const passFields = forms[i].querySelectorAll('input[type="password"]');
        if (passFields.length > 0) {
            targetPassInput = passFields[0];

            // Try to find the associated username/email field in the same form
            const textFields = Array.from(forms[i].querySelectorAll('input[type="text"], input[type="email"], input:not([type])'));
            const visibleFields = textFields.filter(f => !f.hidden && f.offsetWidth > 0 && f.offsetHeight > 0);
            
            classifyFields(visibleFields);
            break;
        }
    }

    // 2. If no form tag, search globally
    if (!targetPassInput) {
        const allPassFields = document.querySelectorAll('input[type="password"]');
        if (allPassFields.length > 0) {
            targetPassInput = allPassFields[0];

            // Try finding a username field globally (highest risk of false match, but needed for SPAs)
            const allTextFields = Array.from(document.querySelectorAll('input[type="text"], input[type="email"], input:not([type])'));
            const visibleFields = allTextFields.filter(f => !f.hidden && f.offsetWidth > 0 && f.offsetHeight > 0);
            
            classifyFields(visibleFields);
        }
    }

    let filled = false;

    // Execute Fill
    if (targetEmailInput && email) {
        simulateTyping(targetEmailInput, email);
        filled = true;
    }
    
    if (targetUsernameInput) {
        if (username) {
            simulateTyping(targetUsernameInput, username);
            filled = true;
        } else if (!targetEmailInput && email) {
            // If we have an email but no username, and we couldn't find a distinct email field, fill the generic field with the email
            simulateTyping(targetUsernameInput, email);
            filled = true;
        }
    }

    if (targetPassInput && password) {
        simulateTyping(targetPassInput, password);
        filled = true;
    }

    if (filled) {
        if (targetEmailInput) highlightField(targetEmailInput);
        if (targetUsernameInput) highlightField(targetUsernameInput);
        if (targetPassInput) highlightField(targetPassInput);
    } else {
        console.warn("Personal Dashboard: No suitable login fields found on this page.");
    }

    return filled;
}

/**
 * Safely sets the value of an input field, triggering necessary React/Vue events.
 */
function simulateTyping(inputElement, value) {
    if (!inputElement) return;

    // Native setter workaround for React 15+
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    if (nativeInputValueSetter) {
        nativeInputValueSetter.call(inputElement, value);
    } else {
        inputElement.value = value;
    }

    // Dispatch standard events so SPAs notice the change
    inputElement.dispatchEvent(new Event('input', { bubbles: true }));
    inputElement.dispatchEvent(new Event('change', { bubbles: true }));
}

/**
 * Temporarily highlights a field that was auto-filled.
 */
function highlightField(field) {
    if (!field) return;
    const oldBg = field.style.backgroundColor;
    const oldTrans = field.style.transition;

    field.style.transition = "background-color 0.5s ease";
    field.style.backgroundColor = "#e6f7ff"; // Light blue glow

    setTimeout(() => {
        field.style.backgroundColor = oldBg;
        setTimeout(() => field.style.transition = oldTrans, 500);
    }, 1500);
}

// ==========================================
// IN-PAGE AUTOFILL POPOVER LOGIC
// ==========================================

let activePopover = null;

document.addEventListener('click', handleDocumentClick);
document.addEventListener('focusin', handleFieldFocus);

async function handleFieldFocus(e) {
    const target = e.target;
    if (target.tagName !== 'INPUT') return;

    // Ignore inputs belonging to the popover itself
    if (target.id === 'pm-unlock-input' || (activePopover && activePopover.contains(target))) return;

    // Check if it's a password field or a text/email field right before a password field
    const isPasswordField = target.type === 'password';
    let isUsernameField = false;

    if (!isPasswordField && (target.type === 'text' || target.type === 'email' || !target.type)) {
        // Simple heuristic: is there a password field nearby in the same form?
        if (target.form) {
            const passFields = target.form.querySelectorAll('input[type="password"]');
            if (passFields.length > 0) isUsernameField = true;
        } else {
            // Maybe global search if no form (SPA)
            const passFields = document.querySelectorAll('input[type="password"]');
            if (passFields.length > 0) isUsernameField = true;
        }
    }

    if (isPasswordField || isUsernameField) {
        // Prevent re-triggering if already showing for this input
        if (activePopover && activePopover._targetInput === target) return;

        requestAndShowPopover(target);
    }
}

function requestAndShowPopover(inputField) {
    chrome.runtime.sendMessage({ action: 'get_vault_entries' }, (response) => {
        if (response && response.success && response.entries) {
            const allEntries = response.entries.filter(e => !e.type || e.type === 'password');
            if (allEntries.length > 0) {
                const currentHost = window.location.hostname;
                let relevantEntries = allEntries.filter(e => {
                    if (!e.url) return false;
                    try {
                        let urlStr = e.url.trim();
                        if (!/^https?:\/\//i.test(urlStr)) {
                            urlStr = 'https://' + urlStr;
                        }
                        const entryHost = new URL(urlStr).hostname;
                        return currentHost === entryHost || currentHost.endsWith('.' + entryHost) || entryHost.endsWith('.' + currentHost);
                    } catch (err) {
                        return false;
                    }
                });

                if (relevantEntries.length > 0) {
                    showAutofillPopover(inputField, relevantEntries, allEntries);
                } else {
                    showEmptyPopover(inputField, false, allEntries); // Vault unlocked, but no entries match
                }
            } else {
                showEmptyPopover(inputField, false, []); // Vault unlocked, but completely empty
            }
        } else {
            showEmptyPopover(inputField, true, []); // Vault locked or error
        }
    });
}

function handleDocumentClick(e) {
    if (activePopover && !activePopover.contains(e.target)) {
        // Don't close if we clicked the input field that triggered the popover
        if (e.target !== activePopover._targetInput) {
            closePopover();
        }
    }

    if (e.target.tagName === 'INPUT' && (!activePopover || activePopover._targetInput !== e.target)) {
        if (e.target.id === 'pm-unlock-input' || (activePopover && activePopover.contains(e.target))) return;
        handleFieldFocus(e);
    }
}

function showEmptyPopover(inputField, isLocked, allEntries = []) {
    closePopover();

    const popover = document.createElement('div');

    // Defer positioning to next frame to ensure accurate layout calculation
    requestAnimationFrame(() => {
        const rect = inputField.getBoundingClientRect();
        Object.assign(popover.style, getPopoverBaseStyles(rect, true));
    });

    // Start slightly hidden for fade-in effect
    Object.assign(popover.style, {
        position: 'absolute',
        left: '-9999px', // Position off-screen initially
        top: '-9999px',
        opacity: '0',
        transition: 'opacity 0.15s ease-in-out',
        backgroundColor: '#2b2b2b',
        border: '1px solid #4a5568',
        borderRadius: '6px',
        boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.5), 0 4px 6px -2px rgba(0, 0, 0, 0.3)',
        zIndex: '2147483647',
        fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden'
    });

    if (isLocked) {
        popover.innerHTML = `
            <div style="padding: 10px 14px; display: flex; align-items: center; justify-content: space-between; gap: 16px; background: #252526; min-width: max-content;">
                <div id="pm-locked-info-area" style="display: flex; align-items: center; gap: 12px;">
                    <div style="display: flex; align-items: center; justify-content: center; width: 32px; height: 32px; border-radius: 8px; background: rgba(59, 130, 246, 0.15); border: 1px solid rgba(59, 130, 246, 0.2);">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                    </div>
                    <div style="display: flex; flex-direction: column; gap: 2px;">
                        <span style="color: #f8fafc; font-size: 13.5px; font-weight: 500; line-height: 1.2;">Vault Locked</span>
                        <span style="color: #94a3b8; font-size: 11.5px; line-height: 1.2;">Unlock to autofill</span>
                    </div>
                </div>
                <form id="pm-unlock-form" style="display: none; align-items: center; gap: 8px; margin: 0;">
                    <input type="password" id="pm-unlock-input" placeholder="Master Password" style="background: #1e1e1e; border: 1px solid #3f4a5c; color: #e2e8f0; padding: 6px 10px; border-radius: 6px; font-size: 12.5px; width: 140px; outline: none; transition: border-color 0.15s ease;">
                    <button type="submit" id="pm-unlock-submit-btn" style="background: #3b82f6; color: white; border: none; padding: 7px 14px; border-radius: 6px; font-size: 12.5px; font-weight: 500; cursor: pointer; outline: none; transition: background 0.15s ease, transform 0.1s ease; box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1); white-space: nowrap;">Unlock</button>
                </form>
                <button id="pm-unlock-btn" style="background: #3b82f6; color: white; border: none; padding: 7px 14px; border-radius: 6px; font-size: 12.5px; font-weight: 500; cursor: pointer; outline: none; transition: background 0.15s ease, transform 0.1s ease; box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1); white-space: nowrap;">
                    Unlock
                </button>
            </div>
        `;
    } else {
        let seeAllHtml = '';
        if (allEntries.length > 0) {
            seeAllHtml = `
                <div id="pm-see-all-btn" style="padding: 8px 12px; margin: 0 8px 8px 8px; background: rgba(59, 130, 246, 0.1); border: 1px solid rgba(59, 130, 246, 0.2); border-radius: 6px; color: #60a5fa; font-size: 12.5px; font-weight: 500; text-align: center; cursor: pointer; transition: background 0.15s ease;">
                    See all credentials
                </div>
            `;
        }

        popover.innerHTML = `
            <div style="padding: 12px 16px; display: flex; align-items: center; gap: 10px; background: #252526; min-width: max-content;">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#718096" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="8" y1="12" x2="16" y2="12"></line></svg>
                <div style="color: #a0aec0; font-size: 13px;">No saved entries found</div>
            </div>
            ${seeAllHtml}
        `;
    }

    document.body.appendChild(popover);
    activePopover = popover;
    activePopover._targetInput = inputField;

    if (!isLocked && allEntries.length > 0) {
        const seeAllBtn = popover.querySelector('#pm-see-all-btn');
        if (seeAllBtn) {
            seeAllBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                closePopover();
                showAutofillPopover(inputField, allEntries, allEntries);
            });
        }
    }

    // Trigger fade in
    requestAnimationFrame(() => {
        popover.style.opacity = '1';
    });

    if (isLocked) {
        const unlockBtn = popover.querySelector('#pm-unlock-btn');
        const unlockForm = popover.querySelector('#pm-unlock-form');
        const infoArea = popover.querySelector('#pm-locked-info-area');
        const passInput = popover.querySelector('#pm-unlock-input');

        // Hover/active effects for unlock button
        if (unlockBtn) {
            unlockBtn.onmouseenter = () => {
                unlockBtn.style.background = '#2563eb';
            };
            unlockBtn.onmouseleave = () => {
                unlockBtn.style.background = '#3b82f6';
            };
            unlockBtn.onmousedown = () => unlockBtn.style.transform = 'scale(0.96)';
            unlockBtn.onmouseup = () => unlockBtn.style.transform = 'scale(1)';

            unlockBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();

                const lockInfo = popover.querySelector('#pm-locked-info-area');
                const form = popover.querySelector('#pm-unlock-form');
                const input = popover.querySelector('#pm-unlock-input');
                const submitBtn = popover.querySelector('#pm-unlock-submit-btn');

                lockInfo.style.display = 'none';
                unlockBtn.style.display = 'none';
                form.style.display = 'flex';
                input.focus();

                input.addEventListener('input', () => {
                    input.style.borderColor = '#3f4a5c';
                });

                submitBtn.onmousedown = () => submitBtn.style.transform = 'scale(0.96)';
                submitBtn.onmouseup = () => submitBtn.style.transform = 'scale(1)';
                submitBtn.onmouseenter = () => submitBtn.style.background = '#2563eb';
                submitBtn.onmouseleave = () => submitBtn.style.background = '#3b82f6';

                form.addEventListener('submit', (subE) => {
                    subE.preventDefault();
                    subE.stopPropagation();
                    const password = input.value;
                    if (!password) return;

                    submitBtn.textContent = '...';
                    submitBtn.disabled = true;

                    chrome.runtime.sendMessage({ action: 'unlock_vault', password }, (resp) => {
                        if (resp && resp.success) {
                            // Vault unlocked! Rerender popover
                            const currentTarget = activePopover ? activePopover._targetInput : null;
                            if (currentTarget) requestAndShowPopover(currentTarget);
                        } else {
                            input.style.borderColor = '#ef4444';
                            submitBtn.textContent = 'Unlock';
                            submitBtn.disabled = false;
                        }
                    });
                });
            });
        }
    }
}

function getPopoverBaseStyles(rect, autoWidth = false) {
    // Add safety checks for positioning
    const topPos = Math.max(0, window.scrollY + rect.bottom + 8);
    const leftPos = Math.max(0, window.scrollX + rect.left);
    const baseWidth = Math.max(rect.width, 280);

    return {
        position: 'absolute',
        top: `${topPos}px`,
        left: `${leftPos}px`,
        width: autoWidth ? 'auto' : `${baseWidth}px`,
        minWidth: autoWidth ? 'max-content' : 'auto',
        backgroundColor: '#2b2b2b', // Dark theme matching screenshot
        border: '1px solid #4a5568',
        borderRadius: '6px',
        boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.5), 0 4px 6px -2px rgba(0, 0, 0, 0.3)',
        zIndex: '2147483647',
        fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden'
    };
}

function showAutofillPopover(inputField, entries, allEntries = []) {
    closePopover();

    const popover = document.createElement('div');

    // Defer positioning to next frame
    requestAnimationFrame(() => {
        const rect = inputField.getBoundingClientRect();
        Object.assign(popover.style, getPopoverBaseStyles(rect, false));
    });

    Object.assign(popover.style, {
        position: 'absolute',
        left: '-9999px',
        top: '-9999px',
        opacity: '0',
        transition: 'opacity 0.15s ease-in-out',
        backgroundColor: '#2b2b2b',
        border: '1px solid #4a5568',
        borderRadius: '6px',
        boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.5), 0 4px 6px -2px rgba(0, 0, 0, 0.3)',
        zIndex: '2147483647',
        fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden'
    });

    entries.forEach(entry => {
        const item = document.createElement('div');
        Object.assign(item.style, {
            display: 'flex',
            alignItems: 'center',
            padding: '12px 14px',
            cursor: 'pointer',
            transition: 'background 0.15s ease',
            color: '#e2e8f0',
            borderBottom: '1px solid #3f4a5c'
        });

        item.onmouseenter = () => item.style.backgroundColor = '#2c5282'; // Blue hover matching screenshot
        item.onmouseleave = () => item.style.backgroundColor = 'transparent';

        // Globe Icon
        const iconDiv = document.createElement('div');
        iconDiv.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#a0aec0" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>`;
        iconDiv.style.marginRight = '12px';
        iconDiv.style.display = 'flex';
        iconDiv.style.alignItems = 'center';

        // Text Content
        const textDiv = document.createElement('div');
        textDiv.style.flexGrow = '1';
        textDiv.style.display = 'flex';
        textDiv.style.flexDirection = 'column';
        textDiv.style.gap = '2px';

        const title = document.createElement('div');
        let displayTitle = entry.title;
        if (!displayTitle && entry.url) {
            try { 
                let urlStr = entry.url.trim();
                if (!/^https?:\/\//i.test(urlStr)) urlStr = 'https://' + urlStr;
                displayTitle = new URL(urlStr).hostname; 
            } catch (e) { }
        }
        title.textContent = displayTitle || 'Unknown';
        title.style.fontWeight = '500';
        title.style.fontSize = '14px';
        title.style.color = '#fff';

        const user = document.createElement('div');
        user.textContent = entry.username || entry.email || 'No username/email';
        user.style.fontSize = '12.5px';
        user.style.color = '#a0aec0';

        textDiv.appendChild(title);
        textDiv.appendChild(user);

        // Pop-out icon on the right
        const rightIcon = document.createElement('div');
        rightIcon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#718096" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>`;
        rightIcon.style.marginLeft = '12px';
        rightIcon.style.display = 'flex';

        item.appendChild(iconDiv);
        item.appendChild(textDiv);
        item.appendChild(rightIcon);

        item.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            fillLoginForm(entry.username, entry.email, entry.password);
            closePopover();
        });

        popover.appendChild(item);
    });

    // See all button at the bottom of the list if applicable
    if (allEntries.length > entries.length) {
        const seeAllBtn = document.createElement('div');
        seeAllBtn.textContent = 'See all credentials';
        Object.assign(seeAllBtn.style, {
            padding: '10px 14px',
            color: '#60a5fa',
            fontSize: '13px',
            fontWeight: '500',
            textAlign: 'center',
            cursor: 'pointer',
            background: 'transparent',
            transition: 'background 0.15s ease'
        });
        
        seeAllBtn.onmouseenter = () => seeAllBtn.style.backgroundColor = 'rgba(59, 130, 246, 0.1)';
        seeAllBtn.onmouseleave = () => seeAllBtn.style.backgroundColor = 'transparent';
        
        seeAllBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            closePopover();
            showAutofillPopover(inputField, allEntries, allEntries);
        });
        
        popover.appendChild(seeAllBtn);
    }

    document.body.appendChild(popover);
    activePopover = popover;
    activePopover._targetInput = inputField;

    requestAnimationFrame(() => {
        popover.style.opacity = '1';
    });
}

function closePopover() {
    if (activePopover) {
        activePopover.remove();
        activePopover = null;
    }
}

// ==========================================
// CAPTURE NEW LOGIN SUBMISSIONS
// ==========================================

function extractCredentials(formElement) {
    let password = '';
    let email = '';
    let username = '';

    const inputs = formElement.querySelectorAll('input');
    for (let input of inputs) {
        const type = input.type.toLowerCase();
        const value = input.value.trim();
        if (!value) continue;

        if (type === 'password') {
            password = value;
        } else if (type === 'email' || input.name.toLowerCase().includes('email') || input.id.toLowerCase().includes('email')) {
            email = value;
        } else if (type === 'text' || !type) {
            // Might be username
            if (!username) username = value; 
        }
    }
    
    // If no distinct username, but a text field was found, use it as email/username depending on heuristics
    if (!email && username && username.includes('@')) {
        email = username;
        username = '';
    }

    return { username, email, password };
}

function handleLoginSubmission(e) {
    let form = null;
    if (e.type === 'submit') {
        form = e.target;
    } else if (e.type === 'click' && e.target.closest('form')) {
        form = e.target.closest('form');
    }

    if (!form) return;

    const creds = extractCredentials(form);
    if (!creds.password || (!creds.username && !creds.email)) return;

    // We have a potential login
    chrome.runtime.sendMessage({
        action: 'process_login',
        username: creds.username,
        email: creds.email,
        password: creds.password,
        hostname: window.location.hostname,
        title: document.title
    }, (response) => {
        if (!response) return;

        if (response.action === 'prompt_save' || response.action === 'prompt_locked_save') {
            showSaveCredentialPopup(creds.username, creds.email, creds.password, false, null);
        } else if (response.action === 'prompt_update') {
            showSaveCredentialPopup(creds.username, creds.email, creds.password, true, response.existingId);
        }
    });

    // Don't prevent default, allow the login to proceed
}

document.addEventListener('submit', handleLoginSubmission, true);
document.addEventListener('click', (e) => {
    if (e.target.tagName === 'BUTTON' && e.target.type === 'submit') {
        handleLoginSubmission(e);
    }
}, true);

// popup logic relocated to save_prompt.js
