/**
 * Google Drive integration service
 * Primary endpoints:
 * - GET  http://127.0.0.1:8000/api/google-drive/connect/ (Connect Google Drive)
 * - POST http://127.0.0.1:8000/api/google-drive/sync/    (Get folders and files from Google Drive)
 *
 * Auxiliary endpoints:
 * - GET  http://127.0.0.1:8000/api/google-drive/picker/config/
 * - GET  http://127.0.0.1:8000/api/google-drive/picker/token/
 * - GET  http://127.0.0.1:8000/api/google-drive/files/?folder_id=...
 */

const BACKEND_BASE = 'http://127.0.0.1:8000';

export const googleDriveService = {
  // GET http://127.0.0.1:8000/api/google-drive/connect/
  // Initiates Google Drive OAuth authorization flow
  connect() {
    window.location.href = `${BACKEND_BASE}/api/google-drive/connect/`;
  },

  // POST http://127.0.0.1:8000/api/google-drive/sync/
  // Synchronizes and returns the folders and files from Google Drive
  async sync() {
    try {
      const response = await fetch(`${BACKEND_BASE}/api/google-drive/sync/`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || `Sync failed with status ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      // If direct request fails (e.g. CORS), attempt through Vite proxy
      if (error.name === 'TypeError') {
        const fallbackResponse = await fetch('/api/google-drive/sync/', {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
          },
        });
        if (fallbackResponse.ok) {
          return await fallbackResponse.json();
        }
      }
      throw error;
    }
  },

  // Alias for sync()
  syncFiles() {
    return this.sync();
  },

  // Check connection status via picker config
  async checkConnectionStatus() {
    try {
      let response = await fetch('/api/google-drive/picker/config/', {
        credentials: 'include',
      }).catch(() => null);

      if (!response || !response.ok) {
        response = await fetch(`${BACKEND_BASE}/api/google-drive/picker/config/`, {
          credentials: 'include',
        }).catch(() => null);
      }

      if (response && response.ok) {
        const config = await response.json();
        return { isConnected: true, config };
      }
      return { isConnected: false, detail: 'Not connected' };
    } catch (error) {
      return { isConnected: false, isOffline: true, error: error.message };
    }
  },

  // Fetch access token for Google Picker
  async getPickerToken() {
    let response = await fetch('/api/google-drive/picker/token/', {
      credentials: 'include',
    }).catch(() => null);

    if (!response || !response.ok) {
      response = await fetch(`${BACKEND_BASE}/api/google-drive/picker/token/`, {
        credentials: 'include',
      });
    }

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to obtain Google Picker access token.');
    }
    return response.json();
  },

  // Fetch files for specific folders
  async fetchFiles(folderIds = []) {
    const params = new URLSearchParams();
    folderIds.forEach((id) => params.append('folder_id', id));

    let response = await fetch(`/api/google-drive/files/?${params.toString()}`, {
      credentials: 'include',
    }).catch(() => null);

    if (!response || !response.ok) {
      response = await fetch(`${BACKEND_BASE}/api/google-drive/files/?${params.toString()}`, {
        credentials: 'include',
      });
    }

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to fetch files from Google Drive.');
    }

    return response.json();
  },

  // Load Google Picker API script
  loadGoogleApiScript() {
    return new Promise((resolve, reject) => {
      if (window.gapi && window.gapi.load) {
        return resolve(window.gapi);
      }
      const existing = document.getElementById('google-api-script');
      if (existing) {
        existing.addEventListener('load', () => resolve(window.gapi));
        existing.addEventListener('error', reject);
        return;
      }
      const script = document.createElement('script');
      script.id = 'google-api-script';
      script.src = 'https://apis.google.com/js/api.js';
      script.async = true;
      script.onload = () => resolve(window.gapi);
      script.onerror = () => reject(new Error('Failed to load Google API script'));
      document.body.appendChild(script);
    });
  },

  // Open Google Picker modal
  async openPicker({ apiKey, appId, accessToken, onPicked }) {
    await this.loadGoogleApiScript();

    return new Promise((resolve, reject) => {
      window.gapi.load('picker', {
        callback: () => {
          try {
            const view = new window.google.picker.DocsView(window.google.picker.ViewId.FOLDERS)
              .setIncludeFolders(true)
              .setSelectFolderEnabled(true);

            const picker = new window.google.picker.PickerBuilder()
              .setDeveloperKey(apiKey)
              .setAppId(appId)
              .setOAuthToken(accessToken)
              .enableFeature(window.google.picker.Feature.MULTISELECT_ENABLED)
              .addView(view)
              .setCallback((data) => {
                if (data.action === window.google.picker.Action.PICKED) {
                  onPicked(data.docs || []);
                  resolve(data.docs);
                } else if (data.action === window.google.picker.Action.CANCEL) {
                  resolve(null);
                }
              })
              .build();

            picker.setVisible(true);
          } catch (err) {
            reject(err);
          }
        },
      });
    });
  },
};
