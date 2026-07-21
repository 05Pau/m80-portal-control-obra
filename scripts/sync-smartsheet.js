// Sincroniza la Línea Base 20240101-M80-LB desde la API de Smartsheet
// y regenera data.json en la raíz del repo. Lo ejecuta el workflow
// de GitHub Actions (.github/workflows/sync-smartsheet.yml).
const fs = require('fs');
const path = require('path');

const TOKEN = process.env.SMARTSHEET_TOKEN;
const SHEET_NAME = '20240101-M80-LB';

if (!TOKEN) {
  console.error('Falta la variable de entorno SMARTSHEET_TOKEN');
  process.exit(1);
}

function normalize(v) {
  return (v === undefined || v === null) ? '' : String(v).trim();
}

function tramoKeyFromLabel(label) {
  const match = label.match(/(\d+)/);
  return 'tramo' + (match ? match[1] : normalize(label).toLowerCase().replace(/\s+/g, ''));
}

function tramoDisplayLabel(label) {
  return /tramo/i.test(label) ? label : `Tramo ${label}`;
}

function subtramoDisplayLabel(code) {
  return code.toUpperCase() === 'GEN' ? 'General' : `Subtramo ${code}`;
}

async function smartsheetGet(apiPath) {
  const res = await fetch(`https://api.smartsheet.com/2.0${apiPath}`, {
    headers: { Authorization: `Bearer ${TOKEN}` }
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Smartsheet API ${apiPath} -> ${res.status}: ${text}`);
  }
  return res.json();
}

function cellValue(row, colIdByTitle, title) {
  const id = colIdByTitle[title];
  if (!id) return '';
  const cell = row.cells.find(c => c.columnId === id);
  if (!cell) return '';
  return normalize(cell.displayValue !== undefined && cell.displayValue !== null ? cell.displayValue : cell.value);
}

async function main() {
  const sheetsResp = await smartsheetGet('/sheets?includeAll=true');
  const sheetMeta = (sheetsResp.data || []).find(s => s.name === SHEET_NAME);
  if (!sheetMeta) {
    const names = (sheetsResp.data || []).map(s => s.name).join(', ');
    throw new Error(`No se encontró la hoja "${SHEET_NAME}" en las hojas visibles para este token. Hojas disponibles: ${names}`);
  }

  const sheet = await smartsheetGet(`/sheets/${sheetMeta.id}`);

  const colIdByTitle = {};
  for (const col of sheet.columns) {
    colIdByTitle[normalize(col.title).toUpperCase()] = col.id;
  }

  const requiredCols = ['TRAMO', 'SUBTRAMO', 'ACTIVO', 'LINK INFORME'];
  const missing = requiredCols.filter(c => !(c in colIdByTitle));
  if (missing.length) {
    console.warn(`Advertencia: no se encontraron estas columnas: ${missing.join(', ')}. Columnas reales en la hoja: ${sheet.columns.map(c => c.title).join(', ')}`);
  }

  const data = {};
  const tramoOrderSeen = [];
  let lastTramoLabel = '';
  let lastSubtramoCode = '';

  for (const row of sheet.rows) {
    const activoName = cellValue(row, colIdByTitle, 'ACTIVO');
    if (!activoName) continue; // fila sin activo (encabezado/agrupación) — se ignora

    const tramoLabelRaw = cellValue(row, colIdByTitle, 'TRAMO') || lastTramoLabel;
    const subtramoCode = cellValue(row, colIdByTitle, 'SUBTRAMO') || lastSubtramoCode;
    const link = cellValue(row, colIdByTitle, 'LINK INFORME');

    lastTramoLabel = tramoLabelRaw;
    lastSubtramoCode = subtramoCode;

    if (!tramoLabelRaw || !subtramoCode) {
      console.warn(`Fila ignorada por falta de TRAMO/SUBTRAMO: activo "${activoName}"`);
      continue;
    }

    const tramoKey = tramoKeyFromLabel(tramoLabelRaw);
    if (!data[tramoKey]) {
      data[tramoKey] = { label: tramoDisplayLabel(tramoLabelRaw), subtramos: {} };
      tramoOrderSeen.push(tramoKey);
    }

    const subtramos = data[tramoKey].subtramos;
    if (!subtramos[subtramoCode]) {
      subtramos[subtramoCode] = {
        label: subtramoDisplayLabel(subtramoCode),
        code: subtramoCode,
        activos: []
      };
    }

    subtramos[subtramoCode].activos.push({
      name: activoName,
      report: /^https?:\/\//i.test(link) ? link : null
    });
  }

  if (Object.keys(data).length === 0) {
    throw new Error('La sincronización no produjo ningún tramo/activo — revisar nombres de columnas o contenido de la hoja antes de publicar data.json vacío.');
  }

  const knownOrder = ['tramo1', 'tramo2', 'tramo3'];
  const tramosOrder = knownOrder.map(key => ({
    key,
    label: data[key] ? data[key].label : tramoDisplayLabel(key.replace('tramo', '')),
    enabled: !!data[key]
  }));
  for (const key of tramoOrderSeen) {
    if (!tramosOrder.find(t => t.key === key)) {
      tramosOrder.push({ key, label: data[key].label, enabled: true });
    }
  }

  const output = {
    generatedAt: new Date().toISOString(),
    source: SHEET_NAME,
    data,
    tramosOrder
  };

  const outPath = path.join(__dirname, '..', 'data.json');
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2) + '\n');
  console.log(`OK: ${Object.keys(data).length} tramo(s) sincronizados en ${outPath}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
