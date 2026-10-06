// Pinia store for the logged-in user and their login token
import { ref, computed } from "vue";
import { defineStore } from "pinia";
import axios from "axios";
import { UserRoles, UserStatus, type IUser } from "@commons/user";
import { PASSWORD_CHANGE_REQUIRED } from "@commons/general";
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

// Id of the axios response interceptor installed by the store, so a re-created store (e.g. a fresh Pinia in tests)
// can remove the old one instead of stacking a duplicate that still points at the old store's state
let interceptorId: number | null = null;

const guestUser: IUser = {
    id: "",
    email: "",
    name: "GUEST USER",
    role: UserRoles.GUEST,
    status: UserStatus.ACTIVE,
    createdAt: new Date(),
    updatedAt: new Date(),
};

export const useAuthStore = defineStore("auth", () => {
    // State: login token, current user (a GUEST placeholder when logged out), and login request status
    const token = ref<string | null>(loadToken());
    const user = ref<IUser>(guestUser);
    const loading = ref(false);
    // True when the saved session could not be restored because the server was unreachable or failed (the token is kept)
    const restoreFailed = ref(false);
    const error = ref<string | null>(null);

    // Logged in once there is a token and the user it belongs to has been loaded (id is "" for the GUEST placeholder),
    // so this is false while restore() is still pending; an expired token is caught by the 401 handler below
    const isLoggedIn = computed(() => !!token.value && !!user.value.id);

    //misc information to avoid recalculations
    const isAdmin = computed(() => user.value.role === UserRoles.ADMIN);
    // Admins and lab members may create datasets (the same roles the owner dropdown offers)
    const canCreateDatasets = computed(() => isAdmin.value || user.value.role === UserRoles.LAB_MEMBER);

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
            restoreFailed.value = false;
            return true;
        } catch (err) {
            const status = axios.isAxiosError(err) ? err.response?.status : undefined;
            error.value =
                status === 401
                    ? "Invalid email or password"
                    : status === 429
                      ? "Too many login attempts. Please wait a few minutes and try again."
                      : "Unable to log in. Please try again.";
            return false;
        } finally {
            loading.value = false;
        }
    }

    /**
     * Restores the user from a saved token (call on app start). Logs out only if the server rejects the token (401);
     * on a network error or 5xx the token is kept, so a reload can retry, and the user shows as logged out meanwhile
     */
    async function restore() {
        if (!token.value) return;
        // Re-saving the token re-attaches the Authorization header after a reload
        setToken(token.value);
        try {
            user.value = await authApi.me();
        } catch (err) {
            if (axios.isAxiosError(err) && err.response?.status === 401) clearSession();
            else restoreFailed.value = true;
        }
    }

    // Clears the token and resets the user to the same guest placeholder used as the initial state
    function clearSession() {
        setToken(null);
        user.value = guestUser;
        restoreFailed.value = false;
    }

    // Global response handling:
    // - 401 while holding a token: it expired or the account was disabled, so drop the session instead of staying
    //   "logged in" (skipped without a token, where a 401 just means bad credentials on the login form)
    // - 403 PASSWORD_CHANGE_REQUIRED: the user is still INVITED (default password), so mark them as such and send them
    //   to /settings, where the unclosable change-password dialog opens (SettingsView watches the status)
    if (interceptorId !== null) axios.interceptors.response.eject(interceptorId);
    interceptorId = axios.interceptors.response.use(undefined, (err) => {
        if (axios.isAxiosError(err)) {
            const { status, data } = err.response ?? {};
            if (status === 401 && token.value) clearSession();
            else if (status === 403 && data?.code === PASSWORD_CHANGE_REQUIRED && token.value) {
                if (user.value.status !== UserStatus.INVITED) user.value = { ...user.value, status: UserStatus.INVITED };
                // Imported lazily because the router imports this store
                import("@src/router").then((m) => m.default.push("/settings"));
            }
        }
        return Promise.reject(err);
    });

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
        restoreFailed,
        isLoggedIn,
        isAdmin,
        canCreateDatasets,
        login,
        restore,
        logout,
    };
});
