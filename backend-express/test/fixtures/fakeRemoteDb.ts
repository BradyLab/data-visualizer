// In-memory stand-ins for the database rows the large-memory worker code reads and writes (datasets, their current RDS file and the RemoteJobs
// table), for the tests of services/remoteProcessing, the /api/worker routes and shiny/preprocess/cluster-worker.sh. Install it in beforeEach
// and call restore() in afterEach
import { mock } from "node:test";
import { DatasetStatus, DatasetVisibility } from "@commons/dataset.ts";
import { FileTypes } from "@commons/file.ts";
import { Datasets } from "@src/models/dataset.ts";
import { Files } from "@src/models/file.ts";
import { RemoteJobs } from "@src/models/remoteJob.ts";
import { Users } from "@src/models/user.ts";

export interface FakeDataset {
    id: string;
    name: string;
    owner: string;
    visibility: DatasetVisibility;
    status: DatasetStatus;
    statusMessage: string | null;
}

export interface FakeJob {
    id: string;
    dataset_id: string;
    file_version: number;
    claimedAt: Date | null;
    heartbeatAt: Date | null;
    createdAt: Date;
    update: (fields: Partial<FakeJob>) => Promise<void>;
}

export const createFakeDb = () => {
    const datasets = new Map<string, FakeDataset>();
    // The current RDS file of each dataset
    const rds = new Map<string, { version: number; sizeBytes: number; ogName: string }>();
    const jobs = new Map<string, FakeJob>();
    // Passage of time for the lease: claims are older than this many ms when a test says so
    const lease = () => Number(process.env.REMOTE_LEASE_MS) || 15 * 60 * 1000;

    const addDataset = (id: string, status = DatasetStatus.WAITING_FOR_LARGE_MEMORY, version = 1, sizeBytes = 1000) => {
        datasets.set(id, {
            id,
            name: `Dataset ${id}`,
            owner: "o",
            visibility: DatasetVisibility.PRIVATE,
            status,
            statusMessage: null,
        });
        rds.set(id, { version, sizeBytes, ogName: "data.rds" });
    };

    const addJob = (datasetId: string, fileVersion = 1, createdAt = new Date()) => {
        const job: FakeJob = {
            id: crypto.randomUUID(),
            dataset_id: datasetId,
            file_version: fileVersion,
            claimedAt: null,
            heartbeatAt: null,
            createdAt,
            update: async (fields) => void Object.assign(job, fields),
        };
        jobs.set(job.id, job);
        return job;
    };

    const matches = (job: FakeJob, where: { id?: string; dataset_id?: string }) =>
        (where.id === undefined || job.id === where.id) &&
        (where.dataset_id === undefined || job.dataset_id === where.dataset_id);

    // Only these stubs are undone by restore(), so a test file can keep stubs of its own (e.g. the rate limit store) across tests
    const installed: { mock: { restore: () => void } }[] = [];
    const stub = ((...args: Parameters<typeof mock.method>) => {
        const m = mock.method(...args);
        installed.push(m);
        return m;
    }) as typeof mock.method;

    const install = () => {
        stub(Datasets, "findByPk", async (id: string) => {
            const d = datasets.get(id);
            return d && Object.assign(d, { update: async (fields: object) => Object.assign(d, fields), get: () => ({ ...d }) });
        });
        stub(Users, "findAll", async () => []);
        stub(Files, "findOne", async ({ where }: { where: { dataset_id: string } }) => {
            const f = rds.get(where.dataset_id);
            return f ? { dataset_id: where.dataset_id, type: FileTypes.RDS, ...f } : null;
        });
        stub(RemoteJobs, "create", async (fields: { id: string; dataset_id: string; file_version: number }) => {
            const job = addJob(fields.dataset_id, fields.file_version);
            jobs.delete(job.id);
            job.id = fields.id;
            jobs.set(job.id, job);
            return job;
        });
        stub(RemoteJobs, "destroy", async ({ where }: { where: { id?: string; dataset_id?: string } }) => {
            let n = 0;
            for (const [id, job] of jobs) if (matches(job, where)) (jobs.delete(id), n++);
            return n;
        });
        mock.method(
            RemoteJobs,
            "count",
            async ({ where }: { where: { dataset_id: string } }) => [...jobs.values()].filter((j) => matches(j, where)).length
        );
        stub(RemoteJobs, "findByPk", async (id: string) => jobs.get(id) ?? null);
        // The oldest job nobody claimed, or whose claim has gone without a heartbeat for the lease (what claimNext asks for)
        stub(RemoteJobs, "findOne", async () => {
            const cutoff = Date.now() - lease();
            return (
                [...jobs.values()]
                    .filter((j) => j.claimedAt === null || (j.heartbeatAt !== null && j.heartbeatAt.getTime() < cutoff))
                    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0] ?? null
            );
        });
        stub(
            RemoteJobs,
            "update",
            async (values: { id?: string; claimedAt?: Date; heartbeatAt?: Date }, { where }: { where: { id: string } }) => {
                const job = jobs.get(where.id);
                if (!job) return [0];
                jobs.delete(job.id);
                Object.assign(job, values);
                jobs.set(job.id, job);
                return [1];
            }
        );
        // claimNext runs inside a transaction; there is none to roll back here
        Object.defineProperty(RemoteJobs, "sequelize", {
            configurable: true,
            value: { transaction: async (work: (t: unknown) => unknown) => work({ LOCK: { UPDATE: "UPDATE" } }) },
        });
    };

    const restore = () => {
        for (const m of installed.splice(0)) m.mock.restore();
        Reflect.deleteProperty(RemoteJobs, "sequelize");
    };

    return { datasets, rds, jobs, addDataset, addJob, install, restore };
};
