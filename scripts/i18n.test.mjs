import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

async function loadTypeScript(file) {
  const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
}
const { detectLocale, createTranslator, interpolate } = await loadTypeScript('../src/i18n/core.ts');
assert.equal(detectLocale(null, ['zh-CN', 'en-US']), 'zh-CN');
assert.equal(detectLocale(null, ['en-GB', 'zh-CN']), 'en');
assert.equal(detectLocale('zh-CN', ['en-US']), 'zh-CN');
assert.equal(detectLocale('en', ['zh-CN']), 'en');
assert.equal(detectLocale('invalid', ['fr-FR', 'en-AU']), 'en');
assert.equal(detectLocale(null, ['zh-TW']), 'zh-CN');
assert.equal(detectLocale(null, []), 'en');
assert.equal(interpolate('{count} / {missing}', { count: 0 }), '0 / {missing}');
const t = createTranslator({ '连接失败': 'Connection failed', '设备 {0}：进度 {1}%': 'Device {0}: {1}% complete', '文件 ({0}) [x]': 'File ({0}) [x]' });
assert.equal(t('en', '连接失败'), 'Connection failed');
assert.equal(t('zh-CN', 'Connection failed'), '连接失败');
assert.equal(t('en', '设备 SN123：进度 50%'), 'Device SN123: 50% complete');
assert.equal(t('zh-CN', 'Device SN123: 50% complete'), '设备 SN123：进度 50%');
assert.equal(t('en', '设备 {0}：进度 {1}%', undefined, { 0: 'A', 1: 0 }), 'Device A: 0% complete');
assert.equal(t('en', '文件 (猫咪.mp4) [x]'), 'File (猫咪.mp4) [x]');
assert.equal(t('en', 'A user title / 未知素材'), 'A user title / 未知素材');
const specific = createTranslator({ '{0}帧': '{0} frames', '转换完成，共 {0}帧': 'Conversion complete: {0} frames' });
assert.equal(specific('en', '转换完成，共 24帧'), 'Conversion complete: 24 frames');
assert.equal(t('en', '你好 {name}', 'Hello {name}', { name: '<script>' }), 'Hello <script>');

const directory = new URL('../src/i18n/', import.meta.url);
let entries = 0;
for (const file of fs.readdirSync(directory).filter(file => /[Mm]essages\.ts$/.test(file))) {
  const exported = await loadTypeScript('../src/i18n/' + file);
  const messages = Object.values(exported)[0];
  for (const [source, english] of Object.entries(messages)) {
    assert.equal(typeof english, 'string', `${file}: ${source}`);
    assert.ok(english.trim() || ["张", "条", "个", "台", "次", "份"].includes(source), `${file}: empty English translation for ${source}`);
    const placeholders = value => [...new Set([...value.matchAll(/\{(\w+)\}/g)].map(match => match[1]))].sort();
    assert.deepEqual(placeholders(english), placeholders(source), `${file}: interpolation mismatch for ${source}`);
    entries++;
  }
}
console.log(`Locale detection, fallback, interpolation, reversible status messages and ${entries} dictionary entries passed.`);
