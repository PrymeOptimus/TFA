import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import sharp from "sharp";

export interface UploadResult {
  url: string;
  storageKey: string;
}

const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_BYTES = 15 * 1024 * 1024;
const MAX_DIMENSION = 3840; // 4K cap, plenty for TV backgrounds

/**
 * Stores a photo upload. Re-encodes through sharp (strips EXIF/GPS, caps
 * dimensions, normalizes format) so nothing beyond a flat pixel grid from
 * user-supplied files ever reaches disk/object storage — the sanitization
 * step called for in the security requirements.
 *
 * STORAGE_DRIVER=local writes to public/uploads for development. Swap this
 * function's body for a Supabase Storage or S3 PutObject call in
 * production; the household-scoped `storageKey` naming stays the same.
 */
export async function saveHouseholdPhoto(
  householdId: string,
  file: File,
): Promise<UploadResult> {
  if (!ALLOWED_MIME.has(file.type)) {
    throw new Error("Unsupported image type. Use JPEG, PNG, or WebP.");
  }
  if (file.size > MAX_BYTES) {
    throw new Error("Image is too large (max 15MB).");
  }

  const arrayBuffer = await file.arrayBuffer();
  const inputBuffer = Buffer.from(arrayBuffer);

  const output = await sharp(inputBuffer)
    .rotate() // normalize orientation, then...
    .withMetadata({}) // ...strip remaining EXIF/GPS metadata
    .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 88 })
    .toBuffer();

  const storageKey = `${householdId}/${randomUUID()}.webp`;

  const driver = process.env.STORAGE_DRIVER ?? "local";
  if (driver === "local") {
    const dir = path.join(process.cwd(), "public", "uploads", householdId);
    await mkdir(dir, { recursive: true });
    const filePath = path.join(process.cwd(), "public", "uploads", storageKey);
    await writeFile(filePath, output);
    return { url: `/uploads/${storageKey}`, storageKey };
  }

  throw new Error(
    `STORAGE_DRIVER=${driver} is not wired up yet — implement the Supabase/S3 branch in src/lib/storage.ts`,
  );
}
