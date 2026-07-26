// Script puntual (de un solo uso): agrega la columna AVANCE a la Linea Base
// de Smartsheet, justo despues de LINK INFORME, para que el proceso de
// Edwin Cantor (Consolidado Power BI M80) pueda escribir ahi el AvancePct.
// Se borra del repo despues de correrlo una vez.
const TOKEN = process.env.SMARTSHEET_TOKEN;
const SHEET_NAME = '20240101-M80-LB';
const NEW_COLUMN_TITLE = 'AVANCE';

if (!TOKEN) {
  console.error('Falta la variable de entorno SMARTSHEET_TOKEN');
  process.exit(1);
}

async function smartsheetGet(apiPath) {
  const res = await fetch(`https://api.smartsheet.com/2.0${apiPath}`, {
    headers: { Authorization: `Bearer ${TOKEN}` }
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`GET ${apiPath} -> ${res.status}: ${text}`);
  }
  return res.json();
}

async function smartsheetPost(apiPath, body) {
  const res = await fetch(`https://api.smartsheet.com/2.0${apiPath}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`POST ${apiPath} -> ${res.status}: ${JSON.stringify(json)}`);
  }
  return json;
}

async function main() {
  const sheetsResp = await smartsheetGet('/sheets?includeAll=true');
  const sheetMeta = (sheetsResp.data || []).find(s => s.name === SHEET_NAME);
  if (!sheetMeta) {
    throw new Error(`No se encontro la hoja "${SHEET_NAME}"`);
  }

  const sheet = await smartsheetGet(`/sheets/${sheetMeta.id}`);

  const existing = sheet.columns.find(c => c.title.trim().toUpperCase() === NEW_COLUMN_TITLE);
  if (existing) {
    console.log(`La columna "${NEW_COLUMN_TITLE}" ya existe (id ${existing.id}), no se crea de nuevo.`);
    return;
  }

  const linkInforme = sheet.columns.find(c => c.title.trim().toUpperCase() === 'LINK INFORME');
  if (!linkInforme) {
    throw new Error('No se encontro la columna LINK INFORME para insertar AVANCE justo despues.');
  }

  const nuevaColumna = {
    title: NEW_COLUMN_TITLE,
    type: 'TEXT_NUMBER',
    index: linkInforme.index + 1,
  };

  const result = await smartsheetPost(`/sheets/${sheetMeta.id}/columns`, [nuevaColumna]);
  console.log('Columna creada:', JSON.stringify(result.result, null, 2));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
