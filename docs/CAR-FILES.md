# Car export and import

Import & Export → Choose cars opens My Cars with export instructions. Select cars and use Export selected, or switch to Wishlist first. A car's More menu also offers Export this car. Both routes use the same export dialog and native file picker. Cancelling the picker writes nothing.

Paddock car files share public details, the main photograph and optional extra photographs and setup snapshots. They exclude private ownership data, prices, notes, custom fields, workshop records and racing histories. They are not database backups.

## Membership and compatibility

- Owned-only files retain the existing slotforge-car-package version 1 format.
- Any selection containing Wishlist entries uses version 2. Each car has an explicit collectionStatus: collection or wishlist.
- Older Paddock versions reject version 2 rather than silently importing Wishlist entries as owned cars. Use a version supporting Wishlist car files on the receiving computer.
- The recipient approves fields in Review; the destination list is shown separately. New Wishlist entries have ownership Wanted. Existing cars can be updated only within the same membership. Import cannot purchase a Wishlist car or demote an owned car.
- Timing exports remain the existing Timing JSON format and reject Wishlist selections in the backend as well as hiding that option in the UI. Public network package submission retains its owned-only contract.

## Review storage

The file boundary validates version 2 and converts its public fields to the established version 1 reviewed-package representation. Submission metadata wishlistImport = {version: 1, carIds: [...]} retains the Wishlist membership. The IDs must be unique, present in the package and cannot accompany local transfer submissions. Membership is not a selectable car field.

This keeps pending submissions readable by the current qualified Timing shared-library engine, without extending Timing's file or transfer APIs. Reusing a package ID with changed content or changed membership is rejected. SQLite restart, full backup and restore retain the metadata; approval is transactional.

Tests cover owned, Wishlist and mixed files, optional photographs and setups, private-field exclusion, partial updates, membership conflicts, invalid files, rejected submissions, duplicate delivery, SQLite reopening, async approval and compatibility with Timing's current bundled validator/writer. The isolated Electron test exercises actual export, native dialog cancellation, file import and approval.

Dealership hosts advertise wishlistCarFiles: 1 on the existing club status route. Connected clients require that capability for Wishlist file intake, so older hosts cannot approve it as owned data. Reconnection refreshes the capability; ordinary owned-file imports remain compatible.
