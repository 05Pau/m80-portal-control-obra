// Script de diagnóstico temporal: vuelca columnas reales y una muestra
// de filas (todas las celdas) para entender la estructura real de la
// hoja antes de ajustar sync-smartsheet.js. No se usa en producción.
const TOKEN = process.env.SMARTSHEET_TOKEN;
const SHEET_NAME = '20240101-M80-LB';

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

async function main() {
  const sheetsResp = await smartsheetGet('/sheets?includeAll=true');
  const sheetMeta = (sheetsResp.data || []).find(s => s.name === SHEET_NAME);
  if (!sheetMeta) throw new Error(`No se encontró la hoja "${SHEET_NAME}"`);

  const sheet = await smartsheetGet(`/sheets/${sheetMeta.id}`);

  console.log('=== COLUMNAS ===');
  for (const col of sheet.columns) {
    console.log(`id=${col.id} title="${col.title}" type=${col.type} index=${col.index}`);
  }

  console.log('\n=== PRIMERAS 40 FILAS (todas las celdas) ===');
  const colTitleById = {};
  for (const col of sheet.columns) colTitleById[col.id] = col.title;

  const sample = sheet.rows.slice(0, 40);
  for (const row of sample) {
    const cells = row.cells
      .filter(c => c.value !== undefined && c.value !== null && c.value !== '')
      .map(c => `${colTitleById[c.columnId]}="${c.displayValue !== undefined ? c.displayValue : c.value}"`)
      .join(' | ');
    console.log(`row#${row.rowNumber} id=${row.id} parentId=${row.parentId || ''} level=${row.level || ''} :: ${cells}`);
  }

  console.log(`\nTotal filas en la hoja: ${sheet.rows.length}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
