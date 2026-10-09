// Vuetify plugin: configures the theme, default component props, and icon set
import type { App } from "vue";
import { createVuetify } from "vuetify";
import { aliases, mdi } from "vuetify/iconsets/mdi";
import type { ThemeDefinition } from "vuetify";
import "vuetify/styles";
import "@mdi/font/css/materialdesignicons.css";

// Plugin function: installed through app.use(vuetify) in main.ts, it builds the Vuetify instance and installs it on the app
export default (app: App) => {
    //themes
    const themes: Record<string, ThemeDefinition> = {
        // Single light theme; "surface" and "primary" share the dark green, and "text" is white (used on green surfaces like the app bar)
        light: {
            dark: false,
            colors: {
                background: "#FFFFFF",
                surface: "#103819",
                "on-surface": "#FFFFFF",
                primary: "#103819",
                "on-primary": "#FFFFFF",
                secondary: "#55ab3d",
                "on-secondary": "#000000",
                //error
                //info
                //success
                //warning
                text: "#FFFFFF",
            },
            variables: {},
        },
    };

    // Global default props for components, so individual views do not repeat them
    //defaults
    const tableDefaults = {
        style: "background-color: rgba(var(--v-theme-primary), 0.12); color: rgb(var(--v-theme-primary)); --v-theme-on-surface: var(--v-theme-primary);",
        VBtn: {
            color: "primary",
        },
    };
    const defaults = {
        VBtn: {
            color: "primary",
            rounded: "lg",
            style: "text-transform: none; font-weight: 500;",
        },
        VCard: {
            flat: true,
            rounded: "lg",
            border: false,
        },
        // Nested default: applies only to buttons inside an app bar
        VAppBar: {
            VBtn: {
                color: "primary",
                rounded: "lg",
                style: "text-transform: none; font-weight: 500;",
                variant: "flat",
            },
        },
        VTextField: {
            variant: "outlined",
            clearable: true,
        },
        VFileUpload: {
            VBtn: {
                color: "#8da091",
            },
        },
        // Tables match a tonal chip: translucent primary background with primary text (VDataTable has no color prop, so use theme variables)
        VDataTable: tableDefaults,
        VDataTableServer: tableDefaults,
    };

    //creation
    const vuetify = createVuetify({
        defaults,
        theme: {
            defaultTheme: "light",
            themes,
        },
        icons: {
            defaultSet: "mdi",
            aliases,
            sets: {
                mdi,
            },
        },
    });

    app.use(vuetify);
};
