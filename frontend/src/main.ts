// Frontend entry point: creates the Vue app and registers plugins
import { createApp } from "vue";
import { createPinia } from "pinia";

import App from "@src/App.vue";
import router from "@src/router";
import vuetify from "@src/plugins/vuetify.ts";
import { useAuthStore } from "@src/stores/auth";

// Root component
const app = createApp(App);

// Pinia: global state management
app.use(createPinia());
// Restore a saved login session (re-attaches the token and reloads the user)
useAuthStore().restore();
// Vuetify: UI component library and theme
app.use(vuetify);
// Vue Router: page navigation
app.use(router);

// Mount the app into the #app element in index.html
app.mount("#app");
