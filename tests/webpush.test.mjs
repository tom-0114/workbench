// node --test tests/webpush.test.mjs
// 用浏览器端的解密流程（RFC 8291）反解，验证加密与 VAPID 签名格式正确。
import test from "node:test";
import assert from "node:assert/strict";
import { createDecipheriv, createECDH, createHmac, createPublicKey, randomBytes, verify } from "node:crypto";
import { encryptPayload, generateVapidKeys, loadVapidKeys, sendPush } from "../server/webpush.mjs";

const hmac = (k, d) => createHmac("sha256", k).update(d).digest();

function decrypt(body, ua, authSecret) {
  const salt = body.subarray(0, 16);
  const idlen = body[20];
  const asPublic = body.subarray(21, 21 + idlen);
  const ciphertext = body.subarray(21 + idlen);
  const secret = ua.computeSecret(asPublic);
  const ikm = hmac(hmac(authSecret, secret), Buffer.concat([Buffer.from("WebPush: info\0"), ua.getPublicKey(), asPublic, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from("Content-Encoding: aes128gcm\0\x01")).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from("Content-Encoding: nonce\0\x01")).subarray(0, 12);
  const d = createDecipheriv("aes-128-gcm", cek, nonce);
  d.setAuthTag(ciphertext.subarray(-16));
  const plain = Buffer.concat([d.update(ciphertext.subarray(0, -16)), d.final()]);
  assert.equal(plain.at(-1), 2, "最后一条记录以 0x02 结尾");
  return plain.subarray(0, -1).toString();
}

test("aes128gcm 载荷可被订阅端解密", () => {
  const ua = createECDH("prime256v1");
  ua.generateKeys();
  const auth = randomBytes(16);
  const payload = JSON.stringify({ title: "交周报", body: "今天 14:30" });
  const body = encryptPayload(payload, ua.getPublicKey().toString("base64url"), auth.toString("base64url"));
  assert.equal(body.readUInt32BE(16), 4096);
  assert.equal(decrypt(body, ua, auth), payload);
});

test("VAPID 授权头可用公钥验签", async () => {
  const keys = generateVapidKeys();
  const vapid = loadVapidKeys(keys.publicKey, keys.privateKey);
  assert.ok(vapid);
  assert.equal(loadVapidKeys("bad", keys.privateKey), null);

  const ua = createECDH("prime256v1");
  ua.generateKeys();
  const auth = randomBytes(16);
  let captured;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { captured = { url: String(url), init }; return new Response(null, { status: 410 }); };
  try {
    const result = await sendPush(
      { endpoint: "https://push.example.com/send/abc", p256dh: ua.getPublicKey().toString("base64url"), auth: auth.toString("base64url") },
      { title: "测试" },
      { vapid, subject: "mailto:me@example.com" },
    );
    assert.deepEqual([result.ok, result.gone], [false, true]);
  } finally {
    globalThis.fetch = realFetch;
  }
  const [, token, k] = captured.init.headers.authorization.match(/^vapid t=([^,]+), k=(.+)$/);
  assert.equal(k, keys.publicKey);
  const [h, c, s] = token.split(".");
  const claims = JSON.parse(Buffer.from(c, "base64url"));
  assert.equal(claims.aud, "https://push.example.com");
  assert.equal(claims.sub, "mailto:me@example.com");
  const pub = Buffer.from(keys.publicKey, "base64url");
  const key = createPublicKey({ key: { kty: "EC", crv: "P-256", x: pub.subarray(1, 33).toString("base64url"), y: pub.subarray(33).toString("base64url") }, format: "jwk" });
  assert.ok(verify("sha256", Buffer.from(`${h}.${c}`), { key, dsaEncoding: "ieee-p1363" }, Buffer.from(s, "base64url")));
  assert.equal(decrypt(captured.init.body, ua, auth), JSON.stringify({ title: "测试" }));
});

test("RFC 8291 附录 A 测试向量", () => {
  const as = createECDH("prime256v1");
  as.setPrivateKey(Buffer.from("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw", "base64url"));
  const body = encryptPayload(
    "When I grow up, I want to be a watermelon",
    "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
    "BTBZMqHH6r4Tts7J_aSIgg",
    { salt: Buffer.from("DGv6ra1nlYgDCS1FRnbzlw", "base64url"), serverEcdh: as },
  );
  assert.equal(
    body.toString("base64url"),
    "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
  );
});
