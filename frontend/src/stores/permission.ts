// Pinia store holding the permissions a user is allowed to see and the datasets they can edit
import { ref } from "vue";
import { defineStore } from "pinia";
import { PermissionOptions, type IPermission } from "@commons/permissions";
import { permissionApi } from "@src/api/permission";
import { type CreatePermissionPayload } from "@src/interfaces/permission";

export const usePermissionStore = defineStore("permission", () => {
    const myPermissions = ref<IPermission[]>([]);
    // Ids of the datasets the viewer holds EDIT permission on (not used for admins, who see everything)
    const editableDatasetIds = ref<string[]>([]);
    const adminPermissions = ref<IPermission[]>([]);

    /**
     * Loads the permissions visible to a user. Admins get every permission; anyone else gets only the
     * permissions on datasets they hold EDIT permission on.
     */
    async function fetchEditable(userId: string, isAdmin: boolean) {
        adminPermissions.value = await permissionApi.getPermissions();
        if (isAdmin) return;
        const mine = await permissionApi.getByUser(userId);
        editableDatasetIds.value = mine.filter((p) => p.perm === PermissionOptions.EDIT).map((p) => p.dataset_id);

        adminPermissions.value = adminPermissions.value.filter((p) => editableDatasetIds.value.includes(p.dataset_id));
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
        myPermissions.value = myPermissions.value.filter((p) => !(p.user_id === userId && p.dataset_id === datasetId));
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
        adminPermissions,
        fetchEditable,
        addPermission,
        editPermission,
        removePermission,
    };
});
