// Example Pinia store from the Vue project template (a simple counter); not used by the app yet
import { ref, computed } from "vue";
import { defineStore } from "pinia";

export const useCounterStore = defineStore("counter", () => {
    // Reactive state
    const count = ref(0);
    // Derived value that updates automatically when count changes
    const doubleCount = computed(() => count.value * 2);
    // Action that modifies state
    function increment() {
        count.value++;
    }

    // Expose state, getters, and actions to components
    return { count, doubleCount, increment };
});
