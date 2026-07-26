// Diagnostico puntual: encuentra en que filas de la hoja quedo un valor
// no vacio en la columna AVANCE, sin filtrar por ANC=1, para ver donde
// realmente se escribieron los datos.
const TOKEN = process.env.SMARTSHEET_TOKEN;
const SHEET_NAME = '20240101-M80-LB';

async function smartsheetGet(apiPath) {
  const res = await fetch(`https://api.smartsheet.com/2.0${apiPath}`, {
    headers: { Authorization: `Bearer ${TOKEN}` }
  });
  if (!res.ok) throw new Error(`${apiPath} -> ${res.status}: ${await res.text()}`);
  return res.json();
}

function cellValue(row, colIdByTitle, title) {
  const id = colIdByTitle[title];
  if (!id) return '';
  const cell = row.cells.find(c => c.columnId === id);
  if (!cell) return '';
  const v = cell.displayValue !== undefined && cell.displayValue !== null ? cell.displayValue : cell.value;
  return v === undefined || v === null ? '' : String(v).trim();
}

async function main() {
  const sheetsResp = await smartsheetGet('/sheets?includeAll=true');
  const sheetMeta = sheetsResp.data.find(s => s.name === SHEET_NAME);
  const sheet = await smartsheetGet(`/sheets/${sheetMeta.id}`);

  const colIdByTitle = {};
  for (const col of sheet.columns) colIdByTitle[col.title.trim().toUpperCase()] = col.id;

  let encontrados = 0;
  for (const row of sheet.rows) {
    const avance = cellValue(row, colIdByTitle, 'AVANCE');
    if (avance) {
      encontrados++;
      const anc = cellValue(row, colIdByTitle, 'ANC');
      const tramo = cellValue(row, colIdByTitle, 'TRAMO');
      const sub = cellValue(row, colIdByTitle, 'SUBTRAMO');
      const nombreTarea = cellValue(row, colIdByTitle, 'G-NOMBRE_TAREA');
      const activo = cellValue(row, colIdByTitle, 'ACTIVO');
      console.log(`row#${row.rowNumber} ANC="${anc}" TRAMO="${tramo}" SUBTRAMO="${sub}" ACTIVO="${activo}" G-NOMBRE_TAREA="${nombreTarea}" AVANCE="${avance}"`);
    }
  }
  console.log(`Total filas con AVANCE no vacio: ${encontrados}`);
}

main().catch(err => { console.error(err); process.exit(1); });
