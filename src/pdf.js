import puppeteer from 'puppeteer';
import fs from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

// Renders the report HTML to a PDF file via headless Chromium.
// We use a slightly larger viewport so the 640px-wide email layout sits
// comfortably on Letter-size paper with margins, and we force background
// graphics (the dark theme + zone gradients) to print.
export async function htmlToPdf({ html, outputPath }) {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 800, height: 1200, deviceScaleFactor: 2 });
    await page.setContent(html, { waitUntil: 'networkidle0' });

    // Make sure the dark background actually paints (Chrome's default for
    // print is to drop background colors).
    await page.addStyleTag({
      content: `
        html, body { background: #0a0a0f !important; }
        * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
      `,
    });

    await page.pdf({
      path: outputPath,
      format: 'Letter',
      printBackground: true,
      margin: { top: '0.5in', bottom: '0.5in', left: '0.4in', right: '0.4in' },
      preferCSSPageSize: false,
    });
  } finally {
    await browser.close();
  }

  // macOS Preview will flag a PDF as "Locked" if the file carries the
  // user-immutable flag or has the com.apple.quarantine xattr — both can
  // sneak in when the file is written by a sandboxed/headless process.
  // Make sure the PDF is plain, writable, and unflagged so the user can
  // save / Save-As / edit it like any normal file.
  await unlockFile(outputPath);

  return outputPath;
}

async function unlockFile(filePath) {
  try {
    fs.chmodSync(filePath, 0o644);
  } catch {
    // best-effort
  }
  if (process.platform !== 'darwin') return;

  // Clear all extended attributes (quarantine, FinderInfo, etc.).
  try {
    await execFileAsync('xattr', ['-c', filePath]);
  } catch {
    // xattr may not exist on minimal systems; ignore.
  }
  // Clear user-immutable / system-immutable flags that show up as the
  // padlock badge in Finder and trigger Preview's "locked" banner.
  try {
    await execFileAsync('chflags', ['nouchg,noschg', filePath]);
  } catch {
    // best-effort
  }
}
