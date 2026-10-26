import ExcelJS from "exceljs";

 












const HEADERS = [
  "Tarih",
  "Tedarikçi",
  "Öğe açıklaması",
  "Adet",
  "Miktar (TL)",
  "Miktar (USD)",
  "Miktar (EUR)",
  "Ödeme türü",
  "Ödeme Yapılan Kart",
  "Harcamayı Yapan Kişi",
  "Fatura",
] ;

const AMOUNT_FORMATS = ['#,##0.00" TL"', '#,##0.00" USD"', '#,##0.00" EUR"'] ;

function amountFor(row, currency) {
  if (row.currency !== currency) return null;
  const value = Number(row.amount);
  return Number.isFinite(value) ? value : null;
}

export async function buildInvoiceWorkbook(rows, origin) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Flywork";
  const sheet = workbook.addWorksheet("Faturalar");
  sheet.columns = HEADERS.map((header, index) => ({
    header,
    width: [14, 28, 36, 10, 16, 16, 16, 16, 24, 24, 36][index],
  }));

  const header = sheet.getRow(1);
  header.font = { name: "Arial", bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF5F7F99" } };
  header.alignment = { vertical: "middle", wrapText: true };
  header.height = 24;

  rows.forEach((row, index) => {
    const line = sheet.getRow(index + 2);
    const [year, month, day] = row.issuedOn.split("-").map(Number);
    line.getCell(1).value = new Date(Date.UTC(year, month - 1, day));
    line.getCell(1).numFmt = "dd.mm.yyyy";
    line.getCell(2).value = row.vendor;
    line.getCell(3).value = row.description;
    line.getCell(4).value = row.quantity;
    const amounts = [amountFor(row, "TRY"), amountFor(row, "USD"), amountFor(row, "EUR")];
    amounts.forEach((value, column) => {
      if (value == null) return;
      const cell = line.getCell(5 + column);
      cell.value = value;
      cell.numFmt = AMOUNT_FORMATS[column];
    });
    line.getCell(8).value = row.paymentLabel;
    line.getCell(9).value = row.card;
    line.getCell(10).value = row.person;
    line.font = { name: "Arial", size: 11 };
    if (row.document?.id && row.document.fileName) {
      const file = line.getCell(11);
      file.value = {
        text: row.document.fileName,
        hyperlink: `${origin}/api/fatura-belge/${row.document.id}`,
      };
      file.font = { name: "Arial", size: 11, color: { argb: "FF047857" }, underline: true };
    }
  });

  if (rows.length > 0) {
    const totalRow = rows.length + 2;
    const last = totalRow - 1;
    sheet.getCell(`A${totalRow}`).value = "Toplam";
    sheet.getCell(`E${totalRow}`).value = { formula: `SUM(E2:E${last})` };
    sheet.getCell(`F${totalRow}`).value = { formula: `SUM(F2:F${last})` };
    sheet.getCell(`G${totalRow}`).value = { formula: `SUM(G2:G${last})` };
    ["E", "F", "G"].forEach((column, index) => {
      sheet.getCell(`${column}${totalRow}`).numFmt = AMOUNT_FORMATS[index];
    });
    sheet.getRow(totalRow).font = { name: "Arial", bold: true, size: 11 };
  }

  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: HEADERS.length } };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  const bytes = await workbook.xlsx.writeBuffer();
  return Buffer.from(bytes);
}
