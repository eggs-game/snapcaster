#!/usr/bin/env node
import assert from "node:assert/strict";
import { deleteExpiredAnonymousUsers } from "../api/maintenance.js";

const now = Date.now();
const deletedIds = [];
const admin = {
  auth: {
    admin: {
      listUsers: async () => ({
        data: {
          users: [
            { id: "expired-anonymous", is_anonymous: true, created_at: new Date(now - 31 * 86400000).toISOString() },
            { id: "recent-anonymous", is_anonymous: true, created_at: new Date(now - 2 * 86400000).toISOString() },
            { id: "permanent-user", is_anonymous: false, created_at: new Date(now - 365 * 86400000).toISOString() },
          ],
        },
        error: null,
      }),
      deleteUser: async (id) => {
        deletedIds.push(id);
        return { error: null };
      },
    },
  },
};

const result = await deleteExpiredAnonymousUsers(admin);
assert.deepEqual(deletedIds, ["expired-anonymous"]);
assert.deepEqual(result, { deleted: 1, failed: 0 });

console.log("anonymous identity retention keeps recent guests and permanent accounts");
