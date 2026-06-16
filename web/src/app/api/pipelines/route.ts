import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/firestore-admin';
import { sanitizePipeline, prettyPrintDocument } from '@/lib/firestore-sanitize';

/**
 * GET /api/pipelines
 * Fetch all pipelines from Firestore
 */
export async function GET(req: NextRequest) {
    try {
        const snapshot = await db.collection('pipelines').get();
        const pipelines = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));
        
        return NextResponse.json({ success: true, data: pipelines });
    } catch (error) {
        console.error('Error fetching pipelines:', error);
        return NextResponse.json(
            { success: false, error: 'Failed to fetch pipelines' },
            { status: 500 }
        );
    }
}

/**
 * POST /api/pipelines
 * Create a new pipeline (for future queue-to-firebase promotion)
 * Sanitizes input to enforce canonical schema.
 */
export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const sanitized = sanitizePipeline(body);
        
        console.log('[API] Storing sanitized pipeline:');
        console.log(prettyPrintDocument(sanitized));
        
        const docRef = await db.collection('pipelines').add(sanitized);

        return NextResponse.json(
            { success: true, data: { ...sanitized, id: docRef.id } },
            { status: 201 }
        );
    } catch (error) {
        console.error('Error creating pipeline:', error);
        return NextResponse.json(
            { success: false, error: 'Failed to create pipeline' },
            { status: 500 }
        );
    }
}
