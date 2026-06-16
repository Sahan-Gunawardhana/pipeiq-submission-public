import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/firestore-admin';

interface RouteParams {
    params: Promise<{
        id: string;
    }>;
}

/**
 * PATCH /api/pipelines/[id]
 * Update a pipeline by ID
 */
export async function PATCH(
    req: NextRequest,
    { params }: RouteParams
) {
    try {
        const { id } = await params;
        const body = await req.json();

        await db.collection('pipelines').doc(id).update({
            ...body,
            updatedAt: new Date().toISOString(),
        });

        return NextResponse.json({ success: true, data: { id, ...body } });
    } catch (error) {
        console.error('Error updating pipeline:', error);
        return NextResponse.json(
            { success: false, error: 'Failed to update pipeline' },
            { status: 500 }
        );
    }
}

/**
 * DELETE /api/pipelines/[id]
 * Delete a pipeline by ID
 */
export async function DELETE(
    req: NextRequest,
    { params }: RouteParams
) {
    try {
        const { id } = await params;

        await db.collection('pipelines').doc(id).delete();

        return NextResponse.json({ success: true, data: { id } });
    } catch (error) {
        console.error('Error deleting pipeline:', error);
        return NextResponse.json(
            { success: false, error: 'Failed to delete pipeline' },
            { status: 500 }
        );
    }
}
