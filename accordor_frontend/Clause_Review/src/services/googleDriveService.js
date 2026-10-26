/**
 * Google Drive integration service
 *
 * Backend:
 * https://meetup-commerce-victoria-entry.trycloudflare.com
 *
 * Endpoints:
 * - GET  /api/google-drive/connect/
 * - POST /api/google-drive/sync/
 * - GET  /api/google-drive/picker/config/
 * - GET  /api/google-drive/picker/token/
 * - POST /api/google-drive/files/
 */

const BACKEND_BASE =
  'https://enhanced-cargo-major-pulse.trycloudflare.com';

const GOOGLE_DRIVE_API = `${BACKEND_BASE}/api/google-drive`;

async function parseResponse(response, fallbackMessage) {
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      data.detail ||
      data.error ||
      `${fallbackMessage} (HTTP ${response.status})`
    );
  }

  return data;
}

async function requestJson(path, options = {}, fallbackMessage = 'Request failed') {
  const response = await fetch(`${GOOGLE_DRIVE_API}${path}`, {
    credentials: 'include',
    cache: 'no-store',
    ...options,
  });

  return parseResponse(response, fallbackMessage);
}

export const googleDriveService = {
  /**
   * Start Google Drive OAuth.
   * This is a top-level navigation, not a fetch request.
   */
  connect() {
    window.location.assign(`${GOOGLE_DRIVE_API}/connect/`);
  },

  /**
   * Synchronize Google Drive folders and files.
   */
  async sync() {
    return requestJson(
      '/sync/',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      },
      'Google Drive sync failed'
    );
  },

  /**
   * Alias for sync().
   */
  syncFiles() {
    return this.sync();
  },

  /**
   * Check whether Google Drive is connected and retrieve Picker config.
   */
  async checkConnectionStatus() {
    try {
      const config = await requestJson(
        '/picker/config/',
        {},
        'Failed to check Google Drive connection'
      );

      return {
        isConnected: true,
        config,
      };
    } catch (error) {
      return {
        isConnected: false,
        isOffline: error instanceof TypeError,
        detail: error.message,
        error: error.message,
      };
    }
  },

  /**
   * Obtain an access token for Google Picker.
   */
  async getPickerToken() {
    return requestJson(
      '/picker/token/',
      {},
      'Failed to obtain Google Picker access token'
    );
  },

  /**
   * Fetch files for the selected folders.
   */
  async fetchFiles(
    folderIds = [],
    {
      agreementType = '',
      sectorialCategory = '',
    } = {}
  ) {
    return requestJson(
      '/files/',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          folder_ids: folderIds,
          agreement_type: agreementType,
          sectorial_category: sectorialCategory,
        }),
      },
      'Failed to fetch files from Google Drive'
    );
  },

  /**
   * Load the Google API script.
   */
  loadGoogleApiScript() {
    return new Promise((resolve, reject) => {
      if (window.gapi?.load) {
        resolve(window.gapi);
        return;
      }

      const existing = document.getElementById('google-api-script');

      if (existing) {
        existing.addEventListener(
          'load',
          () => resolve(window.gapi),
          { once: true }
        );

        existing.addEventListener(
          'error',
          () => reject(new Error('Failed to load Google API script')),
          { once: true }
        );

        return;
      }

      const script = document.createElement('script');

      script.id = 'google-api-script';
      script.src = 'https://apis.google.com/js/api.js';
      script.async = true;

      script.onload = () => {
        if (window.gapi?.load) {
          resolve(window.gapi);
        } else {
          reject(new Error('Google API loaded but gapi is unavailable'));
        }
      };

      script.onerror = () => {
        reject(new Error('Failed to load Google API script'));
      };

      document.body.appendChild(script);
    });
  },

  /**
   * Open Google Picker.
   */
  async openPicker({
    apiKey,
    appId,
    accessToken,
    onPicked,
  }) {
    await this.loadGoogleApiScript();

    return new Promise((resolve, reject) => {
      window.gapi.load('picker', {
        callback: () => {
          try {
            const view = new window.google.picker.DocsView(
              window.google.picker.ViewId.FOLDERS
            )
              .setIncludeFolders(true)
              .setSelectFolderEnabled(true);

            const picker = new window.google.picker.PickerBuilder()
              .setDeveloperKey(apiKey)
              .setAppId(appId)
              .setOAuthToken(accessToken)
              .enableFeature(
                window.google.picker.Feature.MULTISELECT_ENABLED
              )
              .addView(view)
              .setCallback((data) => {
                if (
                  data.action ===
                  window.google.picker.Action.PICKED
                ) {
                  const docs = data.docs || [];

                  try {
                    onPicked?.(docs);
                    resolve(docs);
                  } catch (error) {
                    reject(error);
                  }
                } else if (
                  data.action ===
                  window.google.picker.Action.CANCEL
                ) {
                  resolve(null);
                }
              })
              .build();

            picker.setVisible(true);
          } catch (error) {
            reject(error);
          }
        },
      });
    });
  },
};
