import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/firestore-admin';

interface RouteParams {
    params: Promise<{
        id: string;
    }>;
}

/**
 * PATCH /api/markers/[id]
 * Update a marker by ID
 */
export async function PATCH(
    req: NextRequest,
    { params }: RouteParams
) {
    try {
        const { id } = await params;
        const body = await req.json();

        await db.collection('markers').doc(id).update({
            ...body,
            updatedAt: new Date().toISOString(),
        });

        return NextResponse.json({ success: true, data: { id, ...body } });
    } catch (error) {
        console.error('Error updating marker:', error);
        return NextResponse.json(
            { success: false, error: 'Failed to update marker' },
            { status: 500 }
        );
    }
}

/**
 * DELETE /api/markers/[id]
 * Delete a marker by ID
 */
export async function DELETE(
    req: NextRequest,
    { params }: RouteParams
) {
    try {
        const { id } = await params;

        await db.collection('markers').doc(id).delete();

        return NextResponse.json({ success: true, data: { id } });
    } catch (error) {
        console.error('Error deleting marker:', error);
        return NextResponse.json(
            { success: false, error: 'Failed to delete marker' },
            { status: 500 }
        );
    }
}
