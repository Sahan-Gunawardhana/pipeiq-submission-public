/**
 * API Client for frontend
 * Abstracts all HTTP calls to the backend API
 */

interface ApiResponse<T = any> {
    success: boolean;
    data?: T;
    error?: string;
}

const API_BASE = '/api';

/**
 * Fetch all pipelines
 */
export async function fetchPipelines() {
    const res = await fetch(`${API_BASE}/pipelines`);
    if (!res.ok) throw new Error('Failed to fetch pipelines');
    return (await res.json()) as ApiResponse<any[]>;
}

/**
 * Update a pipeline
 */
export async function updatePipeline(id: string, data: any) {
    const res = await fetch(`${API_BASE}/pipelines/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Failed to update pipeline');
    return (await res.json()) as ApiResponse;
}

/**
 * Delete a pipeline
 */
export async function deletePipeline(id: string) {
    const res = await fetch(`${API_BASE}/pipelines/${id}`, {
        method: 'DELETE',
    });
    if (!res.ok) throw new Error('Failed to delete pipeline');
    return (await res.json()) as ApiResponse;
}

/**
 * Fetch all zones
 */
export async function fetchZones() {
    const res = await fetch(`${API_BASE}/zones`);
    if (!res.ok) throw new Error('Failed to fetch zones');
    return (await res.json()) as ApiResponse<any[]>;
}

/**
 * Update a zone
 */
export async function updateZone(id: string, data: any) {
    const res = await fetch(`${API_BASE}/zones/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Failed to update zone');
    return (await res.json()) as ApiResponse;
}

/**
 * Delete a zone
 */
export async function deleteZone(id: string) {
    const res = await fetch(`${API_BASE}/zones/${id}`, {
        method: 'DELETE',
    });
    if (!res.ok) throw new Error('Failed to delete zone');
    return (await res.json()) as ApiResponse;
}

/**
 * Fetch all markers
 */
export async function fetchMarkers() {
    const res = await fetch(`${API_BASE}/markers`);
    if (!res.ok) throw new Error('Failed to fetch markers');
    return (await res.json()) as ApiResponse<any[]>;
}

/**
 * Update a marker
 */
export async function updateMarker(id: string, data: any) {
    const res = await fetch(`${API_BASE}/markers/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Failed to update marker');
    return (await res.json()) as ApiResponse;
}

/**
 * Delete a marker
 */
export async function deleteMarker(id: string) {
    const res = await fetch(`${API_BASE}/markers/${id}`, {
        method: 'DELETE',
    });
    if (!res.ok) throw new Error('Failed to delete marker');
    return (await res.json()) as ApiResponse;
}
