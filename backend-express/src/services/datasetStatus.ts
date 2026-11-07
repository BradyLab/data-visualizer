// Changing a dataset's processing status, shared by the local queue (processing.ts) and the large-memory worker (remoteProcessing.ts)
import { DatasetStatus } from "@commons/dataset.ts";
import { Datasets } from "@src/models/dataset.ts";
import * as datasetService from "@src/services/dataset.ts";
import { emitDatasetUpdated } from "@src/services/socket.ts";

// Longest failure message stored with a dataset
export const MAX_MESSAGE = 500;

/**
 * The failure message as it is stored: every absolute path is cut down to its last part (".../file.rds"). The message is the tail of
 * R's or the worker's output and is sent to everyone who can see the dataset, so it must not reveal how the server's folders are laid out.
 * The full text is still written to the server log
 */
export const redactPaths = (message: string) =>
    message.replace(/(?:\/[^\s/'"`:,;()<>]+){2,}/g, (path) => `.../${path.split("/").pop()}`);

/** Changes a dataset's status and tells connected browsers; returns false if the dataset no longer exists */
export const setStatus = async (datasetId: string, status: DatasetStatus, statusMessage: string | null) => {
    const dataset = await Datasets.findByPk(datasetId);
    if (!dataset) return false;
    await dataset.update({ status, statusMessage });
    await emitDatasetUpdated((await datasetService.withOwnerName([dataset]))[0]!, dataset.visibility);
    return true;
};
