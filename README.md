# Hercules Web — مُشفّر لوا (نشر على Vercel)

موقع يشغّل خط أنابيب **Hercules** الأصلي (Lua) داخل المتصفح عبر **Fengari**
(مفسّر لوا مترجم لـ JS/WASM). كل التشفير يصير على جهاز المستخدم —
**لا سيرفر، لا رفع للكود، لا قاعدة بيانات.** وهذا يخليه مثالي لـ Vercel
لأنه موقع ثابت 100%.

## الهيكل

```
herc-site/
├── vercel.json          إعداد Vercel
├── public/
│   ├── index.html       الواجهة
│   ├── run.js           محمّل Fengari + منطق التشفير
│   └── hercules/        وحدات Hercules (لوا) — تُحمّل وقت التشغيل
│       ├── config.lua
│       ├── pipeline.lua
│       └── modules/...
```

## النشر على Vercel

### الطريقة الأسهل (بدون أوامر)
1. ادخل https://vercel.com وسجّل دخول بـ GitHub
2. ارفع مجلّد `herc-site` لمستودع GitHub جديد
3. في Vercel اضغط **Add New → Project** واختر المستودع
4. الإعدادات: Framework Preset = **Other**, Output Directory = `public`
5. **Deploy** — خلاص، يطلع لك رابط

### عبر Vercel CLI
```bash
npm i -g vercel
cd herc-site
vercel        # أول مرة: يسألك أسئلة، خلّ Output Directory = public
vercel --prod # للنشر النهائي
```

## ملاحظات مهمة

- **ملفات لوا تُقدّم كنصوص:** `vercel.json` يضبط `Content-Type` لمجلد
  `hercules/` كـ `text/plain` عشان `fetch` يقراها صح.
- **الأداء:** أول تشفير ياخذ ثانية أو ثنتين (تحميل Fengari + الوحدات)،
  بعدها أسرع. الملفات الكبيرة جداً قد تكون بطيئة لأن كل شي بالمتصفح.
- **التوافق:** بعض وحدات Hercules (خصوصاً VM وbytecode) تعتمد على
  سلوك لوا 5.x. لو طلع خطأ مع خيار معيّن، طفّيه وجرّب. أكثر تركيبة
  مستقرة: variable renaming + control flow + garbage + opaque + compressor + wrap.

## الترخيص
Hercules تحت رخصة Apache-2.0 — انظر مستودعه الأصلي:
https://github.com/zeusssz/hercules-obfuscator

## تنبيه
التعمية تصعّب الهندسة العكسية لكنها ليست حماية مضمونة. أي كود يصل
لجهاز المستخدم يمكن نظرياً استخراجه. للمنطق الحسّاس فعلاً، أبقِه على سيرفرك.
