# Security Specification — SiPiket OSIS Cloud Sync

## 1. Data Invariants
- Every document ID path variable (`userId`, `backupId`, `probeId`) must satisfy `^[a-zA-Z0-9_\-]+$` and length `<= 128`.
- `cloud_profiles/{userId}` can only be read, created, or updated by the verified authenticated owner (`request.auth.uid == userId` and `request.auth.token.email_verified == true`), and `uid` in data must equal `request.auth.uid`.
- `cloud_snapshots/{userId}/backups/{backupId}` requires the parent `cloud_profiles/{userId}` document to exist, `ownerId == request.auth.uid`, `ownerId` immutable after create, `createdAt == request.time` on create and immutable on update, `updatedAt == request.time` on create and update, and strict key allowlisting (`hasAll` + `hasOnly` + `affectedKeys().hasOnly(...)`).
- Default deny catch-all `match /{document=**} { allow read, write: if false; }` is enforced at the top of `/databases/{database}/documents`.

## 2. Adversarial Payloads ("Dirty Dozen")
1. Unauthenticated read on `/cloud_profiles/user1` -> DENIED
2. Unverified email (`email_verified: false`) write on `/cloud_profiles/user1` -> DENIED
3. Cross-user read (`uid: attacker`) on `/cloud_profiles/victim` -> DENIED
4. Shadow field injection (`extraAdmin: true`) on `/cloud_profiles/user1` -> DENIED
5. Role escalation (`appRole: "superroot"`) on `/cloud_profiles/user1` -> DENIED
6. Oversized `displayName` (> 120 chars) -> DENIED
7. Spoofed `ownerId` (`ownerId: "other"`) on `/cloud_snapshots/user1/backups/b1` -> DENIED
8. Orphaned snapshot write without parent `cloud_profiles/user1` -> DENIED
9. Spoofed client `createdAt` timestamp != `request.time` -> DENIED
10. Mutating immutable `createdAt` or `ownerId` during `update` -> DENIED
11. Unbounded `summaryDigest` (> 20000 chars) or negative counts -> DENIED
12. Blanket collection list scraping on `/cloud_snapshots/victim/backups` -> DENIED
