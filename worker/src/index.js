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

async function signDownloadPath(path, expires, env) {
  const raw = `${path}|${expires}|${env.SIGN_SECRET}`;
  return sha256(raw);
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

      const { productId, resourceType } = await request.json();
      if (!productId || !resourceType) {
        return json({ success: false, message: "参数不完整" }, 400);
      }

      const expires = Math.floor(Date.now() / 1000) + 60;
      const resourcePath = `${productId}/${resourceType}.zip`;
      const signature = await signDownloadPath(resourcePath, expires, env);
      const signedUrl = `${env.DOWNLOAD_BASE_URL}/${resourcePath}?exp=${expires}&sig=${signature}`;
      return json({ success: true, url: signedUrl, expires });
    }

    if (url.pathname === "/api/verify-token" && request.method === "GET") {
      const token = parseBearer(request);
      const valid = await verifyToken(token, env);
      return json({ success: valid });
    }

    return json({ success: false, message: "Not Found" }, 404);
  },
};
