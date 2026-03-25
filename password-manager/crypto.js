/**
 * Password Manager Core Cryptography (Zero-Knowledge)
 * 
 * Uses Web Crypto API for all operations.
 * - Key Derivation: PBKDF2 (HMAC-SHA256, 600,000 iterations)
 * - Encryption/Decryption: AES-GCM (256-bit)
 */

class CryptoService {
    constructor() {
        this.PBKDF2_ITERATIONS = 600000;
        this.ALGORITHM = 'AES-GCM';
        this.KEY_LENGTH = 256;
    }

    /**
     * Generates a cryptographically secure random salt/iv
     * @param {number} length in bytes
     * @returns {Uint8Array}
     */
    generateRandomBytes(length = 16) {
        return crypto.getRandomValues(new Uint8Array(length));
    }

    /**
     * Converts a string to an ArrayBuffer
     */
    _encodeString(str) {
        return new TextEncoder().encode(str);
    }

    /**
     * Converts an ArrayBuffer to a string
     */
    _decodeBuffer(buffer) {
        return new TextDecoder().decode(buffer);
    }

    /**
     * Helper to encode an ArrayBuffer to a Base64 string for storage
     */
    bufferToBase64(buffer) {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    }

    /**
     * Helper to decode a Base64 string to an ArrayBuffer
     */
    base64ToBuffer(base64) {
        const binaryString = atob(base64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes.buffer;
    }

    /**
     * Derives a master key from a password and salt using PBKDF2
     * @param {string} password 
     * @param {Uint8Array} salt 
     * @returns {Promise<CryptoKey>}
     */
    async deriveMasterKey(password, salt) {
        const passwordKey = await crypto.subtle.importKey(
            'raw',
            this._encodeString(password),
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
            false, // Extractable = false (key never leaves memory)
            ['encrypt', 'decrypt']
        );
    }

    /**
     * Generates a random 256-bit Data Encryption Key (DEK)
     * @returns {string} Base64 representation of the DEK
     */
    generateDataKeyBase64() {
        const rawKey = this.generateRandomBytes(32);
        return this.bufferToBase64(rawKey);
    }

    /**
     * Imports a Base64 DEK into a CryptoKey for AES-GCM operations
     * @param {string} base64Key 
     * @returns {Promise<CryptoKey>}
     */
    async importDataKey(base64Key) {
        const keyBuffer = this.base64ToBuffer(base64Key);
        return await crypto.subtle.importKey(
            'raw',
            keyBuffer,
            { name: this.ALGORITHM, length: this.KEY_LENGTH },
            false,
            ['encrypt', 'decrypt']
        );
    }

    /**
     * Encrypts plaintext using AES-GCM
     * @param {string} plaintext data to encrypt
     * @param {CryptoKey} key derived master key
     * @returns {Promise<{ciphertext: stringBase64, iv: stringBase64}>}
     */
    async encrypt(plaintext, key) {
        const iv = this.generateRandomBytes(12); // Recommended 96-bit IV for GCM
        const encodedText = this._encodeString(plaintext);

        const encryptedBuffer = await crypto.subtle.encrypt(
            {
                name: this.ALGORITHM,
                iv: iv
            },
            key,
            encodedText
        );

        return {
            ciphertext: this.bufferToBase64(encryptedBuffer),
            iv: this.bufferToBase64(iv)
        };
    }

    /**
     * Decrypts ciphertext using AES-GCM
     * @param {stringBase64} ciphertextBase64 
     * @param {stringBase64} ivBase64 
     * @param {CryptoKey} key 
     * @returns {Promise<string>} plaintext
     */
    async decrypt(ciphertextBase64, ivBase64, key) {
        const ciphertextBuffer = this.base64ToBuffer(ciphertextBase64);
        const ivBuffer = this.base64ToBuffer(ivBase64);

        try {
            const decryptedBuffer = await crypto.subtle.decrypt(
                {
                    name: this.ALGORITHM,
                    iv: new Uint8Array(ivBuffer)
                },
                key,
                ciphertextBuffer
            );

            return this._decodeBuffer(decryptedBuffer);
        } catch (e) {
            console.error("Decryption failed. Invalid key or corrupted data.", e);
            throw new Error("Decryption failed");
        }
    }

    /**
     * Utility: Generate a random secure password
     */
    generatePassword(length = 16, useUpper = true, useLower = true, useNumbers = true, useSymbols = true) {
        const charset = {
            upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
            lower: 'abcdefghijklmnopqrstuvwxyz',
            numbers: '0123456789',
            symbols: '!@#$%^&*()_+~`|}{[]:;?><,./-='
        };

        let characters = '';
        if (useUpper) characters += charset.upper;
        if (useLower) characters += charset.lower;
        if (useNumbers) characters += charset.numbers;
        if (useSymbols) characters += charset.symbols;

        if (characters.length === 0) return ''; // Fallback if all unchecked

        let password = '';
        const randomValues = new Uint32Array(length);
        crypto.getRandomValues(randomValues);

        for (let i = 0; i < length; i++) {
            password += characters[randomValues[i] % characters.length];
        }

        return password;
    }
}

// Export for use in other files
const _globalCrypto = typeof window !== 'undefined' ? window : self;
_globalCrypto.cryptoService = new CryptoService();
