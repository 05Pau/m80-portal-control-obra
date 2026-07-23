// Sincroniza la Línea Base 20240101-M80-LB desde la API de Smartsheet
// y regenera data.json en la raíz del repo. Lo ejecuta el workflow
// de GitHub Actions (.github/workflows/sync-smartsheet.yml).
//
// Estructura real de la hoja (confirmada a mano, no es un listado plano):
// cada Activo tiene muchas filas hijas de desglose de tareas que repiten
// TRAMO/SUBTRAMO. La fila del Activo en sí se identifica con ANC = 1,
// y su nombre real vive en la columna G-NOMBRE_TAREA (la columna ACTIVO
// viene vacía a este nivel).
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

// Algunos textos ya vienen mal codificados desde Smartsheet (mojibake
// heredado de una importación previa, ej. "EstaciÃ³n" en vez de "Estación").
// Se reinterpretan los bytes como Latin-1 y se re-decodifican como UTF-8.
// Si el resultado queda con caracteres inválidos, se conserva el original
// en vez de mostrar un glifo roto.
function fixMojibake(s) {
  if (!s) return s;
  const fixed = Buffer.from(s, 'latin1').toString('utf8');
  return fixed.includes('�') ? s : fixed;
}

function tramoKeyFromLabel(label) {
  const match = label.match(/(\d+)/);
  return 'tramo' + (match ? match[1] : normalize(label).toLowerCase().replace(/\s+/g, ''));
}

function tramoDisplayLabel(label) {
  const match = label.match(/(\d+)/);
  return match ? `Tramo ${match[1]}` : label;
}

function subtramoDisplayLabel(code) {
  return /^gen(eral)?$/i.test(code) ? 'General' : `Subtramo ${code}`;
}

// La columna LATITUD_LONGITUD viene como texto "6.2518, -75.5636" (u otros
// separadores). Se intenta extraer dos números decimales con signo.
function parseLatLng(raw) {
  if (!raw) return null;
  const nums = raw.match(/-?\d+\.\d+/g);
  if (!nums || nums.length < 2) return null;
  const lat = parseFloat(nums[0]);
  const lng = parseFloat(nums[1]);
  if (Number.isNaN(lat) || Number.isNaN(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
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

  const requiredCols = ['ANC', 'TRAMO', 'SUBTRAMO', 'G-NOMBRE_TAREA', 'LINK INFORME', 'LATITUD_LONGITUD'];
  const missing = requiredCols.filter(c => !(c in colIdByTitle));
  if (missing.length) {
    console.warn(`Advertencia: no se encontraron estas columnas: ${missing.join(', ')}. Columnas reales en la hoja: ${sheet.columns.map(c => c.title).join(', ')}`);
  }

  const groups = new Map(); // key "tramo|||subtramo|||activo" -> { tramoLabel, subtramoCode, activoName, report }

  for (const row of sheet.rows) {
    const anc = cellValue(row, colIdByTitle, 'ANC');
    if (anc !== '1') continue; // solo filas de Activo real, no las tareas de desglose

    const tramoLabel = fixMojibake(cellValue(row, colIdByTitle, 'TRAMO'));
    const subtramoCode = fixMojibake(cellValue(row, colIdByTitle, 'SUBTRAMO'));
    const activoName = fixMojibake(cellValue(row, colIdByTitle, 'G-NOMBRE_TAREA')).replace(/ /g, ' ');
    const link = cellValue(row, colIdByTitle, 'LINK INFORME');
    const latLng = parseLatLng(cellValue(row, colIdByTitle, 'LATITUD_LONGITUD'));

    if (!tramoLabel || !subtramoCode || !activoName) {
      console.warn(`Fila con ANC=1 ignorada por faltarle TRAMO/SUBTRAMO/nombre: row#${row.rowNumber}`);
      continue;
    }

    const key = `${tramoLabel}|||${subtramoCode}|||${activoName}`;
    if (!groups.has(key)) {
      groups.set(key, { tramoLabel, subtramoCode, activoName, report: null, lat: null, lng: null });
    }
    const g = groups.get(key);
    if (!g.report && /^https?:\/\//i.test(link)) {
      g.report = link;
    }
    if (g.lat === null && latLng) {
      g.lat = latLng.lat;
      g.lng = latLng.lng;
    }
  }

  if (groups.size === 0) {
    throw new Error('La sincronización no produjo ningún activo (ANC=1) — revisar nombres de columnas o el valor de ANC antes de publicar data.json vacío.');
  }

  const data = {};
  const tramoOrderSeen = [];

  for (const g of groups.values()) {
    const tramoKey = tramoKeyFromLabel(g.tramoLabel);
    if (!data[tramoKey]) {
      data[tramoKey] = { label: tramoDisplayLabel(g.tramoLabel), subtramos: {} };
      tramoOrderSeen.push(tramoKey);
    }
    const subtramos = data[tramoKey].subtramos;
    if (!subtramos[g.subtramoCode]) {
      subtramos[g.subtramoCode] = {
        label: subtramoDisplayLabel(g.subtramoCode),
        code: g.subtramoCode,
        activos: []
      };
    }
    subtramos[g.subtramoCode].activos.push({ name: g.activoName, report: g.report, lat: g.lat, lng: g.lng });
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
  console.log(`OK: ${groups.size} activo(s) en ${Object.keys(data).length} tramo(s) sincronizados en ${outPath}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
