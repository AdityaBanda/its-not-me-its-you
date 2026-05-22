#!/usr/bin/env node
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import readlineSync from 'readline-sync';
import chalk from 'chalk';
import ora from 'ora';

import { parseChatFiles } from './src/parser.js';
import { analyze } from './src/analyzer.js';
import { generateNarrative, generateOneLiner } from './src/ai_insights.js';
import { renderReport } from './src/renderer.js';
import { htmlToPdf } from './src/pdf.js';

const FLAGS = new Set(process.argv.slice(2).filter((a) => a.startsWith('--')));
const NO_AI = FLAGS.has('--no-ai');
const NO_OPEN = FLAGS.has('--no-open');
const HTML_ONLY = FLAGS.has('--html-only');

const LOADING_LINES = [
  'digging through your emotional damage…',
  'counting "k." replies…',
  'measuring Sunday Scaries…',
  'awarding the Sorry Trophy…',
  'triangulating the ghosts…',
  'auditing emoji personalities…',
  'putting your texts on trial…',
];

function pickLoading() {
  return LOADING_LINES[Math.floor(Math.random() * LOADING_LINES.length)];
}

function banner() {
  console.log('');
  console.log(chalk.magentaBright.bold("  ╔══════════════════════════════════════════╗"));
  console.log(chalk.magentaBright.bold("  ║      it's_not_me_its_you                 ║"));
  console.log(chalk.magentaBright.bold("  ╚══════════════════════════════════════════╝"));
  console.log(chalk.gray('         chat analysis with feelings'));
  console.log('');
}

function openLocal(file) {
  const cmd =
    process.platform === 'darwin' ? 'open'
      : process.platform === 'win32' ? 'start'
        : 'xdg-open';
  try {
    spawn(cmd, [file], { detached: true, stdio: 'ignore' }).unref();
  } catch {
    // best-effort
  }
}

function gatherChatFilesFromArgs() {
  const args = process.argv.slice(2);
  const files = [];
  for (const a of args) {
    if (a.startsWith('--')) continue;
    const p = path.resolve(a);
    if (!fs.existsSync(p)) {
      console.log(chalk.red(`✗ File not found: ${a}`));
      process.exit(1);
    }
    if (fs.statSync(p).isDirectory()) {
      for (const f of fs.readdirSync(p)) {
        if (f.endsWith('.txt')) files.push(path.join(p, f));
      }
    } else {
      files.push(p);
    }
  }
  return files;
}

function promptForChatFiles() {
  console.log(chalk.cyan('Drop the path(s) to your WhatsApp .txt export(s).'));
  console.log(chalk.gray('Tip: drag files into the terminal, separate multiples with spaces.'));
  console.log(chalk.gray('Or pass them as arguments next time: node run.js chat1.txt chat2.txt'));
  console.log('');

  const raw = readlineSync.question(chalk.bold('chats > ')).trim();
  if (!raw) {
    console.log(chalk.red('No files given. Bye.'));
    process.exit(1);
  }

  const tokens = raw.match(/"([^"]+)"|'([^']+)'|(\S+)/g) || [];
  const files = tokens.map((t) => t.replace(/^['"]|['"]$/g, ''));

  for (const f of files) {
    if (!fs.existsSync(f)) {
      console.log(chalk.red(`✗ File not found: ${f}`));
      process.exit(1);
    }
  }
  return files.map((f) => path.resolve(f));
}

async function main() {
  banner();

  let files = gatherChatFilesFromArgs();
  if (!files.length) files = promptForChatFiles();

  console.log('');
  console.log(chalk.green(`✓ Found ${files.length} chat file${files.length === 1 ? '' : 's'}`));
  files.forEach((f) => console.log(chalk.gray(`  · ${path.basename(f)}`)));
  console.log('');

  // Parse
  const parseSpinner = ora({ text: 'Reading the texts…', color: 'magenta' }).start();
  const { messages, perFile } = parseChatFiles(files);
  if (!messages.length) {
    parseSpinner.fail('Could not find any messages. Are these WhatsApp exports?');
    process.exit(1);
  }
  parseSpinner.succeed(
    `Parsed ${messages.length.toLocaleString()} messages from ${Object.keys(perFile).length} file(s)`
  );

  // Analyze
  const analyzeSpinner = ora({ text: pickLoading(), color: 'yellow' }).start();
  const interval = setInterval(() => {
    analyzeSpinner.text = pickLoading();
  }, 1500);
  let stats;
  try {
    stats = analyze(messages);
  } catch (err) {
    clearInterval(interval);
    analyzeSpinner.fail(err.message);
    process.exit(1);
  }
  clearInterval(interval);
  analyzeSpinner.succeed(
    `Crunched stats for ${stats.meta.participants.length} people across ${stats.meta.daysSpan} days`
  );
  const lang = stats.meta.detectedLanguage;
  if (lang) {
    const note = lang.keywordSupport
      ? `detected language: ${lang.name} (${Math.round(lang.confidence * 100)}% via ${lang.source})`
      : `detected language: ${lang.name} — keyword stats limited, structural stats fully active`;
    console.log(chalk.gray(`  ${note}`));
  }

  // Claude narrative
  let narrative = null;
  let oneLiner = null;
  if (NO_AI) {
    console.log(chalk.yellow('• --no-ai: skipping Claude narrative'));
  } else {
    const aiSpinner = ora({ text: 'Asking Claude to roast you (gently)…', color: 'cyan' }).start();
    try {
      [narrative, oneLiner] = await Promise.all([
        generateNarrative(stats, messages),
        generateOneLiner(stats),
      ]);
      aiSpinner.succeed('Got the verdict from Claude');
    } catch (err) {
      aiSpinner.warn(`Claude failed (${err.message}). Continuing without narrative.`);
    }
  }

  // Render HTML
  const renderSpinner = ora({ text: 'Building your dashboard…', color: 'magenta' }).start();
  const html = renderReport({ stats, narrative, oneLiner, messages });

  const outDir = path.join(process.cwd(), 'out');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const stamp = Date.now();
  const htmlFile = path.join(outDir, `inmiy-${stamp}.html`);
  fs.writeFileSync(htmlFile, html, 'utf8');
  renderSpinner.succeed(`HTML rendered (${path.relative(process.cwd(), htmlFile)})`);

  // PDF
  let pdfFile = null;
  if (!HTML_ONLY) {
    const pdfSpinner = ora({ text: 'Printing PDF (booting headless Chrome)…', color: 'green' }).start();
    pdfFile = path.join(outDir, `inmiy-${stamp}.pdf`);
    try {
      await htmlToPdf({ html, outputPath: pdfFile });
      pdfSpinner.succeed(`PDF saved to ${path.relative(process.cwd(), pdfFile)}`);
    } catch (err) {
      pdfSpinner.fail(`PDF generation failed: ${err.message}`);
      console.log(chalk.gray(`HTML version is still available at ${htmlFile}`));
      pdfFile = null;
    }
  }

  // Final output
  console.log('');
  console.log(chalk.magentaBright.bold('  ╭─────── your report ───────╮'));
  if (pdfFile) {
    console.log(chalk.bold('  📄 PDF: ') + chalk.cyan.underline(pdfFile));
  }
  console.log(chalk.bold('  🌐 HTML: ') + chalk.cyan.underline(`file://${htmlFile}`));
  console.log(chalk.magentaBright.bold('  ╰───────────────────────────╯'));
  console.log('');
  console.log(chalk.gray('  Share the PDF anywhere. The HTML is a backup.'));
  console.log('');

  if (!NO_OPEN) {
    openLocal(pdfFile || htmlFile);
  }
}

main().catch((err) => {
  console.error(chalk.red('\n✗ Something exploded:'));
  console.error(err);
  process.exit(1);
});
