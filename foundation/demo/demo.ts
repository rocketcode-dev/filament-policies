import { hasRole, isUserInfo } from "../foundation.js";

console.log("\n@filamentjs/foundation — shared identity walkthrough");
console.log("====================================================");
console.log("1. Validate application-facing user information at a boundary.");

const candidate: unknown = {
  username: "demo-user",
  realm: "demo",
  emailAddress: "demo@example.com",
  fullName: "Demo User",
  shortName: "Demo",
  roles: ["demo-runner"],
};

if (!isUserInfo(candidate)) {
  throw new Error("Demo user is invalid");
}

console.log(`   ✓ ${candidate.fullName} (${candidate.username}@${candidate.realm})`);
console.log(`   email: ${candidate.emailAddress}`);
console.log("2. Check exact, case-sensitive application roles.");
console.log(`   demo-runner  → ${hasRole(candidate, "demo-runner")}`);
console.log(`   Demo-Runner  → ${hasRole(candidate, "Demo-Runner")}`);
console.log("3. Share the user—not protocol claims—through context.user.");
console.log("\nDemo complete. No server or external dependency was required.\n");
