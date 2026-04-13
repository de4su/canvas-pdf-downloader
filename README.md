# Canvas PDF Downloader

Scan Canvas course pages for PDFs and live-session links, then download PDFs with meaningful filenames.

## Features

- Detects direct file/PDF links on Canvas course pages
- Resolves indirect attachment links (`/modules/items/...`) to real file download URLs
- Detects live-session/recording links during scan
- Saves files to course folders in `Downloads/OPIT/Course_<id>/...`
- Avoids duplicate downloads using local history
- Supports multiple Canvas domains with configurable allowlist

## Install (Chrome or Edge)

1. Open extension management:
   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select this folder:
   - `C:\Users\desu\Desktop\New folder (3)\term 2 only\New folder\opit-pdf-downloader-extension-rebuild`

## Usage

1. Open a Canvas course page (for best results, modules pages)
2. Open extension popup
3. Add your Canvas host in **Allowed Canvas domains** if needed (examples: `canvas.myuni.edu`, `*.instructure.com`)
4. Click **Scan Current Page**
5. Click **Download PDFs From Current Page**

## Notes

- Popup shows clear error text if scanning cannot run
- Auto-download can be toggled in popup
- Double-click the domain list to remove a domain rule
- About button opens the project author's GitHub profile
