// Database access for Files (metadata rows; hard-deleted since the Files table is not paranoid)
import { Files, IFile } from "../models/file.ts";
import { pick } from "../utils/pick.ts";

const FILE_FIELDS = ["dataset_id", "type", "sizeBytes", "ogName"] as const;

// Optional dataset_id filter to list a dataset's files
export const getAll = (dataset_id?: string) => Files.findAll(dataset_id ? { where: { dataset_id } } : {});

export const getById = (id: string) => Files.findByPk(id);

export const create = (body: unknown) => Files.create(pick<IFile>(body, FILE_FIELDS) as IFile);

export const update = async (id: string, body: unknown) => {
    const file = await Files.findByPk(id);
    if (!file) return null;
    return file.update(pick<IFile>(body, FILE_FIELDS));
};

export const remove = async (id: string) => {
    const file = await Files.findByPk(id);
    if (!file) return false;
    await file.destroy();
    return true;
};
