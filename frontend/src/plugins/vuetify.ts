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
    };

    //creation
    // TODO: icon `aliases` is passed both at top level and under `icons`
    const vuetify = createVuetify({
        aliases,
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

    // TODO main.ts also calls app.use(vuetify) with this function's default export (see oddities)
    app.use(vuetify);
};
