// Pinia store holding the viewer's own permissions, the permissions they may manage, and the access rules built on them
import { computed, ref } from "vue";
import { defineStore } from "pinia";
import { PermissionOptions, type IPermission } from "@commons/permissions";
import type { IDataset } from "@commons/dataset";
import { UserRoles } from "@commons/user";
import { permissionApi } from "@src/api/permission";
import { type CreatePermissionPayload } from "@src/interfaces/permission";
import { useAuthStore } from "@src/stores/auth";

export const usePermissionStore = defineStore("permission", () => {
    const auth = useAuthStore();
    // The viewer's own permission rows (see fetchMine)
    const myPermissions = ref<IPermission[]>([]);
    // The permission rows shown on the management page: every row for admins, otherwise the rows on datasets the viewer manages
    const adminPermissions = ref<IPermission[]>([]);
    // Ids of the datasets the viewer holds an EDIT or OWNER permission row on (OWNER includes edit access)
    const editableDatasetIds = computed(() =>
        myPermissions.value.filter((p) => p.perm !== PermissionOptions.VIEW).map((p) => p.dataset_id)
    );
    // Ids of the datasets the viewer holds an OWNER permission row on
    const ownedDatasetIds = computed(() =>
        myPermissions.value.filter((p) => p.perm === PermissionOptions.OWNER).map((p) => p.dataset_id)
    );

    /** Loads the logged-in user's own permissions */
    async function fetchMine(userId: string) {
        myPermissions.value = await permissionApi.getByUser(userId);
    }

    /**
     * Loads the permissions the viewer may see on the management page: every permission for admins, otherwise the
     * permissions on the given datasets (the ones they own; only owners may see who a dataset is shared with)
     */
    async function fetchManaged(datasetIds: string[], isAdmin: boolean) {
        adminPermissions.value = isAdmin
            ? await permissionApi.getPermissions()
            : (await Promise.all(datasetIds.map((id) => permissionApi.getByDataset(id)))).flat();
    }

    /** Forgets everything loaded for the previous viewer (call on login and logout) */
    function clear() {
        myPermissions.value = [];
        adminPermissions.value = [];
    }

    /**
     * True if the viewer may manage this dataset: change its visibility, delete it, and see or change who it is shared with.
     * Admins always can; the dataset's owner can while still a lab member; others need an OWNER permission row.
     * This mirrors the backend rules and only decides what the UI offers, the backend enforces them.
     */
    function canManage(dataset: IDataset) {
        if (!auth.isLoggedIn) return false;
        return (
            auth.isAdmin ||
            (dataset.owner === auth.user.id && auth.user.role === UserRoles.LAB_MEMBER) ||
            ownedDatasetIds.value.includes(dataset.id)
        );
    }

    /** True if the viewer may edit this dataset and its files: anyone who can manage it, or with an EDIT permission row */
    function canEdit(dataset: IDataset) {
        return canManage(dataset) || (auth.isLoggedIn && editableDatasetIds.value.includes(dataset.id));
    }

    /** Grants a permission (or re-grants/updates an existing one) and puts it in the store */
    async function addPermission(payload: CreatePermissionPayload) {
        const permission = await permissionApi.createPermission(payload);
        upsert(permission);
        return permission;
    }

    /** Changes the access level of a permission and replaces it in the store */
    async function editPermission(userId: string, datasetId: string, perm: PermissionOptions) {
        const permission = await permissionApi.updatePermission(userId, datasetId, perm);
        upsert(permission);
        return permission;
    }

    /** Revokes a permission and removes it from the store */
    async function removePermission(userId: string, datasetId: string) {
        await permissionApi.deletePermission(userId, datasetId);
        const keep = (p: IPermission) => !(p.user_id === userId && p.dataset_id === datasetId);
        myPermissions.value = myPermissions.value.filter(keep);
        adminPermissions.value = adminPermissions.value.filter(keep);
    }

    // Replaces the cached permission for the same user + dataset, or adds it
    //TODO move upsert to backend
    function upsert(permission: IPermission) {
        const i = adminPermissions.value.findIndex(
            (p) => p.user_id === permission.user_id && p.dataset_id === permission.dataset_id
        );
        if (i === -1) adminPermissions.value.push(permission);
        else adminPermissions.value[i] = permission;
    }

    return {
        permissions: myPermissions,
        editableDatasetIds,
        ownedDatasetIds,
        adminPermissions,
        fetchMine,
        fetchManaged,
        clear,
        canManage,
        canEdit,
        addPermission,
        editPermission,
        removePermission,
    };
});
