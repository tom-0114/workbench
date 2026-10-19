// Web Push 发送：VAPID（RFC 8292）签名 + aes128gcm 载荷加密（RFC 8291），只用 node:crypto。
// 不用 web-push 库是因为它是 MPL-2.0，不在本项目允许的许可范围内。
import { createECDH, createHmac, createCipheriv, createPrivateKey, randomBytes, sign } from "node:crypto";

const b64u = (buf) => Buffer.from(buf).toString("base64url");

function hmac(key, data) {
  return createHmac("sha256", key).update(data).digest();
}

/** VAPID 密钥：公钥为 65 字节未压缩点，私钥为 32 字节标量，均为 base64url */
export function loadVapidKeys(publicKey, privateKey) {
  const pub = Buffer.from(publicKey || "", "base64url");
  const priv = Buffer.from(privateKey || "", "base64url");
  if (pub.length !== 65 || pub[0] !== 4 || priv.length !== 32) return null;
  const key = createPrivateKey({
    key: { kty: "EC", crv: "P-256", d: b64u(priv), x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33)) },
    format: "jwk",
  });
  return { publicKey: b64u(pub), key };
}

export function generateVapidKeys() {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return { publicKey: b64u(ecdh.getPublicKey()), privateKey: b64u(ecdh.getPrivateKey()) };
}

function vapidJwt(audience, subject, key) {
  const header = b64u(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const claims = b64u(JSON.stringify({ aud: audience, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject }));
  const signature = sign("sha256", Buffer.from(`${header}.${claims}`), { key, dsaEncoding: "ieee-p1363" });
  return `${header}.${claims}.${b64u(signature)}`;
}

/** 按 RFC 8291 加密单条记录；返回可直接作为请求体的 Buffer */
export function encryptPayload(payload, p256dh, auth, { salt = randomBytes(16), serverEcdh } = {}) {
  const uaPublic = Buffer.from(p256dh, "base64url");
  const authSecret = Buffer.from(auth, "base64url");
  const ecdh = serverEcdh ?? createECDH("prime256v1");
  if (!serverEcdh) ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const sharedSecret = ecdh.computeSecret(uaPublic);

  const prkKey = hmac(authSecret, sharedSecret);
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic, Buffer.from([1])]);
  const ikm = hmac(prkKey, keyInfo);
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from("Content-Encoding: aes128gcm\0\x01")).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from("Content-Encoding: nonce\0\x01")).subarray(0, 12);

  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  // 0x02 = 最后一条记录的分隔符
  const body = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const rs = Buffer.alloc(4);
  rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, body]);
}

/**
 * 发送一条推送。返回 { ok, gone }：gone 表示订阅已失效（404/410），调用方应删除。
 * subscription: { endpoint, p256dh, auth }
 */
export async function sendPush(subscription, payload, { vapid, subject, ttl = 3600 }) {
  const endpoint = new URL(subscription.endpoint);
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-encoding": "aes128gcm",
      "content-type": "application/octet-stream",
      ttl: String(ttl),
      urgency: "high",
      authorization: `vapid t=${vapidJwt(endpoint.origin, subject, vapid.key)}, k=${vapid.publicKey}`,
    },
    body: encryptPayload(JSON.stringify(payload), subscription.p256dh, subscription.auth),
    signal: AbortSignal.timeout(10_000),
  });
  return { ok: res.ok, gone: res.status === 404 || res.status === 410, status: res.status };
}
