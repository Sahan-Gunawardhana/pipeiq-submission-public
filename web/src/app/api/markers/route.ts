import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/firestore-admin';
import { sanitizeMarker, prettyPrintDocument } from '@/lib/firestore-sanitize';

/**
 * GET /api/markers
 * Fetch all markers from Firestore
 */
export async function GET(req: NextRequest) {
    try {
        const snapshot = await db.collection('markers').get();
        const markers = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));
        
        return NextResponse.json({ success: true, data: markers });
    } catch (error) {
        console.error('Error fetching markers:', error);
        return NextResponse.json(
            { success: false, error: 'Failed to fetch markers' },
            { status: 500 }
        );
    }
}

/**
 * POST /api/markers
 * Create a new marker
 * Sanitizes input to enforce canonical schema.
 */
export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const sanitized = sanitizeMarker(body);
        
        console.log('[API] Storing sanitized marker:');
        console.log(prettyPrintDocument(sanitized));
        
        const docRef = await db.collection('markers').add(sanitized);

        return NextResponse.json(
            { success: true, data: { ...sanitized, id: docRef.id } },
            { status: 201 }
        );
    } catch (error) {
        console.error('Error creating marker:', error);
        return NextResponse.json(
            { success: false, error: 'Failed to create marker' },
            { status: 500 }
        );
    }
}
