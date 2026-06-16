# PipeIQ Public Submission

This is a public-repository-safe copy of the project. It contains source code, package files, and the bundled local risk model, but no Firebase keys or service-account secrets.

## Structure

```text
backend/  Local API server and bundled risk prediction model
web/      Next.js web GIS application
mobile/   Expo mobile field application
```

## Configure Environment Files

Web:

```bash
cd web
cp .env.example .env.local
```

Fill in the Firebase values in `web/.env.local`.

For Firebase Admin access, either:

- fill `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, and `FIREBASE_PRIVATE_KEY` in `web/.env.local`, or
- copy `web/firebase-admin-sdk.example.json` to `web/firebase-admin-sdk.json` and fill it with a Firebase service-account JSON.

Mobile:

```bash
cd mobile
cp .env.example .env
```

Fill in the Expo Firebase values in `mobile/.env`.

## Backend

The backend runs locally and starts the bundled Python risk model API.

```bash
cd backend
npm install
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
npm run dev
```

Backend URL:

```text
http://localhost:4000
```

## Web

```bash
cd web
npm install
npm run dev
```

Web URL:

```text
http://localhost:3000
```

## Mobile

```bash
cd mobile
npm install
npx expo start
```

## Notes

- Run the backend before testing web risk prediction.
- Firebase features require valid Firebase credentials and an internet connection.
- The model runs locally from `backend/risk_api`.
