// run.js — يحمّل وحدات Hercules (لوا) ويشغّلها داخل المتصفح عبر Fengari (Lua VM)
// لا حاجة لأي سيرفر: كل شي يصير على جهاز المستخدم.

const MODULES = [
  "config.lua",
  "pipeline.lua",
  "modules/string_encoder.lua",
  "modules/variable_renamer.lua",
  "modules/control_flow_obfuscator.lua",
  "modules/garbage_code_inserter.lua",
  "modules/opaque_predicate_injector.lua",
  "modules/function_inliner.lua",
  "modules/dynamic_code_generator.lua",
  "modules/bytecode_encoder.lua",
  "modules/watermark.lua",
  "modules/compressor.lua",
  "modules/StringToExpressions.lua",
  "modules/WrapInFunction.lua",
  "modules/VMGenerator.lua",
  "modules/antitamper.lua",
  "modules/Compiler/bit.lua",
  "modules/Compiler/Opcode.lua",
  "modules/Compiler/Compiler.lua",
  "modules/Compiler/Serializer.lua",
  "modules/Compiler/Deserializer.lua",
  "modules/Compiler/VMStrings.lua",
];

let sources = {};      // اسم الموديول -> كود لوا
let ready = false;

// تحميل كل ملفات لوا مسبقاً كنصوص
async function loadSources() {
  const base = "hercules/";
  await Promise.all(MODULES.map(async (m) => {
    const res = await fetch(base + m);
    if (!res.ok) throw new Error("فشل تحميل " + m);
    // المفتاح المستخدم في require: نشيل .lua ونخلي المسار نسبي
    const key = m.replace(/\.lua$/, "");
    sources[key] = await res.text();
  }));
  ready = true;
}

// نبني بيئة لوا فيها require مخصص يقرأ من sources بدل نظام الملفات
function buildLua() {
  const { lua, lauxlib, lualib, to_luastring, to_jsstring } = fengari;
  const L = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(L);

  // package.loaded cache
  const loaded = {};

  // نعرّف دالة require عالمية بجافاسكربت تُستدعى من لوا
  // الطريقة: نسجّل searcher بسيط عبر تنفيذ كود لوا يفوّض لـ window.__hercRequire
  window.__hercRequire = function (name) {
    return name; // placeholder, نستبدله أدناه بمنطق فعلي داخل لوا نفسه
  };

  return { lua, lauxlib, lualib, to_luastring, to_jsstring, L, loaded };
}

// تنفيذ كود لوا نصاً وإرجاع قيمة سترنق من المكدس
function doString(ctx, code, chunkname) {
  const { lua, lauxlib, to_luastring } = ctx;
  const status = lauxlib.luaL_loadbuffer(
    ctx.L, to_luastring(code), null, to_luastring(chunkname || "=chunk")
  );
  if (status !== lua.LUA_OK) {
    const err = lua.lua_tojsstring(ctx.L, -1);
    lua.lua_pop(ctx.L, 1);
    throw new Error("تحميل (" + chunkname + "): " + err);
  }
  const r = lua.lua_pcall(ctx.L, 0, lua.LUA_MULTRET, 0);
  if (r !== lua.LUA_OK) {
    const err = lua.lua_tojsstring(ctx.L, -1);
    lua.lua_pop(ctx.L, 1);
    throw new Error("تشغيل (" + chunkname + "): " + err);
  }
}

// الدالة الرئيسية: تأخذ كود المستخدم + الإعدادات وترجّع الكود المشفّر
async function obfuscate(userCode, settings) {
  if (!ready) await loadSources();

  const { lua, lauxlib, lualib, to_luastring } = fengari;
  const L = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(L);

  // polyfill لدوال math اللي انحذفت في لوا 5.3+ (Fengari مبني على 5.3/5.4)
  // Hercules يستخدم ldexp/frexp/pow في الـ Compiler.
  let bootstrap = `
if not math.ldexp then
  function math.ldexp(m, e) return m * 2.0 ^ e end
end
if not math.frexp then
  function math.frexp(x)
    if x == 0 then return 0.0, 0 end
    local e = math.floor(math.log(math.abs(x)) / math.log(2)) + 1
    local m = x / (2.0 ^ e)
    return m, e
  end
end
if not math.pow then
  function math.pow(a, b) return a ^ b end
end
if not table.getn then
  function table.getn(t) return #t end
end
if not unpack then unpack = table.unpack end
if not loadstring then loadstring = load end
`;
  bootstrap += "local __src = {}\n";
  for (const key in sources) {
    // نمرّر الكود عبر long bracket مع مستوى مساوي لتجنب التعارض
    const lvl = "==="; // [===[ ... ]===]
    bootstrap += `__src[${luaQuote(key)}] = [${lvl}[\n${sources[key]}\n]${lvl}]\n`;
  }
  // require مخصص: يدعم المسارات بصيغة "modules/x" و "config" إلخ
  bootstrap += `
local __loaded = {}
local __realrequire = require
function require(name)
  name = tostring(name)
  if __loaded[name] ~= nil then return __loaded[name] end
  local code = __src[name]
  if not code then
    -- جرّب بدون امتداد أو بمسارات بديلة
    code = __src[name:gsub("%.", "/")]
  end
  if not code then
    error("module not found: " .. name)
  end
  local chunk, err = load(code, "@"..name)
  if not chunk then error("load "..name..": "..tostring(err)) end
  local res = chunk()
  if res == nil then res = true end
  __loaded[name] = res
  return res
end
`;

  // تطبيق الإعدادات على config قبل تشغيل الـ pipeline
  bootstrap += `
local config = require("config")
`;
  for (const path in settings) {
    if (path === "__watermark_text") continue; // نتعامل معه بشكل خاص
    const v = settings[path];
    const val = (typeof v === "boolean") ? (v ? "true" : "false") : String(v);
    bootstrap += `config.set(${luaQuote(path)}, ${val})\n`;
  }

  // watermark مخصص: نستبدل دالة الوحدة بنص المستخدم
  if (settings["settings.watermark_enabled"] && settings["__watermark_text"]) {
    const wm = settings["__watermark_text"];
    bootstrap += `
do
  local W = require("modules/watermark")
  W.process = function(code) return ${luaQuote("--[ " + wm + " ]")} .. "\\n" .. code end
end
`;
  }

  // نشغّل الـ pipeline على كود المستخدم
  bootstrap += `
local Pipeline = require("pipeline")
local __input = ${luaLongString(userCode)}
local ok, result = pcall(Pipeline.process, __input)
if not ok then
  __RESULT_ERR = tostring(result)
  __RESULT = nil
else
  __RESULT = result
  __RESULT_ERR = nil
end
`;

  // تنفيذ
  const status = lauxlib.luaL_loadbuffer(L, to_luastring(bootstrap), null, to_luastring("=hercules_boot"));
  if (status !== lua.LUA_OK) {
    const err = lua.lua_tojsstring(L, -1);
    throw new Error("خطأ تحميل: " + err);
  }
  const r = lua.lua_pcall(L, 0, lua.LUA_MULTRET, 0);
  if (r !== lua.LUA_OK) {
    const err = lua.lua_tojsstring(L, -1);
    throw new Error("خطأ تشغيل: " + err);
  }

  // اقرأ __RESULT_ERR و __RESULT من البيئة العامة
  lua.lua_getglobal(L, to_luastring("__RESULT_ERR"));
  if (lua.lua_isstring(L, -1)) {
    const e = lua.lua_tojsstring(L, -1);
    lua.lua_pop(L, 1);
    throw new Error("Hercules: " + e);
  }
  lua.lua_pop(L, 1);

  lua.lua_getglobal(L, to_luastring("__RESULT"));
  const out = lua.lua_tojsstring(L, -1);
  lua.lua_pop(L, 1);
  return out;
}

// أدوات تهريب نصوص لوا
function luaQuote(s) {
  return '"' + String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n") + '"';
}
function luaLongString(s) {
  // اختر مستوى أقواس آمن
  let lvl = "";
  while (s.indexOf("]" + lvl + "]") !== -1) lvl += "=";
  return "[" + lvl + "[\n" + s + "\n]" + lvl + "]";
}

window.SAObf = { obfuscate, loadSources };
