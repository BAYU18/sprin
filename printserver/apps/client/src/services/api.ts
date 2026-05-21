import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';
import log from 'electron-log';

let baseURL = 'http://localhost:3000';

export function setupAPI(serverUrl) {
    baseURL = serverUrl;
}

async function getClientToken() {
    return localStorage.getItem('clientToken');
}

export async function uploadJob(store, job) {
    try {
        const formData = new FormData();
        formData.append('file', fs.createReadStream(job.filePath));
        formData.append('jobName', job.fileName);
        formData.append('fileType', job.fileType);
        formData.append('pages', job.pages.toString());
        formData.append('copies', job.copies.toString());
        formData.append('sourceApp', job.sourceApp);
        formData.append('user', job.user);
        formData.append('hostname', job.hostname);

        const response = await axios.post(`${baseURL}/api/jobs/submit`, formData, {
            headers: {
                ...formData.getHeaders(),
                'Authorization': `Bearer ${store.get('clientToken')}`
            },
            timeout: 60000
        });

        log.info('[API] Job uploaded:', response.data);
        return response.data;
    } catch (error) {
        log.error('[API] Upload failed:', error.message);
        throw error;
    }
}

export async function registerClient(clientData) {
    try {
        const response = await axios.post(`${baseURL}/api/clients/register`, clientData, {
            timeout: 15000
        });

        if (response.data.token) {
            localStorage.setItem('clientToken', response.data.token);
        }

        return response.data;
    } catch (error) {
        log.error('[API] Registration failed:', error.message);
        throw error;
    }
}

export async function sendHeartbeat(store, status) {
    try {
        const clientId = store.get('clientId');
        if (!clientId) {
            log.warn('[API] No clientId, skipping heartbeat');
            return;
        }

        const response = await axios.post(
            `${baseURL}/api/clients/${clientId}/heartbeat`,
            status,
            {
                headers: {
                    'Authorization': `Bearer ${store.get('clientToken')}`
                },
                timeout: 10000
            }
        );

        return response.data;
    } catch (error) {
        log.error('[API] Heartbeat failed:', error.message);
        throw error;
    }
}

export async function checkServerHealth() {
    try {
        const response = await axios.get(`${baseURL}/health`, { timeout: 5000 });
        return response.data.status === 'ok';
    } catch {
        return false;
    }
}

export default {
    setupAPI,
    uploadJob,
    registerClient,
    sendHeartbeat,
    checkServerHealth
};