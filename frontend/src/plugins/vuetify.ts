// Vuetify plugin: configures the theme, default component props, and icon set
//imports
import type { App } from "vue";
import { createVuetify } from "vuetify";
import { aliases, mdi } from "vuetify/iconsets/mdi";
import type { ThemeDefinition } from "vuetify";
import "vuetify/styles";
import "@mdi/font/css/materialdesignicons.css";

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

    //defaults
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
            border: "2px solid",
            clearable: true,
        },
        VFileUpload: {
            VBtn: {
                color: "#FFFFFF",
            },
        },
        // Tables match a tonal chip: translucent primary background with primary text (VDataTable has no color prop, so use theme variables)
        VDataTable: {
            style: "background-color: rgba(var(--v-theme-primary), 0.12); color: rgb(var(--v-theme-primary)); --v-theme-on-surface: var(--v-theme-primary);",
            VBtn: {
                color: "primary"
            }
        },
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
