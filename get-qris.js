const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
const path = require('path');
const fs = require('fs');

chromium.use(stealth);

async function generateQRIS(accountId) {
  const accounts = JSON.parse(fs.readFileSync('accounts.json', 'utf8'));
  const account = accounts.find(a => a.id === accountId);

  if (!account) {
    throw new Error('Akun tidak ditemukan');
  }

  const userDataDir = path.join(__dirname, account.profileFolder);

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    channel: 'chrome',
    args: ['--disable-blink-features=AutomationControlled', '--start-maximized']
  });

  const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();

  try {
    console.log(`🔗 Navigasi ke Billing ${account.nama}...`);
    await page.goto('https://www.starlink.com/account/billing', { waitUntil: 'networkidle', timeout: 60000 });

    // 1. Cek Transaksi Pending
    const isPendingText = await page.locator('text=/processing your payment/i, text=/pending/i').first().isVisible({ timeout: 3000 }).catch(() => false);
    const payBtn = page.getByRole('button', { name: /^Pay$\vert{}^Bayar$/i }).or(page.locator('button:has-text("Pay")')).first();
    const isPayDisabled = await payBtn.isDisabled().catch(() => false);

    if (isPayDisabled || isPendingText) {
      console.log('⚠️ Terdeteksi status pending pembayaran pada akun ini.');
      throw new Error('Masih ada pending pembayaran, QRIS belum bisa dibuat');
    }

    // 2. Klik Pay Utama
    console.log('👆 Mengklik tombol Pay / Bayar...');
    await payBtn.waitFor({ state: 'visible', timeout: 10000 });
    await payBtn.click({ force: true });
    await page.waitForTimeout(3000);

    // 3. Area Modal Pembayaran
    const modalArea = page.locator('.MuiDialog-root, .MuiModal-root')
      .filter({ hasText: /Pay Balance|Bayar|Use New Payment Method|Submit|Pay Past-Due Balance/i })
      .first();

    await modalArea.waitFor({ state: 'visible', timeout: 10000 });

    // 4. Klik "Use New Payment Method" Jika Ada
    const newPaymentBtn = modalArea.getByRole('button', { name: /Use New Payment Method|Gunakan Metode Pembayaran Baru/i })
      .or(modalArea.locator('button:has-text("Use New Payment Method")'))
      .first();

    if (await newPaymentBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      console.log('👆 Memilih Use New Payment Method...');
      await newPaymentBtn.click({ force: true });
      await page.waitForTimeout(2000);
    }

    // 5. Pastikan Opsi GoPay/QRIS Terpilih di Modal Starlink
    const gopayBtn = modalArea.getByText('GoPay', { exact: true }).or(modalArea.getByText(/GoPay/i)).first();
    if (await gopayBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      console.log('💳 Memilih metode GoPay / QRIS...');
      await gopayBtn.click({ force: true }).catch(() => {});
      await page.waitForTimeout(1000);
    }

    // 6. Isi NPWP / Tax ID
    console.log('📝 Mengisi NPWP / NIK / Tax ID...');
    const npwpInput = modalArea.locator('input[placeholder*="NPWP"], input[placeholder*="Tax"], input[placeholder*="NIK"]')
      .or(modalArea.locator('input[type="text"]'))
      .first();

    if (await npwpInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await npwpInput.click({ force: true });
      await page.keyboard.press('Control+A');
      await page.keyboard.press('Backspace');
      await npwpInput.type('3217041212930011', { delay: 100 });
      await page.waitForTimeout(1000);
    }

    // 7. Klik Tombol Konfirmasi Pembayaran (Mendukung Akun Suspend)
    console.log('📜 Menggulung Modal & Mengklik Tombol Konfirmasi...');
    await page.evaluate(() => {
      const scrollables = document.querySelectorAll('.MuiDialog-root, .MuiDialog-paper, [role="dialog"], div');
      scrollables.forEach(el => {
        if (el.scrollHeight > el.clientHeight) el.scrollTop = el.scrollHeight;
      });
    });
    await page.waitForTimeout(1000);

    const submitBtn = modalArea.locator('button')
      .filter({ hasText: /Pay Past-Due Balance|Submit|Set Payment Method|Pay and Reactivate/i })
      .or(modalArea.locator('button[type="submit"]'))
      .first();

    await submitBtn.waitFor({ state: 'visible', timeout: 10000 });
    await submitBtn.click({ force: true });

    console.log('⏳ Menunggu Midtrans Snap ter-load...');
    await page.waitForTimeout(6000);

    // 8. KLIK TEPAT OPSI "QRIS" PALING BAWAH (HINDARI GOPAY QRIS ATAS)
    const snapFrame = page.frameLocator('iframe[src*="midtrans"], iframe[id*="snap-midtrans"], iframe[name*="snap"]').first();
    const isFrameExist = await page.locator('iframe[src*="midtrans"], iframe[id*="snap-midtrans"]').isVisible({ timeout: 5000 }).catch(() => false);
    const frameOrPage = isFrameExist ? snapFrame : page;

    console.log('🔍 Menargetkan opsi QRIS murni paling bawah...');

    // Targetkan spesifik teks "QRIS" tanpa frasa "GoPay"
    const pureQrisOption = frameOrPage.locator('.list-custom-item, .list-payment-item, div, a, button')
      .filter({ hasText: /^QRIS$/i })
      .filter({ hasNotText: /GoPay/i })
      .last();

    if (await pureQrisOption.isVisible({ timeout: 8000 }).catch(() => false)) {
      console.log('👆 Mengklik opsi QRIS Murni (Paling Bawah)...');
      await pureQrisOption.scrollIntoViewIfNeeded().catch(() => {});
      await pureQrisOption.click({ force: true });
      await page.waitForTimeout(5000);
    } else {
      // Fallback tombol alternatif dengan mencari elemen terakhir bernama QRIS
      const fallbackQris = frameOrPage.locator('text=/^QRIS$/i').last();
      if (await fallbackQris.isVisible({ timeout: 4000 }).catch(() => false)) {
        console.log('👆 Mengklik fallback opsi QRIS Murni...');
        await fallbackQris.click({ force: true });
        await page.waitForTimeout(5000);
      }
    }

    // 9. SCREENSHOT BARCODE QR CODE SAJA
    const publicDir = path.join(__dirname, 'public');
    if (!fs.existsSync(publicDir)) {
      fs.mkdirSync(publicDir, { recursive: true });
    }

    const qrisPath = path.join(publicDir, `qris-${accountId}.png`);
    console.log('📸 Menangkap matriks Barcode QR...');

    const qrMatrixElement = frameOrPage.locator('canvas, img[src*="data:image"], .qr-image canvas, .qr-code img, img[alt*="QR"]').first();

    if (await qrMatrixElement.isVisible({ timeout: 6000 }).catch(() => false)) {
      await qrMatrixElement.screenshot({ path: qrisPath });
      console.log('✅ Barcode QR Matriks Murni Berhasil Di-screenshot!');
    } else {
      const qrBoxContainer = frameOrPage.locator('.qr-wrapper, .qr-container, div:has(canvas)').first();
      if (await qrBoxContainer.isVisible({ timeout: 3000 }).catch(() => false)) {
        await qrBoxContainer.screenshot({ path: qrisPath });
      } else {
        await page.screenshot({ path: qrisPath, fullPage: true });
      }
    }

    return `/public/qris-${accountId}.png`;

  } catch (err) {
    console.error('❌ Gagal generate QRIS:', err.message);

    if (!err.message.includes('pending pembayaran')) {
      const debugPath = path.join(__dirname, 'public', `error-${accountId}.png`);
      await page.screenshot({ path: debugPath, fullPage: true }).catch(() => {});
    }

    throw err;
  } finally {
    await context.close();
  }
}

// 10. CHECK STATUS LANGSUNG DI MIDTRANS SNAP
async function checkQRISStatus(accountId) {
  const accounts = JSON.parse(fs.readFileSync('accounts.json', 'utf8'));
  const account = accounts.find(a => a.id === accountId);

  if (!account) {
    throw new Error('Akun tidak ditemukan');
  }

  const userDataDir = path.join(__dirname, account.profileFolder);

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    channel: 'chrome',
    args: ['--disable-blink-features=AutomationControlled']
  });

  const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();

  try {
    console.log(`🔍 Memeriksa status pembayaran via Midtrans Snap untuk ${account.nama}...`);
    await page.goto('https://www.starlink.com/account/billing', { waitUntil: 'networkidle', timeout: 60000 });

    const snapFrame = page.frameLocator('iframe[src*="midtrans"], iframe[id*="snap-midtrans"], iframe[name*="snap"]').first();
    const isFrameExist = await page.locator('iframe[src*="midtrans"], iframe[id*="snap-midtrans"]').isVisible({ timeout: 5000 }).catch(() => false);
    const frameOrPage = isFrameExist ? snapFrame : page;

    const checkStatusBtn = frameOrPage.locator('button:has-text("Check status"), text=/Check status/i').first();

    if (await checkStatusBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      console.log('👆 Mengklik tombol Check status di Midtrans Snap...');
      await checkStatusBtn.click({ force: true });
      await page.waitForTimeout(3000);
    }

    const isPaidInSnap = await frameOrPage.locator('text=/Transaction successful|Payment successful|Berhasil|Success/i').first().isVisible({ timeout: 5000 }).catch(() => false);
    const isZeroBalance = await page.locator('text=/IDR 0|Rp 0/i').first().isVisible({ timeout: 3000 }).catch(() => false);

    if (isPaidInSnap || isZeroBalance) {
      console.log('✅ Pembayaran terkonfirmasi LUNAS di Midtrans!');
      return { isPaid: true, message: 'Pembayaran Berhasil! Status akun sudah LUNAS.' };
    } else {
      console.log('⏳ Pembayaran belum terdeteksi di Midtrans.');
      return { isPaid: false, message: 'Pembayaran belum diterima. Silakan selesaikan pembayaran terlebih dahulu.' };
    }

  } catch (err) {
    console.error('❌ Gagal memeriksa status:', err.message);
    throw err;
  } finally {
    await context.close();
  }
}

module.exports = { generateQRIS, checkQRISStatus };