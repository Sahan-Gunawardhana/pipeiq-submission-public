// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import {
    getFirestore,
    collection,
    addDoc,
    setDoc,
    doc,
    getDocs,
    runTransaction,
    deleteDoc,
    query,
    where,
    onSnapshot,
    increment,
    serverTimestamp,
    updateDoc,
} from "firebase/firestore";
import { getStorage, ref, uploadBytes, getDownloadURL } from "firebase/storage";

// Your app's Firebase configuration using Expo env variables
const normalizeBucketName = (value?: string) => {
    if (!value) return '';
    return value
        .trim()
        .replace(/^gs:\/\//, '')
        .replace(/\/$/, '');
};

const storageBucketName = normalizeBucketName(process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET);

const firebaseConfig = {
    apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: storageBucketName || undefined,
    messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID
};

export const NEARBY_RADIUS_METERS = 100;

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const storage = storageBucketName
    ? getStorage(app, `gs://${storageBucketName}`)
    : getStorage(app);

const normalizeGeometry = (geometry: unknown) => {
    if (typeof geometry === 'string') {
        try {
            return JSON.parse(geometry);
        } catch (_e) {
            return null;
        }
    }

    return geometry ?? null;
};

const normalizePipelineDocument = (docId: string, data: any) => {
    const geometry = normalizeGeometry(data.geometry);
    const zoneId = data.zoneId || data.zone || data.dma_id || data.dmaId || data.dmaId;
    const predictionStatus = data.predictionStatus === 'pending' ? 'pending' : 'complete';
    const riskScore100 = Number.isFinite(Number(data.riskScore))
        ? Number(data.riskScore)
        : Number.isFinite(Number(data.risk_score))
            ? Math.round(Number(data.risk_score) * 100)
            : predictionStatus === 'pending'
                ? 0
                : 35;
    const riskScore01 = Number.isFinite(Number(data.risk_score)) ? Number(data.risk_score) : undefined;
    const confidenceScore01 = Number.isFinite(Number(data.confidence_score))
        ? Number(data.confidence_score)
        : Number.isFinite(Number(data.confidence))
            ? Number(data.confidence)
            : undefined;
    const confidenceScoreBandSource = Number.isFinite(confidenceScore01) ? confidenceScore01 : undefined;
    const riskBand = data.riskBand || data.risk_band || data.riskLevel || 'Low';
    const confidenceBand = data.confidenceBand || data.confidence_band || 'Low';

    return {
        id: docId,
        ...data,
        zoneId: zoneId || null,
        dmaId: zoneId || null,
        startLocation: data.startLocation || data.startPoint || data.start || '',
        endLocation: data.endLocation || data.endPoint || data.end || '',
        material: data.material || 'Unknown',
        age: Number.isFinite(Number(data.age)) ? Number(data.age) : 0,
        diameter: Number.isFinite(Number(data.diameter)) ? Number(data.diameter) : undefined,
        repairs: Number.isFinite(Number(data.repairs ?? data.pastRepairs))
            ? Number(data.repairs ?? data.pastRepairs)
            : undefined,
        confidence: Number.isFinite(Number(data.confidence)) ? Number(data.confidence) : undefined,
        riskScore: riskScore100,
        riskBand,
        confidenceBand,
        risk_score: riskScore01,
        confidence_score: confidenceScoreBandSource,
        status: data.status || (predictionStatus === 'pending' ? 'Under Maintenance' : 'Active'),
        predictionStatus,
        createdAt: data.createdAt || null,
        geometry,
    };
};

const normalizeZoneDocument = (docId: string, data: any) => {
    const geometry = normalizeGeometry(data.geometry);
    const zoneName = data.zoneName || data.name || data.areaName || `Zone ${docId}`;

    return {
        id: docId,
        ...data,
        zoneName,
        name: zoneName,
        type: data.type || data.areaType || 'Zone',
        priority: data.priority || 'Medium',
        pipeCount: Number.isFinite(Number(data.ownedPipelineCount))
            ? Number(data.ownedPipelineCount)
            : Number.isFinite(Number(data.pipeCount))
                ? Number(data.pipeCount)
                : undefined,
        assetCount: Number.isFinite(Number(data.ownedAssetCount))
            ? Number(data.ownedAssetCount)
            : undefined,
        highRiskPipes: Number.isFinite(Number(data.highRiskPipes))
            ? Number(data.highRiskPipes)
            : undefined,
        avgRisk: Number.isFinite(Number(data.zoneRiskScore))
            ? Number(data.zoneRiskScore)
            : Number.isFinite(Number(data.avgRisk))
                ? Number(data.avgRisk)
                : undefined,
        nrwPercent: Number.isFinite(Number(data.nrwPercent))
            ? Number(data.nrwPercent)
            : undefined,
        color: data.color || data.strokeColor || undefined,
        createdAt: data.createdAt || null,
        geometry,
    };
};

const normalizeMarkerDocument = (docId: string, data: any) => {
    const normalizedGeometry = (() => {
        const existingGeometry = normalizeGeometry(data.geometry);
        if (existingGeometry?.type === 'Point' && Array.isArray(existingGeometry?.coordinates)) {
            return existingGeometry;
        }

        const parseCoordinatePair = (value: any): [number, number] | null => {
            if (Array.isArray(value) && value.length >= 2) {
                const lng = Number(value[0]);
                const lat = Number(value[1]);
                if (Number.isFinite(lng) && Number.isFinite(lat)) {
                    return [lng, lat];
                }
            }

            if (value && typeof value === 'object') {
                const lat = Number(value.lat ?? value.latitude ?? value._lat ?? value.y);
                const lng = Number(value.lng ?? value.longitude ?? value._long ?? value.x);
                if (Number.isFinite(lng) && Number.isFinite(lat)) {
                    return [lng, lat];
                }
            }

            return null;
        };

        const candidate =
            parseCoordinatePair(data.coordinates) ||
            parseCoordinatePair(data.coordinate) ||
            parseCoordinatePair(data.position) ||
            parseCoordinatePair(data.locationCoords) ||
            parseCoordinatePair(data.location);

        if (candidate) {
            return {
                type: 'Point',
                coordinates: candidate,
            };
        }

        const latitude = Number(data.latitude ?? data.lat);
        const longitude = Number(data.longitude ?? data.lng ?? data.lon);
        if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
            return {
                type: 'Point',
                coordinates: [longitude, latitude],
            };
        }

        return null;
    })();

    return {
        id: docId,
        ...data,
        markerId: data.markerId || data.id || docId,
        type: data.type || 'Marker',
        zone: String(data.zoneId || data.zone || 'Unassigned'),
        severity: String(data.severity || data.priority || data.riskLevel || 'Medium'),
        status: String(data.status || data.condition || 'Active'),
        createdAt: data.createdAt || data.created_at || data.timestamp || null,
        location: data.location || data.address || '',
        geometry: normalizedGeometry,
    };
};

const normalizeSingleDocument = (collectionName: string, docId: string, data: any) => {
    if (collectionName === 'pipelines') {
        return normalizePipelineDocument(docId, data);
    }

    if (collectionName === 'zones') {
        return normalizeZoneDocument(docId, data);
    }

    if (collectionName === 'markers') {
        return normalizeMarkerDocument(docId, data);
    }

    return { id: docId, ...data };
};

const toFiniteNumber = (value: unknown): number | null => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
};

const parseLngLatPair = (value: unknown): [number, number] | null => {
    if (!Array.isArray(value) || value.length < 2) {
        return null;
    }

    const longitude = toFiniteNumber(value[0]);
    const latitude = toFiniteNumber(value[1]);
    if (longitude === null || latitude === null) {
        return null;
    }

    return [longitude, latitude];
};

const pointToSegmentDistanceMeters = (
    pointLat: number,
    pointLng: number,
    startLat: number,
    startLng: number,
    endLat: number,
    endLng: number
) => {
    const meanLatRad = ((pointLat + startLat + endLat) / 3) * (Math.PI / 180);
    const metersPerDegreeLat = 111320;
    const metersPerDegreeLng = 111320 * Math.cos(meanLatRad);

    const px = pointLng * metersPerDegreeLng;
    const py = pointLat * metersPerDegreeLat;
    const ax = startLng * metersPerDegreeLng;
    const ay = startLat * metersPerDegreeLat;
    const bx = endLng * metersPerDegreeLng;
    const by = endLat * metersPerDegreeLat;

    const abx = bx - ax;
    const aby = by - ay;
    const abLengthSquared = abx * abx + aby * aby;
    if (abLengthSquared === 0) {
        return Math.hypot(px - ax, py - ay);
    }

    const t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / abLengthSquared));
    const closestX = ax + t * abx;
    const closestY = ay + t * aby;

    return Math.hypot(px - closestX, py - closestY);
};

const getPipelineDistanceMeters = (
    pipeline: any,
    latitude: number,
    longitude: number
): number | null => {
    let minDistance: number | null = null;
    const setMinDistance = (distance: number | null) => {
        if (!Number.isFinite(distance ?? NaN)) {
            return;
        }

        if (minDistance === null || (distance as number) < minDistance) {
            minDistance = distance as number;
        }
    };

    const directLatitude = toFiniteNumber(pipeline.latitude ?? pipeline.lat);
    const directLongitude = toFiniteNumber(pipeline.longitude ?? pipeline.lng ?? pipeline.lon);
    if (directLatitude !== null && directLongitude !== null) {
        setMinDistance(distanceInMeters(latitude, longitude, directLatitude, directLongitude));
    }

    const geometry = normalizeGeometry(pipeline.geometry);
    if (geometry?.type === 'Point') {
        const pointPair = parseLngLatPair(geometry.coordinates);
        if (pointPair) {
            setMinDistance(distanceInMeters(latitude, longitude, pointPair[1], pointPair[0]));
        }
    }

    const lineSets: [number, number][][] = [];
    if (geometry?.type === 'LineString' && Array.isArray(geometry.coordinates)) {
        const lineCoords = geometry.coordinates
            .map((coord: unknown) => parseLngLatPair(coord))
            .filter((coord: [number, number] | null): coord is [number, number] => !!coord);
        if (lineCoords.length) {
            lineSets.push(lineCoords);
        }
    }

    if (geometry?.type === 'MultiLineString' && Array.isArray(geometry.coordinates)) {
        for (const line of geometry.coordinates) {
            if (!Array.isArray(line)) {
                continue;
            }

            const lineCoords = line
                .map((coord: unknown) => parseLngLatPair(coord))
                .filter((coord: [number, number] | null): coord is [number, number] => !!coord);
            if (lineCoords.length) {
                lineSets.push(lineCoords);
            }
        }
    }

    for (const lineCoords of lineSets) {
        if (lineCoords.length === 1) {
            const [lineLng, lineLat] = lineCoords[0];
            setMinDistance(distanceInMeters(latitude, longitude, lineLat, lineLng));
            continue;
        }

        for (let index = 0; index < lineCoords.length - 1; index += 1) {
            const [startLng, startLat] = lineCoords[index];
            const [endLng, endLat] = lineCoords[index + 1];
            const segmentDistance = pointToSegmentDistanceMeters(
                latitude,
                longitude,
                startLat,
                startLng,
                endLat,
                endLng
            );
            setMinDistance(segmentDistance);
        }
    }

    return minDistance;
};

const distanceInMeters = (
    fromLatitude: number,
    fromLongitude: number,
    toLatitude: number,
    toLongitude: number
) => {
    const toRad = (degrees: number) => (degrees * Math.PI) / 180;
    const earthRadiusMeters = 6371000;
    const latDiff = toRad(toLatitude - fromLatitude);
    const lonDiff = toRad(toLongitude - fromLongitude);
    const a =
        Math.sin(latDiff / 2) ** 2 +
        Math.cos(toRad(fromLatitude)) * Math.cos(toRad(toLatitude)) * Math.sin(lonDiff / 2) ** 2;

    return 2 * earthRadiusMeters * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

type PipelineMatch = {
    pipelineId: string;
    distanceMeters: number;
};

type NearbyPipelineOption = {
    pipelineId: string;
    distanceMeters: number;
    pipeline: any;
};

type ZoneMatch = {
    zoneId: string;
    zoneName: string;
    distanceMeters: number;
    matchType: 'contains' | 'nearest';
};

type CreateRepairInput = {
    latitude: number;
    longitude: number;
    issueType: string;
    severity: string;
    flowRate: string;
    notes: string;
    depthM?: number;
    repairId?: string;
    imageUrls?: string[];
    pipelineId?: string;
    maxMatchDistanceMeters?: number;
};

const normalizeRiskBand = (value: unknown) => {
    const band = String(value || '').trim().toLowerCase();
    if (band === 'high') return 'High';
    if (band === 'medium') return 'Medium';
    if (band === 'low') return 'Low';
    return 'Unknown';
};

const deriveFeedbackCategory = (riskBand: string) => {
    if (riskBand === 'Low') return 'false_negative';
    if (riskBand === 'Medium') return 'partial_match';
    if (riskBand === 'High') return 'correct_high_risk';
    return 'repair_without_prediction';
};

const getPipelineRiskScore = (pipelineData: any) => {
    if (Number.isFinite(Number(pipelineData?.riskScore))) {
        return Number(pipelineData.riskScore);
    }

    if (Number.isFinite(Number(pipelineData?.risk_score))) {
        return Math.round(Number(pipelineData.risk_score) * 100);
    }

    return null;
};

const getPipelineRiskBand = (pipelineData: any) => {
    const explicitBand = normalizeRiskBand(
        pipelineData?.risk_band || pipelineData?.riskBand || pipelineData?.riskLevel
    );
    if (explicitBand !== 'Unknown') return explicitBand;

    const score = getPipelineRiskScore(pipelineData);
    if (!Number.isFinite(Number(score))) return 'Unknown';
    if (Number(score) >= 75) return 'High';
    if (Number(score) >= 40) return 'Medium';
    return 'Low';
};

const buildPipelineTrainingSnapshot = (pipelineId: string, pipelineData: any) => ({
    pipelineId,
    material: pipelineData?.material ?? null,
    age: Number.isFinite(Number(pipelineData?.age)) ? Number(pipelineData.age) : null,
    diameter: Number.isFinite(Number(pipelineData?.diameter)) ? Number(pipelineData.diameter) : null,
    depthM: Number.isFinite(Number(pipelineData?.depthM ?? pipelineData?.depth_m ?? pipelineData?.depth))
        ? Number(pipelineData.depthM ?? pipelineData.depth_m ?? pipelineData.depth)
        : null,
    pressureBar: Number.isFinite(Number(pipelineData?.pressureBar ?? pipelineData?.pressure_bar))
        ? Number(pipelineData.pressureBar ?? pipelineData.pressure_bar)
        : null,
    zoneId: pipelineData?.zoneId || pipelineData?.zone || pipelineData?.dma_id || null,
    startLocation: pipelineData?.startLocation || pipelineData?.startPoint || null,
    endLocation: pipelineData?.endLocation || pipelineData?.endPoint || null,
    previousRepairs: Number.isFinite(Number(pipelineData?.repairs ?? pipelineData?.pastRepairs ?? pipelineData?.n_past_repairs))
        ? Number(pipelineData.repairs ?? pipelineData.pastRepairs ?? pipelineData.n_past_repairs)
        : null,
});

const buildPredictionSnapshot = (pipelineData: any) => ({
    predictionId: pipelineData?.predictionId || pipelineData?.latestPredictionId || null,
    predictedRiskScore: getPipelineRiskScore(pipelineData),
    predictedRiskScoreRaw: Number.isFinite(Number(pipelineData?.risk_score))
        ? Number(pipelineData.risk_score)
        : null,
    predictedRiskBand: getPipelineRiskBand(pipelineData),
    confidenceScore: Number.isFinite(Number(pipelineData?.confidence_score ?? pipelineData?.confidence))
        ? Number(pipelineData.confidence_score ?? pipelineData.confidence)
        : null,
    confidenceBand: pipelineData?.confidence_band || pipelineData?.confidenceBand || null,
    modelVersion:
        pipelineData?.modelVersion ||
        pipelineData?.model_version ||
        pipelineData?.scorePayload?.modelVersion ||
        pipelineData?.scorePayload?.model_version ||
        null,
    predictionStatus: pipelineData?.predictionStatus || null,
    predictedAt: pipelineData?.predictedAt || pipelineData?.scoredAt || pipelineData?.updatedAt || null,
});

export const findNearbyPipelinesForCoordinates = async (
    latitude: number,
    longitude: number,
    radiusMeters = NEARBY_RADIUS_METERS,
    limit = 12
): Promise<NearbyPipelineOption[]> => {
    const pipelines = await fetchPipelinesFromFirestore();
    const nearby: NearbyPipelineOption[] = [];

    for (const pipeline of pipelines) {
        const distanceMeters = getPipelineDistanceMeters(pipeline, latitude, longitude);
        if (!Number.isFinite(distanceMeters ?? NaN)) {
            continue;
        }

        if ((distanceMeters as number) <= radiusMeters) {
            nearby.push({
                pipelineId: pipeline.id,
                distanceMeters: distanceMeters as number,
                pipeline,
            });
        }
    }

    nearby.sort((a, b) => a.distanceMeters - b.distanceMeters);
    return nearby.slice(0, Math.max(1, limit));
};

const isPointInRing = (
    targetLng: number,
    targetLat: number,
    ring: [number, number][]
) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const xi = ring[i][0];
        const yi = ring[i][1];
        const xj = ring[j][0];
        const yj = ring[j][1];

        const intersects =
            yi > targetLat !== yj > targetLat &&
            targetLng < ((xj - xi) * (targetLat - yi)) / ((yj - yi) || 1e-9) + xi;
        if (intersects) {
            inside = !inside;
        }
    }

    return inside;
};

const zoneContainsPoint = (zone: any, latitude: number, longitude: number) => {
    const geometry = normalizeGeometry(zone.geometry);
    if (!geometry) {
        return false;
    }

    if (geometry.type === 'Polygon' && Array.isArray(geometry.coordinates)) {
        const rings = geometry.coordinates
            .map((ring: unknown) => Array.isArray(ring)
                ? ring
                    .map((coord: unknown) => parseLngLatPair(coord))
                    .filter((coord: [number, number] | null): coord is [number, number] => !!coord)
                : [])
            .filter((ring: [number, number][]) => ring.length >= 3);
        return rings.some((ring: [number, number][]) => isPointInRing(longitude, latitude, ring));
    }

    if (geometry.type === 'MultiPolygon' && Array.isArray(geometry.coordinates)) {
        for (const polygon of geometry.coordinates) {
            if (!Array.isArray(polygon)) {
                continue;
            }

            const rings = polygon
                .map((ring: unknown) => Array.isArray(ring)
                    ? ring
                        .map((coord: unknown) => parseLngLatPair(coord))
                        .filter((coord: [number, number] | null): coord is [number, number] => !!coord)
                    : [])
                .filter((ring: [number, number][]) => ring.length >= 3);
            if (rings.some((ring: [number, number][]) => isPointInRing(longitude, latitude, ring))) {
                return true;
            }
        }
    }

    return false;
};

const getZoneReferencePoints = (zone: any): [number, number][] => {
    const geometry = normalizeGeometry(zone.geometry);
    if (!geometry) {
        return [];
    }

    if (geometry.type === 'Point') {
        const point = parseLngLatPair(geometry.coordinates);
        return point ? [point] : [];
    }

    if (geometry.type === 'Polygon' && Array.isArray(geometry.coordinates)) {
        const points = geometry.coordinates
            .flatMap((ring: unknown) =>
                Array.isArray(ring)
                    ? ring
                        .map((coord: unknown) => parseLngLatPair(coord))
                        .filter((coord: [number, number] | null): coord is [number, number] => !!coord)
                    : []
            );
        return points;
    }

    if (geometry.type === 'MultiPolygon' && Array.isArray(geometry.coordinates)) {
        const points = geometry.coordinates
            .flatMap((polygon: unknown) =>
                Array.isArray(polygon)
                    ? polygon.flatMap((ring: unknown) =>
                        Array.isArray(ring)
                            ? ring
                                .map((coord: unknown) => parseLngLatPair(coord))
                                .filter((coord: [number, number] | null): coord is [number, number] => !!coord)
                            : []
                    )
                    : []
            );
        return points;
    }

    return [];
};

export const findZoneForCoordinates = async (
    latitude: number,
    longitude: number
): Promise<ZoneMatch | null> => {
    const zones = await fetchZonesFromFirestore();

    for (const zone of zones) {
        if (zoneContainsPoint(zone, latitude, longitude)) {
            return {
                zoneId: String(zone.id),
                zoneName: String(zone.zoneName || zone.name || zone.id),
                distanceMeters: 0,
                matchType: 'contains',
            };
        }
    }

    return null;
};

export const findClosestPipelineForCoordinates = async (
    latitude: number,
    longitude: number,
    maxMatchDistanceMeters = 2000
): Promise<PipelineMatch | null> => {
    const pipelines = await fetchPipelinesFromFirestore();
    let closestMatch: PipelineMatch | null = null;

    for (const pipeline of pipelines) {
        const distanceMeters = getPipelineDistanceMeters(pipeline, latitude, longitude);
        if (!Number.isFinite(distanceMeters ?? NaN)) {
            continue;
        }

        if (!closestMatch || (distanceMeters as number) < closestMatch.distanceMeters) {
            closestMatch = {
                pipelineId: pipeline.id,
                distanceMeters: distanceMeters as number,
            };
        }
    }

    if (!closestMatch) {
        return null;
    }

    if (closestMatch.distanceMeters > maxMatchDistanceMeters) {
        return null;
    }

    return closestMatch;
};


/**
 * Upload repair images to Firebase Storage
 * Images are stored at: repairs/{pipelineId}/year={YYYY}/month={MM}/day={DD}/{repairId}/{index}_{fileName}
 * Returns an array of download URLs
 */
export const uploadRepairImages = async ({
    pipelineId,
    repairId,
    imageData,
}: {
    pipelineId: string;
    repairId: string;
    imageData: Array<{ uri: string; fileName: string }>;
}): Promise<string[]> => {
    try {
        const sanitizeSegment = (value: string) =>
            String(value || '')
                .trim()
                .replace(/[^a-zA-Z0-9._-]/g, '_')
                .slice(0, 120);

        const now = new Date();
        const year = String(now.getUTCFullYear());
        const month = String(now.getUTCMonth() + 1).padStart(2, '0');
        const day = String(now.getUTCDate()).padStart(2, '0');
        const safePipelineId = sanitizeSegment(pipelineId);
        const safeRepairId = sanitizeSegment(repairId);

        const downloadUrls: string[] = [];

        for (let i = 0; i < imageData.length; i++) {
            const { uri, fileName } = imageData[i];
            const safeFileName = sanitizeSegment(fileName || `repair-image-${i + 1}.jpg`);

            // Fetch the image as a blob
            const response = await fetch(uri);
            const blob = await response.blob();

            // Create a human-readable file path in storage
            const storagePath = `repairs/${safePipelineId}/year=${year}/month=${month}/day=${day}/${safeRepairId}/${String(i + 1).padStart(2, '0')}_${safeFileName}`;
            const storageRef = ref(storage, storagePath);

            // Upload the blob
            await uploadBytes(storageRef, blob);

            // Get download URL
            const downloadUrl = await getDownloadURL(storageRef);
            downloadUrls.push(downloadUrl);
        }

        return downloadUrls;
    } catch (error) {
        const detailed = error as { code?: string; message?: string; serverResponse?: string; customData?: unknown };
        console.error('[Firebase] Image upload failed:', {
            code: detailed?.code,
            message: detailed?.message,
            serverResponse: detailed?.serverResponse,
            customData: detailed?.customData,
            raw: error,
        });
        throw error;
    }
};

export const addRepairToPipelineFromMobile = async ({
    latitude,
    longitude,
    issueType,
    severity,
    flowRate,
    notes,
    depthM,
    repairId,
    imageUrls = [],
    pipelineId,
    maxMatchDistanceMeters = 2000,
}: CreateRepairInput) => {
    const match = pipelineId
        ? { pipelineId, distanceMeters: 0 }
        : await findClosestPipelineForCoordinates(latitude, longitude, maxMatchDistanceMeters);

    if (!match) {
        throw new Error('No nearby pipeline found for this location.');
    }

    const pipelineRef = doc(db, 'pipelines', match.pipelineId);
    const createdAtMs = Date.now();
    const createdAtIso = new Date(createdAtMs).toISOString();
    const finalRepairId = repairId || `repair_${createdAtMs}_${Math.random().toString(36).slice(2, 8)}`;
    const feedbackRef = doc(collection(db, 'ground_truth_feedback'));
    let feedbackId: string | null = feedbackRef.id;

    const repairDoc = {
        repairId: finalRepairId,
        issueType,
        severity,
        repairType: issueType,
        flowRate,
        waterLoss: flowRate,
        notes,
        depthM: Number.isFinite(Number(depthM)) ? Number(depthM) : null,
        imageUrls: Array.isArray(imageUrls) ? imageUrls : [],
        location: {
            latitude,
            longitude,
        },
        createdAtMs,
        createdAtIso,
        source: 'mobile',
    };

    let wasDuplicate = false;

    await runTransaction(db, async (transaction) => {
        const pipelineSnap = await transaction.get(pipelineRef);
        if (!pipelineSnap.exists()) {
            throw new Error('Pipeline not found.');
        }

        const pipelineData = pipelineSnap.data() || {};
        const existingRepairs = Array.isArray((pipelineData as any).repair_history)
            ? ((pipelineData as any).repair_history as any[])
            : [];

        const alreadyExists = existingRepairs.some(
            (entry) => String(entry?.repairId || '') === finalRepairId
        );

        if (alreadyExists) {
            wasDuplicate = true;
            feedbackId = null;
            return;
        }

        const updatedRepairHistory = [...existingRepairs, repairDoc].slice(-10);

        const pipelineUpdates: Record<string, unknown> = {
            repair_history: updatedRepairHistory,
            repairs: increment(1),
            pastRepairs: increment(1),
            n_past_repairs: increment(1),
            lastRepairAt: serverTimestamp(),
            lastRepairType: issueType,
            updatedAt: serverTimestamp(),
        };

        if (Number.isFinite(Number(depthM))) {
            const nextDepth = Number(depthM);
            // Conflict policy for scalar depth fields: last successful write wins.
            pipelineUpdates.depthM = nextDepth;
            pipelineUpdates.depth_m = nextDepth;
            pipelineUpdates.depth = nextDepth;
        }

        transaction.update(pipelineRef, pipelineUpdates);

        const predictionSnapshot = buildPredictionSnapshot(pipelineData);
        const feedbackCategory = deriveFeedbackCategory(predictionSnapshot.predictedRiskBand);

        transaction.set(feedbackRef, {
            pipelineId: match.pipelineId,
            repairId: finalRepairId,
            predictionId: predictionSnapshot.predictionId,
            actualOutcome: 'repair_logged',
            feedbackCategory,
            predictedRiskBand: predictionSnapshot.predictedRiskBand,
            predictedRiskScore: predictionSnapshot.predictedRiskScore,
            predictedRiskScoreRaw: predictionSnapshot.predictedRiskScoreRaw,
            confidenceScore: predictionSnapshot.confidenceScore,
            confidenceBand: predictionSnapshot.confidenceBand,
            modelVersion: predictionSnapshot.modelVersion,
            predictionStatus: predictionSnapshot.predictionStatus,
            pipelineSnapshot: buildPipelineTrainingSnapshot(match.pipelineId, pipelineData),
            predictionSnapshot,
            repairSnapshot: repairDoc,
            predictedAt: predictionSnapshot.predictedAt,
            repairedAt: createdAtIso,
            createdAtMs,
            createdAtIso,
            createdAt: serverTimestamp(),
            source: 'mobile_repair_log',
        });
    });

    return {
        pipelineId: match.pipelineId,
        repairId: finalRepairId,
        feedbackId,
        distanceMeters: match.distanceMeters,
        wasAutoMatched: !pipelineId,
        wasDuplicate,
    };
};

/**
 * Fetch all pipelines from Firestore
 */
export const fetchPipelinesFromFirestore = async () => {
    try {
        const pipelinesRef = collection(db, 'pipelines');
        const snapshot = await getDocs(pipelinesRef);

        const pipelines = snapshot.docs.map((docRef) => normalizePipelineDocument(docRef.id, docRef.data()));

        return pipelines;
    } catch (error) {
        console.error('[Firebase] Error fetching pipelines from Firestore:', error);
        throw error;
    }
};

/**
 * Fetch zones from Firestore
 */
export const fetchZonesFromFirestore = async () => {
    try {
        const zonesRef = collection(db, 'zones');
        const snapshot = await getDocs(zonesRef);

        const zones = snapshot.docs.map((docRef) => normalizeZoneDocument(docRef.id, docRef.data()));

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
        const markersRef = collection(db, 'markers');
        const snapshot = await getDocs(markersRef);

        const markers = snapshot.docs.map((docRef) => normalizeMarkerDocument(docRef.id, docRef.data()));

        return markers;
    } catch (error) {
        console.error('[Firebase] Error fetching markers from Firestore:', error);
        throw error;
    }
};

/**
 * Subscribe to pipelines collection changes.
 */
export const subscribeToPipelines = (onChange: (pipelines: any[]) => void) => {
    const pipelinesRef = collection(db, 'pipelines');
    return onSnapshot(pipelinesRef, (snapshot) => {
        const pipelines = snapshot.docs.map(docRef => normalizePipelineDocument(docRef.id, docRef.data()));
        onChange(pipelines);
    });
};

/**
 * Subscribe to zones collection changes.
 */
export const subscribeToZones = (onChange: (zones: any[]) => void) => {
    const zonesRef = collection(db, 'zones');
    return onSnapshot(zonesRef, (snapshot) => {
        const zones = snapshot.docs.map(docRef => normalizeZoneDocument(docRef.id, docRef.data()));
        onChange(zones);
    });
};

/**
 * Subscribe to markers collection changes.
 */
export const subscribeToMarkers = (onChange: (markers: any[]) => void) => {
    const markersRef = collection(db, 'markers');
    return onSnapshot(markersRef, (snapshot) => {
        const markers = snapshot.docs.map(docRef => normalizeMarkerDocument(docRef.id, docRef.data()));
        onChange(markers);
    });
};

/**
 * Subscribe to a single Firestore document by collection and id.
 */
export const subscribeToFirestoreDocument = (
    collectionName: string,
    documentId: string,
    onChange: (data: any | null) => void
) => {
    const documentRef = doc(db, collectionName, documentId);
    return onSnapshot(documentRef, (snapshot) => {
        if (!snapshot.exists()) {
            onChange(null);
            return;
        }

        onChange(normalizeSingleDocument(collectionName, snapshot.id, snapshot.data()));
    });
};

export { app, db };
