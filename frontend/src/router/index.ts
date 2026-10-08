// Vue Router setup: defines the app's pages and their URLs
import { createRouter, createWebHistory } from "vue-router";
import { useAuthStore } from "@src/stores/auth";

// Route meta flags: requiresAuth needs a login, requiresAdmin needs an admin (and implies a login),
// requiresDatasetCreator needs an admin or lab member (and implies a login)
declare module "vue-router" {
    interface RouteMeta {
        hideFooter?: boolean;
        requiresAuth?: boolean;
        requiresAdmin?: boolean;
        requiresDatasetCreator?: boolean;
    }
}

// Route table. Views are lazy-loaded so each page is only downloaded when visited.
// meta.hideFooter controls whether the footer is shown on that page
const router = createRouter({
    // Use browser history mode (clean URLs, no #)
    history: createWebHistory(import.meta.env.BASE_URL),
    routes: [
        // Root path redirects to the home page
        {
            path: "/",
            name: "default",
            redirect: "/home",
            meta: { hideFooter: false },
        },
        {
            path: "/home",
            name: "home",
            component: async () => import("@src/views/HomeView.vue"),
            meta: { hideFooter: false },
        },
        {
            path: "/about",
            name: "about",
            component: () => import("@src/views/AboutView.vue"),
            meta: { hideFooter: false },
        },
        {
            path: "/settings",
            name: "settings",
            component: () => import("@src/views/SettingsView.vue"),
            meta: { hideFooter: false, requiresAuth: true },
        },
        // Shows the dataset with the URL slug in :datasetURL
        {
            path: "/dataset/:datasetURL",
            name: "dataset",
            component: () => import("@src/views/DatasetView.vue"),
            meta: { hideFooter: false },
        },
        // Page for editing the dataset with the URL slug in :datasetURL (same form as /new)
        {
            path: "/dataset/:datasetURL/edit",
            name: "edit-dataset",
            component: () => import("@src/views/EditDatasetView.vue"),
            meta: { hideFooter: false, requiresAuth: true },
        },
        // Page for creating a new dataset; static routes outrank "/dataset/:datasetURL", so "new" is a reserved slug
        // (RESERVED_DATASET_SLUGS in commons/dataset.ts, enforced by the Datasets model and the edit form)
        {
            path: "/dataset/new",
            name: "new",
            component: () => import("@src/views/EditDatasetView.vue"),
            meta: { hideFooter: false, requiresAuth: true, requiresDatasetCreator: true },
        },
        // Login page (footer hidden)
        {
            path: "/login",
            name: "login",
            component: () => import("@src/views/LoginView.vue"),
            meta: { hideFooter: true },
        },
        //Admin User Management Page
        {
            path: "/admin/user-mgmt",
            name: "user-mgmt",
            component: () => import("@src/views/admin/UserManagement.vue"),
            meta: { hideFooter: false, requiresAuth: true, requiresAdmin: true },
        },
        // Admin Activity Logs Page
        {
            path: "/admin/activity-logs",
            name: "activity-logs",
            component: () => import("@src/views/admin/ActivityLogs.vue"),
            meta: { hideFooter: false, requiresAuth: true, requiresAdmin: true },
        },
        // Permission management page (admins see all datasets, other users only the datasets they own; see fetchManaged)
        {
            path: "/admin/permissions",
            name: "permissions",
            component: () => import("@src/views/admin/PermissionManagement.vue"),
            meta: { hideFooter: false, requiresAuth: true },
        },
    ],
});

// Route guard: login-required pages send logged-out users to /login (with the requested page in the redirect query), admin-only and dataset-creation pages send
// users without the needed role home.
// The session is restored before the router is installed (see main.ts), so the auth state is settled here.
// Returning a route location redirects; returning nothing lets navigation proceed
router.beforeEach((to) => {
    const auth = useAuthStore();
    // The saved session could not be checked (server down, token kept): the user is not really logged out, so don't send them to /login
    // or home. The page opens as requested; the backend still enforces access, and the banner in AppDefault.vue offers a reload to retry
    if (auth.restoreFailed) return;
    // LoginView sends the user back to the redirect page after they log in
    if (to.meta.requiresAuth && !auth.isLoggedIn) return { name: "login", query: { redirect: to.fullPath } };
    if (to.meta.requiresAdmin && !auth.isAdmin) return { name: "home" };
    if (to.meta.requiresDatasetCreator && !auth.canCreateDatasets) return { name: "home" };
});

export default router;
