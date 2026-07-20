import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");

const MANAGERS = [
  {
    id: "taya",
    name: "Тая",
    spreadsheetId: "1kjC6t8IMlipgE827-yqyJWUK0kZEU01gYxrNPn1sKSE"
  },
  {
    id: "kateryna",
    name: "Катерина",
    spreadsheetId: "1nLX2GGih9k6UJHDsH33_qK6IGquxzLGvWW7FQfMzt9Q"
  }
];

const DISPLAY_NAMES = new Map([
  ["РУ-tiktok", "TikTok — РУ"],
  ["УКР-tiktok", "TikTok — УКР"],
  ["legal-tiktok", "TikTok — Legal"],
  ["Рум - tiktok", "TikTok — Румунський"],
  ["Новинний - tiktok", "TikTok — Новинний"],
  ["РУ-inst", "Instagram — РУ"],
  ["УКР-inst", "Instagram — УКР"],
  ["legal-inst", "Instagram — Legal"],
  ["УЗБ - inst", "Instagram — УЗБ"],
  ["Новинний - inst", "Instagram — Новинний"],
  ["РУ-facebook", "Facebook — РУ"],
  ["ТЕЛЕГРАМ", "Telegram"],
  ["Ісп (cap) -tiktok", "TikTok — Іспанська (CAP)"],
  ["Marocco (europe)-tiktok", "TikTok — Марокко (Europe)"],
  ["Англ (e) - tiktok", "TikTok — Англійська (E)"],
  ["УЗБ (uz) - tiktok", "TikTok — Узбецька (UZ)"],
  ["Англ - INST", "Instagram — Англійська"],
  ["Рум - INST", "Instagram — Румунська"],
  ["УКР-facebook", "Facebook — Українська"]
]);

const OUTPUT_PATH = path.resolve("data/report.json");
const HEADER_SCAN_ROWS = 8;
const TODAY_ISO = toIsoDate(new Date());

async function main() {
  const managers = [];

  for (const manager of MANAGERS) {
    console.log(`Завантаження таблиці: ${manager.name}`);
    const workbookBuffer = await downloadSpreadsheet(manager.spreadsheetId);
    const workbook = XLSX.read(workbookBuffer, {
      type: "buffer",
      cellDates: true,
      raw: true
    });

    managers.push(parseManagerWorkbook(manager, workbook));
  }

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    managers
  };

  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  const accountsCount = managers.reduce((sum, manager) => sum + manager.accounts.length, 0);
  const recordsCount = managers.reduce(
    (sum, manager) => sum + manager.accounts.reduce((inner, account) => inner + account.records.length, 0),
    0
  );

  console.log(`Готово: ${managers.length} direct-менеджери, ${accountsCount} акаунтів, ${recordsCount} денних записів.`);
  console.log(`Файл: ${OUTPUT_PATH}`);
}

async function downloadSpreadsheet(spreadsheetId) {
  const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=xlsx`;
  let lastError;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        redirect: "follow",
        headers: {
          "user-agent": "direct-managers-dashboard/1.0"
        }
      });

      if (!response.ok) {
        throw new Error(`Google Sheets повернув HTTP ${response.status}`);
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
        const preview = buffer.toString("utf8", 0, Math.min(buffer.length, 180)).replace(/\s+/g, " ");
        throw new Error(`Отримано не XLSX-файл. Перевірте доступ «Усі, хто має посилання». Відповідь: ${preview}`);
      }

      return buffer;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await sleep(attempt * 1500);
    }
  }

  throw new Error(`Не вдалося завантажити Google Таблицю ${spreadsheetId}: ${lastError?.message || lastError}`);
}

function parseManagerWorkbook(manager, workbook) {
  const accounts = [];
  const ignoredSheets = [];

  workbook.SheetNames.forEach((sheetName) => {
    const worksheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(worksheet, {
      header: 1,
      raw: true,
      defval: null,
      blankrows: true
    });

    const parsed = parseAccountSheet(manager, sheetName, rows);
    if (parsed.account) accounts.push(parsed.account);
    else ignoredSheets.push({ sheet: sheetName, reason: parsed.reason });
  });

  return {
    id: manager.id,
    name: manager.name,
    spreadsheetId: manager.spreadsheetId,
    accounts,
    ignoredSheets
  };
}

function parseAccountSheet(manager, sheetName, rows) {
  if (!rows.length) {
    return { account: null, reason: "Порожній аркуш" };
  }

  const maxColumns = rows.reduce((max, row) => Math.max(max, row.length), 0);
  const columnHeaders = Array.from({ length: maxColumns }, (_, columnIndex) => {
    const parts = [];
    for (let rowIndex = 0; rowIndex < Math.min(HEADER_SCAN_ROWS, rows.length); rowIndex += 1) {
      const value = rows[rowIndex]?.[columnIndex];
      if (value !== null && value !== undefined && String(value).trim() !== "") {
        parts.push(String(value));
      }
    }
    return normalizeText(parts.join(" "));
  });

  const dateColumn = findColumn(columnHeaders, (header) => header.includes("дата")) ?? 0;
  const totalChatsColumn = findColumn(columnHeaders, (header) => header.includes("загальні чати"));
  const totalNumbersColumn = findColumn(columnHeaders, (header) => (
    header.includes("всього номерів разом") ||
    header.includes("всього номерів") ||
    header.includes("всего номеров")
  ));

  const chatColumns = totalChatsColumn !== null
    ? [totalChatsColumn]
    : findColumns(columnHeaders, (header) => [
      "к сть чатів",
      "кількість чатів",
      "к сть звернень",
      "кількість звернень",
      "к сть написаних",
      "кількість написаних"
    ].some((pattern) => header.includes(pattern)));

  if (!chatColumns.length || totalNumbersColumn === null) {
    return {
      account: null,
      reason: "Не знайдено одночасно колонки чатів і загальної кількості номерів"
    };
  }

  const recordsByDate = new Map();

  rows.forEach((row) => {
    const dateIso = parseDateCell(row?.[dateColumn]);
    if (!dateIso || dateIso > TODAY_ISO) return;

    const chatValues = chatColumns.map((column) => toNumber(row?.[column]));
    const totalNumbersValue = toNumber(row?.[totalNumbersColumn]);

    let hasData;
    let chats;

    if (totalChatsColumn !== null) {
      hasData = chatValues[0] !== null || (totalNumbersValue !== null && totalNumbersValue > 0);
      chats = chatValues[0] ?? 0;
    } else {
      hasData = chatValues.some((value) => value !== null) || (totalNumbersValue !== null && totalNumbersValue > 0);
      chats = chatValues.reduce((sum, value) => sum + (value ?? 0), 0);
    }

    if (!hasData) return;

    const record = {
      date: dateIso,
      chats: roundMetric(chats),
      numbers: roundMetric(totalNumbersValue ?? 0)
    };

    const previous = recordsByDate.get(dateIso);
    if (!previous || activityScore(record) > activityScore(previous)) {
      recordsByDate.set(dateIso, record);
    }
  });

  const records = [...recordsByDate.values()].sort((first, second) => first.date.localeCompare(second.date));
  if (!records.length) {
    return { account: null, reason: "Немає рядків із датою та показниками" };
  }

  return {
    account: {
      id: stableId(manager.id, sheetName),
      sheetName,
      name: DISPLAY_NAMES.get(sheetName) || prettifySheetName(sheetName),
      platform: detectPlatform(sheetName),
      records
    },
    reason: null
  };
}

function normalizeText(value) {
  return String(value ?? "")
    .toLocaleLowerCase("uk-UA")
    .replace(/[\r\n]+/g, " ")
    .replace(/[^\p{L}\p{N}%]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function findColumn(headers, predicate) {
  const index = headers.findIndex(predicate);
  return index === -1 ? null : index;
}

function findColumns(headers, predicate) {
  const indexes = [];
  headers.forEach((header, index) => {
    if (predicate(header)) indexes.push(index);
  });
  return indexes;
}

function parseDateCell(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return toIsoDate(value);
  }

  if (typeof value === "number" && Number.isFinite(value) && value > 20000) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed?.y && parsed?.m && parsed?.d) {
      return `${parsed.y}-${pad(parsed.m)}-${pad(parsed.d)}`;
    }
  }

  if (typeof value !== "string") return null;
  const text = value.trim();

  let match = text.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})$/);
  if (match) {
    const [, day, month, year] = match;
    return validIso(Number(year), Number(month), Number(day));
  }

  match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (match) {
    const [, year, month, day] = match;
    return validIso(Number(year), Number(month), Number(day));
  }

  return null;
}

function validIso(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}

function toNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;

  const normalized = value.trim().replace(/\s+/g, "").replace(",", ".");
  if (!normalized || normalized === "-" || normalized === "—") return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function roundMetric(value) {
  return Math.round((Number(value) + Number.EPSILON) * 1_000_000) / 1_000_000;
}

function activityScore(record) {
  return Math.abs(record.chats) + Math.abs(record.numbers);
}

function detectPlatform(sheetName) {
  const normalized = normalizeText(sheetName);
  if (normalized.includes("tiktok")) return "TikTok";
  if (normalized.includes("inst")) return "Instagram";
  if (normalized.includes("facebook") || normalized.includes("фб")) return "Facebook";
  if (normalized.includes("телеграм") || normalized.includes("telegram")) return "Telegram";
  return "Інше";
}

function prettifySheetName(sheetName) {
  const normalized = sheetName
    .replace(/\s*-?\s*tiktok/gi, "")
    .replace(/\s*-?\s*inst(?:agram)?/gi, "")
    .replace(/\s*-?\s*facebook/gi, "")
    .trim();
  const platform = detectPlatform(sheetName);
  return platform === "Інше" ? sheetName : `${platform} — ${normalized || sheetName}`;
}

function stableId(managerId, sheetName) {
  let hash = 2166136261;
  for (const character of `${managerId}:${sheetName}`) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `${managerId}-${(hash >>> 0).toString(36)}`;
}

function toIsoDate(date) {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  return `${year}-${pad(month)}-${pad(day)}`;
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
