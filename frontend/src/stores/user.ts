// Pinia store holding the list of users and wrapping the user API calls
import { ref } from "vue";
import { defineStore } from "pinia";
import type { IUser } from "@commons/user";
import { userApi } from "@src/api/user";
import { type UpdateUserPayload, type InviteUserPayload, type UserName } from "@src/interfaces/user";

export const useUserStore = defineStore("user", () => {
    // Reactive state (cached list of all users, filled by fetchUsers)
    const users = ref<IUser[]>([]);

    // Id/name pairs of every user, for pages that only need names and are open to non-admins (see fetchNames)
    const names = ref<UserName[]>([]);

    /** Loads all users from the backend into the store (admins only) */
    async function fetchUsers() {
        users.value = await userApi.getUsers();
    }

    /** Loads just the id and name of every user (admins and lab members) */
    async function fetchNames() {
        names.value = await userApi.getNames();
    }

    /** Returns the name of the user with this id from the loaded names, or the id itself if not loaded */
    function nameOf(id: string) {
        return names.value.find((u) => u.id === id)?.name ?? id;
    }

    /** Returns the cached user with this id, or null if not loaded */
    function getById(id: string) {
        return users.value.find((u) => u.id === id) ?? null;
    }

    /** Creates a user and adds it to the store */
    async function addUser(payload: InviteUserPayload) {
        const user = await userApi.createUser(payload);
        users.value.push(user);
        return user;
    }

    /** Updates a user and replaces it in the store */
    async function editUser(id: string, payload: UpdateUserPayload) {
        const user = await userApi.updateUser(id, payload);
        const i = users.value.findIndex((u) => u.id === id);
        // Replace in place if cached, otherwise add it
        if (i === -1) users.value.push(user);
        else users.value[i] = user;
        return user;
    }

    // Note: editUser/removeUser only touch this local cache after the backend call succeeds
    /** Deletes a user and removes it from the store */
    async function removeUser(id: string) {
        await userApi.deleteUser(id);
        users.value = users.value.filter((u) => u.id !== id);
    }

    return {
        users,
        names,
        fetchUsers,
        fetchNames,
        nameOf,
        getById,
        addUser,
        editUser,
        removeUser,
    };
});
