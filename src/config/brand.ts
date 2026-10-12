/**
 * The brand this build runs under. See `src/config/brand-core.ts` for the
 * variables and their defaults, and `.env.example` for the full list.
 */
import { buildBrand } from "./brand-core";

export const brand = buildBrand(import.meta.env as unknown as Record<string, string | undefined>);
export type { Brand } from "./brand-core";
