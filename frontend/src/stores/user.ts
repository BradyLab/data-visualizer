// Pinia store holding the list of users and wrapping the user API calls
import { ref, watch } from "vue";
import { defineStore } from "pinia";
import type { IUser } from "@commons/user";
import { userApi } from "@src/api/user";
import { useAuthStore } from "@src/stores/auth";
import { useSocketStore } from "@src/stores/socket";
import { SocketEvent } from "@commons/socket";
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

    // Keeps the names list in step with a created or edited user, so nameOf and the role/status-based choices stay current
    function syncName(user: UserName) {
        const entry: UserName = { id: user.id, name: user.name, role: user.role, status: user.status };
        const i = names.value.findIndex((u) => u.id === user.id);
        if (i === -1) names.value.push(entry);
        else names.value[i] = entry;
    }

    /** Creates a user and adds it to the store */
    async function addUser(payload: InviteUserPayload) {
        const user = await userApi.createUser(payload);
        // The server announces the new user over the websocket before it answers this request, so the user may already be here
        const i = users.value.findIndex((u) => u.id === user.id);
        if (i === -1) users.value.push(user);
        else users.value[i] = user;
        syncName(user);
        return user;
    }

    /** Updates a user and replaces it in the store */
    async function editUser(id: string, payload: UpdateUserPayload) {
        const user = await userApi.updateUser(id, payload);
        const i = users.value.findIndex((u) => u.id === id);
        // Replace in place if cached, otherwise add it
        if (i === -1) users.value.push(user);
        else users.value[i] = user;
        syncName(user);
        return user;
    }

    // Note: editUser/removeUser only touch these local caches after the backend call succeeds
    /** Deletes a user and removes it from the store */
    async function removeUser(id: string) {
        await userApi.deleteUser(id);
        users.value = users.value.filter((u) => u.id !== id);
        names.value = names.value.filter((u) => u.id !== id);
    }

    // Live updates. Admins hear about every user; anyone hears about their own account, which replaces the logged-in user
    // (a changed name or role shows up without a new login; App.vue reloads what the viewer may see when the role changes)
    const auth = useAuthStore();
    const socket = useSocketStore();
    socket.on(SocketEvent.USER_CHANGED, ({ user }) => {
        if (user.id === auth.user.id) auth.user = user;
        if (!auth.isAdmin) return;
        const i = users.value.findIndex((u) => u.id === user.id);
        if (i === -1) users.value.push(user);
        else users.value[i] = user;
        syncName(user);
    });
    // Lab members only get the name, role and status, which is all the names list holds. A list that was never loaded stays empty
    socket.on(SocketEvent.USER_NAME_CHANGED, ({ user }) => {
        if (names.value.length) syncName(user);
    });
    socket.on(SocketEvent.USER_DELETED, ({ id }) => {
        users.value = users.value.filter((u) => u.id !== id);
        names.value = names.value.filter((u) => u.id !== id);
    });
    // After a reconnect, reload whichever lists this viewer had loaded to catch changes made while offline
    watch(
        () => socket.reconnects,
        () => {
            if (users.value.length) fetchUsers().catch(() => {});
            if (names.value.length) fetchNames().catch(() => {});
        }
    );

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
