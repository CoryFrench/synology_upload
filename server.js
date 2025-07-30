require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const csv = require('csv-parser');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const axios = require('axios');
const FormData = require('form-data');
const { Client } = require('ssh2');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Create necessary directories
const agreementsDir = './agreements';
const uploadsDir = './uploads';

if (!fs.existsSync(agreementsDir)) {
    fs.mkdirSync(agreementsDir, { recursive: true });
}

if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        if (file.fieldname === 'agreement') {
            cb(null, agreementsDir);
        } else {
            cb(null, uploadsDir);
        }
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + '-' + file.originalname);
    }
});

const upload = multer({ 
    storage: storage,
    fileFilter: function (req, file, cb) {
        if (file.fieldname === 'agreement' && file.mimetype !== 'application/pdf') {
            return cb(new Error('Agreement must be a PDF file'), false);
        }
        cb(null, true);
    }
});

// CSV file for photographers database
const photographersCSV = './photographers.csv';

// Initialize CSV file if it doesn't exist
if (!fs.existsSync(photographersCSV)) {
    const csvWriter = createCsvWriter({
        path: photographersCSV,
        header: [
            { id: 'id', title: 'ID' },
            { id: 'name', title: 'Name' },
            { id: 'agreementFile', title: 'Agreement File' },
            { id: 'dateAdded', title: 'Date Added' }
        ]
    });

    const defaultPhotographers = [
        { id: 1, name: 'Studio Alpha Photography', agreementFile: 'default-agreement-1.pdf', dateAdded: new Date().toISOString() },
        { id: 2, name: 'Nature Lens Co.', agreementFile: 'default-agreement-2.pdf', dateAdded: new Date().toISOString() },
        { id: 3, name: 'Portrait Pro Studios', agreementFile: 'default-agreement-3.pdf', dateAdded: new Date().toISOString() }
    ];

    csvWriter.writeRecords(defaultPhotographers);
}

// Synology API functions
class SynologyAPI {
    constructor() {
        this.baseUrl = process.env.DSM_URL;
        this.username = process.env.SYNOLOGY_USERNAME;
        this.password = process.env.SYNOLOGY_PASSWORD;
        this.uploadPath = process.env.UPLOAD_PATH;
        this.sid = null;
    }

    async login() {
        try {
            console.log('🔐 Logging in to Synology...');
            console.log(`🔗 Connecting to: ${this.baseUrl}`);
            console.log(`👤 Username: ${this.username}`);
            
            const response = await axios.get(`${this.baseUrl}/webapi/auth.cgi`, {
                params: {
                    api: 'SYNO.API.Auth',
                    version: '6',
                    method: 'login',
                    account: this.username,
                    passwd: this.password,
                    session: 'FileStation',
                    format: 'sid'
                },
                httpsAgent: new (require('https')).Agent({
                    rejectUnauthorized: false
                }),
                timeout: 10000
            });

            console.log(`📡 Response Status: ${response.status}`);
            console.log(`📋 Response Data:`, JSON.stringify(response.data, null, 2));

            if (response.data && response.data.success) {
                this.sid = response.data.data.sid;
                console.log(`✅ Login successful. SID: ${this.sid}`);
                return this.sid;
            } else {
                const errorMsg = response.data.error ? 
                    `Code: ${response.data.error.code}` : 
                    'Unknown error';
                throw new Error(`Login failed: ${errorMsg}. Full response: ${JSON.stringify(response.data)}`);
            }
        } catch (error) {
            if (error.response) {
                console.error('❌ HTTP Error Response:', error.response.status, error.response.data);
            }
            console.error('❌ Login error:', error.message);
            throw error;
        }
    }

    async uploadFile(filePath, originalName, targetPath) {
        try {
            if (!this.sid) {
                await this.login();
            }

            const fullUploadPath = targetPath || this.uploadPath;
            console.log(`📤 Uploading '${originalName}' to '${fullUploadPath}'...`);

            const formData = new FormData();
            formData.append('api', 'SYNO.FileStation.Upload');
            formData.append('version', '2');
            formData.append('method', 'upload');
            formData.append('path', fullUploadPath);
            formData.append('create_parents', 'true');
            formData.append('overwrite', 'true');
            formData.append('file', fs.createReadStream(filePath), {
                filename: originalName,
                contentType: 'application/octet-stream'
            });

            const response = await axios.post(`${this.baseUrl}/webapi/entry.cgi`, formData, {
                params: {
                    _sid: this.sid
                },
                headers: {
                    ...formData.getHeaders()
                },
                httpsAgent: new (require('https')).Agent({
                    rejectUnauthorized: false
                }),
                timeout: 60000
            });

            console.log(`[UPLOAD] Status Code: ${response.status}`);
            console.log(`[UPLOAD] Response:`, JSON.stringify(response.data, null, 2));
            
            if (response.data && response.data.success) {
                console.log('✅ Upload completed successfully.');
                return { success: true, data: response.data };
            } else {
                console.log('❌ Upload failed:', response.data);
                return { success: false, error: response.data };
            }
        } catch (error) {
            if (error.response) {
                console.error('❌ Upload HTTP Error:', error.response.status, error.response.data);
            }
            console.error('❌ Upload error:', error.message);
            throw error;
        }
    }

    // Helper function to create directory structure
    buildPropertyPath(propertyInfo) {
        // Sanitize directory names (replace spaces and special characters)
        const sanitize = (str) => str ? str.replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_') : '';
        
        const currentYear = new Date().getFullYear();
        
        if (propertyInfo.photoType === 'property') {
            const sanitizedCounty = sanitize(propertyInfo.county);
            const sanitizedCity = sanitize(propertyInfo.city);
            const sanitizedDevelopment = sanitize(propertyInfo.development);
            const sanitizedSubdivision = sanitize(propertyInfo.subdivision);
            const sanitizedAgent = sanitize(propertyInfo.agent);
            
            // Build address from components
            const addressParts = [
                propertyInfo.streetNumber,
                propertyInfo.streetName,
                propertyInfo.streetSuffix
            ].filter(part => part && part.trim()).join('_');
            
            const sanitizedAddress = sanitize(addressParts);
            const sanitizedUnit = sanitize(propertyInfo.unitNumber);
            
            // Build final directory name: Address_AgentName_Year[_Unit]
            let finalDirectoryName = `${sanitizedAddress}_${sanitizedAgent}_${currentYear}`;
            if (sanitizedUnit) {
                finalDirectoryName += `_${sanitizedUnit}`;
            }
            
            // Structure: Listings/County/City/Development/Development/Address_AgentName_Year[_Unit]/Originals_v#
            const basePath = `${this.uploadPath}/Listings/${sanitizedCounty}/${sanitizedCity}/${sanitizedDevelopment}/${sanitizedDevelopment}/${finalDirectoryName}`;
            
            return basePath;
            
        } else if (propertyInfo.photoType === 'amenity') {
            const sanitizedCounty = sanitize(propertyInfo.county);
            const sanitizedCity = sanitize(propertyInfo.city);
            const sanitizedDevelopment = sanitize(propertyInfo.development);
            const sanitizedAmenity = sanitize(propertyInfo.amenityDescription);
            
            // For amenities, we'll also include the year
            const finalDirectoryName = `${sanitizedAmenity}_${currentYear}`;
            
            // Structure: Amenities/County/City/Development/AmenityDescription_Year/Originals_v#
            const basePath = `${this.uploadPath}/Amenities/${sanitizedCounty}/${sanitizedCity}/${sanitizedDevelopment}/${finalDirectoryName}`;
            
            return basePath;
        }
        
        throw new Error('Invalid photo type');
    }

    // Helper function to determine the next version number for Originals folder
    async determineOriginalsVersion(basePath) {
        try {
            // Convert API path to volume path for SSH commands
            const volumePath = basePath.replace(this.uploadPath, synologySSH.volumePath);
            
            console.log(`🔍 Checking for existing Originals versions in: ${volumePath}`);
            
            // List existing Originals_v# directories
            const listCommand = `find "${volumePath}" -maxdepth 1 -type d -name "Originals_v*" 2>/dev/null | sort -V`;
            
            try {
                const result = await synologySSH.executeCommand(listCommand);
                const existingVersions = result.stdout.trim().split('\n').filter(line => line.trim());
                
                if (existingVersions.length === 0) {
                    console.log(`📁 No existing Originals folders found, starting with v1`);
                    return 1;
                }
                
                // Extract version numbers and find the highest
                const versionNumbers = existingVersions.map(path => {
                    const match = path.match(/Originals_v(\d+)$/);
                    return match ? parseInt(match[1]) : 0;
                }).filter(num => num > 0);
                
                const highestVersion = Math.max(...versionNumbers);
                const nextVersion = highestVersion + 1;
                
                console.log(`📁 Found ${existingVersions.length} existing Originals folders, highest version: v${highestVersion}, next version: v${nextVersion}`);
                return nextVersion;
                
            } catch (findError) {
                // If directory doesn't exist yet or find command fails, start with v1
                console.log(`📁 Directory doesn't exist yet or find failed, starting with v1`);
                return 1;
            }
            
        } catch (error) {
            console.error(`⚠️ Error determining Originals version:`, error.message);
            // Default to v1 if there's any error
            return 1;
        }
    }

    // Helper function to build agent-based symlink path
    buildAgentPath(propertyInfo) {
        const sanitize = (str) => str ? str.replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_') : '';
        const currentYear = new Date().getFullYear();
        
        if (propertyInfo.photoType === 'property') {
            const sanitizedAgent = sanitize(propertyInfo.agent);
            
            // Build address from components
            const addressParts = [
                propertyInfo.streetNumber,
                propertyInfo.streetName,
                propertyInfo.streetSuffix
            ].filter(part => part && part.trim()).join('_');
            
            const sanitizedAddress = sanitize(addressParts);
            const sanitizedUnit = sanitize(propertyInfo.unitNumber);
            
            // Build final directory name: Address_AgentName_Year[_Unit]
            let finalDirectoryName = `${sanitizedAddress}_${sanitizedAgent}_${currentYear}`;
            if (sanitizedUnit) {
                finalDirectoryName += `_${sanitizedUnit}`;
            }
            
            // Agent-based path: Listings/Agent/AgentName/Year/Address_AgentName_Year[_Unit]
            return `${this.uploadPath}/Listings/Agent/${sanitizedAgent}/${currentYear}/${finalDirectoryName}`;
        }
        
        return null; // Only create agent symlinks for properties, not amenities
    }
}

// SSH Client for creating symbolic links
class SynologySSH {
    constructor() {
        this.host = process.env.SSH_HOST;
        this.port = process.env.SSH_PORT || 22;
        this.username = process.env.SSH_USERNAME;
        this.password = process.env.SSH_PASSWORD;
        this.volumePath = process.env.VOLUME_PATH;
    }

    async executeCommand(command) {
        return new Promise((resolve, reject) => {
            const conn = new Client();
            
            conn.on('ready', () => {
                console.log(`🔧 SSH: Executing command: ${command}`);
                
                // Set HOME to /tmp to avoid home directory issues and use absolute paths
                const wrappedCommand = `export HOME=/tmp && cd /tmp && ${command}`;
                
                conn.exec(wrappedCommand, (err, stream) => {
                    if (err) {
                        conn.end();
                        return reject(err);
                    }
                    
                    let stdout = '';
                    let stderr = '';
                    
                    stream.on('close', (code, signal) => {
                        conn.end();
                        if (code === 0) {
                            console.log(`✅ SSH: Command executed successfully`);
                            resolve({ stdout, stderr, code });
                        } else {
                            console.log(`❌ SSH: Command failed with code ${code}`);
                            reject(new Error(`Command failed with code ${code}: ${stderr}`));
                        }
                    }).on('data', (data) => {
                        stdout += data.toString();
                    }).stderr.on('data', (data) => {
                        stderr += data.toString();
                    });
                });
            }).on('error', (err) => {
                reject(err);
            }).connect({
                host: this.host,
                port: this.port,
                username: this.username,
                password: this.password
            });
        });
    }

    async createSymlink(primaryPath, symlinkPath) {
        try {
            // Convert API paths to volume paths
            const primaryVolumePath = primaryPath.replace(process.env.UPLOAD_PATH, this.volumePath);
            const symlinkVolumePath = symlinkPath.replace(process.env.UPLOAD_PATH, this.volumePath);
            
            console.log(`🔗 Creating symlink:`);
            console.log(`   Primary: ${primaryVolumePath}`);
            console.log(`   Symlink: ${symlinkVolumePath}`);
            
            // Create parent directory for symlink
            const symlinkParent = symlinkVolumePath.substring(0, symlinkVolumePath.lastIndexOf('/'));
            await this.executeCommand(`mkdir -p "${symlinkParent}"`);
            
            // Remove existing symlink if it exists
            await this.executeCommand(`rm -f "${symlinkVolumePath}"`);
            
            // Create the symbolic link
            const linkCommand = `ln -s "${primaryVolumePath}" "${symlinkVolumePath}"`;
            await this.executeCommand(linkCommand);
            
            console.log(`✅ Symlink created successfully`);
            return true;
            
        } catch (error) {
            console.error(`❌ Failed to create symlink:`, error.message);
            throw error;
        }
    }

    async checkSynoacltool() {
        try {
            // Check if synoacltool is available at the standard location
            await this.executeCommand('which /usr/syno/bin/synoacltool || ls -la /usr/syno/bin/synoacltool');
            return '/usr/syno/bin/synoacltool';
        } catch (error) {
            // Try alternative locations
            try {
                await this.executeCommand('which synoacltool');
                return 'synoacltool';
            } catch (altError) {
                console.log('🔍 Checking for synoacltool in common locations...');
                const locations = [
                    '/usr/syno/bin/synoacltool',
                    '/usr/bin/synoacltool',
                    '/bin/synoacltool',
                    '/usr/local/bin/synoacltool'
                ];
                
                for (const location of locations) {
                    try {
                        await this.executeCommand(`test -f "${location}" && echo "found"`);
                        console.log(`✅ Found synoacltool at: ${location}`);
                        return location;
                    } catch (e) {
                        // Continue searching
                    }
                }
                
                throw new Error('synoacltool not found in any standard locations. Please check if it is installed on your Synology system.');
            }
        }
    }

    async setFilePermissions(filePath, readOnlyForOthers = true) {
        try {
            // Convert API path to volume path
            const volumePath = filePath.replace(process.env.UPLOAD_PATH, this.volumePath);
            
            console.log(`🔒 Setting permissions for: ${volumePath}`);
            console.log(`📋 Read-only for others: ${readOnlyForOthers}`);
            
            // Check if synoacltool is available
            const synoacltoolPath = await this.checkSynoacltool();
            
            // Step 1: Remove all existing ACLs
            await this.executeCommand(`${synoacltoolPath} -del "${volumePath}"`);
            
            // Step 2: Set archive bit to disable inheritance but allow custom ACLs
            await this.executeCommand(`${synoacltoolPath} -set-archive "${volumePath}" has_ACL`);
            
            // Define users and groups that should have read-only access
            const readOnlyUsers = ['admin'];
            const readOnlyGroups = [
                'administrators',
                'WFPADMIN\\Domain Users', 
                'WFPADMIN\\Domain Admins',
                'WFPADMIN\\Enterprise Admins'
            ];
            
            // Define permission strings
            const readOnlyPermissions = 'r-x---a-R-c--';  // Read-only
            const fullPermissions = 'rwxp--a-R-cC-';      // Read/Write
            
            // Step 3: Add full permissions for wfadmin (your superadmin user)
            console.log(`📝 Adding full permissions for wfadmin...`);
            await this.executeCommand(`${synoacltoolPath} -add "${volumePath}" "user:wfadmin:allow:${fullPermissions}:---"`);
            
            if (readOnlyForOthers) {
                // Step 4: Add read-only permissions for other users
                console.log(`📝 Adding read-only permissions for other users...`);
                for (const user of readOnlyUsers) {
                    await this.executeCommand(`${synoacltoolPath} -add "${volumePath}" "user:${user}:allow:${readOnlyPermissions}:---"`);
                }
                
                // Step 5: Add read-only permissions for groups
                console.log(`📝 Adding read-only permissions for groups...`);
                for (const group of readOnlyGroups) {
                    await this.executeCommand(`${synoacltoolPath} -add "${volumePath}" "group:\\"${group}\\":allow:${readOnlyPermissions}:---"`);
                }
            }
            
            console.log(`✅ Permissions set successfully for ${volumePath}`);
            return true;
            
        } catch (error) {
            console.error(`❌ Failed to set permissions with synoacltool:`, error.message);
            
            // Fallback to standard Unix permissions if synoacltool fails
            console.log(`🔄 Attempting fallback to standard Unix permissions...`);
            try {
                // Convert API path to volume path (in case it wasn't done above due to early error)
                const fallbackVolumePath = filePath.replace(process.env.UPLOAD_PATH, this.volumePath);
                
                // Set file to read-only for group and others, but writable for owner (wfadmin)
                await this.executeCommand(`chmod 644 "${fallbackVolumePath}"`);
                
                // Try to change ownership to wfadmin if possible
                await this.executeCommand(`chown wfadmin "${fallbackVolumePath}" || true`);
                
                console.log(`✅ Fallback permissions set successfully for ${fallbackVolumePath}`);
                return true;
            } catch (fallbackError) {
                console.error(`❌ Fallback permission setting also failed:`, fallbackError.message);
                throw new Error(`Both synoacltool and standard permissions failed: ${error.message}`);
            }
        }
    }

    async setDirectoryPermissions(directoryPath, readOnlyForOthers = true) {
        try {
            // Convert API path to volume path
            const volumePath = directoryPath.replace(process.env.UPLOAD_PATH, this.volumePath);
            
            console.log(`🔒 Setting permissions for all files in directory: ${volumePath}`);
            
            // Find all files in the directory (including subdirectories)
            const findCommand = `find "${volumePath}" -type f`;
            const result = await this.executeCommand(findCommand);
            
            const files = result.stdout.trim().split('\n').filter(file => file.trim());
            
            console.log(`📁 Found ${files.length} files to update permissions`);
            
            // Set permissions on each file
            for (const file of files) {
                if (file.trim()) {
                    // Convert back to API path for the setFilePermissions method
                    const apiPath = file.replace(this.volumePath, process.env.UPLOAD_PATH);
                    await this.setFilePermissions(apiPath, readOnlyForOthers);
                }
            }
            
            console.log(`✅ Directory permissions updated for ${files.length} files`);
            return { success: true, filesUpdated: files.length };
            
        } catch (error) {
            console.error(`❌ Failed to set directory permissions:`, error.message);
            throw error;
        }
    }
}

const synologyAPI = new SynologyAPI();
const synologySSH = new SynologySSH();

// Helper function to read photographers from CSV
function readPhotographers() {
    return new Promise((resolve, reject) => {
        const photographers = [];
        fs.createReadStream(photographersCSV)
            .pipe(csv())
            .on('data', (row) => {
                const normalizedRow = {
                    id: row.ID || row.id,
                    name: row.Name || row.name,
                    agreementFile: row['Agreement File'] || row.agreementFile,
                    dateAdded: row['Date Added'] || row.dateAdded
                };
                photographers.push(normalizedRow);
            })
            .on('end', () => {
                resolve(photographers);
            })
            .on('error', reject);
    });
}

// Helper function to add new photographer
function addPhotographer(name, agreementFile) {
    return new Promise(async (resolve, reject) => {
        try {
            const photographers = await readPhotographers();
            const newId = Math.max(...photographers.map(p => parseInt(p.id) || 0), 0) + 1;
            
            const newPhotographer = {
                id: newId,
                name: name,
                agreementFile: agreementFile,
                dateAdded: new Date().toISOString()
            };

            const csvWriter = createCsvWriter({
                path: photographersCSV,
                header: [
                    { id: 'id', title: 'ID' },
                    { id: 'name', title: 'Name' },
                    { id: 'agreementFile', title: 'Agreement File' },
                    { id: 'dateAdded', title: 'Date Added' }
                ],
                append: true
            });

            await csvWriter.writeRecords([newPhotographer]);
            resolve(newPhotographer);
        } catch (error) {
            reject(error);
        }
    });
}

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Get all photographers
app.get('/api/photographers', async (req, res) => {
    try {
        const photographers = await readPhotographers();
        res.json(photographers);
    } catch (error) {
        console.error('Error reading photographers:', error);
        res.status(500).json({ error: 'Failed to load photographers' });
    }
});

// Add new photographer with agreement
app.post('/api/photographers', upload.single('agreement'), async (req, res) => {
    try {
        const { name } = req.body;
        
        if (!name || !req.file) {
            return res.status(400).json({ error: 'Name and agreement file are required' });
        }

        const newPhotographer = await addPhotographer(name, req.file.filename);
        res.json(newPhotographer);
    } catch (error) {
        console.error('Error adding photographer:', error);
        res.status(500).json({ error: 'Failed to add photographer' });
    }
});

// Upload photos to Synology
app.post('/api/upload', upload.array('photos', 10), async (req, res) => {
    try {
        const { photographerId, photoType } = req.body;
        
        if (!photographerId || !req.files || req.files.length === 0) {
            return res.status(400).json({ error: 'Photographer ID and photo files are required' });
        }

        if (!photoType) {
            return res.status(400).json({ error: 'Photo type is required' });
        }

        const photographers = await readPhotographers();
        const photographer = photographers.find(p => p.id == photographerId);
        
        if (!photographer) {
            return res.status(404).json({ error: 'Photographer not found' });
        }

        // Extract property information based on photo type
        const propertyInfo = { photoType };
        
        if (photoType === 'property') {
            propertyInfo.agent = req.body.agent;
            propertyInfo.county = req.body.county;
            propertyInfo.city = req.body.city;
            propertyInfo.development = req.body.development;
            propertyInfo.subdivision = req.body.subdivision;
            propertyInfo.streetNumber = req.body.streetNumber;
            propertyInfo.streetName = req.body.streetName;
            propertyInfo.streetSuffix = req.body.streetSuffix;
            propertyInfo.unitNumber = req.body.unitNumber;
            
            // Validate required fields for property
            if (!propertyInfo.agent || !propertyInfo.county || !propertyInfo.city || 
                !propertyInfo.development || !propertyInfo.streetNumber || !propertyInfo.streetName) {
                return res.status(400).json({ 
                    error: 'Required property fields: agent, county, city, development, street number, street name' 
                });
            }
        } else if (photoType === 'amenity') {
            propertyInfo.county = req.body.county;
            propertyInfo.city = req.body.city;
            propertyInfo.development = req.body.development;
            propertyInfo.subdivision = req.body.subdivision;
            propertyInfo.amenityDescription = req.body.amenityDescription;
            
            // Validate required fields for amenity
            if (!propertyInfo.county || !propertyInfo.amenityDescription) {
                return res.status(400).json({ 
                    error: 'Required amenity fields: county, amenity description' 
                });
            }
        }

        // Build the base property path
        const basePath = synologyAPI.buildPropertyPath(propertyInfo);
        
        // Determine the next Originals version number
        const originalsVersion = await synologyAPI.determineOriginalsVersion(basePath);
        
        // Build the final target path with Originals_v# folder
        const targetPath = `${basePath}/Originals_v${originalsVersion}`;
        
        console.log(`🏠 Base directory: ${basePath}`);
        console.log(`📁 Upload target: ${targetPath} (version ${originalsVersion})`);

        const uploadResults = [];
        
        for (const file of req.files) {
            try {
                const result = await synologyAPI.uploadFile(file.path, file.originalname, targetPath);
                uploadResults.push({
                    filename: file.originalname,
                    success: result.success,
                    error: result.error || null
                });
                
                // Clean up local file after upload
                fs.unlinkSync(file.path);
            } catch (error) {
                uploadResults.push({
                    filename: file.originalname,
                    success: false,
                    error: error.message
                });
            }
        }

        // Set read-only permissions for each successfully uploaded file (except for wfadmin)
        let permissionResult = null;
        const successfulUploads = uploadResults.filter(r => r.success);
        if (successfulUploads.length > 0) {
            try {
                console.log(`🔒 Setting read-only permissions for ${successfulUploads.length} uploaded files...`);
                
                const permissionPromises = [];
                for (const uploadResult of successfulUploads) {
                    // Build the full file path: targetPath + "/" + filename
                    const fullFilePath = `${targetPath}/${uploadResult.filename}`;
                    console.log(`📝 Setting permissions for: ${uploadResult.filename}`);
                    
                    // Set permissions on this specific file
                    permissionPromises.push(
                        synologySSH.setFilePermissions(fullFilePath, true).catch(error => {
                            console.error(`⚠️ Failed to set permissions for ${uploadResult.filename}:`, error.message);
                            return { filename: uploadResult.filename, error: error.message };
                        })
                    );
                }
                
                // Wait for all permission operations to complete
                const permissionResults = await Promise.all(permissionPromises);
                const failedPermissions = permissionResults.filter(result => result && result.error);
                
                permissionResult = {
                    success: failedPermissions.length === 0,
                    filesUpdated: successfulUploads.length - failedPermissions.length,
                    totalFiles: successfulUploads.length,
                    failedFiles: failedPermissions,
                    message: failedPermissions.length === 0 
                        ? `Read-only permissions set for ${successfulUploads.length} files. wfadmin has full access.`
                        : `Permissions set for ${successfulUploads.length - failedPermissions.length}/${successfulUploads.length} files. ${failedPermissions.length} failed.`
                };
                
                console.log(`✅ Permissions updated for ${permissionResult.filesUpdated}/${successfulUploads.length} files`);
                
            } catch (error) {
                console.error(`⚠️ Failed to set file permissions:`, error.message);
                permissionResult = {
                    success: false,
                    error: error.message,
                    message: 'Files uploaded successfully but permission setting failed'
                };
            }
        }

        // Create agent-based symlink for property photos (points to base directory, not versioned folder)
        let symlinkResult = null;
        if (propertyInfo.photoType === 'property' && uploadResults.some(r => r.success)) {
            try {
                const agentPath = synologyAPI.buildAgentPath(propertyInfo);
                if (agentPath) {
                    // Symlink should point to the base property directory, not the specific Originals_v# folder
                    await synologySSH.createSymlink(basePath, agentPath);
                    symlinkResult = {
                        success: true,
                        agentPath: agentPath
                    };
                    console.log(`🔗 Agent symlink created: ${agentPath} -> ${basePath}`);
                }
            } catch (error) {
                console.error(`⚠️ Failed to create agent symlink:`, error.message);
                symlinkResult = {
                    success: false,
                    error: error.message
                };
            }
        }

        res.json({
            photographer: photographer.name,
            property: {
                ...propertyInfo,
                basePath,
                targetPath,
                originalsVersion
            },
            uploads: uploadResults,
            permissions: permissionResult,
            symlink: symlinkResult,
            totalFiles: req.files.length,
            successfulUploads: uploadResults.filter(r => r.success).length
        });

    } catch (error) {
        console.error('Error uploading photos:', error);
        res.status(500).json({ error: 'Failed to upload photos' });
    }
});

// Serve agreement files
app.get('/agreements/:filename', (req, res) => {
    const filename = req.params.filename;
    const filepath = path.join(__dirname, 'agreements', filename);
    
    if (fs.existsSync(filepath)) {
        res.sendFile(filepath);
    } else {
        res.status(404).json({ error: 'Agreement file not found' });
    }
});

// Test Synology connection
app.get('/api/test-synology', async (req, res) => {
    try {
        await synologyAPI.login();
        res.json({ success: true, message: 'Successfully connected to Synology NAS' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Test SSH connection
app.get('/api/test-ssh', async (req, res) => {
    try {
        const result = await synologySSH.executeCommand('whoami && pwd');
        res.json({ 
            success: true, 
            message: 'Successfully connected via SSH',
            output: result.stdout.trim()
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Test synoacltool availability
app.get('/api/test-synoacltool', async (req, res) => {
    try {
        console.log('🔍 Testing synoacltool availability...');
        const synoacltoolPath = await synologySSH.checkSynoacltool();
        
        // Test basic synoacltool functionality
        const testResult = await synologySSH.executeCommand(`${synoacltoolPath} --help || ${synoacltoolPath} -h`);
        
        res.json({ 
            success: true, 
            message: 'synoacltool is available and working',
            path: synoacltoolPath,
            helpOutput: testResult.stdout.substring(0, 500) // First 500 chars of help
        });
    } catch (error) {
        console.error('synoacltool test error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message,
            suggestion: 'Make sure synoacltool is installed. You may need to install it via Package Center or enable Advanced Mode in DSM.'
        });
    }
});

// Test permission setting
app.post('/api/test-permissions', async (req, res) => {
    try {
        const { filePath, readOnlyForOthers = true } = req.body;
        
        if (!filePath) {
            return res.status(400).json({ error: 'filePath is required' });
        }
        
        console.log(`🧪 Testing permissions for: ${filePath}`);
        
        // Check if it's a file or directory
        const volumePath = filePath.replace(process.env.UPLOAD_PATH, synologySSH.volumePath);
        const checkResult = await synologySSH.executeCommand(`test -f "${volumePath}" && echo "file" || test -d "${volumePath}" && echo "directory" || echo "not_found"`);
        const type = checkResult.stdout.trim();
        
        if (type === 'not_found') {
            return res.status(404).json({ error: 'File or directory not found' });
        }
        
        let result;
        if (type === 'file') {
            await synologySSH.setFilePermissions(filePath, readOnlyForOthers);
            result = { success: true, type: 'file', message: 'File permissions updated successfully' };
        } else {
            const dirResult = await synologySSH.setDirectoryPermissions(filePath, readOnlyForOthers);
            result = { 
                success: true, 
                type: 'directory', 
                filesUpdated: dirResult.filesUpdated,
                message: `Directory permissions updated for ${dirResult.filesUpdated} files`
            };
        }
        
        res.json(result);
    } catch (error) {
        console.error('Permission test error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📁 Upload destination: ${process.env.UPLOAD_PATH}`);
    console.log(`🔗 Synology NAS: ${process.env.DSM_URL}`);
});
