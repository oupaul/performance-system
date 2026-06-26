const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

const dbPath = './db/performance.db';

// 確保資料庫目錄存在
if (!fs.existsSync('./db')) {
    fs.mkdirSync('./db', { recursive: true });
}

const db = new Database(dbPath);

// 確保 admins 表存在
db.exec(`
    CREATE TABLE IF NOT EXISTS admins (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
`);

// 檢查是否已存在管理員
const existingAdmin = db.prepare('SELECT id, username FROM admins WHERE username = ?').get('admin');

if (existingAdmin) {
    console.log('管理員帳號已存在:');
    console.log('  帳號:', existingAdmin.username);
    console.log('  ID:', existingAdmin.id);
    console.log('\n如果要重置密碼，請刪除資料庫中的記錄後重新執行此腳本。');
} else {
    // 建立預設管理員
    const password = 'admin123';
    const passwordHash = bcrypt.hashSync(password, 10);
    
    db.prepare('INSERT INTO admins (username, password_hash) VALUES (?, ?)')
      .run('admin', passwordHash);
    
    console.log('✅ 管理員帳號已建立！');
    console.log('  帳號: admin');
    console.log('  密碼: admin123');
    console.log('\n⚠️  請在首次登入後立即修改密碼！');
}

db.close();

