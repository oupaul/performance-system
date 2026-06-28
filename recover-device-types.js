#!/usr/bin/env node
/**
 * 設備類型資料救援工具
 * ----------------------------------------------------------
 * 掃描伺服器上所有可用的資料庫（含各目錄副本與 backups/ 備份），
 * 找出「設備類型」筆數最完整的一份，並可還原到指定的資料庫。
 *
 * 用法（在專案目錄執行）:
 *   node recover-device-types.js
 *       → 只掃描並報告每一份 db 的設備類型（不修改任何資料）
 *
 *   node recover-device-types.js --apply
 *       → 將最完整的一份還原到 ./db/performance.db
 *
 *   node recover-device-types.js --apply --target /opt/perfom-dev/db/performance.db
 *       → 還原到指定的資料庫（例如正式環境的 db）
 *
 * 安全性：掃描階段一律以唯讀開啟；只有加 --apply 時才會寫入，
 *         且使用 INSERT ... ON CONFLICT 更新分數，不會刪除既有資料。
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const Database = require('better-sqlite3');

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const targetIdx = args.indexOf('--target');
const targetDb = targetIdx >= 0 && args[targetIdx + 1]
    ? args[targetIdx + 1]
    : path.join(__dirname, 'db', 'performance.db');

function readDeviceTypes(file) {
    const d = new Database(file, { readonly: true });
    try {
        return d.prepare('SELECT device_name, score FROM device_types ORDER BY score DESC').all();
    } finally {
        d.close();
    }
}

// ---- 1) 收集候選資料庫 ----
const candidates = [];
const seen = new Set();
function add(file, label) {
    if (file && fs.existsSync(file) && !seen.has(file)) {
        seen.add(file);
        candidates.push({ file, label });
    }
}

add(path.join(__dirname, 'db', 'performance.db'), '目前目錄');

// 找出其他目錄的 performance.db（best-effort，找不到也沒關係）
try {
    execSync('find /opt /root /home -name performance.db 2>/dev/null', { encoding: 'utf8' })
        .split('\n').filter(Boolean)
        .forEach(f => add(f, '其他副本'));
} catch (e) { /* find 不可用或無權限時略過 */ }

// 解壓 backups/ 內的備份來掃描
const tmpDirs = [];
const backupDir = path.join(__dirname, 'backups');
if (fs.existsSync(backupDir)) {
    fs.readdirSync(backupDir).filter(f => f.endsWith('.tar.gz')).forEach(b => {
        try {
            const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'dtrec_'));
            tmpDirs.push(tmp);
            execSync(`tar -xzf "${path.join(backupDir, b)}" -C "${tmp}" db/performance.db`, { stdio: 'ignore' });
            add(path.join(tmp, 'db', 'performance.db'), `備份:${b}`);
        } catch (e) { /* 此備份沒有 db 或解壓失敗時略過 */ }
    });
}

// ---- 2) 掃描並報告 ----
let best = null;
console.log('===== 設備類型掃描結果 =====');
for (const c of candidates) {
    try {
        const rows = readDeviceTypes(c.file);
        console.log(`\n[${rows.length} 筆] ${c.label}  ${c.file}`);
        console.log('   ' + (rows.map(r => `${r.device_name}(${r.score})`).join(', ') || '(空)'));
        if (!best || rows.length > best.rows.length) best = { ...c, rows };
    } catch (e) {
        console.log(`\n[讀取失敗] ${c.file}: ${e.message}`);
    }
}

// ---- 3) 還原 ----
if (best && best.rows.length) {
    console.log(`\n最完整的一份：${best.label}（${best.rows.length} 筆）— ${best.file}`);
    if (apply) {
        const dst = new Database(targetDb);
        dst.exec(`CREATE TABLE IF NOT EXISTS device_types (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            device_name TEXT UNIQUE NOT NULL,
            score INTEGER NOT NULL
        );`);
        const up = dst.prepare(
            'INSERT INTO device_types (device_name, score) VALUES (?, ?) ' +
            'ON CONFLICT(device_name) DO UPDATE SET score = excluded.score'
        );
        const tx = dst.transaction(() => best.rows.forEach(r => up.run(r.device_name, r.score)));
        tx();
        dst.close();
        console.log(`\n✅ 已還原 ${best.rows.length} 筆設備類型到: ${targetDb}`);
        console.log('   接著重啟服務並 Ctrl+F5 即可看到資料回來。');
    } else {
        console.log('\n（以上為預覽，未修改任何資料。要實際還原請加 --apply）');
        console.log('   例如: node recover-device-types.js --apply');
    }
} else {
    console.log('\n找不到任何設備類型資料（所有 db 都沒有此表或皆為空）。');
}

// ---- 清理暫存 ----
tmpDirs.forEach(t => { try { fs.rmSync(t, { recursive: true, force: true }); } catch (e) {} });
