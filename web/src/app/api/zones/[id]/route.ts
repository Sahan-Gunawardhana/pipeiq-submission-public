import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/firestore-admin';

interface RouteParams {
    params: Promise<{
        id: string;
    }>;
}

/**
 * PATCH /api/zones/[id]
 * Update a zone by ID
 */
export async function PATCH(
    req: NextRequest,
    { params }: RouteParams
) {
    try {
        const { id } = await params;
        const body = await req.json();

        await db.collection('zones').doc(id).update({
            ...body,
            updatedAt: new Date().toISOString(),
        });

        return NextResponse.json({ success: true, data: { id, ...body } });
    } catch (error) {
        console.error('Error updating zone:', error);
        return NextResponse.json(
            { success: false, error: 'Failed to update zone' },
            { status: 500 }
        );
    }
}

/**
 * DELETE /api/zones/[id]
 * Delete a zone by ID
 */
export async function DELETE(
    req: NextRequest,
    { params }: RouteParams
) {
    try {
        const { id } = await params;

        await db.collection('zones').doc(id).delete();

        return NextResponse.json({ success: true, data: { id } });
    } catch (error) {
        console.error('Error deleting zone:', error);
        return NextResponse.json(
            { success: false, error: 'Failed to delete zone' },
            { status: 500 }
        );
    }
}
