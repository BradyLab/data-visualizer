// Database access for Files (metadata rows; hard-deleted since the Files table is not paranoid)
import { Files, IFile } from "@src/models/file.ts";
import { FileTypes } from "@commons/file.ts";

// Returns an error message for the first client-supplied field that is present but invalid, or null if all are fine.
export const validateFileFields = (fields: Partial<IFile>) => {
    if (fields.type !== undefined && !Object.values(FileTypes).includes(fields.type))
        return `type must be one of: ${Object.values(FileTypes).join(", ")}`;
    if (fields.sizeBytes !== undefined && !(Number.isSafeInteger(fields.sizeBytes) && fields.sizeBytes >= 0))
        return "sizeBytes must be a non-negative integer";
    // 255 matches the STRING column length of ogName
    if (fields.ogName !== undefined && (typeof fields.ogName !== "string" || !fields.ogName.trim() || fields.ogName.length > 255))
        return "ogName must be a non-empty string of at most 255 characters";
    if (fields.version !== undefined && !(Number.isSafeInteger(fields.version) && fields.version >= 1))
        return "version must be a positive integer";
    if (fields.updates !== undefined && fields.updates !== null && typeof fields.updates !== "string")
        return "updates must be a string";
    return null;
};

// Optional dataset_id filter to list a dataset's files
export const getAll = (dataset_id?: string) => {
    console.log("[FILE SERVICE] Fetching files...");
    return Files.findAll(dataset_id ? { where: { dataset_id } } : {});
};

/** All files uploaded by a user (they are deleted with the user, so the caller must remove them from disk) */
export const getByUser = (user_id: string) => {
    console.log("[FILE SERVICE] Fetching files by uploader...");
    return Files.findAll({ where: { user_id } });
};

/** The current version of a dataset's file of one type (the only one kept on disk), or null */
export const getCurrent = (dataset_id: string, type: IFile["type"]) => {
    console.log("[FILE SERVICE] Fetching current file...");
    return Files.findOne({ where: { dataset_id, type, isCurrent: true } });
};

/** Finds a file record by primary key, or null */
export const getById = (id: string) => {
    console.log("[FILE SERVICE] Fetching file by id...");
    return Files.findByPk(id);
};

/** Highest version number of a dataset's files of one type, or 0 if there are none yet */
export const latestVersion = async (dataset_id: string, type: IFile["type"]) => {
    const max = await Files.max<number | null, Files>("version", { where: { dataset_id, type } });
    return max ?? 0;
};

/**
 * Creates a file record as the current version of its type, and in the same transaction clears the flag on the one it replaces.
 * beforeCommit (e.g. moving the file into place) runs inside the transaction. Returns the new record and the records that stopped being current (their files are no longer needed on disk)
 */
export const createCurrent = async (body: Partial<IFile>, beforeCommit?: () => Promise<void>) => {
    console.log("[FILE SERVICE] Creating file record...");
    return Files.sequelize!.transaction(async (transaction) => {
        const where = { dataset_id: body.dataset_id, type: body.type, isCurrent: true };
        const replaced = await Files.findAll({ where, transaction });
        await Files.update({ isCurrent: false }, { where, transaction });
        const created = await Files.create({ ...body, isCurrent: true } as IFile, { transaction });
        // Runs once the row exists (so a duplicate version has already failed) but before the commit; if it throws, everything is rolled back
        await beforeCommit?.();
        return { created, replaced };
    });
};

/** Updates a file record with the whitelisted body fields; returns null if not found */
export const update = async (id: string, body: Partial<IFile>) => {
    console.log("[FILE SERVICE] Updating file record...");
    const file = await Files.findByPk(id);
    if (!file) {
        console.log("[FILE SERVICE] File to update not found");
        return null;
    }
    return file.update(body);
};

/** Deletes a file record; returns false if not found */
export const remove = async (id: string) => {
    console.log("[FILE SERVICE] Deleting file record...");
    const file = await Files.findByPk(id);
    if (!file) {
        console.log("[FILE SERVICE] File to delete not found");
        return false;
    }
    await file.destroy();
    return true;
};
