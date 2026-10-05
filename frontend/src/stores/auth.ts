// Pinia store for the logged-in user and their login token
import { ref, computed } from "vue";
import { defineStore } from "pinia";
import axios from "axios";
import { UserRoles, UserStatus, type IUser } from "@commons/user";
import { authApi } from "@src/api/auth";

// localStorage key for the token so the session survives a page reload
const TOKEN_KEY = "token";

// Reads the saved token; storage can be unavailable (e.g. blocked site data)
const loadToken = () => {
    try {
        return localStorage.getItem(TOKEN_KEY);
    } catch {
        return null;
    }
};

const guestUser: IUser = {
    id: "",
    email: "",
    name: "GUEST USER",
    role: UserRoles.GUEST,
    status: UserStatus.ACTIVE,
    createdAt: new Date(),
};

export const useAuthStore = defineStore("auth", () => {
    // State: login token, current user (a GUEST placeholder when logged out), and login request status
    const token = ref<string | null>(loadToken());
    const user = ref<IUser>(guestUser);
    const loading = ref(false);
    const error = ref<string | null>(null);

    // Logged in whenever a token is present (the token is not validated client-side)
    const isLoggedIn = computed(() => !!token.value);

    //misc information to avoid recalculations
    const isAdmin = computed(() => user.value.role === UserRoles.ADMIN);

    // Saves the token, and makes every axios request send it
    function setToken(value: string | null) {
        token.value = value;
        try {
            if (value) localStorage.setItem(TOKEN_KEY, value);
            else localStorage.removeItem(TOKEN_KEY);
        } catch {
            // Storage unavailable; the session just won't survive a reload
        }
        if (value) axios.defaults.headers.common["Authorization"] = `Bearer ${value}`;
        else delete axios.defaults.headers.common["Authorization"];
    }

    /** Logs in; returns true on success, or false with `error` set to a message for the user */
    async function login(email: string, password: string) {
        loading.value = true;
        error.value = null;
        try {
            const result = await authApi.login({ email, password });
            setToken(result.token);
            user.value = result.user;
            return true;
        } catch (err) {
            error.value =
                axios.isAxiosError(err) && err.response?.status === 401
                    ? "Invalid email or password"
                    : "Unable to log in. Please try again.";
            return false;
        } finally {
            loading.value = false;
        }
    }

    /** Restores the user from a saved token (call on app start); logs out if the token is no longer valid */
    async function restore() {
        if (!token.value) return;
        setToken(token.value);
        try {
            user.value = await authApi.me();
        } catch {
            clearSession();
        }
    }

    // Clears the token and resets the user to the same guest placeholder used as the initial state
    function clearSession() {
        setToken(null);
        user.value = guestUser;
    }

    /** Notifies the backend, then clears the token and user; the local session is cleared even if the request fails */
    async function logout() {
        try {
            await authApi.logout();
        } catch {
            // Backend unreachable or token already invalid; the user is logged out locally either way
        } finally {
            clearSession();
        }
    }

    return {
        token,
        user,
        loading,
        error,
        isLoggedIn,
        isAdmin,
        login,
        restore,
        logout,
    };
});
