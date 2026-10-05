<script setup lang="ts">
// Admin-only user management page: table of users with their role and buttons for permissions / activity logs
import { computed, onMounted, ref, watchEffect } from "vue";
import { useRouter } from "vue-router";
import { UserRoles, UserStatus, type IUser } from "@commons/user";
import EditUserDialog from "@src/components/EditUserDialog.vue";
import InviteUserDialog from "@src/components/InviteUserDialog.vue";
import { useAuthStore } from "@src/stores/auth";
import { useUserStore } from "@src/stores/user";

const router = useRouter();
const auth = useAuthStore();
const userStore = useUserStore();

// Table columns: name, email, role, and an actions column for the buttons
const headers = [
    { title: "NAME", key: "name" },
    { title: "EMAIL", key: "email" },
    { title: "ROLE", key: "role" },
    { title: "STATUS", key: "status" },
    { title: "", key: "actions", sortable: false, align: "end" as const },
];

// Selected filter values; an empty list means no filter on that field
const roleFilter = ref<UserRoles[]>([]);
const statusFilter = ref<UserStatus[]>([]);
const roleOptions = Object.values(UserRoles);
const statusOptions = Object.values(UserStatus);

// Users matching any selected status and any selected role
const filteredUsers = computed(() =>
    userStore.users.filter(
        (u) =>
            (!statusFilter.value.length || statusFilter.value.includes(u.status)) &&
            (!roleFilter.value.length || roleFilter.value.includes(u.role))
    )
);

// Only admins may view this page; everyone else is sent home.
// A saved token with a GUEST user means the session is still being restored on page load, so wait for it.
watchEffect(() => {
    const restoring = auth.isLoggedIn && auth.user.role === UserRoles.GUEST;
    if (!auth.isAdmin && !restoring) router.replace("/home");
});

// Load the users once we know the viewer is an admin
// (the restoring branch above is defensive; see the router guard)
onMounted(async () => {
    if (auth.isAdmin) await userStore.fetchUsers();
});

// User currently being edited in the popup
// (the dialog stays mounted and receives the selected user as a prop)
const editingUser = ref<IUser | null>(null);
const editDialogOpen = ref(false);

// Opens the edit popup for this user
function edit(user: IUser) {
    editingUser.value = user;
    editDialogOpen.value = true;
}

// Opens the permission management page filtered to this user
function viewPermissions(userId: string) {
    router.push({ name: "permissions", query: { user: userId } });
}

// Opens the activity logs page filtered to this user
function viewActivityLogs(userId: string) {
    router.push({ name: "activity-logs", query: { user: userId } });
}

const inviteDialogOpen = ref(false);

// Opens the invite popup
function inviteUser() {
    inviteDialogOpen.value = true;
}
</script>

<template>
    <v-container v-if="auth.isAdmin">
        <div class="d-flex align-center mb-4">
            <h1 class="text-h6 font-weight-bold">USER MANAGEMENT</h1>
            <v-spacer></v-spacer>
        </div>

        <v-row class="align-center mb-2">
            <!-- Filter menu: each item opens a submenu of values; picking one sets the filter and shows a chip -->
            <v-menu>
                <template #activator="{ props }">
                    <v-btn v-bind="props" prepend-icon="mdi-filter-variant">Filter</v-btn>
                </template>
                <v-list>
                    <v-list-item append-icon="mdi-chevron-right">
                        <v-list-item-title>Status</v-list-item-title>
                        <v-menu activator="parent" submenu open-on-hover :close-on-content-click="false" location="end">
                            <v-list v-model:selected="statusFilter" select-strategy="leaf">
                                <v-list-item v-for="status in statusOptions" :key="status" :title="status" :value="status">
                                    <template #prepend="{ isSelected }">
                                        <v-icon
                                            :icon="isSelected ? 'mdi-checkbox-marked' : 'mdi-checkbox-blank-outline'"
                                        ></v-icon>
                                    </template>
                                </v-list-item>
                            </v-list>
                        </v-menu>
                    </v-list-item>
                    <v-list-item append-icon="mdi-chevron-right">
                        <v-list-item-title>Role</v-list-item-title>
                        <v-menu activator="parent" submenu open-on-hover :close-on-content-click="false" location="end">
                            <v-list v-model:selected="roleFilter" select-strategy="leaf">
                                <v-list-item v-for="role in roleOptions" :key="role" :title="role" :value="role">
                                    <template #prepend="{ isSelected }">
                                        <v-icon
                                            :icon="isSelected ? 'mdi-checkbox-marked' : 'mdi-checkbox-blank-outline'"
                                        ></v-icon>
                                    </template>
                                </v-list-item>
                            </v-list>
                        </v-menu>
                    </v-list-item>
                </v-list>
            </v-menu>
            <v-spacer></v-spacer>
            <v-btn prepend-icon="mdi-account-plus-outline" @click="inviteUser">Invite User</v-btn>
        </v-row>

        <!-- Active filters (only shown when there are any); closing a chip removes that value -->
        <div v-if="statusFilter.length || roleFilter.length" class="d-flex flex-wrap ga-2 mb-3">
            <v-chip
                v-for="status in statusFilter"
                :key="status"
                closable
                color="primary"
                @click:close="statusFilter = statusFilter.filter((s) => s !== status)"
            >
                Status: {{ status }}
            </v-chip>
            <v-chip
                v-for="role in roleFilter"
                :key="role"
                closable
                color="primary"
                @click:close="roleFilter = roleFilter.filter((r) => r !== role)"
            >
                Role: {{ role }}
            </v-chip>
        </div>

        <v-data-table :headers="headers" :items="filteredUsers" item-value="id">
            <template #item.actions="{ item }">
                <v-btn class="mr-2" prepend-icon="mdi-pencil" @click="edit(item)"> Edit </v-btn>
                <v-btn class="mr-2" prepend-icon="mdi-shield-key-outline" @click="viewPermissions(item.id)"> Permissions </v-btn>
                <v-btn prepend-icon="mdi-history" @click="viewActivityLogs(item.id)">Activity Logs</v-btn>
            </template>
        </v-data-table>

        <EditUserDialog v-model="editDialogOpen" :user="editingUser" />
        <InviteUserDialog v-model="inviteDialogOpen" />
    </v-container>
</template>
