// Pinia store holding the list of users and wrapping the user API calls
import { ref } from "vue";
import { defineStore } from "pinia";
import type { IUser } from "@commons/user";
import { userApi, type CreateUserPayload, type UpdateUserPayload } from "@src/api/user";

export const useUserStore = defineStore("user", () => {
    // Reactive state
    const users = ref<IUser[]>([]);
    const loading = ref(false);
    const error = ref<string | null>(null);

    /** Loads all users from the backend into the store */
    async function fetchUsers() {
        users.value = await userApi.getUsers();
    }

    /** Returns the cached user with this id, or null if not loaded */
    function getById(id: string) {
        return users.value.find((u) => u.id === id) ?? null;
    }

    /** Creates a user and adds it to the store */
    async function addUser(payload: CreateUserPayload) {
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

    /** Deletes a user and removes it from the store */
    async function removeUser(id: string) {
        await userApi.deleteUser(id);
        users.value = users.value.filter((u) => u.id !== id);
    }

    return {
        users,
        loading,
        error,
        fetchUsers,
        getById,
        addUser,
        editUser,
        removeUser,
    };
});
