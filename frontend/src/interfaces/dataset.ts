import { type IDataset } from "@commons/dataset";
import { type ServerFields } from "./general";

/** Payload for creating a dataset */
export type CreateDatasetPayload = Omit<IDataset, ServerFields>;

/** Payload for updating a dataset; any subset of the editable fields */
export type UpdateDatasetPayload = Partial<Omit<CreateDatasetPayload, "owner">>;
