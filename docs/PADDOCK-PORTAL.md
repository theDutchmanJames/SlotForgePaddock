# Paddock Portal

Paddock Portal is a phone and tablet page for quickly adding a car and its main photograph to your local collection. It is separate from Dealership Mode, LAN collection sharing and the shared local Timing library. Turning on the Portal does not turn on any of those connections.

## Add cars from a phone or tablet

1. In Paddock, open **Connections → Paddock Portal → Turn on**.
2. Connect your mobile device to the same local network as the computer. Scan the displayed QR code, or type its `http://address:port/` into the browser and enter the six-digit access code.
3. Tap **Add Car**. Enter a manufacturer and model. Product reference is optional but recommended for later product research.
4. Choose a photograph from the gallery or take one with the camera. Check its preview.
5. Tap **Send to Paddock**. Wait for confirmation that the car was saved. The form clears automatically after a short confirmation, ready for another car.
6. Turn the Portal off when finished. Complete the cars' remaining details in Paddock.

Model becomes the initial car name and model field; Manufacturer fills the maker field. The photograph becomes the main photograph. New cars are saved directly, without a Review submission. Existing cars are never matched or overwritten by name or product reference. Choose **Existing Car** on the main page to add gallery photographs to a car already in your collection.

## Add photos to an existing car

1. On the Portal main page, tap **Existing Car**.
2. Search by name, manufacturer, model or product reference. The list loads in pages, with small main-photo thumbnails.
3. Select the car, then choose up to **five photos per upload** from your gallery or take photographs individually. Review the previews and remove any you do not want.
4. Tap **Send to Paddock**. The complete batch is saved together in **Photos & documents**, preserving the existing main photo and gallery.
5. After confirmation, the Portal returns to its main page with **Add Car** and **Existing Car**.

The existing limit of **40 gallery photos per car** still applies; the Portal shows the remaining space. Uploads save directly without Review. If the car has changed, been deleted, archived, rebuilt or merged since selection, select it again. Photos are never silently redirected to another car. If an acknowledgement is lost, the same operation can be retried without duplicates, even after a restart. After reloading a pending batch, reselect the same photographs in the same order if no save has been confirmed.

## Photographs

JPEG, PNG and WebP originals are stored without resizing or recompression. The existing limit is 12 MiB when encoded, approximately 9 MiB for the original file. An additional-photo batch accepts at most five such originals (60 MiB encoded plus request metadata); one batch uploads at a time. The Portal also limits image decoding to 60 megapixels and 20,000 pixels on either side. An oversized image can be replaced or explicitly converted to a JPEG copy with a longest side of up to 1,600 pixels. The source on the phone remains unchanged. Files above 25 MiB must be reduced in the phone's photo app first.

HEIC is not accepted directly. If the phone supplies HEIC, export a JPEG copy or try its camera upload option. The browser and operating system determine the native camera/gallery picker. Preview framing does not crop or resize the stored original.

## Connections and recovery

Keep Paddock running and the computer awake. Its window may be in the background. Guest Wi-Fi, client isolation, a VPN or firewall can prevent local connections. Use an address displayed by Paddock, not `localhost` on the phone. If multiple adapters are listed, use the address on the phone's network.

The Portal starts off on every Paddock launch. Turning it off revokes mobile access. Switching collections, replacing the database or putting the computer to sleep also stops the Portal. It does not provide internet access or port forwarding. QR links contain temporary access; manually entered addresses use the short code. This is an HTTP service for a trusted local network.

An interrupted upload retains its operation identity. Retrying the same upload cannot add a second car; a durable receipt is committed with the car and photo. After a page reload, **Check whether it was saved** can recover the acknowledgement. If the photo needs selecting again, use the same file. A changed request under the same identity is rejected. Database restoration changes recovery identity, preventing an old uncertain upload from silently reappearing.

The Portal is available for the original local collection, including a Dealership authority, but not a downloaded replica. A compatible Timing application sharing that same local SQLite library sees the added cars through its normal shared-library updates. Timing and Telemetry API routes and permissions are unchanged.
