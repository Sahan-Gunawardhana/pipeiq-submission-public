const DEFAULT_BACKEND_API_BASE = "http://localhost:4000";

export const BACKEND_API_BASE = (
  process.env.NEXT_PUBLIC_BACKEND_API_BASE || DEFAULT_BACKEND_API_BASE
).replace(/\/$/, "");

export const backendApiUrl = (path: string) => {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${BACKEND_API_BASE}${normalizedPath}`;
};
