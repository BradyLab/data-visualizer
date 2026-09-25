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
                text: "#000000",
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
    };

    //creation
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

    app.use(vuetify);
};