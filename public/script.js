class PhotoUploadApp {
    constructor() {
        this.photographers = [];
        this.selectedPhotographer = null;
        this.selectedFiles = [];
        
        this.init();
    }

    init() {
        this.bindEvents();
        this.loadPhotographers();
    }

    bindEvents() {
        // Test connection
        document.getElementById('test-connection-btn').addEventListener('click', () => this.testConnection());
        
        // Photographer selection
        document.getElementById('photographer-select').addEventListener('change', (e) => this.onPhotographerSelect(e));
        
        // Add new photographer
        document.getElementById('add-new-photographer').addEventListener('click', () => this.showNewPhotographerForm());
        document.getElementById('cancel-add-photographer').addEventListener('click', () => this.hideNewPhotographerForm());
        document.getElementById('add-photographer-form').addEventListener('submit', (e) => this.addNewPhotographer(e));
        
        // View agreement
        document.getElementById('view-agreement').addEventListener('click', () => this.viewAgreement());
        
        // Step navigation
        document.getElementById('proceed-to-upload').addEventListener('click', () => this.goToStep2());
        document.getElementById('back-to-step1').addEventListener('click', () => this.goToStep1());
        
        // File selection
        document.getElementById('photo-files').addEventListener('change', (e) => this.onFileSelect(e));
        
        // Photo upload
        document.getElementById('photo-upload-form').addEventListener('submit', (e) => this.uploadPhotos(e));
        
        // Results actions
        document.getElementById('upload-more').addEventListener('click', () => this.goToStep2());
        document.getElementById('start-over').addEventListener('click', () => this.startOver());
    }

    async loadPhotographers() {
        try {
            const response = await fetch('/api/photographers');
            if (!response.ok) throw new Error('Failed to load photographers');
            
            this.photographers = await response.json();
            this.updatePhotographerSelect();
            
        } catch (error) {
            console.error('Error loading photographers:', error);
            this.showMessage('Failed to load photographers', 'error');
        }
    }

    updatePhotographerSelect() {
        const select = document.getElementById('photographer-select');
        select.innerHTML = '<option value="">Select a photographer...</option>';
        
        this.photographers.forEach(photographer => {
            const option = document.createElement('option');
            option.value = photographer.id;
            option.textContent = photographer.name;
            select.appendChild(option);
        });
    }

    onPhotographerSelect(e) {
        const photographerId = e.target.value;
        
        if (photographerId) {
            this.selectedPhotographer = this.photographers.find(p => p.id == photographerId);
            this.showPhotographerActions();
            document.getElementById('proceed-to-upload').disabled = false;
        } else {
            this.selectedPhotographer = null;
            this.hidePhotographerActions();
            document.getElementById('proceed-to-upload').disabled = true;
        }
    }

    showPhotographerActions() {
        document.getElementById('photographer-actions').classList.remove('hidden');
        document.getElementById('selected-photographer-display').textContent = this.selectedPhotographer.name;
    }

    hidePhotographerActions() {
        document.getElementById('photographer-actions').classList.add('hidden');
    }

    showNewPhotographerForm() {
        document.getElementById('new-photographer-form').classList.remove('hidden');
        document.getElementById('add-new-photographer').style.display = 'none';
    }

    hideNewPhotographerForm() {
        document.getElementById('new-photographer-form').classList.add('hidden');
        document.getElementById('add-new-photographer').style.display = 'inline-block';
        document.getElementById('add-photographer-form').reset();
    }

    async addNewPhotographer(e) {
        e.preventDefault();
        
        const formData = new FormData(e.target);
        
        try {
            this.showMessage('Adding new photographer...', 'info');
            
            const response = await fetch('/api/photographers', {
                method: 'POST',
                body: formData
            });
            
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Failed to add photographer');
            }
            
            const newPhotographer = await response.json();
            this.photographers.push(newPhotographer);
            this.updatePhotographerSelect();
            
            // Select the new photographer
            document.getElementById('photographer-select').value = newPhotographer.id;
            this.selectedPhotographer = newPhotographer;
            
            this.hideNewPhotographerForm();
            this.showPhotographerActions();
            document.getElementById('proceed-to-upload').disabled = false;
            
            this.showMessage('Photographer added successfully!', 'success');
            
        } catch (error) {
            console.error('Error adding photographer:', error);
            this.showMessage(error.message, 'error');
        }
    }

    viewAgreement() {
        if (this.selectedPhotographer && this.selectedPhotographer.agreementFile) {
            const url = `/agreements/${this.selectedPhotographer.agreementFile}`;
            window.open(url, '_blank');
        }
    }

    goToStep1() {
        document.getElementById('step1').classList.remove('hidden');
        document.getElementById('step2').classList.add('hidden');
        document.getElementById('upload-results').classList.add('hidden');
    }

    goToStep2() {
        if (!this.selectedPhotographer) {
            this.showMessage('Please select a photographer first', 'error');
            return;
        }
        
        document.getElementById('step1').classList.add('hidden');
        document.getElementById('step2').classList.remove('hidden');
        document.getElementById('upload-results').classList.add('hidden');
        
        document.getElementById('selected-photographer-name').textContent = this.selectedPhotographer.name;
        document.getElementById('selected-photographer-id').value = this.selectedPhotographer.id;
    }

    onFileSelect(e) {
        const files = Array.from(e.target.files);
        this.selectedFiles = files;
        
        if (files.length > 0) {
            this.showPhotoPreview(files);
        } else {
            this.hidePhotoPreview();
        }
    }

    showPhotoPreview(files) {
        const preview = document.getElementById('photo-preview');
        const grid = document.getElementById('photo-grid');
        
        grid.innerHTML = '';
        
        files.forEach(file => {
            const item = document.createElement('div');
            item.className = 'photo-item';
            
            const img = document.createElement('img');
            img.src = URL.createObjectURL(file);
            img.alt = file.name;
            
            const name = document.createElement('span');
            name.textContent = file.name;
            
            item.appendChild(img);
            item.appendChild(name);
            grid.appendChild(item);
        });
        
        preview.classList.remove('hidden');
    }

    hidePhotoPreview() {
        document.getElementById('photo-preview').classList.add('hidden');
    }

    async uploadPhotos(e) {
        e.preventDefault();
        
        if (this.selectedFiles.length === 0) {
            this.showMessage('Please select photos to upload', 'error');
            return;
        }
        
        const formData = new FormData();
        formData.append('photographerId', this.selectedPhotographer.id);
        
        this.selectedFiles.forEach(file => {
            formData.append('photos', file);
        });
        
        try {
            // Show loading state
            const submitBtn = e.target.querySelector('button[type="submit"]');
            const originalText = submitBtn.textContent;
            submitBtn.innerHTML = '<span class="spinner"></span> Uploading...';
            submitBtn.disabled = true;
            
            this.showMessage('Uploading photos to Synology NAS...', 'info');
            
            const response = await fetch('/api/upload', {
                method: 'POST',
                body: formData
            });
            
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Upload failed');
            }
            
            const result = await response.json();
            this.showUploadResults(result);
            
        } catch (error) {
            console.error('Error uploading photos:', error);
            this.showMessage(error.message, 'error');
            
            // Reset button
            const submitBtn = e.target.querySelector('button[type="submit"]');
            submitBtn.textContent = 'Upload to Synology';
            submitBtn.disabled = false;
        }
    }

    showUploadResults(result) {
        document.getElementById('step2').classList.add('hidden');
        document.getElementById('upload-results').classList.remove('hidden');
        
        const content = document.getElementById('results-content');
        
        const summary = document.createElement('div');
        summary.className = 'upload-summary';
        summary.innerHTML = `
            <h3>Upload Summary</h3>
            <p><strong>Photographer:</strong> ${result.photographer}</p>
            <p><strong>Total Files:</strong> ${result.totalFiles}</p>
            <p><strong>Successful Uploads:</strong> ${result.successfulUploads}</p>
            <p><strong>Failed Uploads:</strong> ${result.totalFiles - result.successfulUploads}</p>
        `;
        
        const details = document.createElement('div');
        details.className = 'upload-details';
        details.innerHTML = '<h4>Upload Details:</h4>';
        
        result.uploads.forEach(upload => {
            const item = document.createElement('div');
            item.className = `upload-item ${upload.success ? 'success' : 'error'}`;
            item.innerHTML = `
                <span>${upload.filename}</span>
                <span class="upload-status ${upload.success ? 'success' : 'error'}">
                    ${upload.success ? '✅ Success' : '❌ Failed'}
                </span>
            `;
            
            if (!upload.success && upload.error) {
                const error = document.createElement('div');
                error.style.fontSize = '12px';
                error.style.color = '#e74c3c';
                error.textContent = upload.error;
                item.appendChild(error);
            }
            
            details.appendChild(item);
        });
        
        content.innerHTML = '';
        content.appendChild(summary);
        content.appendChild(details);
        
        // Reset form
        document.getElementById('photo-upload-form').reset();
        this.selectedFiles = [];
        this.hidePhotoPreview();
        
        // Show success message
        if (result.successfulUploads > 0) {
            this.showMessage(`Successfully uploaded ${result.successfulUploads} photos!`, 'success');
        }
        
        if (result.successfulUploads < result.totalFiles) {
            this.showMessage(`${result.totalFiles - result.successfulUploads} photos failed to upload`, 'error');
        }
    }

    async testConnection() {
        try {
            this.showMessage('Testing Synology connection...', 'info');
            
            const response = await fetch('/api/test-synology');
            const result = await response.json();
            
            if (result.success) {
                this.showMessage('Successfully connected to Synology NAS!', 'success');
            } else {
                this.showMessage(`Connection failed: ${result.error}`, 'error');
            }
            
        } catch (error) {
            console.error('Error testing connection:', error);
            this.showMessage('Failed to test connection', 'error');
        }
    }

    startOver() {
        this.selectedPhotographer = null;
        this.selectedFiles = [];
        
        document.getElementById('photographer-select').value = '';
        document.getElementById('photo-upload-form').reset();
        
        this.hidePhotographerActions();
        this.hidePhotoPreview();
        this.hideNewPhotographerForm();
        
        document.getElementById('proceed-to-upload').disabled = true;
        
        this.goToStep1();
    }

    showMessage(message, type = 'info') {
        const container = document.getElementById('status-messages');
        
        const messageEl = document.createElement('div');
        messageEl.className = `status-message ${type}`;
        messageEl.textContent = message;
        
        container.appendChild(messageEl);
        
        // Auto remove after 5 seconds
        setTimeout(() => {
            if (messageEl.parentNode) {
                messageEl.parentNode.removeChild(messageEl);
            }
        }, 5000);
        
        // Remove on click
        messageEl.addEventListener('click', () => {
            if (messageEl.parentNode) {
                messageEl.parentNode.removeChild(messageEl);
            }
        });
    }
}

// Initialize the app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new PhotoUploadApp();
});
