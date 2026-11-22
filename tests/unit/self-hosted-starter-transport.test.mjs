import test from "node:test";
import assert from "node:assert/strict";
import { createSelfHostedStarterTransport } from "../../src/lib/ai/self-hosted-starter-transport.server.mjs";
const config = () => ({model:"kova-argon-4.6", repository:"Qwen/Qwen3.6-35B-A3B",
 revision:"a".repeat(40), runtimeDigest:"sha256:"+"b".repeat(64),
 endpoint:"https://argon.inference.internal/v1/chat/completions", token:"c".repeat(32)});
const request = () => ({model:"kova-argon-4.6", messages:[{role:"user",content:"Hello"}],
 stream:false,max_tokens:100});
test("only the pinned private destination receives a request after authorization", async () => {
 const deployment=config(); let sent=0; let authorized=false;
 const send=createSelfHostedStarterTransport(deployment, async (url, options) => {
  sent++; assert.ok(authorized); assert.equal(url, config().endpoint);
  assert.equal(options.redirect,"error");
  const body=JSON.parse(options.body);
  assert.equal(body.model,config().repository+"@"+config().revision);
  assert.equal(body.provider,undefined); assert.equal(body.reasoning,undefined);
  return new Response("{}",{headers:{"content-type":"application/json"}});
 });
 deployment.endpoint="https://attacker.example/v1/chat/completions";
 await send(request(),{beforeSend:()=>{authorized=true;}});
 assert.equal(sent,1);
});
test("unsupported content and caller routing are rejected before any network call", async () => {
 let sent=0;
 const send=createSelfHostedStarterTransport(config(),async()=>{sent++;});
 for(const extra of [{tools:[]},{endpoint:"https://attacker.example"},{model:"kova-xenon-5"},
  {messages:[{role:"user",content:[{type:"image_url"}]}]},{max_tokens:99999}])
  await assert.rejects(send({...request(),...extra}));
 const controller=new AbortController();controller.abort();
 await assert.rejects(send(request(),{signal:controller.signal}));
 await assert.rejects(send(request(),{beforeSend:()=>{throw new Error("authorization_revoked");}}));
 assert.equal(sent,0);
 for(const extra of [{endpoint:"http://argon.inference.internal/v1/chat/completions"},
  {endpoint:"https://attacker.example/v1/chat/completions"},{revision:"main"},
  {runtimeDigest:"latest"},{repository:"unapproved/model"}])
  assert.throws(()=>createSelfHostedStarterTransport({...config(),...extra}));
});
test("failed inference never retries or falls back to a hosted provider", async () => {
 let sent=0;
 const send=createSelfHostedStarterTransport(config(),async()=>{
  sent++;return new Response("private error",{status:429});
 });
 await assert.rejects(send(request()),/self_hosted_inference_unavailable/);
 assert.equal(sent,1);
});
