export interface PipelineProperties {
    id: string;
    zoneId: string;
    material: 'PVC' | 'Cast Iron' | 'Ductile Iron' | 'HDPE';
    diameter: number; // mm
    age: number; // years
    pressure: number; // bar
    leakHistory: number; // count
    riskScore: number; // 0-100
    lastInspected: string; // ISO date
    status: 'Active' | 'Under Maintenance';
}

export interface ZoneProperties {
    id: string;
    name: string;
    color: string;
}

// Helper to generate random coordinate offsets near Colombo center
const CENTER = [79.8612, 6.9271]; // [Lng, Lat]
const SPREAD = 0.02;

const randomCoord = (): [number, number] => [
    CENTER[0] + (Math.random() - 0.5) * SPREAD,
    CENTER[1] + (Math.random() - 0.5) * SPREAD
];

const generatePipelines = (count: number): GeoJSON.FeatureCollection => {
    const features: GeoJSON.Feature[] = [];

    for (let i = 0; i < count; i++) {
        const start = randomCoord();
        const end = [start[0] + (Math.random() - 0.5) * 0.005, start[1] + (Math.random() - 0.5) * 0.005];

        // Correlate attributes for realism
        const age = Math.floor(Math.random() * 50) + 1; // 1-50 years
        const material = age > 30 ? 'Cast Iron' : 'PVC';
        const leakHistory = age > 40 ? Math.floor(Math.random() * 5) : 0;

        // Risk formula simulation
        let riskScore = (age * 1.5) + (leakHistory * 10);
        if (material === 'Cast Iron') riskScore += 10;
        riskScore = Math.min(Math.max(Math.floor(riskScore + (Math.random() * 20)), 0), 100);

        const props: PipelineProperties = {
            id: `P-${1000 + i}`,
            zoneId: i % 3 === 0 ? 'Z-01' : i % 3 === 1 ? 'Z-02' : 'Z-03',
            material,
            diameter: [100, 150, 200, 300][Math.floor(Math.random() * 4)],
            age,
            pressure: parseFloat((2 + Math.random() * 4).toFixed(1)),
            leakHistory,
            riskScore,
            lastInspected: new Date(Date.now() - Math.random() * 10000000000).toISOString().split('T')[0],
            status: Math.random() > 0.95 ? 'Under Maintenance' : 'Active'
        };

        features.push({
            type: "Feature",
            geometry: {
                type: "LineString",
                coordinates: [start, end]
            },
            properties: props
        });
    }

    return {
        type: "FeatureCollection",
        features
    };
};

const generateZones = (): GeoJSON.FeatureCollection => {
    // Simplified triangular zones for demo
    return {
        type: "FeatureCollection",
        features: [
            {
                type: "Feature",
                geometry: {
                    type: "Polygon",
                    coordinates: [[[79.85, 6.92], [79.87, 6.92], [79.86, 6.94], [79.85, 6.92]]]
                },
                properties: { id: 'Z-01', name: 'Colombo North', color: '#3B82F6' }
            },
            {
                type: "Feature",
                geometry: {
                    type: "Polygon",
                    coordinates: [[[79.85, 6.91], [79.87, 6.91], [79.86, 6.92], [79.85, 6.91]]]
                },
                properties: { id: 'Z-02', name: 'Colombo Central', color: '#10B981' }
            },
            {
                type: "Feature",
                geometry: {
                    type: "Polygon",
                    coordinates: [[[79.86, 6.91], [79.88, 6.92], [79.88, 6.90], [79.86, 6.91]]]
                },
                properties: { id: 'Z-03', name: 'Colombo South', color: '#F59E0B' }
            }
        ]
    };
};

// Singleton Data
export const MOCK_PIPELINES = generatePipelines(100);
export const MOCK_ZONES = generateZones();

export const getPipelineStats = () => {
    const features = MOCK_PIPELINES.features as unknown as Array<{ properties: PipelineProperties }>;
    return {
        total: features.length,
        highRisk: features.filter(f => f.properties.riskScore >= 75).length,
        mediumRisk: features.filter(f => f.properties.riskScore >= 40 && f.properties.riskScore < 75).length,
        lowRisk: features.filter(f => f.properties.riskScore < 40).length,
        avgAge: Math.round(features.reduce((acc, curr) => acc + curr.properties.age, 0) / features.length)
    };
};
