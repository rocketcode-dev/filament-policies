import assert from "node:assert/strict";
import test from "node:test";

import {
  hasRole,
  isUserInfo,
  systemClock,
  type UserInfo,
} from "../foundation.js";

test("systemClock returns an epoch timestamp", () => {
  const before = Date.now();
  const actual = systemClock.now();
  const after = Date.now();
  assert.ok(actual >= before);
  assert.ok(actual <= after);
});

test("isUserInfo accepts application-facing user information", () => {
  assert.equal(isUserInfo({ username: "alice" }), true);
  assert.equal(
    isUserInfo({
      username: "alice",
      realm: "employees",
      emailAddress: "alice@example.com",
      emailVerified: true,
      fullName: "Alice Example",
      shortName: "Alice",
      roles: ["billing-reader"],
    }),
    true,
  );
});

test("isUserInfo rejects unsafe or malformed shared fields", () => {
  assert.equal(isUserInfo(null), false);
  assert.equal(isUserInfo({ username: "" }), false);
  assert.equal(isUserInfo({ username: "alice", roles: ["reader", 2] }), false);
  assert.equal(
    isUserInfo({ username: "alice", roles: ["reader", "reader"] }),
    false,
  );
  assert.equal(isUserInfo({ username: "alice", fullName: "" }), false);
  assert.equal(isUserInfo({ username: "alice", shortName: 2 }), false);
});

test("hasRole uses exact case-sensitive application roles", () => {
  const user: UserInfo = { username: "alice", roles: ["billing-reader"] };
  user.roles?.push("profile-reader");
  assert.equal(hasRole(user, "billing-reader"), true);
  assert.equal(hasRole(user, "profile-reader"), true);
  assert.equal(hasRole(user, "Billing-Reader"), false);
  assert.equal(hasRole(user, ""), false);
});
