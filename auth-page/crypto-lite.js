/**
 * auth-page/crypto-lite.js — Lightweight crypto for the auth page.
 *
 * Subset of CryptoService needed to derive vault keys when creating
 * a master password during sign-up. Runs in the web context (not extension).
 *
 * All heavy lifting uses the Web Crypto API (same as the extension).
 * The master password NEVER leaves this page.
 */

const CryptoLite = {
    PBKDF2_ITERATIONS: 600000,
    ALGORITHM: 'AES-GCM',
    KEY_LENGTH: 256,

    generateRandomBytes(length = 16) {
        return crypto.getRandomValues(new Uint8Array(length));
    },

    bufferToBase64(buffer) {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    },

    base64ToBuffer(base64) {
        const binaryString = atob(base64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes.buffer;
    },

    async deriveMasterKey(password, salt) {
        const passwordKey = await crypto.subtle.importKey(
            'raw',
            new TextEncoder().encode(password),
            { name: 'PBKDF2' },
            false,
            ['deriveKey']
        );

        return await crypto.subtle.deriveKey(
            {
                name: 'PBKDF2',
                salt: salt,
                iterations: this.PBKDF2_ITERATIONS,
                hash: 'SHA-256'
            },
            passwordKey,
            { name: this.ALGORITHM, length: this.KEY_LENGTH },
            false,
            ['encrypt', 'decrypt']
        );
    },

    generateDataKeyBase64() {
        const rawKey = this.generateRandomBytes(32);
        return this.bufferToBase64(rawKey);
    },

    async importDataKey(base64Key) {
        const keyBuffer = this.base64ToBuffer(base64Key);
        return await crypto.subtle.importKey(
            'raw',
            keyBuffer,
            { name: this.ALGORITHM, length: this.KEY_LENGTH },
            false,
            ['encrypt', 'decrypt']
        );
    },

    async encrypt(plaintext, key) {
        const iv = this.generateRandomBytes(12);
        const encodedText = new TextEncoder().encode(plaintext);

        const encryptedBuffer = await crypto.subtle.encrypt(
            { name: this.ALGORITHM, iv: iv },
            key,
            encodedText
        );

        return {
            ciphertext: this.bufferToBase64(encryptedBuffer),
            iv: this.bufferToBase64(iv)
        };
    },

    /**
     * Derives all vault key material from a master password.
     * Returns the payload to send alongside AUTH_SUCCESS.
     * The master password itself is NEVER included.
     */
    async deriveVaultKeys(masterPassword) {
        // 1. Generate salt and DEK
        const salt = this.generateRandomBytes(16);
        const saltBase64 = this.bufferToBase64(salt.buffer);
        const dekBase64 = this.generateDataKeyBase64();
        const dekKey = await this.importDataKey(dekBase64);

        // 2. Derive KEK from password + salt
        const kek = await this.deriveMasterKey(masterPassword, salt);

        // 3. Encrypt DEK with KEK (produces EDEK)
        const edekEnc = await this.encrypt(dekBase64, kek);

        // 4. Encrypt validator with DEK (allows checking correct password)
        const validatorEnc = await this.encrypt('VAULT_OK', dekKey);

        return {
            salt: saltBase64,
            edek: edekEnc.ciphertext,
            edek_iv: edekEnc.iv,
            validator: validatorEnc.ciphertext,
            validator_iv: validatorEnc.iv
        };
    }
};

window.CryptoLite = CryptoLite;
