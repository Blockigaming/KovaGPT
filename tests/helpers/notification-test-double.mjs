import assert from "node:assert/strict";

// Unit fixtures execute component callbacks but do not create a browser event
// bus or claim backend delivery. Validate the notice contract at this boundary.
export const notificationDeliveryStub = {
  publishKovaNotice(notice) {
    assert.ok(notice && typeof notice.id === "string" && notice.id.length > 0);
  },
};
