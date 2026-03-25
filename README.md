# Personal Dashboard - Chrome Extension

Personal Dashboard is a Notion-style Chrome Extension that allows you to easily save links, notes, images, and files locally within your browser. It provides a clean, organized, and secure interface right in your extension popup.

## Features

- **Store Everything**: Save text notes, URLs, images, and other file types seamlessly.
- **Folder Organization**: Create, rename, delete folders, and move items between them to stay organized.
- **PIN Protection**: Lock specific folders with a numeric PIN for privacy.
- **Drag & Drop / Paste**: Quickly bring content into the dashboard by dropping files onto the popup or pasting directly from your clipboard.
- **Context Menu Integration**: Right-click on any page or text selection to add it instantly to your dashboard.
- **Export & Import**: Backup your dashboard by exporting the data as a JSON file, and restore it easily.
- **Dark/Light Mode**: Toggle between light and dark themes according to your preference.
- **Search**: Quickly find saved notes, links, and files using the integrated search box.
- **Open in New Window**: Detach the dashboard into a floating window for long reading or organization sessions.

---

## User Guide

### Installation

1. Download or clone this repository to your local machine.
2. Open Google Chrome and go to `chrome://extensions/`.
3. Enable **Developer mode** using the toggle switch in the top right corner.
4. Click on **Load unpacked** in the top left corner.
5. Select the folder containing the extension files.
6. Pin the extension to your browser toolbar for quick access.

### Usage

- **Adding Items**: 
  - Click the floating `+` button in the popup to add a Note, Link, or Upload a file.
  - Drag and drop files directly onto the popup window.
  - Paste text or files directly into the popup.
  - Right-click text or anywhere on a webpage and select "Add selection to Dashboard" or "Add page to Dashboard".
- **Managing Folders**: 
  - Click the folder icon in the sidebar header to create a new folder.
  - Hover over a folder to rename, delete, or lock it with a PIN.
- **Viewing & Editing**: Click on any note or item to view its full content, copy it to clipboard, or edit its content. You can also use the "Move" button to relocate items to other folders.
- **Backup Data**: Use the Export and Import buttons at the bottom of the sidebar to manage your local data backups securely.

---

## Developer Guide

### Tech Stack
- **Frontend**: Standard HTML, CSS, and vanilla JavaScript (No frameworks).
- **Storage Database**: IndexedDB (for structured, large storage capacity, including files and blobs).
- **Architecture**: Adheres to the latest Chrome Extension **Manifest V3** standards.

### Architecture Overview

- **`manifest.json`**: Configuration, permissions (`storage`, `contextMenus`, `activeTab`, `clipboardRead`), and extension metadata.
- **`background.js`**: The service worker. It handles initializing the IndexedDB and listens to Context Menu events for adding items silently in the background.
- **`popup.html`**: The UI skeleton of the dashboard, encompassing the sidebar, item grid, and modals.
- **`popup.css`**: Styling file implementing responsive grid layouts, animations, and dark/light modes.
- **`popup.js`**: The main application logic.
  - **IndexedDB Utility**: Handles all CRUD (Create, Read, Update, Delete) operations for Folders and Items.
  - **UI Updates**: Dynamically renders folders and handles the display configurations for notes and links.
  - **Event Listeners**: Manages drag-and-drop actions, clipboard paste formatting, theme toggling, PIN verifications, and modal processing.

### Database Schema

The database leverages IndexedDB (`PersonalDashboardDB`, version 1).

**Store: `folders`**
- `id` (Auto Increment Integer)
- `name` (String)
- `pin` (String / Null if unlocked)

**Store: `items`**
- `id` (Auto Increment Integer)
- `folderId` (Number / Null for "All Items" root folder)
- `type` (String: `'text'`, `'link'`, `'image'`, `'file'`)
- `content` (String / URL mapping)
- `title` (String strictly for URLs/links)
- `fileName`, `fileType`, `fileSize`, `fileBlob` (Properties specifically for file uploads/images)
- `createdAt` (Date object)

### Local Setup & Development Workflow
1. Make changes to the raw files (`popup.js`, `popup.css`, `background.js`, etc.).
2. Navigate to `chrome://extensions/` and click the curved reload icon on the "Personal Dashboard" extension card to apply the changes.
3. Open the popup, right-click anywhere, and select **Inspect** to view console error logs, network conditions, or to debug issues using the Chrome DevTools. Wait for changes to be applied.
