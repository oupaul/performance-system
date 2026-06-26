const express = require('express');
const session = require('express-session');
const multer = require('multer');
const ExcelJS = require('exceljs');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// 確保目錄存在
const dirs = ['uploads', 'db', 'public'];
dirs.forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// 初始化資料庫
const db = new Database('./db/performance.db');
initDatabase();

// Session 設定
app.use(session({
    secret: 'performance-system-secret-key-2024',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false, // 開發環境使用 false，生產環境 HTTPS 使用 true
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000 // 24 小時
    }
}));

// Middleware
app.use(express.json());
app.use(express.static('public', {
    setHeaders: (res, filePath) => {
        // HTML 不快取，確保更新後使用者一律拿到最新介面（避免改版後仍顯示舊頁）
        if (filePath.endsWith('.html')) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        }
    }
}));

// 檔案上傳設定
const storage = multer.diskStorage({
    destination: './uploads/',
    filename: (req, file, cb) => {
        cb(null, `upload_${Date.now()}${path.extname(file.originalname)}`);
    }
});
const upload = multer({ storage });

// ============================================================
// 資料庫初始化
// ============================================================
function initDatabase() {
    db.exec(`
        -- 維護記錄表
        CREATE TABLE IF NOT EXISTS maintenance_records (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            task_id TEXT,
            call_date DATE,
            engineer TEXT,
            customer_type TEXT,
            work_type TEXT,
            work_content TEXT,
            description TEXT,
            total_hours REAL,
            process_description TEXT,
            complexity_score REAL,
            complexity_level TEXT,
            matched_keywords TEXT,
            upload_batch TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        -- 績效結果表
        CREATE TABLE IF NOT EXISTS performance_results (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            engineer TEXT,
            ticket_count INTEGER,
            total_hours REAL,
            avg_hours REAL,
            avg_complexity REAL,
            high_complexity_count INTEGER,
            mid_complexity_count INTEGER,
            low_complexity_count INTEGER,
            non_routine_ratio REAL,
            diversity_score INTEGER,
            final_score REAL,
            ranking INTEGER,
            bonus_ratio REAL,
            ticket_only_ratio REAL,
            ratio_diff REAL,
            upload_batch TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        -- 權重設定表
        CREATE TABLE IF NOT EXISTS weight_settings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE,
            weight REAL,
            description TEXT
        );

        -- 關鍵字設定表
        CREATE TABLE IF NOT EXISTS keywords (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            keyword TEXT,
            level TEXT,
            score INTEGER
        );

        -- 設備類型設定表
        CREATE TABLE IF NOT EXISTS device_types (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            device_name TEXT UNIQUE NOT NULL,
            score INTEGER NOT NULL
        );

        -- 管理員帳號表
        CREATE TABLE IF NOT EXISTS admins (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `);

    // 為 maintenance_records 表添加 original_filename 欄位（如果不存在）
    try {
        db.exec(`ALTER TABLE maintenance_records ADD COLUMN original_filename TEXT`);
    } catch (error) {
        // 欄位已存在時忽略錯誤
        if (!error.message.includes('duplicate column')) {
            console.error('Error adding original_filename column:', error);
        }
    }

    // 初始化預設權重
    const defaultWeights = [
        ['ticket_count', 0.15, '工單完成數'],
        ['total_hours', 0.15, '總服務工時'],
        ['avg_complexity', 0.35, '平均案件複雜度'],
        ['high_complexity_count', 0.15, '高複雜度案件數'],
        ['non_routine_ratio', 0.10, '非例行工作比例'],
        ['diversity', 0.05, '服務多樣性'],
        ['efficiency', 0.05, '平均案件工時效率']
    ];

    const insertWeight = db.prepare(`
        INSERT OR IGNORE INTO weight_settings (name, weight, description) VALUES (?, ?, ?)
    `);
    defaultWeights.forEach(w => insertWeight.run(...w));

    // 初始化預設關鍵字（已移除，改由使用者自行匯入或新增）
    // 如需預設關鍵字，請使用匯入功能或手動新增

    // 初始化預設設備類型
    const defaultDeviceTypes = [
        ['伺服器', 20],
        ['網路設備', 18],
        ['不斷電系統', 15],
        ['備份系統', 15],
        ['雲端服務', 12],
        ['個人電腦', 8],
        ['一般性事務', 5],
        ['列印設備', 4],
        ['例行性維護', 3]
    ];

    const insertDeviceType = db.prepare(`
        INSERT OR IGNORE INTO device_types (device_name, score) VALUES (?, ?)
    `);
    
    defaultDeviceTypes.forEach(([name, score]) => insertDeviceType.run(name, score));

    // 初始化預設管理員帳號（如果不存在）
    const defaultAdmin = {
        username: 'admin',
        password: 'admin123' // 預設密碼，首次登入後請修改
    };
    
    const existingAdmin = db.prepare('SELECT id FROM admins WHERE username = ?').get(defaultAdmin.username);
    if (!existingAdmin) {
        const passwordHash = bcrypt.hashSync(defaultAdmin.password, 10);
        db.prepare('INSERT INTO admins (username, password_hash) VALUES (?, ?)')
          .run(defaultAdmin.username, passwordHash);
        console.log(`預設管理員帳號已建立: ${defaultAdmin.username} / ${defaultAdmin.password}`);
    }
}

// ============================================================
// 工程師姓名標準化
// ============================================================
// 姓名映射表：處理 OCR 識別錯誤或字符變體
const engineerNameMap = {
    '柯志勳': '柯志勲',  // 修正識別錯誤：勳 -> 勲
    '柯志勛': '柯志勲',  // 預防其他可能的變體
    // 可以在這裡添加更多映射規則
};

function normalizeEngineerName(name) {
    if (!name || typeof name !== 'string') return name;
    
    // 去除首尾空白
    const trimmed = name.trim();
    
    // 檢查映射表
    if (engineerNameMap[trimmed]) {
        return engineerNameMap[trimmed];
    }
    
    return trimmed;
}

// ============================================================
// 複雜度計算
// ============================================================
function getKeywords() {
    return db.prepare('SELECT keyword, level, score FROM keywords').all();
}

function getDeviceTypes() {
    return db.prepare('SELECT device_name, score FROM device_types ORDER BY score DESC').all();
}

function getWeights() {
    const rows = db.prepare('SELECT name, weight FROM weight_settings').all();
    const weights = {};
    rows.forEach(r => weights[r.name] = r.weight);
    return weights;
}

function calculateKeywordScore(description, keywords) {
    if (!description) return { score: 0, matched: [], matchedLevels: new Set() };
    
    const desc = description.toUpperCase();
    let score = 0;
    const matched = [];
    const matchedLevels = new Set();
    
    // 記錄已計分的關鍵字（使用關鍵字本身，確保同一關鍵字只計分一次）
    const scoredKeywords = new Set();
    
    // 按關鍵字長度排序（先匹配長的，避免短關鍵字覆蓋長關鍵字）
    // 例如：先匹配 "Hyper-V"，再匹配 "VM"，避免 "VM" 在 "Hyper-V" 中誤匹配
    const sortedKeywords = [...keywords].sort((a, b) => b.keyword.length - a.keyword.length);
    
    // 記錄已匹配的位置，避免重疊位置被重複計算
    const matchedPositions = new Set();
    
    sortedKeywords.forEach(kw => {
        // 如果這個關鍵字已經計分過，跳過（確保同一個關鍵字只計分一次）
        const keywordKey = kw.keyword.toUpperCase();
        if (scoredKeywords.has(keywordKey)) {
            return;
        }
        
        const keyword = kw.keyword.toUpperCase();
        let searchIndex = 0;
        let foundMatch = false;
        
        // 找出第一個未被覆蓋的匹配位置
        while (true) {
            const index = desc.indexOf(keyword, searchIndex);
            if (index === -1) break;
            
            // 檢查這個位置是否已經被更長的關鍵字匹配過
            let alreadyMatched = false;
            for (let i = index; i < index + keyword.length; i++) {
                if (matchedPositions.has(i)) {
                    alreadyMatched = true;
                    break;
                }
            }
            
            if (!alreadyMatched) {
                // 標記這個位置已被匹配
                for (let i = index; i < index + keyword.length; i++) {
                    matchedPositions.add(i);
                }
                
                // 只計分一次
                score += kw.score;
                matched.push(`${kw.keyword}(${kw.level[0]})`);
                matchedLevels.add(kw.level);
                scoredKeywords.add(keywordKey);
                foundMatch = true;
                break; // 找到第一個匹配位置後就停止，不再搜尋其他位置
            }
            
            // 繼續搜尋下一個匹配位置
            searchIndex = index + 1;
        }
    });
    
    return { score: Math.min(score, 60), matched, matchedLevels };
}

function calculateDeviceScore(workType) {
    if (!workType) return 5;
    
    const deviceTypes = getDeviceTypes();
    let maxScore = 0;
    
    for (const device of deviceTypes) {
        if (workType.includes(device.device_name)) {
            maxScore = Math.max(maxScore, device.score);
        }
    }
    
    return maxScore || 5;
}

function calculateHoursScore(hours) {
    if (!hours || hours <= 0) return 0;
    return Math.min(hours / 8 * 20, 20);
}

function calculateComplexityScore(record, keywords, includeDetails = false) {
    const { score: keywordScore, matched, matchedLevels } = calculateKeywordScore(record.process_description, keywords);
    const hoursScore = calculateHoursScore(record.total_hours);
    const deviceScore = calculateDeviceScore(record.work_type);
    const routineScore = (record.work_type && record.work_type.includes('例行')) ? 0 : 10;
    
    const keywordWeighted = keywordScore * 0.4;
    const hoursWeighted = hoursScore * 0.3;
    const deviceWeighted = deviceScore * 0.2;
    const routineWeighted = routineScore * 0.1;
    
    const total = keywordWeighted + hoursWeighted + deviceWeighted + routineWeighted;
    const normalized = Math.min(total / 25 * 100, 100);
    
    // 根據匹配的關鍵字等級來確定複雜度等級
    // 優先級：高專業度 > 中專業度 > 低專業度
    let level = '低';
    let levelReason = '';
    const matchedLevelList = Array.from(matchedLevels);
    const hasHigh = matchedLevels.has('高專業度');
    const hasMid = matchedLevels.has('中專業度');
    const hasLow = matchedLevels.has('低專業度');
    
    // 如果匹配到高專業度關鍵字，至少是"高"
    if (hasHigh) {
        level = '高';
        levelReason = '匹配到高專業度關鍵字，等級至少為「高」';
    } 
    // 如果匹配到中專業度關鍵字，且總分達到一定標準，至少是"中"
    else if (hasMid) {
        if (normalized > 60) {
            level = '高';
            levelReason = `匹配到中專業度關鍵字，且正規化分數 ${Math.round(normalized * 10) / 10} > 60，等級為「高」`;
        } else {
            level = '中';
            levelReason = `匹配到中專業度關鍵字，且正規化分數 ${Math.round(normalized * 10) / 10} ≤ 60，等級為「中」`;
        }
    }
    // 如果只有低專業度或沒有匹配關鍵字，根據總分判斷
    else {
        if (normalized > 60) {
            level = '高';
            levelReason = `未匹配高/中專業度關鍵字，但正規化分數 ${Math.round(normalized * 10) / 10} > 60，等級為「高」`;
        } else if (normalized > 30) {
            level = '中';
            levelReason = `未匹配高/中專業度關鍵字，正規化分數 ${Math.round(normalized * 10) / 10} 介於 30-60 之間，等級為「中」`;
        } else {
            level = '低';
            levelReason = `未匹配高/中專業度關鍵字，且正規化分數 ${Math.round(normalized * 10) / 10} ≤ 30，等級為「低」`;
        }
    }
    
    const result = {
        score: Math.round(normalized * 10) / 10,
        level,
        matched: matched.join(', ')
    };
    
    // 如果需要返回詳細資訊
    if (includeDetails) {
        result.details = {
            keywordScore: Math.round(keywordScore * 10) / 10,
            keywordWeighted: Math.round(keywordWeighted * 100) / 100,
            keywordWeight: 0.4,
            hoursScore: Math.round(hoursScore * 10) / 10,
            hoursWeighted: Math.round(hoursWeighted * 100) / 100,
            hoursWeight: 0.3,
            deviceScore: Math.round(deviceScore * 10) / 10,
            deviceWeighted: Math.round(deviceWeighted * 100) / 100,
            deviceWeight: 0.2,
            routineScore: Math.round(routineScore * 10) / 10,
            routineWeighted: Math.round(routineWeighted * 100) / 100,
            routineWeight: 0.1,
            total: Math.round(total * 100) / 100,
            normalized: Math.round(normalized * 10) / 10,
            normalizationFactor: 25,
            // 等級判定資訊
            levelDetails: {
                matchedLevels: matchedLevelList,
                hasHigh,
                hasMid,
                hasLow,
                level,
                levelReason
            }
        };
    }
    
    return result;
}

// ============================================================
// 績效計算
// ============================================================
function normalizeScores(values, higherIsBetter = true) {
    const min = Math.min(...values);
    const max = Math.max(...values);
    
    if (max === min) return values.map(() => 50);
    
    return values.map(v => {
        const normalized = (v - min) / (max - min) * 100;
        return higherIsBetter ? normalized : 100 - normalized;
    });
}

function calculatePerformance(uploadBatch) {
    const weights = getWeights();
    
    // 取得各工程師統計
    const stats = db.prepare(`
        SELECT 
            engineer,
            COUNT(*) as ticket_count,
            SUM(total_hours) as total_hours,
            AVG(total_hours) as avg_hours,
            AVG(complexity_score) as avg_complexity,
            SUM(CASE WHEN complexity_level = '高' THEN 1 ELSE 0 END) as high_complexity_count,
            SUM(CASE WHEN complexity_level = '中' THEN 1 ELSE 0 END) as mid_complexity_count,
            SUM(CASE WHEN complexity_level = '低' THEN 1 ELSE 0 END) as low_complexity_count,
            SUM(CASE WHEN work_type NOT LIKE '%例行%' THEN 1 ELSE 0 END) * 100.0 / COUNT(*) as non_routine_ratio,
            COUNT(DISTINCT work_type) + COUNT(DISTINCT work_content) as diversity_score
        FROM maintenance_records
        WHERE upload_batch = ?
        GROUP BY engineer
    `).all(uploadBatch);
    
    if (stats.length === 0) return [];
    
    // 正規化各指標
    const ticketScores = normalizeScores(stats.map(s => s.ticket_count));
    const hoursScores = normalizeScores(stats.map(s => s.total_hours));
    const complexityScores = normalizeScores(stats.map(s => s.avg_complexity));
    const highComplexityScores = normalizeScores(stats.map(s => s.high_complexity_count));
    const nonRoutineScores = normalizeScores(stats.map(s => s.non_routine_ratio));
    const diversityScores = normalizeScores(stats.map(s => s.diversity_score));
    
    // 效率分數 (2.5小時為理想)
    const efficiencyScores = stats.map(s => {
        const diff = Math.abs(s.avg_hours - 2.5);
        return Math.max(0, 100 - diff / 2.5 * 50);
    });
    
    // 計算加權總分
    const results = stats.map((s, i) => {
        const finalScore = 
            ticketScores[i] * weights.ticket_count +
            hoursScores[i] * weights.total_hours +
            complexityScores[i] * weights.avg_complexity +
            highComplexityScores[i] * weights.high_complexity_count +
            nonRoutineScores[i] * weights.non_routine_ratio +
            diversityScores[i] * weights.diversity +
            efficiencyScores[i] * weights.efficiency;
        
        return {
            ...s,
            final_score: Math.round(finalScore * 10) / 10
        };
    });
    
    // 排名
    results.sort((a, b) => b.final_score - a.final_score);
    results.forEach((r, i) => r.ranking = i + 1);
    
    // 計算獎金分配
    const totalScore = results.reduce((sum, r) => sum + r.final_score, 0);
    const totalTickets = results.reduce((sum, r) => sum + r.ticket_count, 0);
    
    // 先計算所有比例，確保總和為100%
    let bonusRatioSum = 0;
    let ticketOnlyRatioSum = 0;
    
    results.forEach((r, index) => {
        const exactBonusRatio = r.final_score / totalScore * 100;
        const exactTicketOnlyRatio = r.ticket_count / totalTickets * 100;
        
        // 最後一個人補齊到100%，其他四捨五入
        if (index === results.length - 1) {
            r.bonus_ratio = Math.round((100 - bonusRatioSum) * 100) / 100;
            r.ticket_only_ratio = Math.round((100 - ticketOnlyRatioSum) * 100) / 100;
        } else {
            r.bonus_ratio = Math.round(exactBonusRatio * 100) / 100;
            r.ticket_only_ratio = Math.round(exactTicketOnlyRatio * 100) / 100;
            bonusRatioSum += r.bonus_ratio;
            ticketOnlyRatioSum += r.ticket_only_ratio;
        }
        
        r.ratio_diff = Math.round((r.bonus_ratio - r.ticket_only_ratio) * 100) / 100;
    });
    
    // 儲存結果
    const insertResult = db.prepare(`
        INSERT INTO performance_results 
        (engineer, ticket_count, total_hours, avg_hours, avg_complexity,
         high_complexity_count, mid_complexity_count, low_complexity_count,
         non_routine_ratio, diversity_score, final_score, ranking,
         bonus_ratio, ticket_only_ratio, ratio_diff, upload_batch)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    // 清除舊結果
    db.prepare('DELETE FROM performance_results WHERE upload_batch = ?').run(uploadBatch);
    
    results.forEach(r => {
        insertResult.run(
            r.engineer, r.ticket_count, r.total_hours, r.avg_hours, r.avg_complexity,
            r.high_complexity_count, r.mid_complexity_count, r.low_complexity_count,
            r.non_routine_ratio, r.diversity_score, r.final_score, r.ranking,
            r.bonus_ratio, r.ticket_only_ratio, r.ratio_diff, uploadBatch
        );
    });
    
    return results;
}

// ============================================================
// 認證中間件
// ============================================================
function requireAuth(req, res, next) {
    if (req.session && req.session.userId) {
        return next();
    }
    return res.status(401).json({ error: '需要登入' });
}

// ============================================================
// API 路由
// ============================================================

// 登入
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        if (!username || !password) {
            return res.status(400).json({ error: '請輸入帳號和密碼' });
        }
        
        const admin = db.prepare('SELECT id, username, password_hash FROM admins WHERE username = ?').get(username);
        
        if (!admin) {
            return res.status(401).json({ error: '帳號或密碼錯誤' });
        }
        
        const isValid = bcrypt.compareSync(password, admin.password_hash);
        
        if (!isValid) {
            return res.status(401).json({ error: '帳號或密碼錯誤' });
        }
        
        // 建立 session
        req.session.userId = admin.id;
        req.session.username = admin.username;
        
        res.json({ 
            success: true, 
            message: '登入成功',
            username: admin.username
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: error.message });
    }
});

// 登出
app.post('/api/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).json({ error: '登出失敗' });
        }
        res.json({ success: true, message: '已登出' });
    });
});

// 檢查登入狀態
app.get('/api/auth/status', (req, res) => {
    if (req.session && req.session.userId) {
        res.json({ 
            authenticated: true, 
            username: req.session.username 
        });
    } else {
        res.json({ authenticated: false });
    }
});

// 修改密碼
app.post('/api/auth/change-password', requireAuth, async (req, res) => {
    try {
        const { oldPassword, newPassword } = req.body;
        
        if (!oldPassword || !newPassword) {
            return res.status(400).json({ error: '請輸入舊密碼和新密碼' });
        }
        
        if (newPassword.length < 6) {
            return res.status(400).json({ error: '新密碼長度至少需要 6 個字元' });
        }
        
        const admin = db.prepare('SELECT password_hash FROM admins WHERE id = ?').get(req.session.userId);
        
        const isValid = bcrypt.compareSync(oldPassword, admin.password_hash);
        if (!isValid) {
            return res.status(401).json({ error: '舊密碼錯誤' });
        }
        
        const newPasswordHash = bcrypt.hashSync(newPassword, 10);
        db.prepare('UPDATE admins SET password_hash = ? WHERE id = ?')
          .run(newPasswordHash, req.session.userId);
        
        res.json({ success: true, message: '密碼已更新' });
    } catch (error) {
        console.error('Change password error:', error);
        res.status(500).json({ error: error.message });
    }
});

// 保護所有 API 路由（除了登入相關）
app.use('/api', (req, res, next) => {
    // 允許登入、登出和檢查狀態的路由
    if (req.path === '/login' || req.path === '/logout' || req.path === '/auth/status') {
        return next();
    }
    requireAuth(req, res, next);
});

// 上傳並處理 Excel
app.post('/api/upload', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: '請選擇檔案' });
        }
        
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(req.file.path);
        
        const worksheet = workbook.worksheets[0];
        if (!worksheet) {
            return res.status(400).json({ error: '檔案中沒有工作表' });
        }
        
        // 讀取第一行作為欄位名稱
        const headerRow = worksheet.getRow(1);
        const headers = {};
        let colIndex = 1;
        headerRow.eachCell({ includeEmpty: false }, (cell) => {
            const headerName = cell.value ? String(cell.value).trim() : '';
            if (headerName) {
                headers[colIndex] = headerName;
            }
            colIndex++;
        });
        
        // 讀取資料行
        const data = [];
        worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
            if (rowNumber === 1) return; // 跳過標題行
            
            const rowData = {};
            let hasData = false;
            
            row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
                const header = headers[colNumber];
                if (header) {
                    let cellValue = cell.value;
                    
                    // 處理不同類型的值
                    if (cellValue === null || cellValue === undefined) {
                        cellValue = null;
                    } else if (cellValue instanceof Date) {
                        // 處理日期
                        const year = cellValue.getFullYear();
                        const month = String(cellValue.getMonth() + 1).padStart(2, '0');
                        const day = String(cellValue.getDate()).padStart(2, '0');
                        cellValue = `${year}-${month}-${day}`;
                    } else if (typeof cellValue === 'number') {
                        // 數字直接使用
                        cellValue = cellValue;
                    } else {
                        // 字串處理
                        cellValue = String(cellValue).trim();
                        if (cellValue === '') {
                            cellValue = null;
                        }
                    }
                    
                    rowData[header] = cellValue;
                    if (cellValue !== null) {
                        hasData = true;
                    }
                }
            });
            
            // 只添加有資料的行
            if (hasData) {
                data.push(rowData);
            }
        });
        
        if (data.length === 0) {
            // 刪除上傳的暫存檔
            fs.unlinkSync(req.file.path);
            return res.status(400).json({ error: '檔案無資料' });
        }
        
        const uploadBatch = `batch_${Date.now()}`;
        const keywords = getKeywords();
        
        // 欄位對應
        const fieldMap = {
            '任務編號': 'task_id',
            '叫修日期：': 'call_date',
            '工程人員': 'engineer',
            '客戶類別': 'customer_type',
            '工作類別': 'work_type',
            '工作內容': 'work_content',
            '需求說明': 'description',
            '總工時': 'total_hours',
            '處理說明': 'process_description'
        };
        
        const originalFilename = req.file.originalname || '未知檔案';
        
        const insert = db.prepare(`
            INSERT INTO maintenance_records 
            (task_id, call_date, engineer, customer_type, work_type, work_content,
             description, total_hours, process_description, complexity_score,
             complexity_level, matched_keywords, upload_batch, original_filename)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        
        let importedCount = 0;
        let skippedCount = 0;
        const transaction = db.transaction(() => {
            data.forEach(row => {
                const record = {};
                for (const [excelCol, dbCol] of Object.entries(fieldMap)) {
                    let value = row[excelCol] || null;
                    // 對工程人員姓名進行標準化處理
                    if (dbCol === 'engineer' && value) {
                        value = normalizeEngineerName(value);
                    }
                    record[dbCol] = value;
                }
                
                // 跳過沒有工程師名稱的記錄（但仍然記錄跳過數量）
                if (!record.engineer || record.engineer.trim() === '') {
                    skippedCount++;
                    console.log(`跳過沒有工程師名稱的記錄，任務編號: ${record.task_id || 'N/A'}`);
                    return;
                }
                
                // 計算複雜度
                const complexity = calculateComplexityScore(record, keywords);
                
                insert.run(
                    record.task_id, record.call_date, record.engineer,
                    record.customer_type, record.work_type, record.work_content,
                    record.description, record.total_hours, record.process_description,
                    complexity.score, complexity.level, complexity.matched, uploadBatch,
                    originalFilename
                );
                importedCount++;
            });
        });
        
        transaction();
        
        // 計算績效
        const results = calculatePerformance(uploadBatch);
        
        // 刪除上傳的暫存檔
        fs.unlinkSync(req.file.path);
        
        let message = `成功匯入 ${importedCount} 筆資料`;
        if (skippedCount > 0) {
            message += `，跳過 ${skippedCount} 筆無工程師名稱的記錄`;
        }
        
        res.json({
            success: true,
            message,
            uploadBatch,
            results,
            skippedCount
        });
        
    } catch (error) {
        console.error('Upload error:', error);
        // 確保刪除暫存檔
        if (req.file && fs.existsSync(req.file.path)) {
            try {
                fs.unlinkSync(req.file.path);
            } catch (e) {
                console.error('Failed to delete temp file:', e);
            }
        }
        res.status(500).json({ error: error.message });
    }
});

// 取得績效結果
app.get('/api/results/:batch', (req, res) => {
    try {
        const results = db.prepare(`
            SELECT * FROM performance_results 
            WHERE upload_batch = ? 
            ORDER BY ranking
        `).all(req.params.batch);
        
        res.json(results);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 取得最新批次
app.get('/api/latest-batch', (req, res) => {
    try {
        const result = db.prepare(`
            SELECT upload_batch FROM performance_results 
            ORDER BY created_at DESC LIMIT 1
        `).get();
        
        res.json({ batch: result?.upload_batch || null });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 取得工單明細
app.get('/api/records/:batch', (req, res) => {
    try {
        const records = db.prepare(`
            SELECT * FROM maintenance_records 
            WHERE upload_batch = ? 
            ORDER BY complexity_score DESC
        `).all(req.params.batch);
        
        // 取得關鍵字列表用於計算明細
        const keywords = getKeywords();
        
        // 為每筆記錄添加計算明細
        const recordsWithDetails = records.map(record => {
            const complexity = calculateComplexityScore(record, keywords, true);
            return {
                ...record,
                complexityDetails: complexity.details
            };
        });
        
        res.json(recordsWithDetails);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 取得權重設定
app.get('/api/weights', (req, res) => {
    try {
        const weights = db.prepare('SELECT * FROM weight_settings').all();
        res.json(weights);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 更新權重
app.put('/api/weights', (req, res) => {
    try {
        const { weights } = req.body;
        
        const update = db.prepare('UPDATE weight_settings SET weight = ? WHERE name = ?');
        const transaction = db.transaction(() => {
            for (const [name, weight] of Object.entries(weights)) {
                update.run(weight, name);
            }
        });
        transaction();
        
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 重新計算績效
app.post('/api/recalculate/:batch', (req, res) => {
    try {
        const batch = req.params.batch;
        
        // 取得最新的關鍵字列表
        const keywords = getKeywords();
        
        // 取得該批次的所有記錄
        const records = db.prepare(`
            SELECT id, task_id, call_date, engineer, customer_type, work_type, 
                   work_content, description, total_hours, process_description
            FROM maintenance_records
            WHERE upload_batch = ?
        `).all(batch);
        
        // 重新計算每筆記錄的複雜度分數
        const updateComplexity = db.prepare(`
            UPDATE maintenance_records
            SET complexity_score = ?, complexity_level = ?, matched_keywords = ?
            WHERE id = ?
        `);
        
        const updateTransaction = db.transaction(() => {
            records.forEach(record => {
                const complexity = calculateComplexityScore(record, keywords);
                updateComplexity.run(
                    complexity.score,
                    complexity.level,
                    complexity.matched,
                    record.id
                );
            });
        });
        
        updateTransaction();
        
        // 重新計算績效
        const results = calculatePerformance(batch);
        
        res.json({ success: true, results });
    } catch (error) {
        console.error('Recalculate error:', error);
        res.status(500).json({ error: error.message });
    }
});

// 取得關鍵字設定
app.get('/api/keywords', (req, res) => {
    try {
        const keywords = db.prepare('SELECT * FROM keywords ORDER BY level, keyword').all();
        res.json(keywords);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 新增關鍵字
app.post('/api/keywords', (req, res) => {
    try {
        const { keyword, level, score } = req.body;
        db.prepare('INSERT INTO keywords (keyword, level, score) VALUES (?, ?, ?)')
          .run(keyword, level, score);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 刪除關鍵字
app.delete('/api/keywords/:id', (req, res) => {
    try {
        db.prepare('DELETE FROM keywords WHERE id = ?').run(req.params.id);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 批次刪除關鍵字
app.post('/api/keywords/batch-delete', (req, res) => {
    try {
        const { ids } = req.body;
        if (!Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ error: '請提供要刪除的關鍵字 ID 陣列' });
        }

        // 僅保留有效的正整數 ID
        const validIds = ids.map(Number).filter(n => Number.isInteger(n) && n > 0);
        if (validIds.length === 0) {
            return res.status(400).json({ error: '沒有有效的關鍵字 ID' });
        }

        const del = db.prepare('DELETE FROM keywords WHERE id = ?');
        const deleteMany = db.transaction((idList) => {
            let count = 0;
            for (const id of idList) count += del.run(id).changes;
            return count;
        });
        const deleted = deleteMany(validIds);

        res.json({ success: true, deleted });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 下載關鍵字匯入範本
app.get('/api/keywords/template', async (req, res) => {
    try {
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('關鍵字範本');
        
        // 設定欄位
        worksheet.columns = [
            { header: '關鍵字', key: 'keyword', width: 30 },
            { header: '專業度等級', key: 'level', width: 20 },
            { header: '分數', key: 'score', width: 10 }
        ];
        
        // 添加範例資料
        const exampleData = [
            { keyword: 'DNS', level: '高專業度', score: 25 },
            { keyword: 'VPN', level: '高專業度', score: 25 },
            { keyword: 'NAS', level: '中專業度', score: 10 },
            { keyword: 'Outlook', level: '中專業度', score: 10 },
            { keyword: '重開機', level: '低專業度', score: 2 },
            { keyword: '密碼重設', level: '低專業度', score: 2 }
        ];
        
        exampleData.forEach(row => worksheet.addRow(row));
        
        // 設定標題樣式
        worksheet.getRow(1).font = { bold: true };
        worksheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFBDD7EE' } };
        
        // 添加說明行（在標題下方）
        worksheet.insertRow(2, ['說明：', '專業度等級必須為「高專業度」、「中專業度」或「低專業度」', '分數為選填，未填寫時將使用預設值（高專業度25分、中專業度10分、低專業度2分）']);
        worksheet.getRow(2).font = { italic: true, color: { argb: 'FF666666' } };
        
        // 設定回應
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=keywords_template.xlsx');
        
        await workbook.xlsx.write(res);
        res.end();
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 匯出關鍵字
app.get('/api/keywords/export', async (req, res) => {
    try {
        const keywords = db.prepare('SELECT keyword, level, score FROM keywords ORDER BY level, keyword').all();
        
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('關鍵字列表');
        
        // 設定欄位
        worksheet.columns = [
            { header: '關鍵字', key: 'keyword', width: 30 },
            { header: '專業度等級', key: 'level', width: 15 },
            { header: '分數', key: 'score', width: 10 }
        ];
        
        // 添加資料
        keywords.forEach(k => worksheet.addRow(k));
        
        // 設定標題樣式
        worksheet.getRow(1).font = { bold: true };
        worksheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFBDD7EE' } };
        
        // 設定回應
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=keywords_export_${new Date().toISOString().split('T')[0]}.xlsx`);
        
        await workbook.xlsx.write(res);
        res.end();
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 批次匯入關鍵字
app.post('/api/keywords/import', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: '請選擇檔案' });
        }
        
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(req.file.path);
        
        const worksheet = workbook.worksheets[0];
        if (!worksheet) {
            fs.unlinkSync(req.file.path);
            return res.status(400).json({ error: '檔案中沒有工作表' });
        }
        
        // 讀取第一行作為欄位名稱
        const headerRow = worksheet.getRow(1);
        const headers = {};
        let colIndex = 1;
        headerRow.eachCell({ includeEmpty: false }, (cell) => {
            const headerName = cell.value ? String(cell.value).trim() : '';
            if (headerName) {
                headers[colIndex] = headerName;
            }
            colIndex++;
        });
        
        // 檢查必要欄位
        const requiredFields = ['關鍵字', '專業度等級'];
        const headerValues = Object.values(headers);
        const missingFields = requiredFields.filter(f => !headerValues.includes(f));
        if (missingFields.length > 0) {
            fs.unlinkSync(req.file.path);
            return res.status(400).json({ error: `缺少必要欄位：${missingFields.join(', ')}` });
        }
        
        // 找出欄位索引
        let keywordCol = null, levelCol = null, scoreCol = null;
        Object.entries(headers).forEach(([col, name]) => {
            if (name === '關鍵字') keywordCol = parseInt(col);
            if (name === '專業度等級') levelCol = parseInt(col);
            if (name === '分數') scoreCol = parseInt(col);
        });
        
        // 讀取資料行
        const keywords = [];
        const errors = [];
        const insertStmt = db.prepare('INSERT INTO keywords (keyword, level, score) VALUES (?, ?, ?)');
        
        worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
            if (rowNumber === 1) return; // 跳過標題行
            
            try {
                const keywordCell = row.getCell(keywordCol);
                const levelCell = row.getCell(levelCol);
                const scoreCell = scoreCol ? row.getCell(scoreCol) : null;
                
                const keyword = keywordCell.value ? String(keywordCell.value).trim() : '';
                const level = levelCell.value ? String(levelCell.value).trim() : '';
                
                if (!keyword) {
                    errors.push(`第 ${rowNumber} 行：關鍵字不能為空`);
                    return;
                }
                
                if (!level) {
                    errors.push(`第 ${rowNumber} 行：專業度等級不能為空`);
                    return;
                }
                
                // 驗證專業度等級
                const validLevels = ['高專業度', '中專業度', '低專業度'];
                if (!validLevels.includes(level)) {
                    errors.push(`第 ${rowNumber} 行：專業度等級必須為「高專業度」、「中專業度」或「低專業度」`);
                    return;
                }
                
                // 計算分數（如果沒有提供，使用預設值）
                let score = null;
                if (scoreCell && scoreCell.value !== null && scoreCell.value !== undefined) {
                    score = typeof scoreCell.value === 'number' ? scoreCell.value : parseFloat(String(scoreCell.value));
                    if (isNaN(score)) {
                        // 使用預設分數
                        const defaultScores = { '高專業度': 25, '中專業度': 10, '低專業度': 2 };
                        score = defaultScores[level];
                    }
                } else {
                    // 使用預設分數
                    const defaultScores = { '高專業度': 25, '中專業度': 10, '低專業度': 2 };
                    score = defaultScores[level];
                }
                
                // 檢查是否已存在（關鍵字和等級相同視為重複）
                const existing = db.prepare('SELECT id FROM keywords WHERE keyword = ? AND level = ?').get(keyword, level);
                if (existing) {
                    // 更新現有記錄的分數
                    db.prepare('UPDATE keywords SET score = ? WHERE id = ?').run(score, existing.id);
                    keywords.push({ keyword, level, score, action: 'updated' });
                } else {
                    // 新增記錄
                    insertStmt.run(keyword, level, score);
                    keywords.push({ keyword, level, score, action: 'inserted' });
                }
            } catch (error) {
                errors.push(`第 ${rowNumber} 行：${error.message}`);
            }
        });
        
        // 刪除上傳的檔案
        fs.unlinkSync(req.file.path);
        
        res.json({
            success: true,
            imported: keywords.filter(k => k.action === 'inserted').length,
            updated: keywords.filter(k => k.action === 'updated').length,
            errors: errors.length > 0 ? errors : undefined
        });
    } catch (error) {
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        res.status(500).json({ error: error.message });
    }
});

// 取得設備類型設定
app.get('/api/device-types', (req, res) => {
    try {
        const deviceTypes = db.prepare('SELECT * FROM device_types ORDER BY score DESC, device_name').all();
        res.json(deviceTypes);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 新增設備類型
app.post('/api/device-types', (req, res) => {
    try {
        const { device_name, score } = req.body;
        if (!device_name || score === undefined) {
            return res.status(400).json({ error: '設備名稱和分數為必填欄位' });
        }
        db.prepare('INSERT INTO device_types (device_name, score) VALUES (?, ?)')
          .run(device_name, score);
        res.json({ success: true });
    } catch (error) {
        if (error.message.includes('UNIQUE constraint')) {
            res.status(400).json({ error: '此設備類型已存在' });
        } else {
            res.status(500).json({ error: error.message });
        }
    }
});

// 更新設備類型
app.put('/api/device-types/:id', (req, res) => {
    try {
        const { score } = req.body;
        if (score === undefined || score < 0 || score > 100) {
            return res.status(400).json({ error: '請提供有效的分數（0-100）' });
        }
        const result = db.prepare('UPDATE device_types SET score = ? WHERE id = ?').run(score, req.params.id);
        if (result.changes === 0) {
            return res.status(404).json({ error: '設備類型不存在' });
        }
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 刪除設備類型
app.delete('/api/device-types/:id', (req, res) => {
    try {
        db.prepare('DELETE FROM device_types WHERE id = ?').run(req.params.id);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 匯出 Excel 報表
app.get('/api/export/:batch', async (req, res) => {
    try {
        const batch = req.params.batch;
        
        const results = db.prepare(`
            SELECT * FROM performance_results WHERE upload_batch = ? ORDER BY ranking
        `).all(batch);
        
        const records = db.prepare(`
            SELECT * FROM maintenance_records WHERE upload_batch = ? ORDER BY complexity_score DESC
        `).all(batch);
        
        const weights = db.prepare('SELECT * FROM weight_settings').all();
        
        const workbook = new ExcelJS.Workbook();
        
        // Sheet 1: 績效總覽
        const ws1 = workbook.addWorksheet('績效總覽');
        ws1.columns = [
            { header: '工程人員', key: 'engineer', width: 12 },
            { header: '績效排名', key: 'ranking', width: 10 },
            { header: '綜合績效分數', key: 'final_score', width: 14 },
            { header: '工單完成數', key: 'ticket_count', width: 12 },
            { header: '總服務工時', key: 'total_hours', width: 12 },
            { header: '平均案件複雜度', key: 'avg_complexity', width: 14 },
            { header: '高複雜度案件數', key: 'high_complexity_count', width: 14 },
            { header: '獎金分配比例(%)', key: 'bonus_ratio', width: 14 },
            { header: '純工單數分配(%)', key: 'ticket_only_ratio', width: 14 },
            { header: '分配差異(%)', key: 'ratio_diff', width: 12 }
        ];
        
        results.forEach(r => ws1.addRow(r));
        
        // 設定標題樣式
        ws1.getRow(1).font = { bold: true };
        ws1.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFBDD7EE' } };
        
        // Sheet 2: 權重說明
        const ws2 = workbook.addWorksheet('評分機制說明');
        ws2.columns = [
            { header: '指標', key: 'description', width: 20 },
            { header: '權重', key: 'weight', width: 10 }
        ];
        weights.forEach(w => ws2.addRow({ description: w.description, weight: `${(w.weight * 100).toFixed(0)}%` }));
        ws2.getRow(1).font = { bold: true };
        
        // Sheet 3: 工單明細
        const ws3 = workbook.addWorksheet('工單複雜度明細');
        ws3.columns = [
            { header: '任務編號', key: 'task_id', width: 14 },
            { header: '叫修日期', key: 'call_date', width: 12 },
            { header: '工程人員', key: 'engineer', width: 10 },
            { header: '工作類別', key: 'work_type', width: 20 },
            { header: '總工時', key: 'total_hours', width: 8 },
            { header: '複雜度分數', key: 'complexity_score', width: 12 },
            { header: '複雜度等級', key: 'complexity_level', width: 12 },
            { header: '匹配關鍵字', key: 'matched_keywords', width: 30 },
            { header: '處理說明', key: 'process_description', width: 50 }
        ];
        records.forEach(r => ws3.addRow(r));
        ws3.getRow(1).font = { bold: true };
        
        // 設定回應
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=performance_report_${batch}.xlsx`);
        
        await workbook.xlsx.write(res);
        res.end();
        
    } catch (error) {
        console.error('Export error:', error);
        res.status(500).json({ error: error.message });
    }
});

// 取得歷史批次列表
app.get('/api/batches', (req, res) => {
    try {
        const batches = db.prepare(`
            SELECT 
                mr.upload_batch,
                MIN(mr.created_at) as created_at,
                COUNT(*) as record_count,
                (SELECT original_filename FROM maintenance_records mr2 
                 WHERE mr2.upload_batch = mr.upload_batch 
                 AND mr2.original_filename IS NOT NULL 
                 LIMIT 1) as original_filename
            FROM maintenance_records mr
            GROUP BY mr.upload_batch 
            ORDER BY created_at DESC
            LIMIT 20
        `).all();
        
        res.json(batches);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 啟動伺服器
app.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════════════════════════╗
║     維護記錄單績效評比系統 v3.0                              ║
║     Server running at http://localhost:${PORT}                ║
╚════════════════════════════════════════════════════════════╝
    `);
});
