import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/firestore-admin';
import { sanitizeZone, prettyPrintDocument } from '@/lib/firestore-sanitize';

/**
 * GET /api/zones
 * Fetch all zones from Firestore
 */
export async function GET(req: NextRequest) {
    try {
        const snapshot = await db.collection('zones').get();
        const zones = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));
        
        return NextResponse.json({ success: true, data: zones });
    } catch (error) {
        console.error('Error fetching zones:', error);
        return NextResponse.json(
            { success: false, error: 'Failed to fetch zones' },
            { status: 500 }
        );
    }
}

/**
 * POST /api/zones
 * Create a new zone
 * Sanitizes input to enforce canonical schema.
 */
export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const sanitized = sanitizeZone(body);
        
        console.log('[API] Storing sanitized zone:');
        console.log(prettyPrintDocument(sanitized));
        
        const docRef = await db.collection('zones').add(sanitized);

        return NextResponse.json(
            { success: true, data: { ...sanitized, id: docRef.id } },
            { status: 201 }
        );
    } catch (error) {
        console.error('Error creating zone:', error);
        return NextResponse.json(
            { success: false, error: 'Failed to create zone' },
            { status: 500 }
        );
    }
}
