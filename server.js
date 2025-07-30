require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const csv = require('csv-parser');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const axios = require('axios');
const FormData = require('form-data');

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
            
            // Structure: Listings/County/City/Development/Development/Address_AgentName_Year[_Unit]
            const path = `${this.uploadPath}/Listings/${sanitizedCounty}/${sanitizedCity}/${sanitizedDevelopment}/${sanitizedDevelopment}/${finalDirectoryName}`;
            
            return path;
            
        } else if (propertyInfo.photoType === 'amenity') {
            const sanitizedCounty = sanitize(propertyInfo.county);
            const sanitizedCity = sanitize(propertyInfo.city);
            const sanitizedDevelopment = sanitize(propertyInfo.development);
            const sanitizedAmenity = sanitize(propertyInfo.amenityDescription);
            
            // For amenities, we'll also include the year
            const finalDirectoryName = `${sanitizedAmenity}_${currentYear}`;
            
            // Structure: Amenities/County/City/Development/AmenityDescription_Year
            return `${this.uploadPath}/Amenities/${sanitizedCounty}/${sanitizedCity}/${sanitizedDevelopment}/${finalDirectoryName}`;
        }
        
        throw new Error('Invalid photo type');
    }
}

const synologyAPI = new SynologyAPI();

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

        // Build the target directory path
        const targetPath = synologyAPI.buildPropertyPath(propertyInfo);
        console.log(`🏠 Target directory: ${targetPath}`);

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

        res.json({
            photographer: photographer.name,
            property: {
                ...propertyInfo,
                targetPath
            },
            uploads: uploadResults,
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

app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📁 Upload destination: ${process.env.UPLOAD_PATH}`);
    console.log(`🔗 Synology NAS: ${process.env.DSM_URL}`);
});
