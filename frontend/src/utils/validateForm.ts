// Runs a Vuetify form's rules; when one fails, moves focus to the first invalid field so keyboard and screen-reader users land on the problem
// The form is the v-form component instance (its validate() resolves with the failing inputs' ids)
export async function validateForm(
    form: { validate: () => Promise<{ valid: boolean; errors?: { id: string | number }[] }> } | null
): Promise<boolean> {
    const result = await form?.validate();
    if (!result) return false;
    if (!result.valid) document.getElementById(String(result.errors?.[0]?.id))?.focus();
    return result.valid;
}
