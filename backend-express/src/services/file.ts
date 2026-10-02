// Database access for Files (metadata rows; hard-deleted since the Files table is not paranoid)
import { Files, IFile } from "@src/models/file.ts";

// Optional dataset_id filter to list a dataset's files
export const getAll = (dataset_id?: string) => {
    console.log("[FILE SERVICE] Fetching files...");
    return Files.findAll(dataset_id ? { where: { dataset_id } } : {});
};

/** Finds a file record by primary key, or null */
export const getById = (id: string) => {
    console.log("[FILE SERVICE] Fetching file by id...");
    return Files.findByPk(id);
};

/** Creates a file record from the whitelisted body fields */
export const create = (body: Partial<IFile>) => {
    console.log("[FILE SERVICE] Creating file record...");
    return Files.create(body as IFile);
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
