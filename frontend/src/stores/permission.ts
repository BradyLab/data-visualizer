// Pinia store holding the permissions a user is allowed to see and the datasets they can edit
import { ref } from "vue";
import { defineStore } from "pinia";
import { PermissionOptions, type IPermission } from "@commons/permissions";
import { permissionApi } from "@src/api/permission";

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

    return { permissions, editableDatasetIds, fetchEditable, fetchVisible };
});
