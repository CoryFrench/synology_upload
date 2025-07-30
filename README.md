# Synology Upload Server

A Node.js application for uploading photos to a Synology NAS with photographer agreement validation and management.

## Features

- **Photographer Management**: Select from existing photographers or add new ones with agreement validation
- **Synology Integration**: Direct upload to Synology NAS via FileStation API
- **Agreement System**: PDF agreement requirement for new photographers
- **Modern UI**: Clean, responsive interface with photo previews
- **Multi-file Upload**: Support for multiple photo uploads simultaneously
- **Connection Testing**: Built-in Synology NAS connection testing

## Prerequisites

- Node.js (v14 or later)
- npm
- Access to a Synology NAS with FileStation API enabled
- Valid Synology user credentials

## Environment Setup

Create a `.env` file in the root directory with the following variables:

```env
# Synology NAS Configuration
DSM_URL=https://your-synology-ip:5001
USERNAME=your-synology-username
PASSWORD=your-synology-password
UPLOAD_PATH=/your/upload/path

# Server Configuration
PORT=3000
NODE_ENV=development
```

### Required Environment Variables:

- **DSM_URL**: The HTTPS URL of your Synology NAS (e.g., `https://10.0.0.4:5001`)
- **USERNAME**: Synology user account with FileStation access
- **PASSWORD**: Password for the Synology user account
- **UPLOAD_PATH**: Target directory path on the NAS (e.g., `/Legacy Marketing/CoryTest`)
- **PORT**: (Optional) Server port, defaults to 3000
- **NODE_ENV**: (Optional) Environment mode, defaults to development

## Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/CoryFrench/synology_upload.git
   cd synology_upload
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Set up your environment variables in `.env` file

4. Start the server:
   ```bash
   npm start
   ```

   Or for development with auto-restart:
   ```bash
   npm run dev
   ```

5. Open your browser to `http://localhost:3000`

## Usage

1. **Test Connection**: Click "Test Connection" to verify your Synology NAS connection
2. **Select Photographer**: Choose from existing photographers or add a new one
3. **Add New Photographer**: If adding new, provide name and upload a PDF agreement
4. **Upload Photos**: Select multiple image files to upload to your Synology NAS
5. **Review Results**: See detailed upload results for each file

## API Endpoints

- `GET /api/photographers` - Get all photographers
- `POST /api/photographers` - Add new photographer with agreement
- `POST /api/upload` - Upload photos to Synology NAS
- `GET /api/test-synology` - Test Synology connection
- `GET /agreements/:filename` - Serve agreement PDF files

## Project Structure

```
├── server.js              # Main server file
├── package.json           # Dependencies and scripts
├── .env                   # Environment variables (create this)
├── .gitignore            # Git ignore rules
├── README.md             # This file
├── public/               # Static web files
│   ├── index.html        # Main UI
│   ├── styles.css        # Styling
│   └── script.js         # Client-side JavaScript
├── agreements/           # Photographer agreements (auto-created)
├── uploads/              # Temporary upload storage (auto-created)
├── photographers.csv     # Photographer database (auto-created)
└── SAMPLES/              # Sample code and documentation
    ├── File Upload Page Sample/
    └── Synology API Test/
```

## Synology NAS Setup

1. **Enable FileStation API**:
   - Control Panel → Terminal & SNMP → Enable SSH service
   - Control Panel → File Services → Enable FTP service (if needed)

2. **User Permissions**:
   - Create a user account with FileStation access
   - Grant read/write permissions to the target upload directory

3. **SSL Certificate**:
   - The application bypasses SSL verification for self-signed certificates
   - For production, consider using valid SSL certificates

## Security Notes

- The `.env` file contains sensitive credentials and is excluded from Git
- SSL certificate verification is disabled for development
- Ensure proper firewall rules for Synology NAS access
- Use strong passwords for Synology user accounts

## Development

- `npm start` - Start production server
- `npm run dev` - Start development server with auto-restart
- Server runs on port 3000 by default (configurable via PORT environment variable)

## Troubleshooting

1. **Connection Issues**: 
   - Verify Synology NAS IP address and port
   - Check firewall settings
   - Ensure FileStation API is enabled

2. **Upload Failures**:
   - Verify user permissions on target directory
   - Check available disk space on NAS
   - Ensure upload path exists or can be created

3. **Authentication Errors**:
   - Double-check username and password
   - Verify user has FileStation access rights

## Based On

This project combines functionality from:
- File Upload Page Sample: Photo upload UI with photographer management
- Synology API Test: Synology NAS integration and API interaction
