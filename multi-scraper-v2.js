const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
const path = require('path');
const fs = require('fs');

chromium.use(stealth);

const accounts = JSON.parse(fs.readFileSync('accounts.json', 'utf8'));

function parseBillingData(lines, accountInfo) {
  const fullText = lines.join('\n');
  const isSuspended = fullText.includes('disabled due to a billing issue');

  // 1. Tangkap Balance Due
  let balanceDue = 'IDR 0';
  const balanceIndex = lines.indexOf('Balance Due');
  if (balanceIndex !== -1 && lines[balanceIndex + 2] && lines[balanceIndex + 2].startsWith('IDR')) {
    balanceDue = lines[balanceIndex + 2];
  }

  // 2. Tangkap Billing Cycle (Hapus awalan "Your billing period is")
  let billingCycle = '-';
  const cycleIndex = lines.indexOf('Billing Cycle');
  if (cycleIndex !== -1 && lines[cycleIndex + 1]) {
    let cycleText = lines[cycleIndex + 1];
    if (!cycleText.includes('No subscriptions') && !cycleText.includes('Payment Method')) {
      // Bersihkan teks "Your billing period is " dan titik di akhir
      billingCycle = cycleText
        .replace(/^Your billing period is\s+/i, '')
        .replace(/\.$/, '')
        .trim();
    }
  }

  // 3. Isolasi Area Tabel Invoices
  const invoicesStartIndex = lines.indexOf('Invoices');
  const paymentsStartIndex = lines.indexOf('Payments');
  
  let invoiceSectionLines = [];
  if (invoicesStartIndex !== -1) {
    const endIndex = paymentsStartIndex !== -1 ? paymentsStartIndex : lines.length;
    invoiceSectionLines = lines.slice(invoicesStartIndex, endIndex);
  }

  // 4. Parse Baris Invoice
  const invoices = [];
  invoiceSectionLines.forEach((line, index) => {
    if (line.startsWith('INV-')) {
      const date = invoiceSectionLines[index - 3] || '-';
      const dueDate = invoiceSectionLines[index - 2] || '-';
      const type = invoiceSectionLines[index - 1] || '-';
      const method = invoiceSectionLines[index + 1] || '-';
      const total = invoiceSectionLines[index + 2] || '-';
      const balance = invoiceSectionLines[index + 3] || '-';
      const status = invoiceSectionLines[index + 4] || '-';

      if (date.includes('/') && (status === 'Paid' || status === 'Cancelled' || status === 'Pending' || status === 'Unpaid')) {
        invoices.push({
          invoiceNumber: line,
          date,
          dueDate,
          type,
          method,
          total,
          balance,
          status
        });
      }
    }
  });

  // 5. Tangkap Due Date dari Invoice Teratas
  let balanceDueDate = '-';
  if (invoices.length > 0) {
    balanceDueDate = invoices[0].dueDate || '-';
  }

  return {
    accountId: accountInfo.id,
    accountName: accountInfo.nama,
    alokasi: accountInfo.alokasi || '-',
    noKit: accountInfo.noKit || '-',
    lastScraped: new Date().toISOString(),
    isSuspended,
    billingCycle,
    balanceDue,
    balanceDueDate,
    invoicesCount: invoices.length,
    invoices
  };
}

async function runMultiScraper() {
  const summaryResult = [];

  for (const acc of accounts) {
    console.log(`\n==========================================`);
    console.log(`🚀 Scrape Akun: ${acc.nama} (${acc.id})`);
    console.log(`==========================================`);

    const userDataDir = path.join(__dirname, acc.profileFolder);

    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      channel: 'chrome',
      args: ['--disable-blink-features=AutomationControlled', '--start-maximized'],
      viewport: null
    });

    const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();

    try {
      await page.goto('https://www.starlink.com/account/billing', { 
        waitUntil: 'networkidle',
        timeout: 60000 
      });

      if (page.url().includes('/auth') || page.url().includes('/login')) {
        console.log(`⚠️ Akun ${acc.nama} butuh login manual! Silakan login di browser lalu TEKAN ENTER di terminal.`);
        await new Promise((resolve) => process.stdin.once('data', resolve));
      }

      await page.waitForTimeout(4000);

      const lines = await page.evaluate(() => {
        return document.body.innerText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
      });

      const parsed = parseBillingData(lines, acc);
      summaryResult.push(parsed);

      console.log(`✅ ${acc.nama} selesai. Status Suspend: ${parsed.isSuspended ? 'YA' : 'TIDAK'} | Cycle: ${parsed.billingCycle}`);

    } catch (err) {
      console.error(`❌ Gagal scrape ${acc.nama}:`, err.message);
    } finally {
      await context.close();
    }
  }

  fs.writeFileSync('all-billing-clean.json', JSON.stringify(summaryResult, null, 2));
  console.log('\n🎉 Selesai! Hasil tersimpan di: all-billing-clean.json');
  process.exit(0);
}

runMultiScraper();