const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

async function sha256(content) {
  const bytes = new TextEncoder().encode(content);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha1Hex(content) {
  const bytes = new TextEncoder().encode(content);
  const digest = await crypto.subtle.digest("SHA-1", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmacSha1Hex(content, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(content));
  return [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function parseResourceMap(env) {
  try {
    if (!env.RESOURCE_MAP_JSON) return {};
    const parsed = JSON.parse(env.RESOURCE_MAP_JSON);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed;
  } catch {
    return {};
  }
}

function resolveResourceKey(resourceId, env) {
  const mapping = parseResourceMap(env);
  const key = mapping[String(resourceId)];
  if (typeof key === "string" && key.length > 0) return key;
  return `${resourceId}.zip`;
}

function encodeObjectKey(path) {
  return path
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
}

async function buildCosPresignedGetUrl(resourceKey, env, ttlSeconds = 600) {
  const bucket = env.COS_BUCKET;
  const region = env.COS_REGION;
  const secretId = env.COS_SECRET_ID;
  const secretKey = env.COS_SECRET_KEY;

  if (!bucket || !region || !secretId || !secretKey) {
    throw new Error("missing COS worker secrets");
  }

  const host = `${bucket}.cos.${region}.myqcloud.com`;
  const now = Math.floor(Date.now() / 1000);
  const end = now + ttlSeconds;
  const keyTime = `${now};${end}`;
  const encodedKey = encodeObjectKey(resourceKey);

  const httpString = `get\n/${encodedKey}\n\nhost=${host}\n`;
  const sha1edHttpString = await sha1Hex(httpString);
  const stringToSign = `sha1\n${keyTime}\n${sha1edHttpString}\n`;
  const signKey = await hmacSha1Hex(keyTime, secretKey);
  const signature = await hmacSha1Hex(stringToSign, signKey);

  const query = new URLSearchParams({
    "q-sign-algorithm": "sha1",
    "q-ak": secretId,
    "q-sign-time": keyTime,
    "q-key-time": keyTime,
    "q-header-list": "host",
    "q-url-param-list": "",
    "q-signature": signature,
  });

  return `https://${host}/${encodedKey}?${query.toString()}`;
}

function parseBearer(request) {
  const header = request.headers.get("Authorization") || "";
  if (!header.startsWith("Bearer ")) return null;
  return header.slice(7);
}

async function createToken(serial, env) {
  const payload = `${serial}.${Date.now()}`;
  const signature = await sha256(`${payload}.${env.JWT_SECRET}`);
  return `${payload}.${signature}`;
}

async function verifyToken(token, env) {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length < 3) return false;
  const payload = `${parts[0]}.${parts[1]}`;
  const expected = await sha256(`${payload}.${env.JWT_SECRET}`);
  return expected === parts.slice(2).join(".");
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (url.pathname === "/api/auth" && request.method === "POST") {
      const { serial, vid, pid } = await request.json();
      if (!serial || !vid || !pid) {
        return json({ success: false, message: "参数不完整" }, 400);
      }

      if (vid.toUpperCase() !== env.ALLOWED_VID || pid.toUpperCase() !== env.ALLOWED_PID) {
        return json({ success: false, message: "设备 VID/PID 不匹配" }, 401);
      }

      const token = await createToken(serial, env);
      return json({ success: true, token });
    }

    if (url.pathname === "/api/download-sign" && request.method === "POST") {
      const token = parseBearer(request);
      const valid = await verifyToken(token, env);
      if (!valid) {
        return json({ success: false, message: "token 无效" }, 401);
      }

      const { resourceId } = await request.json();
      if (!resourceId) {
        return json({ success: false, message: "参数不完整" }, 400);
      }

      const resourcePath = resolveResourceKey(resourceId, env);
      const signedUrl = await buildCosPresignedGetUrl(resourcePath, env, 600);
      return json({ success: true, url: signedUrl, expiresIn: 600 });
    }

    if (url.pathname === "/api/verify-token" && request.method === "GET") {
      const token = parseBearer(request);
      const valid = await verifyToken(token, env);
      return json({ success: valid });
    }

    if (url.pathname === "/api/resource/" && request.method === "GET") {
      const token = parseBearer(request);
      const valid = await verifyToken(token, env);
      if (!valid) {
        return json({ error: "token 无效" }, 401);
      }
      const resourceId = url.searchParams.get("id");
      if (!resourceId) {
        return json({ error: "missing id" }, 400);
      }
      const resourcePath = resolveResourceKey(resourceId, env);
      const signedUrl = await buildCosPresignedGetUrl(resourcePath, env, 600);
      return json({ url: signedUrl });
    }

    return json({ success: false, message: "Not Found" }, 404);
  },
};
