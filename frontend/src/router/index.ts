// Vue Router setup: defines the app's pages and their URLs
import { createRouter, createWebHistory } from "vue-router";

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
            component: async () => await import("@src/views/HomeView.vue"),
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
            meta: { hideFooter: false },
        },
        // Shows the dataset with the URL slug in :datasetTitle
        {
            path: "/dataset/:datasetTitle",
            name: "dataset",
            component: () => import("@src/views/DatasetView.vue"),
            meta: { hideFooter: false },
        },
        // Page for creating a new dataset
        {
            path: "/new",
            name: "new",
            component: () => import("@src/views/EditDatasetView.vue"),
            meta: { hideFooter: false },
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
            meta: { hideFooter: false},
        },
    ],
});

export default router;
