// Pinia store holding the viewer's own permissions, the permissions they may manage, and the access rules built on them
import { computed, ref, watch } from "vue";
import { defineStore } from "pinia";
import { PermissionOptions, type IPermission } from "@commons/permissions";
import type { IDataset } from "@commons/dataset";
import { UserRoles } from "@commons/user";
import { permissionApi } from "@src/api/permission";
import { type CreatePermissionPayload } from "@src/interfaces/permission";
import { useAuthStore } from "@src/stores/auth";
import { useDatasetStore } from "@src/stores/dataset";
import { useSocketStore } from "@src/stores/socket";
import { SocketEvent, type IPermissionChangedEvent } from "@commons/socket";

export const usePermissionStore = defineStore("permission", () => {
    const auth = useAuthStore();
    // The viewer's own permission rows (see fetchMine)
    const myPermissions = ref<IPermission[]>([]);
    // The permission rows shown on the management page: every row for admins, otherwise the rows on datasets the viewer manages
    const adminPermissions = ref<IPermission[]>([]);
    // Ids of the datasets the viewer holds a DOWNLOAD or EDIT permission row on (each level includes the ones below it)
    const downloadableDatasetIds = computed(() =>
        myPermissions.value.filter((p) => p.perm !== PermissionOptions.VIEW).map((p) => p.dataset_id)
    );
    // Ids of the datasets the viewer holds an EDIT permission row on
    const editableDatasetIds = computed(() =>
        myPermissions.value.filter((p) => p.perm === PermissionOptions.EDIT).map((p) => p.dataset_id)
    );

    /** Loads the logged-in user's own permissions */
    async function fetchMine(userId: string) {
        myPermissions.value = await permissionApi.getByUser(userId);
    }

    /**
     * Loads the permissions the viewer may see on the management page: every permission for admins, otherwise the
     * permissions on the given datasets (the ones they own; only owners may see who a dataset is shared with).
     * If some of those requests fail, the rows that did load are kept and the first error is thrown
     */
    async function fetchManaged(datasetIds: string[], isAdmin: boolean) {
        if (isAdmin) {
            adminPermissions.value = await permissionApi.getPermissions();
            return;
        }
        // Keep the rows of the datasets that loaded even if another request fails, instead of leaving the old list in place;
        // the failure is still thrown afterwards so the caller can tell the user the list is incomplete
        const results = await Promise.allSettled(datasetIds.map((id) => permissionApi.getByDataset(id)));
        adminPermissions.value = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
        const failed = results.find((r) => r.status === "rejected");
        if (failed) throw failed.reason;
    }

    /** Forgets everything loaded for the previous viewer (call on login and logout) */
    function clear() {
        myPermissions.value = [];
        adminPermissions.value = [];
    }

    /**
     * True if the viewer may manage this dataset: change its visibility, delete it, and see or change who it is shared with.
     * Only admins and the dataset's owner (whatever their role) can; ownership is the dataset's owner column, not a permission row.
     * This mirrors the backend rules and only decides what the UI offers, the backend enforces them.
     */
    function canManage(dataset: IDataset) {
        if (!auth.isLoggedIn) return false;
        return auth.isAdmin || dataset.owner === auth.user.id;
    }

    /** True if the viewer may edit this dataset and its files: anyone who can manage it, or with an EDIT permission row */
    function canEdit(dataset: IDataset) {
        return canManage(dataset) || (auth.isLoggedIn && editableDatasetIds.value.includes(dataset.id));
    }

    /**
     * True if the viewer may download the dataset's RDS file: anyone who can edit it, any lab member, or anyone with a
     * DOWNLOAD permission row. PUBLIC datasets only give view access, so guests never can.
     */
    function canDownload(dataset: IDataset) {
        return (
            canEdit(dataset) ||
            (auth.isLoggedIn && (auth.user.role === UserRoles.LAB_MEMBER || downloadableDatasetIds.value.includes(dataset.id)))
        );
    }

    /** Grants a new permission (rejects with a 409 if the user already has one on the dataset) and puts it in the store */
    async function addPermission(payload: CreatePermissionPayload) {
        const permission = await permissionApi.createPermission(payload);
        cachePermission(permission);
        return permission;
    }

    /** Changes the access level of a permission and replaces it in the store */
    async function editPermission(userId: string, datasetId: string, perm: PermissionOptions) {
        const permission = await permissionApi.updatePermission(userId, datasetId, perm);
        cachePermission(permission);
        return permission;
    }

    /** Revokes a permission and removes it from the store */
    async function removePermission(userId: string, datasetId: string) {
        await permissionApi.deletePermission(userId, datasetId);
        const keep = (p: IPermission) => !(p.user_id === userId && p.dataset_id === datasetId);
        myPermissions.value = myPermissions.value.filter(keep);
        adminPermissions.value = adminPermissions.value.filter(keep);
    }

    /** Drops every cached permission on a dataset (call after the dataset is deleted, which removes its permissions in the backend) */
    function removeForDataset(datasetId: string) {
        const keep = (p: IPermission) => p.dataset_id !== datasetId;
        myPermissions.value = myPermissions.value.filter(keep);
        adminPermissions.value = adminPermissions.value.filter(keep);
    }

    // Cache helper. Replaces the cached permission for the same user + dataset, or adds it (e.g. a new grant),
    // in both lists it belongs to: the management list always, and the viewer's own list (which the can* checks use)
    // when the permission is the viewer's, e.g. an admin editing their own row
    function cachePermission(permission: IPermission) {
        const replace = (list: IPermission[]) => {
            const i = list.findIndex((p) => p.user_id === permission.user_id && p.dataset_id === permission.dataset_id);
            if (i === -1) list.push(permission);
            else list[i] = permission;
        };
        replace(adminPermissions.value);
        if (permission.user_id === auth.user.id) replace(myPermissions.value);
    }

    // Live updates when a permission is granted, changed or revoked. The viewer's own list follows the rows that are theirs; the
    // management list follows every row, but only if the viewer manages that dataset (the server also sends them to the dataset's owner and admins)
    function onPermissionChanged({ user_id, dataset_id, permission }: IPermissionChangedEvent) {
        const isRow = (p: IPermission) => p.user_id === user_id && p.dataset_id === dataset_id;
        const apply = (list: IPermission[]) => {
            if (!permission) return list.filter((p) => !isRow(p));
            return list.some(isRow) ? list.map((p) => (isRow(p) ? permission : p)) : [...list, permission];
        };
        const datasetStore = useDatasetStore();
        if (user_id === auth.user.id) myPermissions.value = apply(myPermissions.value);
        const dataset = datasetStore.datasets.find((d) => d.id === dataset_id);
        if (auth.isAdmin || dataset?.owner === auth.user.id) adminPermissions.value = apply(adminPermissions.value);
        // New or lost access changes which datasets the viewer can see, so reload the list
        if (user_id === auth.user.id) datasetStore.fetchDatasets().catch(() => {});
    }
    const socket = useSocketStore();
    socket.on(SocketEvent.PERMISSION_CHANGED, onPermissionChanged);
    // Reload the viewer's own permissions after a reconnect, to catch changes made while offline
    watch(
        () => socket.reconnects,
        () => {
            if (auth.isLoggedIn) fetchMine(auth.user.id).catch(() => {});
        }
    );

    return {
        myPermissions,
        downloadableDatasetIds,
        editableDatasetIds,
        adminPermissions,
        fetchMine,
        fetchManaged,
        clear,
        canManage,
        canEdit,
        canDownload,
        addPermission,
        editPermission,
        removePermission,
        removeForDataset,
    };
});
