import { type IActivity } from "@commons/activity.ts";
import { type ServerFields } from "@src/interfaces/general.ts";

/** Payload for creating an activity */
export type CreateActivityPayload = Omit<IActivity, ServerFields>;
