// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getFirestore, collection, addDoc, setDoc, doc, getDocs, deleteDoc, query, where, onSnapshot } from "firebase/firestore";
// import { getAnalytics } from "firebase/analytics";

// Your web app's Firebase configuration
const firebaseConfig = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
// const analytics = getAnalytics(app);

const sanitizeFirestoreData = (value: any): any => {
    if (value === undefined) return null;
    if (value === null) return null;
    if (Array.isArray(value)) {
        return value.map((item) => sanitizeFirestoreData(item));
    }
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : null;
    }
    if (typeof value === 'object') {
        const output: Record<string, any> = {};
        Object.entries(value).forEach(([key, item]) => {
            if (item === undefined) return;
            output[key] = sanitizeFirestoreData(item);
        });
        return output;
    }
    return value;
};

const pickDefined = (value: Record<string, any>) => {
    const out: Record<string, any> = {};
    Object.entries(value).forEach(([key, item]) => {
        if (item !== undefined) out[key] = item;
    });
    return out;
};

const buildPipelineFirestorePayload = (pipelineData: any) => {
    return pickDefined({
        id: pipelineData.id || pipelineData.pipelineId,
        pipelineId: pipelineData.pipelineId || pipelineData.id,
        zoneId: pipelineData.zoneId,
        zone: pipelineData.zone,
        zoneName: pipelineData.zoneName,
        dmaId: pipelineData.dmaId,
        dma_id: pipelineData.dma_id,
        startLocation: pipelineData.startLocation,
        endLocation: pipelineData.endLocation,
        endpointAnchors: pipelineData.endpointAnchors,
        material: pipelineData.material,
        installationYear: pipelineData.installationYear,
        diameter: pipelineData.diameter,
        pipeLengthM: pipelineData.pipeLengthM,
        roadCategory: pipelineData.roadCategory,
        elevationM: pipelineData.elevationM,
        operatingPressure: pipelineData.operatingPressure,
        pastRepairs: pipelineData.pastRepairs,
        repairs: pipelineData.repairs,
        n_past_repairs: pipelineData.n_past_repairs,
        repair_history: pipelineData.repair_history,
        lastRepairAt: pipelineData.lastRepairAt,
        lastRepairType: pipelineData.lastRepairType,
        soilType: pipelineData.soilType,
        depthM: pipelineData.depthM,
        riskScore: pipelineData.riskScore,
        risk_score: pipelineData.risk_score,
        riskBand: pipelineData.riskBand,
        risk_band: pipelineData.risk_band,
        confidence: pipelineData.confidence,
        confidence_score: pipelineData.confidence_score,
        confidenceBand: pipelineData.confidenceBand,
        confidence_band: pipelineData.confidence_band,
        createdAt: pipelineData.createdAt,
        geometry: pipelineData.geometry ? JSON.stringify(pipelineData.geometry) : null,
        savedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    });
};

/**
 * Save pipeline to Firestore
 */
export const savePipelineToFirestore = async (pipelineData: any) => {
    try {
        console.log('[Firebase] savePipelineToFirestore called with data:', pipelineData);
        
        const pipelineId = pipelineData.id || pipelineData.pipelineId;
        if (!pipelineId) {
            throw new Error('Pipeline ID is required');
        }

        console.log('[Firebase] Pipeline ID:', pipelineId);
        console.log('[Firebase] Database instance:', db);
        console.log('[Firebase] Firestore app config:', { projectId: db?.app?.options?.projectId });

        // Persist only operational pipeline fields; exclude payload/debug blobs.
        const dataToSave = sanitizeFirestoreData(
            buildPipelineFirestorePayload(pipelineData),
        );

        console.log('[Firebase] Data to save (after serialization):', dataToSave);

        const pipelinesRef = collection(db, 'pipelines');
        console.log('[Firebase] Collection reference created');
        
        console.log('[Firebase] Calling setDoc...');
        await setDoc(doc(pipelinesRef, String(pipelineId)), dataToSave);
        
        console.log('[Firebase] setDoc succeeded for pipeline:', pipelineId);
        return { ok: true, pipelineId };
    } catch (error) {
        console.error('[Firebase] Error saving pipeline to Firestore:', error);
        console.error('[Firebase] Error type:', error instanceof Error ? error.constructor.name : typeof error);
        console.error('[Firebase] Error message:', error instanceof Error ? error.message : String(error));
        throw error;
    }
};

/**
 * Save zone to Firestore
 */
export const saveZoneToFirestore = async (zoneData: any) => {
    try {
        const zoneId = zoneData.id || zoneData.zoneId;
        if (!zoneId) {
            throw new Error('Zone ID is required');
        }

        const dataToSave = sanitizeFirestoreData({
            ...zoneData,
            geometry: zoneData.geometry ? JSON.stringify(zoneData.geometry) : null,
            savedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        });

        const zonesRef = collection(db, 'zones');
        await setDoc(doc(zonesRef, String(zoneId)), dataToSave);
        
        return { ok: true, zoneId };
    } catch (error) {
        console.error('[Firebase] Error saving zone to Firestore:', error);
        throw error;
    }
};

/**
 * Delete zone from Firestore
 */
export const deleteZoneFromFirestore = async (zoneId: string) => {
    try {
        if (!zoneId) {
            throw new Error('Zone ID is required');
        }

        const zonesRef = collection(db, 'zones');
        await deleteDoc(doc(zonesRef, String(zoneId)));

        return { ok: true, zoneId };
    } catch (error) {
        console.error('[Firebase] Error deleting zone from Firestore:', error);
        throw error;
    }
};

/**
 * Save marker to Firestore
 */
export const saveMarkerToFirestore = async (markerData: any) => {
    try {
        const markerId = markerData.id || markerData.markerId;
        if (!markerId) {
            throw new Error('Marker ID is required');
        }

        const dataToSave = sanitizeFirestoreData({
            ...markerData,
            savedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        });

        const markersRef = collection(db, 'markers');
        await setDoc(doc(markersRef, String(markerId)), dataToSave);
        
        return { ok: true, markerId };
    } catch (error) {
        console.error('[Firebase] Error saving marker to Firestore:', error);
        throw error;
    }
};

/**
 * Delete marker from Firestore
 */
export const deleteMarkerFromFirestore = async (markerId: string) => {
    try {
        if (!markerId) {
            throw new Error('Marker ID is required');
        }

        const markersRef = collection(db, 'markers');
        await deleteDoc(doc(markersRef, String(markerId)));

        return { ok: true, markerId };
    } catch (error) {
        console.error('[Firebase] Error deleting marker from Firestore:', error);
        throw error;
    }
};

/**
 * Delete pipeline from Firestore
 */
export const deletePipelineFromFirestore = async (pipelineId: string) => {
    try {
        console.log('[Firebase] deletePipelineFromFirestore called with ID:', pipelineId);
        
        if (!pipelineId) {
            throw new Error('Pipeline ID is required');
        }

        const pipelinesRef = collection(db, 'pipelines');
        console.log('[Firebase] Collection reference created for delete');
        
        console.log('[Firebase] Calling deleteDoc...');
        await deleteDoc(doc(pipelinesRef, String(pipelineId)));

        console.log('[Firebase] deleteDoc succeeded for pipeline:', pipelineId);
        return { ok: true, pipelineId };
    } catch (error) {
        console.error('[Firebase] Error deleting pipeline from Firestore:', error);
        console.error('[Firebase] Error type:', error instanceof Error ? error.constructor.name : typeof error);
        console.error('[Firebase] Error message:', error instanceof Error ? error.message : String(error));
        throw error;
    }
};

/**
 * Fetch all pipelines from Firestore
 */
export const fetchPipelinesFromFirestore = async () => {
    try {
        console.log('[Firebase] fetchPipelinesFromFirestore called');
        console.log('[Firebase] Database instance:', db);
        
        const pipelinesRef = collection(db, 'pipelines');
        console.log('[Firebase] Collection reference created for fetch');
        
        console.log('[Firebase] Calling getDocs...');
        const snapshot = await getDocs(pipelinesRef);
        
        console.log('[Firebase] getDocs succeeded, found', snapshot.docs.length, 'documents');
        
        const pipelines = snapshot.docs.map((docRef) => {
            const data = docRef.data();
            
            // Deserialize geometry JSON string back to object
            let geometry = data.geometry;
            if (typeof geometry === 'string') {
                try {
                    geometry = JSON.parse(geometry);
                } catch (_e) {
                    console.warn('[Firebase] Failed to parse geometry for doc', docRef.id);
                    geometry = null;
                }
            }

            return {
                id: docRef.id,
                ...data,
                geometry,
            };
        });

        console.log('[Firebase] Deserialized pipelines:', pipelines);
        return pipelines;
    } catch (error) {
        console.error('[Firebase] Error fetching pipelines from Firestore:', error);
        console.error('[Firebase] Error type:', error instanceof Error ? error.constructor.name : typeof error);
        console.error('[Firebase] Error message:', error instanceof Error ? error.message : String(error));
        throw error;
    }
};

/**
 * Fetch zones from Firestore
 */
export const fetchZonesFromFirestore = async () => {
    try {
        console.log('[Firebase] fetchZonesFromFirestore called');
        
        const zonesRef = collection(db, 'zones');
        const snapshot = await getDocs(zonesRef);
        
        console.log('[Firebase] Found', snapshot.docs.length, 'zones in Firestore');
        
        const zones = snapshot.docs.map((docRef) => {
            const data = docRef.data();
            
            // Deserialize geometry JSON string back to object
            let geometry = data.geometry;
            if (typeof geometry === 'string') {
                try {
                    geometry = JSON.parse(geometry);
                } catch (_e) {
                    console.warn('[Firebase] Failed to parse geometry for zone', docRef.id);
                    geometry = null;
                }
            }
            
            return {
                id: docRef.id,
                ...data,
                geometry,
            };
        });

        console.log('[Firebase] Deserialized zones:', zones);
        return zones;
    } catch (error) {
        console.error('[Firebase] Error fetching zones from Firestore:', error);
        throw error;
    }
};

/**
 * Fetch markers from Firestore
 */
export const fetchMarkersFromFirestore = async () => {
    try {
        console.log('[Firebase] fetchMarkersFromFirestore called');
        
        const markersRef = collection(db, 'markers');
        const snapshot = await getDocs(markersRef);
        
        console.log('[Firebase] Found', snapshot.docs.length, 'markers in Firestore');
        
        const markers = snapshot.docs.map((docRef) => {
            const data = docRef.data();
            return {
                id: docRef.id,
                ...data,
            };
        });

        console.log('[Firebase] Markers from Firestore:', markers);
        return markers;
    } catch (error) {
        console.error('[Firebase] Error fetching markers from Firestore:', error);
        throw error;
    }
};

/**
 * Subscribe to pipelines collection changes.
 */
export const subscribeToPipelines = (onChange: () => void) => {
    const pipelinesRef = collection(db, 'pipelines');
    return onSnapshot(pipelinesRef, () => onChange());
};

/**
 * Subscribe to zones collection changes.
 */
export const subscribeToZones = (onChange: () => void) => {
    const zonesRef = collection(db, 'zones');
    return onSnapshot(zonesRef, () => onChange());
};

/**
 * Subscribe to markers collection changes.
 */
export const subscribeToMarkers = (onChange: () => void) => {
    const markersRef = collection(db, 'markers');
    return onSnapshot(markersRef, () => onChange());
};

export { app, db };
