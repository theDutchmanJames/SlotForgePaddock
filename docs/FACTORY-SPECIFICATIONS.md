# Use Factory specifications

Open a car's **Technical & parts** page and choose **Use Factory specifications…**
beside Edit specifications. Owned cars and Wishlist cars use the same comparison.

The dialog compares saved Factory reference values with current technical
specifications. Empty current fields are selected initially. Existing values
can be selected individually or with Select all changes. Empty Factory values
and values already identical to the current specification are omitted.

Review the selection, tick the confirmation and choose **Apply selected
specifications**. Unselected fields, the Factory reference, saved setups and
historical race configurations are unchanged. This uses existing saved data;
it does not research the car or infer its fitted components.

Replacing a specification tied to fitted inventory requires individual
selection. The comparison lists the affected pieces and their quantity. The
existing atomic stock-override operation returns them to **Used spares**;
unaffected assembly components stay fitted. Copying a Factory description does
not install replacement inventory. Bulk selection skips these stock-return
replacements, and the normal revision check rejects a stale comparison.

The editor loads one car and its installed-part dependencies. It uses the
existing `car.save` mutation, so it does not add a database format or change
Timing/Telemetry contracts.
