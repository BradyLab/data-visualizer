import { createRouter, createWebHistory } from "vue-router";

const router = createRouter({
    history: createWebHistory(import.meta.env.BASE_URL),
    routes: [
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
        {
            path: "/dataset/:datasetTitle",
            name: "dataset",
            component: () => import("@src/views/DatasetView.vue"),
            meta: { hideFooter: false },
        },
        {
            path: "/new",
            name: "new",
            component: () => import("@src/views/EditDatasetView.vue"),
            meta: { hideFooter: false },
        },
        {
            path: "/login",
            name: "login",
            component: () => import("@src/views/LoginView.vue"),
            meta: { hideFooter: true },
        },
    ],
});

export default router;
