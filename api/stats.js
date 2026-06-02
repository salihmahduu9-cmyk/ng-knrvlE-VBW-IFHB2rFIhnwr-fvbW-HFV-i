// api/stats.js — عدّاد الإحصائيات (Vercel Serverless Function)
// يخزّن في Upstash Redis. متغيرات البيئة المطلوبة:
//   KV_REST_API_URL   (أو UPSTASH_REDIS_REST_URL)
//   KV_REST_API_TOKEN (أو UPSTASH_REDIS_REST_TOKEN)
// تتعبّى تلقائياً لما تربط Upstash من Vercel Marketplace.

import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
});

const ACTIVE_WINDOW = 5 * 60; // النشط = آخر 5 دقائق (ثواني)

// توليد/قراءة معرّف زائر من الكوكي
function getVisitorId(req) {
  const cookie = req.headers.cookie || "";
  const m = cookie.match(/(?:^|;\s*)vid=([^;]+)/);
  if (m) return { id: m[1], isNew: false };
  // معرّف جديد
  const id =
    Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  return { id, isNew: true };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const { id: vid, isNew } = getVisitorId(req);
    const now = Math.floor(Date.now() / 1000);

    // نوع الحدث: ?event=obfuscate لزيادة عداد التشفير، أو لا شيء = زيارة فقط
    const url = new URL(req.url, "http://x");
    const event = url.searchParams.get("event");

    // 1) سجّل النشاط الحالي (sorted set: عضو=معرّف الزائر، النقاط=الوقت)
    await redis.zadd("active_users", { score: now, member: vid });
    // نظّف القدامى (أقدم من نافذة النشاط)
    await redis.zremrangebyscore("active_users", 0, now - ACTIVE_WINDOW);

    // 2) عدّاد الزوّار الفريدين (set)
    if (isNew) {
      await redis.sadd("unique_visitors", vid);
    }

    // 3) عدّاد مرات التشفير
    if (event === "obfuscate") {
      await redis.incr("obfuscate_count");
    }

    // اقرأ كل الأرقام
    const [obfuscateCount, uniqueVisitors, activeCount] = await Promise.all([
      redis.get("obfuscate_count"),
      redis.scard("unique_visitors"),
      redis.zcard("active_users"),
    ]);

    // اضبط كوكي الزائر (سنة)
    if (isNew) {
      res.setHeader(
        "Set-Cookie",
        `vid=${vid}; Path=/; Max-Age=31536000; SameSite=Lax`
      );
    }

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({
      obfuscations: Number(obfuscateCount) || 0,
      visitors: Number(uniqueVisitors) || 0,
      active: Number(activeCount) || 0,
    });
  } catch (e) {
    return res.status(500).json({ error: String(e && e.message || e) });
  }
}
