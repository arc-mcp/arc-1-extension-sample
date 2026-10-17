// Opt-in: use an authorized classic test system and explicit, existing fixtures.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../cli.js', import.meta.resolve('arc-1/public')));
const plugin = fileURLToPath(new URL('../dist/forms.js', import.meta.url));
const required = (key) => {
  assert.ok(process.env[key], `${key} must name an existing test fixture`);
  return process.env[key];
};
const sapscript = required('SAMPLE_SAPSCRIPT_FORM');
const text = required('SAMPLE_SO10_TEXT');
const language = process.env.SAMPLE_LANGUAGE ?? 'E';
const env = {
  ...process.env,
  ARC1_PLUGINS: plugin,
  SAP_ALLOW_WRITES: 'false',
  SAP_ALLOW_PLUGIN_EXECUTE: 'false',
  SAP_ALLOW_PLUGIN_RAW_WRITES: 'false',
};

function read(args) {
  const output = execFileSync(
    process.execPath,
    [cli, 'call', 'Custom_ReadForm', '--json', JSON.stringify(args), '--output', 'json'],
    {
      env,
      encoding: 'utf8',
      timeout: 120000,
      maxBuffer: 2 * 1024 * 1024,
    },
  );
  const toolResult = JSON.parse(output);
  const result = JSON.parse(toolResult.content[0].text);
  assert.equal(result.name, args.name);
  assert.equal(result.kind, args.kind);
  assert.equal(result.language, args.language);
  return result.content;
}

const form = read({ kind: 'sapscript', name: sapscript, language });
assert.equal(form.header.tdform, sapscript);
assert.ok(form.pages.length > 0 && form.windows.length > 0, 'fixture needs pages and windows');
assert.ok(Array.isArray(form.lines) && Array.isArray(form.paragraphs));
const so10 = read({ kind: 'so10', name: text, language, textId: process.env.SAMPLE_TEXT_ID ?? 'ST' });
assert.equal(so10.header.tdobject, 'TEXT');
assert.ok(so10.lines.length > 0, 'fixture needs text lines');
const smart = read({ kind: 'smartform', name: process.env.SAMPLE_SMARTFORM ?? 'SF_EXAMPLE_01', language });
assert.ok(smart.xml.includes('<sf:SMARTFORM') && smart.xml.includes('<sf:PAGE') && smart.xml.includes('<sf:WINDOW'));
if (process.env.SAMPLE_EXPECT_NOLANGUAGE === 'true') {
  assert.ok(smart.xml.includes('<NOLANGUAGE>X</NOLANGUAGE>'), 'fixture needs a language-independent text node');
}
console.log(
  'PASS: SAPscript structure, SO10 ITF and SmartForm XML through the loaded extension; write gates disabled.',
);
