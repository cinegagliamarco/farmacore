/* Gera docs/pricing-api.md (referência legível) a partir do OpenAPI.
 * Uso: node scripts/gen-pricing-api-md.cjs > docs/pricing-api.md */
const spec = require('../docs/pricing-api.openapi.json');
const S = spec.components.schemas;
const out = [];
const w = (s = '') => out.push(s);
const anchor = (n) => '#tipo-' + n.toLowerCase();

const refName = (r) => (r && r.$ref ? r.$ref.split('/').pop() : null);

function typeStr(sc) {
  if (!sc) return 'any';
  const n = refName(sc);
  if (n) return `[${n}](${anchor(n)})`;
  if (sc.const !== undefined) return `\`"${sc.const}"\``;
  if (sc.enum) return sc.enum.map((e) => `\`${e}\``).join(' \\| ');
  if (sc.oneOf) return sc.oneOf.map(typeStr).join(' \\| ');
  if (sc.allOf) return sc.allOf.map(typeStr).join(' & ');
  if (sc.type === 'array') return typeStr(sc.items) + '[]';
  let t = sc.type || 'object';
  if (sc.format) t += ` (${sc.format})`;
  if (sc.nullable) t += ' \\| null';
  return t;
}

function constraints(sc) {
  const c = [];
  if (sc.minLength != null || sc.maxLength != null) c.push(`len ${sc.minLength ?? 0}..${sc.maxLength ?? '∞'}`);
  if (sc.minimum != null || sc.maximum != null) c.push(`${sc.minimum ?? '-∞'}..${sc.maximum ?? '∞'}`);
  if (sc.minItems != null || sc.maxItems != null) c.push(`itens ${sc.minItems ?? 0}..${sc.maxItems ?? '∞'}`);
  if (sc.pattern) c.push('regex `' + sc.pattern + '`');
  if (sc.nullable) c.push('nullable');
  if (sc.description) c.push(sc.description);
  return c.join('; ');
}

// ---- header ----
w('# Pricing API — Referência');
w('');
w('> Gerado de `docs/pricing-api.openapi.json` (OpenAPI ' + spec.openapi + ') por `scripts/gen-pricing-api-md.cjs`. **Fonte de verdade é o JSON** (importável no Swagger UI / Postman); este arquivo é a versão legível.');
w('');
w('## Convenções');
w('');
w(spec.info.description.split('. ').map((s) => '- ' + s.trim() + (s.endsWith('.') ? '' : '.')).join('\n'));
w('');
w('**Auth:** `Authorization: Bearer <accessToken>` (JWT). `x-roles` indica os papéis exigidos; sem JWT → 401, role insuficiente → 403.');
w('');

// ---- índice de operações ----
w('## Operações');
w('');
w('| Método | Path | Roles | Resumo |');
w('|---|---|---|---|');
const ORDER = ['get', 'post', 'patch', 'put', 'delete'];
for (const p of Object.keys(spec.paths)) {
  for (const m of ORDER) {
    const op = spec.paths[p][m];
    if (!op) continue;
    const roles = op['x-roles'] ? op['x-roles'].join('/') : op.security && op.security.length === 0 ? 'público' : 'autenticado';
    w(`| ${m.toUpperCase()} | \`${p}\` | ${roles} | ${op.summary || ''} |`);
  }
}
w('');

// ---- endpoints por tag ----
w('## Endpoints');
w('');
for (const tag of spec.tags) {
  const eps = [];
  for (const p of Object.keys(spec.paths)) {
    for (const m of ORDER) {
      const op = spec.paths[p][m];
      if (op && (op.tags || []).includes(tag.name)) eps.push({ p, m, op });
    }
  }
  if (!eps.length) continue;
  w(`### ${tag.name} — ${tag.description}`);
  w('');
  for (const { p, m, op } of eps) {
    const roles = op['x-roles'] ? op['x-roles'].join('/') : op.security && op.security.length === 0 ? 'público' : 'autenticado';
    w(`#### \`${m.toUpperCase()} ${p}\``);
    w('');
    w(`- **Roles:** ${roles}`);
    if (op.summary) w(`- **Resumo:** ${op.summary}`);
    if (op.description) w(`- **Detalhe:** ${op.description}`);
    const params = (op.parameters || []).filter((x) => x.in === 'query');
    if (params.length) {
      w('- **Query:**');
      for (const q of params) w(`  - \`${q.name}\`: ${typeStr(q.schema)}${q.description ? ' — ' + q.description : ''}`);
    }
    if (op.requestBody) {
      const sc = op.requestBody.content['application/json'].schema;
      w(`- **Body:** ${typeStr(sc)}`);
    }
    w('- **Respostas:**');
    for (const code of Object.keys(op.responses)) {
      const r = op.responses[code];
      const sc = r.content && r.content['application/json'] ? r.content['application/json'].schema : null;
      w(`  - \`${code}\` — ${r.description}${sc ? ' → ' + typeStr(sc) : ''}`);
    }
    w('');
  }
}

// ---- tipos ----
w('## Tipos');
w('');
for (const name of Object.keys(S)) {
  const sc = S[name];
  w(`### Tipo: ${name}`);
  w('');
  if (sc.enum) {
    w('Enum: ' + sc.enum.map((e) => `\`${e}\``).join(', ') + (sc.nullable ? ' (nullable)' : '') + '.');
    w('');
    continue;
  }
  if (sc.allOf) {
    w('Composto (`allOf`): ' + sc.allOf.map(typeStr).join(' & ') + '.');
    w('');
    continue;
  }
  if (sc.oneOf) {
    w('União (`oneOf`)' + (sc.discriminator ? ` discriminada por \`${sc.discriminator.propertyName}\`` : '') + ':');
    for (const v of sc.oneOf) w('- ' + typeStr(v) + (v.properties ? ' — { ' + Object.keys(v.properties).join(', ') + ' }' : ''));
    w('');
    continue;
  }
  const props = sc.properties || {};
  if (!Object.keys(props).length) {
    w((sc.description || sc.type || 'object') + '.');
    w('');
    continue;
  }
  if (sc.description) { w('> ' + sc.description); w(''); }
  const req = new Set(sc.required || []);
  w('| Campo | Tipo | Obrig. | Notas |');
  w('|---|---|:--:|---|');
  for (const f of Object.keys(props)) {
    w(`| \`${f}\` | ${typeStr(props[f])} | ${req.has(f) ? '✓' : ''} | ${constraints(props[f])} |`);
  }
  w('');
}

process.stdout.write(out.join('\n') + '\n');
