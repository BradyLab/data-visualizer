// Screen-reader announcements for changes nothing on screen would otherwise tell them about (a page change, or being moved to another page).
// AppDefault.vue shows `announcement` in a polite live region
import { ref } from "vue";

export const announcement = ref("");

// Says the message once; it is cleared first so the same message can be announced twice in a row
export function announce(message: string) {
    announcement.value = "";
    setTimeout(() => (announcement.value = message), 50);
}
