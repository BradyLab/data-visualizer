// Unit tests for the dataset access rules in services/access (Permissions lookups are stubbed, no database needed)
import { test, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { getAccess, hasAccess, OWNER } from "@src/services/access.ts";
import { Permissions } from "@src/models/permission.ts";
import type { Users } from "@src/models/user.ts";
import type { Datasets } from "@src/models/dataset.ts";
import { DatasetVisibility } from "@commons/dataset.ts";
import { PermissionOptions } from "@commons/permissions.ts";
import { UserRoles } from "@commons/user.ts";

const user = (role: UserRoles, id = "u1") => ({ id, role }) as unknown as Users;
const dataset = (visibility: DatasetVisibility, owner = "someone-else") =>
    ({ id: "d1", visibility, owner }) as unknown as Datasets;

// Makes the Permissions lookup return a row with this level, or nothing
const grant = (perm: PermissionOptions | null) =>
    mock.method(Permissions, "findOne", async () => (perm ? { perm } : null));

beforeEach(() => grant(null));
afterEach(() => mock.restoreAll());

const PUBLIC = DatasetVisibility.PUBLIC;
const PRIVATE = DatasetVisibility.PRIVATE;

test("guests can only VIEW public datasets", async () => {
    assert.equal(await getAccess(null, dataset(PUBLIC)), PermissionOptions.VIEW);
    assert.equal(await getAccess(null, dataset(PRIVATE)), null);
});

test("admins are OWNER of everything", async () => {
    assert.equal(await getAccess(user(UserRoles.ADMIN), dataset(PRIVATE)), OWNER);
});

test("a dataset's owner is OWNER whatever their role", async () => {
    assert.equal(await getAccess(user(UserRoles.EXTERNAL, "me"), dataset(PRIVATE, "me")), OWNER);
});

test("lab members get at least DOWNLOAD, even on private datasets", async () => {
    assert.equal(await getAccess(user(UserRoles.LAB_MEMBER), dataset(PRIVATE)), PermissionOptions.DOWNLOAD);
    assert.equal(await getAccess(user(UserRoles.LAB_MEMBER), dataset(PUBLIC)), PermissionOptions.DOWNLOAD);
});

test("lab members can be granted EDIT", async () => {
    grant(PermissionOptions.EDIT);
    assert.equal(await getAccess(user(UserRoles.LAB_MEMBER), dataset(PRIVATE)), PermissionOptions.EDIT);
});

test("a lab member's VIEW grant does not lower their DOWNLOAD floor", async () => {
    grant(PermissionOptions.VIEW);
    assert.equal(await getAccess(user(UserRoles.LAB_MEMBER), dataset(PRIVATE)), PermissionOptions.DOWNLOAD);
});

test("external users get their granted level, capped at DOWNLOAD", async () => {
    grant(PermissionOptions.VIEW);
    assert.equal(await getAccess(user(UserRoles.EXTERNAL), dataset(PRIVATE)), PermissionOptions.VIEW);
    grant(PermissionOptions.DOWNLOAD);
    assert.equal(await getAccess(user(UserRoles.EXTERNAL), dataset(PRIVATE)), PermissionOptions.DOWNLOAD);
    grant(PermissionOptions.EDIT);
    assert.equal(await getAccess(user(UserRoles.EXTERNAL), dataset(PRIVATE)), PermissionOptions.DOWNLOAD);
});

test("external users without a grant see nothing private but can VIEW public datasets", async () => {
    assert.equal(await getAccess(user(UserRoles.EXTERNAL), dataset(PRIVATE)), null);
    assert.equal(await getAccess(user(UserRoles.EXTERNAL), dataset(PUBLIC)), PermissionOptions.VIEW);
});

test("a public VIEW is raised by a higher grant", async () => {
    grant(PermissionOptions.DOWNLOAD);
    assert.equal(await getAccess(user(UserRoles.EXTERNAL), dataset(PUBLIC)), PermissionOptions.DOWNLOAD);
});

test("hasAccess compares levels in order and rejects null", () => {
    assert.equal(hasAccess(null, PermissionOptions.VIEW), false);
    assert.equal(hasAccess(PermissionOptions.VIEW, PermissionOptions.DOWNLOAD), false);
    assert.equal(hasAccess(PermissionOptions.DOWNLOAD, PermissionOptions.DOWNLOAD), true);
    assert.equal(hasAccess(PermissionOptions.EDIT, PermissionOptions.DOWNLOAD), true);
    assert.equal(hasAccess(OWNER, PermissionOptions.EDIT), true);
    assert.equal(hasAccess(PermissionOptions.EDIT, OWNER), false);
});
