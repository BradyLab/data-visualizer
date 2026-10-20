// Sends the invite email through EmailJS (https://www.emailjs.com), which delivers it from the mailbox connected to the EmailJS service.
// The email never contains a password; the inviting admin passes that on separately. Kept behind this one function so the provider can be swapped
const EMAILJS_URL = "https://api.emailjs.com/api/v1.0/email/send";
const SEND_TIMEOUT_MS = 10_000;

export interface InviteEmail {
    name: string;
    email: string;
    // The admin who sent the invite; passed to the template as admin_name and admin_email
    invitedBy: { name: string; email: string };
}

/** True when tests (NODE_ENV=test) or EMAIL_DISABLED=true ask for no real requests, whatever the EmailJS settings in .env say */
const isEmailDisabled = () => process.env.NODE_ENV === "test" || process.env.EMAIL_DISABLED === "true";

/** True if every EmailJS setting is present and sending is not disabled; otherwise invites are still created but no email goes out */
export const isEmailConfigured = () =>
    !isEmailDisabled() &&
    !!(
        process.env.EMAILJS_SERVICE_ID &&
        process.env.EMAILJS_TEMPLATE_ID &&
        process.env.EMAILJS_PUBLIC_KEY &&
        process.env.EMAILJS_PRIVATE_KEY
    );

/**
 * Sends the invite email (the EmailJS template decides its text). Returns true if EmailJS accepted it, false if email is not configured or sending failed;
 * it never throws, because the user already exists by the time it is called and a failed email must not fail the invite.
 * The EmailJS template can use the variables invitee_name, invitee_email, admin_name, admin_email
 */
export const sendInviteEmail = async ({ name, email, invitedBy }: InviteEmail) => {
    if (!isEmailConfigured()) {
        console.log("[EMAIL SERVICE] EmailJS is not configured or is disabled, skipping the invite email");
        return false;
    }
    try {
        const response = await fetch(EMAILJS_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
            body: JSON.stringify({
                service_id: process.env.EMAILJS_SERVICE_ID,
                template_id: process.env.EMAILJS_TEMPLATE_ID,
                user_id: process.env.EMAILJS_PUBLIC_KEY,
                // The private key is what allows calls from a server instead of a browser
                accessToken: process.env.EMAILJS_PRIVATE_KEY,
                template_params: {
                    invitee_name: name,
                    invitee_email: email,
                    admin_name: invitedBy.name,
                    admin_email: invitedBy.email,
                },
            }),
        });
        if (!response.ok) {
            console.error(`[EMAIL SERVICE] EmailJS refused the invite email (${response.status}): ${await response.text()}`);
            return false;
        }

        console.log("[EMAIL SERVICE] Invite email sent successfully");
        return true;
    } catch (err) {
        console.error("[EMAIL SERVICE] Could not send the invite email", err);
        return false;
    }
};
