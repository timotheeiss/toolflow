/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CONTROL_API_URL?: string;
  readonly VITE_DEV_AUTH?: string;
  readonly VITE_DEV_USER_ID?: string;
  readonly VITE_DEV_MEMBERSHIP_ID?: string;
  readonly VITE_DEV_ORGANIZATION_ID?: string;
  readonly VITE_DEV_ROLE?: "admin" | "builder" | "member";
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
