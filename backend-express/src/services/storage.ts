// On-disk storage for uploaded files: RDS files go in <UPLOAD_DIR>/rds and cover photos in <UPLOAD_DIR>/cover
// Each stored file is named <dataset_id>_<type>_v<version><extension> (extension lowercased from the original name), so its path can always be rebuilt from its record
// Only the current version of a file is kept on disk; older versions stay in the Files table without a file
import { mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { FileTypes } from "@commons/file.ts";

// Root upload folder; /data/uploads unless UPLOAD_DIR is set
export const UPLOAD_DIR = process.env.UPLOAD_DIR || "/data/uploads";

// Folder for each file type
const TYPE_DIRS: Record<FileTypes, string> = {
    [FileTypes.RDS]: path.join(UPLOAD_DIR, "rds"),
    [FileTypes.COVER]: path.join(UPLOAD_DIR, "cover"),
};

// Incoming uploads land here first (same filesystem as the final folders, so the move is a cheap rename) until they are validated
export const TMP_DIR = path.join(UPLOAD_DIR, "tmp");

// Extensions accepted for each file type
export const ALLOWED_EXTENSIONS: Record<FileTypes, string[]> = {
    [FileTypes.RDS]: [".rds"],
    [FileTypes.COVER]: [".jpg", ".jpeg", ".png", ".webp", ".gif"],
};

// Largest accepted cover photo; RDS files are only bound by the upload limit in middleware/upload.ts
export const MAX_COVER_BYTES = 20 * 1024 * 1024;

/** Lowercased extension of an uploaded file name (including the dot), or "" */
export const extensionOf = (ogName: string) => path.extname(ogName).toLowerCase();

/** Creates the upload folders if they do not exist yet */
export const ensureDirs = async () => {
    await Promise.all([TMP_DIR, ...Object.values(TYPE_DIRS)].map((dir) => mkdir(dir, { recursive: true })));
};

// The parts of a file record that decide where it is stored
type StoredFile = { dataset_id: string; type: FileTypes; version: number; ogName: string };

/** Where this file is (or will be) stored */
export const storedPath = (file: StoredFile) =>
    path.join(TYPE_DIRS[file.type], `${file.dataset_id}_${file.type}_v${file.version}${extensionOf(file.ogName)}`);

/** Moves a validated upload from its temporary location to its final place */
export const store = async (tmpPath: string, file: StoredFile) => {
    await rename(tmpPath, storedPath(file));
};

/** Deletes files from disk, ignoring ones that are already gone */
export const removeStored = async (files: StoredFile[]) => {
    await Promise.all(files.map((file) => rm(storedPath(file), { force: true })));
};

/** Deletes a leftover temporary upload (e.g. one that failed validation) */
export const discard = async (tmpPath: string) => {
    await rm(tmpPath, { force: true });
};
