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

export interface PasswordResetEmail {
    name: string;
    email: string;
    // The new temporary password; this is the one email that carries a password, so only ever send it to the account's own address
    password: string;
}

/** True if every EmailJS setting plus the password reset template (EMAILJS_RESET_TEMPLATE_ID) is present and sending is not disabled */
export const isResetEmailConfigured = () =>
    !isEmailDisabled() &&
    !!(
        process.env.EMAILJS_SERVICE_ID &&
        process.env.EMAILJS_RESET_TEMPLATE_ID &&
        process.env.EMAILJS_PUBLIC_KEY &&
        process.env.EMAILJS_PRIVATE_KEY
    );

/**
 * Emails a user their new temporary password (the EmailJS template decides its text). Returns true if EmailJS accepted it, false if
 * email is not configured or sending failed; never throws. The template can use the variables user_name, user_email and new_password
 */
export const sendPasswordResetEmail = async ({ name, email, password }: PasswordResetEmail) => {
    if (!isResetEmailConfigured()) {
        console.log(
            "[EMAIL SERVICE] The password reset template is not configured or email is disabled, skipping the reset email"
        );
        return false;
    }
    try {
        const response = await fetch(EMAILJS_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
            body: JSON.stringify({
                service_id: process.env.EMAILJS_SERVICE_ID,
                template_id: process.env.EMAILJS_RESET_TEMPLATE_ID,
                user_id: process.env.EMAILJS_PUBLIC_KEY,
                accessToken: process.env.EMAILJS_PRIVATE_KEY,
                template_params: { user_name: name, user_email: email, new_password: password },
            }),
        });
        if (!response.ok) {
            // The response body is not logged: it could echo the request, which holds the password
            console.error(`[EMAIL SERVICE] EmailJS refused the password reset email (${response.status})`);
            return false;
        }
        console.log("[EMAIL SERVICE] Password reset email sent successfully");
        return true;
    } catch (err) {
        console.error("[EMAIL SERVICE] Could not send the password reset email", (err as Error).name);
        return false;
    }
};

/** The addresses that get notices about the processing queue (NOTIFY_EMAIL_TO, comma separated; use a shared lab mailbox) */
const noticeRecipients = () =>
    (process.env.NOTIFY_EMAIL_TO ?? "")
        .split(",")
        .map((address) => address.trim())
        .filter(Boolean);

/** True if notices can be sent: the EmailJS account settings, a template for notices (EMAILJS_NOTIFY_TEMPLATE_ID) and at least one recipient */
export const isNoticeConfigured = () =>
    !isEmailDisabled() &&
    !!(
        process.env.EMAILJS_SERVICE_ID &&
        process.env.EMAILJS_NOTIFY_TEMPLATE_ID &&
        process.env.EMAILJS_PUBLIC_KEY &&
        process.env.EMAILJS_PRIVATE_KEY
    ) &&
    noticeRecipients().length > 0;

/**
 * Emails a short notice to the lab (for example "a dataset is waiting for the large-memory worker"), one message per recipient in
 * NOTIFY_EMAIL_TO. Returns true if EmailJS accepted every message; false if notices are not configured or any send failed. Never throws:
 * the notice is a courtesy and must not affect what it is about. The EmailJS template can use the variables to_email, subject and message
 */
export const sendNotice = async (subject: string, message: string) => {
    if (!isNoticeConfigured()) {
        console.log("[EMAIL SERVICE] Notices are not configured or are disabled, skipping the notice:", subject);
        return false;
    }
    let allSent = true;
    for (const to of noticeRecipients()) {
        try {
            const response = await fetch(EMAILJS_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
                body: JSON.stringify({
                    service_id: process.env.EMAILJS_SERVICE_ID,
                    template_id: process.env.EMAILJS_NOTIFY_TEMPLATE_ID,
                    user_id: process.env.EMAILJS_PUBLIC_KEY,
                    accessToken: process.env.EMAILJS_PRIVATE_KEY,
                    template_params: { to_email: to, subject, message },
                }),
            });
            if (!response.ok) {
                console.error(`[EMAIL SERVICE] EmailJS refused the notice (${response.status}): ${await response.text()}`);
                allSent = false;
            }
        } catch (err) {
            console.error("[EMAIL SERVICE] Could not send the notice", err);
            allSent = false;
        }
    }
    return allSent;
};
