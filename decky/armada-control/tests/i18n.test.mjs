import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Buffer } from "node:buffer";
import ts from "typescript";

const compilerOptions = {
  module: ts.ModuleKind.ESNext,
  target: ts.ScriptTarget.ES2020,
};

async function compileModule(relativePath) {
  const source = await readFile(new URL(relativePath, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions, fileName: relativePath });
  return `data:text/javascript;base64,${Buffer.from(compiled.outputText).toString("base64")}`;
}

const localeModuleUrls = Object.fromEntries(await Promise.all(
  ["en", "es", "zh-CN", "pt-BR", "pt-PT"].map(async (locale) => [
    `./locales/${locale}`,
    await compileModule(`../src/locales/${locale}.ts`),
  ]),
));
const i18nSource = await readFile(new URL("../src/i18n.ts", import.meta.url), "utf8");
let i18nOutput = ts.transpileModule(i18nSource, { compilerOptions, fileName: "i18n.ts" }).outputText;
for (const [modulePath, moduleUrl] of Object.entries(localeModuleUrls)) {
  i18nOutput = i18nOutput.replace(`from "${modulePath}"`, `from "${moduleUrl}"`);
}
const moduleUrl = `data:text/javascript;base64,${Buffer.from(i18nOutput).toString("base64")}`;
const {
  localeStrings,
  localeFromLanguage,
  resolveLocale,
  translate,
  translateLabelForLocale,
} = await import(moduleUrl);

for (const locale of ["es", "zh-CN", "pt-BR", "pt-PT"]) {
  assert.deepEqual(Object.keys(localeStrings[locale]), Object.keys(localeStrings.en));
}

assert.equal(localeFromLanguage("english"), "en");
assert.equal(localeFromLanguage("schinese"), "zh-CN");
assert.equal(localeFromLanguage("SteamChina_SChinese"), "zh-CN");
assert.equal(localeFromLanguage("zh_Hans"), "zh-CN");
assert.equal(localeFromLanguage("pt_BR"), "pt-BR");
assert.equal(localeFromLanguage("brazilian"), "pt-BR");
assert.equal(localeFromLanguage("pt"), "pt-PT");
assert.equal(localeFromLanguage("portuguese"), "pt-PT");
assert.equal(localeFromLanguage("spanish"), "es");
assert.equal(localeFromLanguage("latam"), "es");
assert.equal(localeFromLanguage("es-419"), "es");
assert.equal(localeFromLanguage("es_MX"), "es");
assert.equal(localeFromLanguage("tchinese"), "en");
assert.equal(localeFromLanguage(""), null);

assert.equal(resolveLocale({ steamLanguage: "english", deckyLocales: ["zh-cn"] }), "en");
assert.equal(resolveLocale({ steamLanguage: "schinese", deckyLocales: ["en-us"] }), "zh-CN");
assert.equal(resolveLocale({ deckyLocales: ["zh-cn"], browserLanguages: ["en-US"] }), "zh-CN");
assert.equal(resolveLocale({ browserLanguages: ["zh-CN", "en-US"] }), "zh-CN");
assert.equal(resolveLocale({ steamLanguage: "brazilian", deckyLocales: ["pt-PT"] }), "pt-BR");
assert.equal(resolveLocale({ browserLanguages: ["pt-PT", "en-US"] }), "pt-PT");
assert.equal(resolveLocale({ steamLanguage: "latam", browserLanguages: ["en-US"] }), "es");
assert.equal(resolveLocale({ steamLanguage: "french", browserLanguages: ["es-MX"] }), "en");
assert.equal(resolveLocale({}), "en");

assert.equal(translate("en", "power.cpuGovernor"), "CPU Governor");
assert.equal(translate("zh-CN", "power.cpuGovernor"), "CPU 调频策略");
assert.equal(translate("zh-CN", "games.appFallback", { id: 123 }), "应用 123");
assert.equal(translate("pt-BR", "common.loading"), "Carregando");
assert.equal(translate("pt-PT", "common.loading"), "A carregar");
assert.equal(translateLabelForLocale("en", "Balanced"), "Balanced");
assert.equal(translateLabelForLocale("zh-CN", "Balanced"), "均衡");
assert.equal(translateLabelForLocale("zh-CN", "Big Cores (4-7)"), "大核心 (4-7)");
assert.equal(translateLabelForLocale("pt-BR", "Balanced"), "Balanceado");
assert.equal(translateLabelForLocale("pt-PT", "Balanced"), "Equilibrado");
assert.equal(translateLabelForLocale("zh-CN", "Untranslated runtime label"), "Untranslated runtime label");
assert.equal(translate("es", "common.saveChanges"), "Guardar cambios");
assert.equal(translate("es", "fanCurve.usedBy", { profiles: "Ahorro" }), "La usan: Ahorro");
assert.equal(translateLabelForLocale("es", "Big Cores (3-7)"), "Núcleos grandes (3-7)");
assert.equal(translateLabelForLocale("es", "Deep"), "Profundo");
assert.equal(
  translateLabelForLocale("es", "armada-rgb is not installed on this device"),
  "armada-rgb no está instalado en este dispositivo",
);

// Labels that reach the UI from data files and the system service are shown
// through translateLabel, so each must be a known English string.
const repo = new URL("../../../", import.meta.url).pathname;
const runtimeLabels = new Set(["All Cores"]);
const powerProfiles = readFileSync(join(repo, "system_files/usr/share/armada/power-profiles.conf"), "utf8");
for (const match of powerProfiles.matchAll(/^label=(.+)$/gm)) runtimeLabels.add(match[1].trim());
const fexProfiles = JSON.parse(readFileSync(join(repo, "system_files/usr/share/armada/fex-profiles.json"), "utf8"));
for (const profile of Object.values(fexProfiles.profiles ?? fexProfiles)) if (profile?.label) runtimeLabels.add(profile.label);
const service = readFileSync(join(repo, "system_files/usr/libexec/armada/armada-control"), "utf8");
const sleepLabels = /SLEEP_MODE_LABELS = \{([^}]*)\}/.exec(service);
assert.ok(sleepLabels, "SLEEP_MODE_LABELS not found in armada-control");
for (const match of sleepLabels[1].matchAll(/:\s*"([^"]+)"/g)) runtimeLabels.add(match[1]);
for (const match of service.matchAll(/RuntimeError\("([^"]+)"\)/g)) runtimeLabels.add(match[1]);
const system = readFileSync(join(repo, "decky/armada-control/py_modules/armada_control/system.py"), "utf8");
for (const match of system.matchAll(/\("\w+", "([^"]+)", "ARMADA_\w+"\)/g)) runtimeLabels.add(match[1]);
assert.ok(runtimeLabels.size > 20, `only found ${runtimeLabels.size} labels; the parsing above broke`);
const englishValues = new Set(Object.values(localeStrings.en));
const untranslated = [...runtimeLabels].filter((label) => !englishValues.has(label));
assert.deepEqual(untranslated, []);

// Components render text through t(), not as bare English.
const srcDir = new URL("../src/", import.meta.url).pathname;
function componentFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return componentFiles(path);
    return name.endsWith(".tsx") ? [path] : [];
  });
}
// Product and button names are not translated.
const untranslatable = new Set(["Armada Control", "LT", "RT"]);
const bareText = [];
for (const file of componentFiles(srcDir)) {
  const text = readFileSync(file, "utf8");
  const patterns = [
    />\s*([A-Za-z][^<>{}]*?)\s*<\//g,
    /\b(?:label|title|description|placeholder)="([^"]*[A-Za-z][^"]*)"/g,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      if (!untranslatable.has(match[1].trim())) bareText.push(`${file.slice(srcDir.length)}: ${match[1].trim()}`);
    }
  }
}
assert.deepEqual(bareText, []);

console.log("i18n tests passed: locale parity, translations, precedence, interpolation, runtime labels, and no bare component text");
