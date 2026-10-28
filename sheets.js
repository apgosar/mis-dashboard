const { google } = require('googleapis');
const path = require('path');

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

async function getAuthClient() {
  let authOptions;

  // Cloud: use GOOGLE_CREDENTIALS_JSON env var (full JSON content)
  if (process.env.GOOGLE_CREDENTIALS_JSON) {
    authOptions = {
      credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON),
      scopes: SCOPES,
    };
  } else {
    // Local: use key file
    const credentialsPath = process.env.CREDENTIALS_PATH || './credentials.json';
    authOptions = {
      keyFile: path.resolve(__dirname, credentialsPath),
      scopes: SCOPES,
    };
  }

  const auth = new google.auth.GoogleAuth(authOptions);
  return auth.getClient();
}

async function getSheetsApi() {
  const authClient = await getAuthClient();
  return google.sheets({ version: 'v4', auth: authClient });
}

async function fetchSheetData(range = process.env.SHEET_NAME || 'Sheet 1') {
  const sheets = await getSheetsApi();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range,
  });
  return response.data.values || [];
}

async function updateRange(range, values) {
  const sheets = await getSheetsApi();
  await sheets.spreadsheets.values.update({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range,
    valueInputOption: 'RAW',
    requestBody: { values },
  });
}

module.exports = { fetchSheetData, updateRange };
