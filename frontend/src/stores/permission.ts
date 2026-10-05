// Pinia store holding the permissions a user is allowed to see and the datasets they can edit
import { ref } from "vue";
import { defineStore } from "pinia";
import { PermissionOptions, type IPermission } from "@commons/permissions";
import { permissionApi } from "@src/api/permission";
import { type CreatePermissionPayload } from "@src/interfaces/permission";

export const usePermissionStore = defineStore("permission", () => {
    const permissions = ref<IPermission[]>([]);
    // Ids of the datasets the viewer holds EDIT permission on (not used for admins, who see everything)
    const editableDatasetIds = ref<string[]>([]);

    /** Loads just the ids of the datasets a user holds EDIT permission on (used to decide which pages to link to) */
    async function fetchEditable(userId: string) {
        const mine = await permissionApi.getByUser(userId);
        editableDatasetIds.value = mine.filter((p) => p.perm === PermissionOptions.EDIT).map((p) => p.dataset_id);
    }

    /**
     * Loads the permissions visible to a user. Admins get every permission; anyone else gets only the
     * permissions on datasets they hold EDIT permission on.
     */
    async function fetchVisible(userId: string, isAdmin: boolean) {
        if (isAdmin) {
            permissions.value = await permissionApi.getPermissions();
            return;
        }
        const mine = await permissionApi.getByUser(userId);
        editableDatasetIds.value = mine.filter((p) => p.perm === PermissionOptions.EDIT).map((p) => p.dataset_id);
        // TODOC08: passing permissionApi.getByDataset directly to map also passes (index, array) as extra args (harmless today, fragile if the API gains parameters); this block also duplicates fetchEditable and mutates editableDatasetIds as a side effect
        permissions.value = (await Promise.all(editableDatasetIds.value.map(permissionApi.getByDataset))).flat();
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
        permissions.value = permissions.value.filter((p) => !(p.user_id === userId && p.dataset_id === datasetId));
    }

    // Replaces the cached permission for the same user + dataset, or adds it
    function upsert(permission: IPermission) {
        const i = permissions.value.findIndex(
            (p) => p.user_id === permission.user_id && p.dataset_id === permission.dataset_id,
        );
        if (i === -1) permissions.value.push(permission);
        else permissions.value[i] = permission;
    }

    return {
        permissions,
        editableDatasetIds,
        fetchEditable,
        fetchVisible,
        addPermission,
        editPermission,
        removePermission,
    };
});
