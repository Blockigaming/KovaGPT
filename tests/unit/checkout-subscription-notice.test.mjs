import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {checkoutOriginKey, activeCheckoutOrigin, CHECKOUT_ORIGIN_MAX_AGE_MS} from "../../src/lib/checkout-notice-policy.mjs";

const owner="550e8400-e29b-41d4-a716-446655440000";
test("checkout receipt is account scoped and expires promptly",()=>{
 assert.equal(checkoutOriginKey(owner),"kova:checkout-origin:"+owner);
 assert.equal(checkoutOriginKey("malicious/path"),null);
 assert.equal(activeCheckoutOrigin({ownerId:owner,startedAt:1000},owner,1001),true);
 assert.equal(activeCheckoutOrigin({ownerId:owner,startedAt:1000},"650e8400-e29b-41d4-a716-446655440001",1001),false);
 assert.equal(activeCheckoutOrigin({ownerId:owner,startedAt:1000},owner,1000+CHECKOUT_ORIGIN_MAX_AGE_MS+1),false);
 assert.equal(activeCheckoutOrigin({ownerId:owner,startedAt:1000},owner,999),false);
 assert.equal(activeCheckoutOrigin({ownerId:owner,startedAt:"1000"},owner,1001),false);
});
test("checkout initiation never announces a successful payment",()=>{
 const src=readFileSync("src/components/StripeEmbeddedCheckout.tsx","utf8");
 assert.match(src,/url\.origin !== "https:\/\/checkout\.stripe\.com"/);
 assert.match(src,/checkoutOriginKey\(owner\)/);
 assert.match(src,/id: "checkout_started"/);
 assert.doesNotMatch(src,/id: "subscription_updated"/);
});
test("checkout return confirms subscription only after authenticated server summary",()=>{
 const src=readFileSync("src/routes/checkout.return.tsx","utf8");
 const i=src.indexOf('publishKovaNotice({\n            id: "subscription_updated"');
 assert.ok(i>0);
 assert.ok(src.indexOf("getSubscriptionSummary(")<i);
 assert.ok(src.indexOf('resolved.kind !== "active"')<i);
 assert.ok(src.indexOf("activeCheckoutOrigin(stored, ownerId)")<i);
 assert.ok(src.indexOf("sessionStorage.removeItem(receiptKey)")<i);
 assert.match(src,/confirmed: true/);
});
