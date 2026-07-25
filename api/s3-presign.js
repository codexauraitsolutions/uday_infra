// /api/s3-presign.js
// Generates a short-lived, scoped URL that lets the browser upload ONE file
// directly to S3 — the actual AWS secret key never leaves this server.
//
// Required Vercel environment variables (Project Settings -> Environment Variables):
//   AWS_ACCESS_KEY_ID       - from the IAM user you created
//   AWS_SECRET_ACCESS_KEY   - from the IAM user you created
//   AWS_REGION              - e.g. ap-south-1
//   S3_BUCKET               - e.g. uday-infra
//   UPLOAD_SECRET            - any password you make up, shared with admin.html
//                             (see ADMIN_UPLOAD_SECRET in admin.html)

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

function sanitizeFilename(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Upload-Secret");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // Simple shared-secret check so random people on the internet can't get upload URLs.
  // Not as strong as verifying a real login session, but keeps this endpoint from being
  // wide open, while staying simple to set up (no extra Firebase Admin credentials needed).
  const providedSecret = req.headers["x-upload-secret"];
  if (!providedSecret || providedSecret !== process.env.UPLOAD_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const { filename, contentType } = req.body || {};
    if (!filename || !contentType) {
      return res.status(400).json({ error: "filename and contentType are required" });
    }
    if (!contentType.startsWith("image/")) {
      return res.status(400).json({ error: "Only image uploads are allowed" });
    }

    const clean = sanitizeFilename(filename);
    const key = `our_work/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${clean}`;

    const command = new PutObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: key,
      ContentType: contentType,
    });

    const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 120 }); // 2 minutes to use it
    const publicUrl = `https://${process.env.S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;

    return res.status(200).json({ uploadUrl, publicUrl, key });
  } catch (err) {
    console.error("s3-presign error:", err);
    return res.status(500).json({ error: "Could not generate upload URL" });
  }
}
