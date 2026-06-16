// Server-side Firebase Admin SDK initialization
import * as admin from 'firebase-admin';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

let app: admin.app.App | null = null;
let firestoreDb: admin.firestore.Firestore | null = null;

const loadServiceAccountFromFile = () => {
    const serviceAccountPath =
        process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT_PATH ||
        path.join(process.cwd(), 'firebase-admin-sdk.json');

    if (!existsSync(serviceAccountPath)) {
        return null;
    }

    const raw = readFileSync(serviceAccountPath, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, string>;
    return {
        projectId: parsed.project_id,
        clientEmail: parsed.client_email,
        privateKey: parsed.private_key,
    } as admin.ServiceAccount;
};

const getFirebaseAdminApp = () => {
    if (app) return app;

    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
    const serviceAccountFromEnv =
        projectId && clientEmail && privateKey
            ? {
                  projectId,
                  clientEmail,
                  privateKey,
              }
            : null;

    const serviceAccount = serviceAccountFromEnv || loadServiceAccountFromFile();

    if (!serviceAccount) {
        throw new Error('Missing Firebase Admin credentials');
    }

    if (!admin.apps.length) {
        app = admin.initializeApp({
            credential: admin.credential.cert(serviceAccount as admin.ServiceAccount),
        });
    } else {
        app = admin.app();
    }

    return app;
};

export const getFirestoreAdminDb = () => {
    if (!firestoreDb) {
        firestoreDb = admin.firestore(getFirebaseAdminApp());
    }
    return firestoreDb;
};

export const db = new Proxy({} as admin.firestore.Firestore, {
    get(_target, prop, receiver) {
        const value = Reflect.get(getFirestoreAdminDb(), prop, receiver);
        return typeof value === 'function' ? value.bind(getFirestoreAdminDb()) : value;
    },
});

export default getFirebaseAdminApp;
