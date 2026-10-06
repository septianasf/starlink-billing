const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { generateQRIS, checkQRISStatus } = require('./get-qris');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
app.use('/public', express.static(path.join(__dirname, 'public')));

const DATA_FILE = path.join(__dirname, 'all-billing-clean.json');
const CACHE_FILE = path.join(__dirname, 'qris-cache.json');

function getQrisCache() {
  if (!fs.existsSync(CACHE_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); } catch (e) { return {}; }
}

function saveQrisCache(cache) {
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
}

function getBillingData() {
  if (!fs.existsSync(DATA_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch (e) { return []; }
}

// Parsing nilai nominal tagihan agar pembacaan saldo Rp 0 / IDR 0 lebih akurat
function parseBalance(balanceStr) {
  if (!balanceStr) return 0;
  const clean = String(balanceStr).replace(/[^0-9]/g, '');
  return parseInt(clean, 10) || 0;
}

function checkMonthStatus(invoices, monthNum, year) {
  const invoice = invoices.find(inv => {
    if (!inv.date) return false;
    const parts = inv.date.split('/');
    if (parts.length === 3) {
      return parseInt(parts[0], 10) === monthNum && parseInt(parts[2], 10) === year && inv.status === 'Paid';
    }
    return false;
  });
  return invoice ? true : false;
}

function getLastPaymentDate(invoices) {
  const paidInvoices = invoices.filter(inv => inv.status === 'Paid');
  if (paidInvoices.length === 0) return '-';
  const last = paidInvoices[0];
  const parts = last.date.split('/');
  if (parts.length === 3) {
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agt", "Sep", "Okt", "Nov", "Des"];
    return `${parts[1]} ${monthNames[parseInt(parts[0], 10) - 1] || ''}`;
  }
  return last.date;
}

function formatDate(dateStr) {
  if (!dateStr || dateStr === '-') return '-';
  const parts = dateStr.split('/');
  if (parts.length === 3) {
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agt", "Sep", "Okt", "Nov", "Des"];
    return `${parts[1]} ${monthNames[parseInt(parts[0], 10) - 1] || ''}`;
  }
  return dateStr;
}

app.get('/', (req, res) => {
  const data = getBillingData();

  const html = `
  <!DOCTYPE html>
  <html lang="id">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Dashboard Monitoring Billing Starlink</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css" rel="stylesheet">
    <style>
      body { background-color: #f8fafc; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; }
      .table-header { background-color: #2d6a4f; color: #ffffff; }
      .table-header th { border: 1px solid #1b4332; text-align: center; font-size: 11px; font-weight: 700; text-transform: uppercase; padding: 8px 4px; }
      .excel-cell { border: 1px solid #cbd5e1; padding: 6px 10px; font-size: 12px; color: #1e293b; }
    </style>
  </head>
  <body class="p-6">
    <div class="max-w-[98%] mx-auto bg-white rounded-lg shadow-md border border-slate-300 p-4">
      
      <div class="flex justify-between items-center mb-4 pb-3 border-b border-slate-200">
        <h1 class="text-lg font-bold text-slate-800 flex items-center gap-2">
          <i class="fa-solid fa-table-cells text-emerald-700"></i> Rekapitulasi Tagihan Starlink
        </h1>
        <button onclick="syncData()" id="syncBtn" class="bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold px-4 py-2 rounded flex items-center gap-2 shadow transition">
          <i class="fa-solid fa-rotate" id="syncIcon"></i> Refresh Data
        </button>
      </div>

      <div class="overflow-x-auto">
        <table class="w-full border-collapse">
          <thead>
            <tr class="table-header">
              <th class="w-10">NO</th>
              <th class="text-left px-3">NAMA POS</th>
              <th class="w-20">ALOKASI</th>
              <th class="w-32">NO KIT</th>
              <th class="w-24">STATUS</th>
              <th class="w-36">BILLING CYCLE</th>
              <th class="w-32">BALANCE DUE</th>
              <th class="w-28">DUE DATE</th>
              <th class="w-28">LAST PAYMENT</th>
              <th class="w-24">AKSI</th>
              <th class="w-16">AGT</th>
              <th class="w-16">SEP</th>
              <th class="w-16">OKT</th>
              <th class="w-16">NOV</th>
              <th class="w-16">DES</th>
            </tr>
            <tr class="bg-slate-100 text-[10px] font-bold text-slate-600 text-center">
              <td colspan="10" class="border border-slate-300"></td>
              <td colspan="5" class="border border-slate-300 py-1">2026</td>
            </tr>
          </thead>
          <tbody>
            ${data.map((acc, idx) => {
              const isAgustusPaid = checkMonthStatus(acc.invoices, 8, 2026);
              const isSeptemberPaid = checkMonthStatus(acc.invoices, 9, 2026);
              const isOktoberPaid = checkMonthStatus(acc.invoices, 10, 2026);
              const isNovemberPaid = checkMonthStatus(acc.invoices, 11, 2026);
              const isDesemberPaid = checkMonthStatus(acc.invoices, 12, 2026);

              const lastPayment = getLastPaymentDate(acc.invoices);
              const dueDateFormatted = formatDate(acc.balanceDueDate);
              
              const numericBalance = parseBalance(acc.balanceDue);
              const hasBalance = numericBalance > 0;

              return `
                <tr class="hover:bg-slate-50 transition">
                  <td class="excel-cell text-center font-semibold">${idx + 1}</td>
                  <td class="excel-cell font-medium">${acc.accountName}</td>
                  <td class="excel-cell text-center font-semibold text-slate-600">${acc.alokasi}</td>
                  <td class="excel-cell text-center font-mono text-slate-700">${acc.noKit}</td>
                  
                  <td class="excel-cell text-center">
                    ${acc.isSuspended ? `
                      <span class="bg-rose-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full inline-block">SUSPENDED</span>
                    ` : `
                      <span class="bg-emerald-700 text-white text-[10px] font-bold px-2.5 py-0.5 rounded-full inline-block">ACTIVE</span>
                    `}
                  </td>

                  <td class="excel-cell text-center font-medium text-slate-600">${acc.billingCycle || '-'}</td>

                  <td class="excel-cell text-right font-semibold ${hasBalance ? 'text-rose-600' : 'text-slate-700'}">
                    ${acc.balanceDue ? acc.balanceDue.replace('IDR', 'Rp') : 'Rp 0'}
                  </td>

                  <td class="excel-cell text-center font-medium ${hasBalance ? 'text-rose-600 font-bold' : 'text-slate-600'}">
                    ${dueDateFormatted}
                  </td>

                  <td class="excel-cell text-center text-slate-600">${lastPayment}</td>

                  <!-- Kolom Aksi (Hanya aktif jika tagihan > 0) -->
                  <td class="excel-cell text-center">
                    ${hasBalance ? `
                      <button onclick="openQRIS('${acc.accountId}', '${acc.accountName}', '${acc.balanceDue}')" class="bg-sky-600 hover:bg-sky-700 text-white text-[11px] font-bold px-2.5 py-1 rounded shadow flex items-center gap-1 mx-auto transition">
                        <i class="fa-solid fa-qrcode"></i> Bayar
                      </button>
                    ` : `
                      <span class="text-[11px] text-slate-400 italic font-medium">Lunas</span>
                    `}
                  </td>

                  <td class="excel-cell text-center"><input type="checkbox" ${isAgustusPaid ? 'checked' : ''} disabled class="w-4 h-4 accent-emerald-700"></td>
                  <td class="excel-cell text-center"><input type="checkbox" ${isSeptemberPaid ? 'checked' : ''} disabled class="w-4 h-4 accent-emerald-700"></td>
                  <td class="excel-cell text-center"><input type="checkbox" ${isOktoberPaid ? 'checked' : ''} disabled class="w-4 h-4 accent-emerald-700"></td>
                  <td class="excel-cell text-center"><input type="checkbox" ${isNovemberPaid ? 'checked' : ''} disabled class="w-4 h-4 accent-emerald-700"></td>
                  <td class="excel-cell text-center"><input type="checkbox" ${isDesemberPaid ? 'checked' : ''} disabled class="w-4 h-4 accent-emerald-700"></td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <!-- Modal Popup QRIS (Diperbesar) -->
    <div id="qrisModal" class="fixed inset-0 bg-slate-900/60 backdrop-blur-sm hidden flex justify-center items-center z-50 p-4">
      <div class="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-xl w-full overflow-hidden">
        <div class="bg-emerald-800 text-white p-4 flex justify-between items-center">
          <div>
            <h3 class="font-bold text-base" id="modalAccountName">Pembayaran QRIS</h3>
            <p class="text-xs text-emerald-200" id="modalBalance">Tagihan: Rp 0</p>
          </div>
          <button onclick="closeQRIS()" class="text-emerald-200 hover:text-white text-xl font-bold">&times;</button>
        </div>
        
        <div class="p-6 text-center" id="modalBody">
          <div id="qrisLoading" class="space-y-3 py-8">
            <i class="fa-solid fa-circle-notch fa-spin text-emerald-700 text-4xl"></i>
            <p class="text-sm text-slate-600 font-semibold">Mengambil Barcode QRIS...</p>
            <p class="text-xs text-slate-400">Menyiapkan kode QRIS berukuran besar dari Midtrans.</p>
          </div>

          <div id="qrisContent" class="hidden space-y-4">
            <div class="bg-amber-50 border border-amber-200 rounded-lg p-2.5 flex justify-between items-center text-xs">
              <span class="text-amber-800 font-semibold flex items-center gap-1.5">
                <i class="fa-solid fa-clock text-amber-600"></i> Masa Berlaku QRIS:
              </span>
              <span id="countdownTimer" class="font-mono font-bold text-amber-700 bg-amber-100 px-2.5 py-1 rounded border border-amber-300 text-sm">
                15:00
              </span>
            </div>

            <!-- Area Gambar Barcode QR Code Ekstra Besar -->
            <div class="p-4 bg-white border-2 border-emerald-600 rounded-2xl shadow-md inline-block">
              <img id="qrisImage" src="" alt="Kode QRIS" class="w-80 h-80 object-contain mx-auto rounded-lg">
            </div>

            <p class="text-xs text-slate-500 font-medium">Scan menggunakan GoPay, OVO, Dana, BCA, atau m-Banking Anda.</p>

            <div class="pt-2">
              <button onclick="checkStatus()" id="checkStatusBtn" class="w-full bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold py-3 px-4 rounded-xl flex items-center justify-center gap-2 shadow transition">
                <i class="fa-solid fa-arrows-rotate" id="checkIcon"></i> Check Status Pembayaran
              </button>
            </div>
          </div>
        </div>

        <div class="bg-slate-100 px-6 py-3 border-t border-slate-200 flex justify-between items-center">
          <span id="cachedNotice" class="text-[11px] text-slate-500 italic hidden">QRIS Tersimpan</span>
          <button onclick="closeQRIS()" class="bg-slate-700 hover:bg-slate-800 text-white text-xs font-semibold px-4 py-2 rounded-lg ml-auto">
            Tutup
          </button>
        </div>
      </div>
    </div>

    <script>
      let countdownInterval = null;
      let currentAccountId = null;

      function startCountdown(remainingSeconds) {
        clearInterval(countdownInterval);
        let secondsLeft = remainingSeconds;

        const timerDisplay = document.getElementById('countdownTimer');

        function updateDisplay() {
          if (secondsLeft <= 0) {
            clearInterval(countdownInterval);
            timerDisplay.innerText = "Kedaluwarsa";
            timerDisplay.className = "font-mono font-bold text-rose-700 bg-rose-100 px-2 py-0.5 rounded border border-rose-300";
            return;
          }

          const mins = Math.floor(secondsLeft / 60);
          const secs = secondsLeft % 60;
          timerDisplay.innerText = String(mins).padStart(2, '0') + ':' + String(secs).padStart(2, '0');
          secondsLeft--;
        }

        updateDisplay();
        countdownInterval = setInterval(updateDisplay, 1000);
      }

      async function openQRIS(accountId, accountName, balance) {
        currentAccountId = accountId;
        document.getElementById('modalAccountName').innerText = accountName;
        document.getElementById('modalBalance').innerText = 'Total: ' + balance.replace('IDR', 'Rp');
        
        document.getElementById('qrisLoading').classList.remove('hidden');
        document.getElementById('qrisContent').classList.add('hidden');
        document.getElementById('cachedNotice').classList.add('hidden');
        document.getElementById('qrisModal').classList.remove('hidden');

        try {
          const res = await fetch('/api/billing/get-qris', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ accountId })
          });

          const json = await res.json();
          if (json.status === 'success') {
            document.getElementById('qrisImage').src = json.qrisUrl + '?t=' + new Date().getTime();
            document.getElementById('qrisLoading').classList.add('hidden');
            document.getElementById('qrisContent').classList.remove('hidden');

            if (json.isCached) {
              document.getElementById('cachedNotice').classList.remove('hidden');
            }

            startCountdown(json.remainingSeconds);

          } else {
            alert('Gagal mengambil QRIS: ' + json.message);
            closeQRIS();
          }
        } catch (e) {
          alert('Terjadi kesalahan koneksi.');
          closeQRIS();
        }
      }

      async function checkStatus() {
        if (!currentAccountId) return;

        const btn = document.getElementById('checkStatusBtn');
        const icon = document.getElementById('checkIcon');
        
        btn.disabled = true;
        btn.classList.add('opacity-50');
        icon.classList.add('fa-spin');

        try {
          const res = await fetch('/api/billing/check-status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ accountId: currentAccountId })
          });

          const json = await res.json();
          if (json.status === 'success') {
            if (json.isPaid) {
              alert('🎉 ' + json.message);
              location.reload();
            } else {
              alert('ℹ ' + json.message);
            }
          } else {
            alert('Gagal mengecek status: ' + json.message);
          }
        } catch (e) {
          alert('Terjadi kesalahan koneksi saat mengecek status.');
        } finally {
          btn.disabled = false;
          btn.classList.remove('opacity-50');
          icon.classList.remove('fa-spin');
        }
      }

      function closeQRIS() {
        clearInterval(countdownInterval);
        document.getElementById('qrisModal').classList.add('hidden');
      }

      async function syncData() {
        const btn = document.getElementById('syncBtn');
        const icon = document.getElementById('syncIcon');
        btn.disabled = true;
        btn.classList.add('opacity-50');
        icon.classList.add('fa-spin');

        try {
          const res = await fetch('/api/billing/sync', { method: 'POST' });
          if (res.ok) location.reload();
          else alert('Gagal sync data.');
        } catch (e) {
          alert('Terjadi kesalahan jaringan.');
        } finally {
          btn.disabled = false;
          btn.classList.remove('opacity-50');
          icon.classList.remove('fa-spin');
        }
      }
    </script>
  </body>
  </html>
  `;
  res.send(html);
});

app.post('/api/billing/get-qris', async (req, res) => {
  const { accountId } = req.body;
  const cache = getQrisCache();
  const now = Math.floor(Date.now() / 1000);
  const CACHE_DURATION = 15 * 60;

  if (cache[accountId] && (now - cache[accountId].timestamp) < CACHE_DURATION) {
    const elapsed = now - cache[accountId].timestamp;
    const remainingSeconds = CACHE_DURATION - elapsed;

    console.log(`⚡ Menggunakan QRIS cache untuk akun ${accountId} (sisa waktu: ${remainingSeconds}s)`);
    return res.json({
      status: 'success',
      qrisUrl: cache[accountId].qrisUrl,
      isCached: true,
      remainingSeconds
    });
  }

  try {
    const qrisUrl = await generateQRIS(accountId);
    
    cache[accountId] = {
      qrisUrl,
      timestamp: Math.floor(Date.now() / 1000)
    };
    saveQrisCache(cache);

    res.json({
      status: 'success',
      qrisUrl,
      isCached: false,
      remainingSeconds: CACHE_DURATION
    });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.post('/api/billing/check-status', async (req, res) => {
  const { accountId } = req.body;
  try {
    const result = await checkQRISStatus(accountId);
    res.json({ status: 'success', ...result });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.get('/api/billing', (req, res) => res.json({ status: 'success', data: getBillingData() }));

app.post('/api/billing/sync', (req, res) => {
  exec('node multi-scraper-v2.js', (err) => {
    if (err) return res.status(500).json({ status: 'error' });
    res.json({ status: 'success', data: getBillingData() });
  });
});

app.listen(PORT, () => {
  console.log(`\n🚀 Dashboard Siap! Buka di: http://localhost:${PORT}\n`);
});