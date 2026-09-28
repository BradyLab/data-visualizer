import { createRouter, createWebHistory } from 'vue-router'
import HomeView from '../views/HomeView.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'default',
      redirect: '/home',
      meta: { hideFooter: false },
    },
    {
      path: '/home',
      name: 'home',
      component: async () => await import("../views/HomeView.vue"),
      meta: { hideFooter: false },
    },
    {
      path: '/about',
      name: 'about',
      component: () => import('../views/AboutView.vue'),
      meta: { hideFooter: false },
    },
    {
      path: '/settings',
      name: 'settings',
      component: () => import('../views/SettingsView.vue'),
      meta: { hideFooter: false },
    },
    {
      path: '/dataset',
      name: 'dataset',
      component: () => import('../views/DatasetView.vue'),
      meta: { hideFooter: false },
    },
    {
      path: '/new',
      name: 'new',
      component: () => import('../views/NewDatasetView.vue'),
      meta: { hideFooter: false },
    },
    {
      path: '/login',
      name: 'login',
      component: () => import('../views/LoginView.vue'),
      meta: { hideFooter: true },
    },
  ],
})

export default router
